/**
 * AudioEngine — motor de processamento de áudio em tempo real.
 *
 * Pipeline (mono):
 *   microfone → RNNoise (WASM) → highpass → lowpass → peaking EQ
 *              → gain → compressor → noise-gate → saída
 *
 * Roda inteiramente no cliente (browser). Utiliza Web Audio API + AudioWorklet.
 * Projetado para baixa latência em smartphones Android com headset.
 */

export type RNNoiseStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface EngineSettings {
  volume: number;           // ganho em dB
  speech: number;           // EQ peaking em dB (3 kHz)
  noiseCut: number;         // highpass em Hz
  gateThreshold: number;    // limiar do gate em dB
  noiseGate: boolean;
  browserNoise: boolean;    // usar noiseSuppression/echoCancellation do browser
  rnnoiseEnabled: boolean;
  lowLatency: boolean;
  inputDeviceId?: string;
  outputDeviceId?: string;
}

export interface MeterData {
  rmsDb: number;
  peak: number;
}

export interface EngineCallbacks {
  onMeter?(data: MeterData): void;
  onRNNoiseStatus?(status: RNNoiseStatus): void;
  onDeviceLabel?(label: string): void;
  onClip?(active: boolean): void;
  onFeedback?(active: boolean): void;
}

interface AudioNodes {
  source?: MediaStreamAudioSourceNode;
  rnnoise?: AudioWorkletNode;
  noiseCut?: BiquadFilterNode;
  lowpass?: BiquadFilterNode;
  speech?: BiquadFilterNode;
  volume?: GainNode;
  compressor?: DynamicsCompressorNode;
  gate?: AudioWorkletNode;
  analyser?: AnalyserNode;
  mediaDest?: MediaStreamAudioDestinationNode;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nodes: AudioNodes = {};
  private outputEl: HTMLAudioElement | null = null;
  private cb: EngineCallbacks = {};
  private clipHold = 0;
  private feedbackHold = 0;
  private currentRmsDb = -60;

  constructor(callbacks: EngineCallbacks = {}) {
    this.cb = callbacks;
  }

  // ----- Lifecycle ----

  async start(s: EngineSettings): Promise<void> {
    if (this.ctx) return;

    this.ctx = new AudioContext({
      latencyHint: s.lowLatency ? 0.01 : 'interactive',
    } as AudioContextOptions);
    await this.ctx.resume();

    // Carrega worklets
    await Promise.all([
      this.ctx.audioWorklet.addModule('/worklets/gate-meter-processor.js'),
      this.ctx.audioWorklet.addModule('/worklets/rnnoise-processor.js'),
    ]);

    // Captura de microfone via WebRTC getUserMedia
    const constraints: MediaTrackConstraints = {
      echoCancellation: s.browserNoise,
      noiseSuppression: s.browserNoise,
      autoGainControl: s.browserNoise,
    };
    if (s.inputDeviceId) {
      Object.assign(constraints, { deviceId: { exact: s.inputDeviceId } });
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    } catch {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: s.browserNoise,
          noiseSuppression: s.browserNoise,
          autoGainControl: s.browserNoise,
        },
      });
    }

    const track = this.stream.getAudioTracks()[0];
    if (track?.label) this.cb.onDeviceLabel?.(track.label);

    // Nodes
    this.nodes.source = this.ctx.createMediaStreamSource(this.stream);

    this.nodes.rnnoise = new AudioWorkletNode(this.ctx, 'rnnoise-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.startRNNoise(this.nodes.rnnoise, s.rnnoiseEnabled);

    this.nodes.noiseCut = this.ctx.createBiquadFilter();
    this.nodes.noiseCut.type = 'highpass';
    this.nodes.noiseCut.frequency.value = s.noiseCut;
    this.nodes.noiseCut.Q.value = 0.707;

    this.nodes.lowpass = this.ctx.createBiquadFilter();
    this.nodes.lowpass.type = 'lowpass';
    this.nodes.lowpass.frequency.value = 9000;
    this.nodes.lowpass.Q.value = 0.707;

    this.nodes.speech = this.ctx.createBiquadFilter();
    this.nodes.speech.type = 'peaking';
    this.nodes.speech.frequency.value = 3000;
    this.nodes.speech.Q.value = 1.0;
    this.nodes.speech.gain.value = s.speech;

    this.nodes.volume = this.ctx.createGain();
    this.nodes.volume.gain.value = this.dBToGain(s.volume);

    this.nodes.compressor = this.ctx.createDynamicsCompressor();
    this.nodes.compressor.threshold.value = -55;
    this.nodes.compressor.knee.value = 24;
    this.nodes.compressor.ratio.value = 6;
    this.nodes.compressor.attack.value = 0.005;
    this.nodes.compressor.release.value = 0.15;

    this.nodes.gate = new AudioWorkletNode(this.ctx, 'gate-meter-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      parameterData: {
        thresholdDb: s.gateThreshold,
        gateEnabled: s.noiseGate ? 1 : 0,
        minGain: 0.15,
      },
    });
    this.nodes.gate.port.onmessage = (e) => this.handleMeter(e.data);

    this.nodes.analyser = this.ctx.createAnalyser();
    this.nodes.analyser.fftSize = 1024;

    // Cadeia: source → rnnoise → highpass → lowpass → peaking → gain → compressor → gate → analyser
    this.nodes.source
      .connect(this.nodes.rnnoise)
      .connect(this.nodes.noiseCut)
      .connect(this.nodes.lowpass)
      .connect(this.nodes.speech)
      .connect(this.nodes.volume)
      .connect(this.nodes.compressor)
      .connect(this.nodes.gate)
      .connect(this.nodes.analyser);

    // Saída — tenta usar setSinkId para rotear para o headset correto
    const canSetSink = 'setSinkId' in HTMLAudioElement.prototype;
    if (canSetSink) {
      this.nodes.mediaDest = this.ctx.createMediaStreamDestination();
      this.nodes.gate.connect(this.nodes.mediaDest);
      this.outputEl = new Audio();
      this.outputEl.autoplay = true;
      this.outputEl.srcObject = this.nodes.mediaDest.stream;

      // Resolve o outputDeviceId: se não foi fornecido, tenta casar com o input
      let sinkId = s.outputDeviceId && s.outputDeviceId !== '' ? s.outputDeviceId : null;
      if (!sinkId && s.inputDeviceId) {
        sinkId = await AudioEngine.matchOutputForInput(s.inputDeviceId);
      }

      try {
        if (sinkId) {
          await (this.outputEl as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(sinkId);
        }
        await this.outputEl.play();
      } catch (err) {
        console.warn('[AudioEngine] setSinkId falhou, usando saída padrão:', err);
        try { this.outputEl.pause(); } catch { /* noop */ }
        this.outputEl.srcObject = null;
        this.outputEl = null;
        this.nodes.gate.connect(this.ctx.destination);
      }
    } else {
      this.nodes.gate.connect(this.ctx.destination);
    }
  }

  async stop(): Promise<void> {
    if (!this.ctx) return;

    Object.values(this.nodes).forEach((n) => {
      try { (n as AudioNode).disconnect(); } catch { /* noop */ }
    });

    if (this.nodes.gate?.port) this.nodes.gate.port.onmessage = null;
    if (this.nodes.rnnoise?.port) this.nodes.rnnoise.port.onmessage = null;

    this.stream?.getTracks().forEach((t) => t.stop());

    if (this.outputEl) {
      this.outputEl.pause();
      this.outputEl.srcObject = null;
    }

    await this.ctx.close();
    this.ctx = null;
    this.stream = null;
    this.nodes = {};
    this.outputEl = null;
    this.clipHold = 0;
    this.feedbackHold = 0;
    this.currentRmsDb = -60;
  }

  // ----- Parâmetros em tempo real -----

  updateSettings(p: Partial<EngineSettings>): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    if (p.volume !== undefined && this.nodes.volume)
      this.nodes.volume.gain.setValueAtTime(this.dBToGain(p.volume), t);

    if (p.speech !== undefined && this.nodes.speech)
      this.nodes.speech.gain.setValueAtTime(p.speech, t);

    if (p.noiseCut !== undefined && this.nodes.noiseCut)
      this.nodes.noiseCut.frequency.setValueAtTime(p.noiseCut, t);

    if (p.gateThreshold !== undefined && this.nodes.gate)
      this.nodes.gate.parameters.get('thresholdDb')?.setValueAtTime(p.gateThreshold, t);

    if (p.noiseGate !== undefined && this.nodes.gate)
      this.nodes.gate.parameters.get('gateEnabled')?.setValueAtTime(p.noiseGate ? 1 : 0, t);

    if (p.rnnoiseEnabled !== undefined && this.nodes.rnnoise) {
      // Atualiza pendingEnabled caso o worklet ainda não esteja pronto
      const n = this.nodes.rnnoise as AudioWorkletNode & { _setPendingEnabled?(v: boolean): void };
      n._setPendingEnabled?.(p.rnnoiseEnabled);
      n.port.postMessage({ type: 'enable', value: p.rnnoiseEnabled });
    }
  }

  async calibrateGate(): Promise<number> {
    const start = Date.now();
    let sum = 0;
    let count = 0;
    while (Date.now() - start < 1500) {
      sum += this.currentRmsDb;
      count++;
      await new Promise((r) => setTimeout(r, 50));
    }
    return count > 0 ? Math.min(-20, Math.max(-70, Math.round(sum / count + 6))) : -50;
  }

  getAnalyser(): AnalyserNode | null {
    return this.nodes.analyser ?? null;
  }

  isRunning(): boolean {
    return this.ctx !== null;
  }

  // ----- Dispositivos -----

  static async enumerateDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
    if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [] };
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      return {
        inputs:  list.filter((d) => d.kind === 'audioinput'),
        outputs: list.filter((d) => d.kind === 'audiooutput'),
      };
    } catch {
      return { inputs: [], outputs: [] };
    }
  }

  /**
   * Tenta encontrar o dispositivo de saída que corresponde ao mesmo
   * hardware do input (ex: headset USB Logitech).
   * Usa groupId quando disponível, senão tenta casar pelo label.
   */
  static async matchOutputForInput(inputDeviceId: string): Promise<string | null> {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const input = list.find((d) => d.kind === 'audioinput' && d.deviceId === inputDeviceId);
      if (!input) return null;

      // 1. Tenta casar por groupId (mais confiável)
      if (input.groupId) {
        const byGroup = list.find(
          (d) => d.kind === 'audiooutput' && d.groupId === input.groupId
        );
        if (byGroup) return byGroup.deviceId;
      }

      // 2. Fallback: casar por prefixo do label (ex: "Logitech H390")
      if (input.label) {
        const words = input.label.split(/[\s(]+/).filter((w) => w.length > 3);
        const byLabel = list.find(
          (d) =>
            d.kind === 'audiooutput' &&
            words.some((w) => d.label.toLowerCase().includes(w.toLowerCase()))
        );
        if (byLabel) return byLabel.deviceId;
      }
    } catch { /* noop */ }
    return null;
  }

  // ----- Internos -----

  private dBToGain(db: number): number {
    return Math.pow(10, db / 20);
  }

  private handleMeter(data: { type: string; rmsDb: number; peak: number }): void {
    if (!data || data.type !== 'meter') return;
    const { rmsDb, peak } = data;
    this.currentRmsDb = rmsDb;
    this.cb.onMeter?.({ rmsDb, peak });

    // Clip
    if (peak > 0.98) this.clipHold = 12;
    if (this.clipHold > 0) {
      this.clipHold--;
      this.cb.onClip?.(true);
    } else {
      this.cb.onClip?.(false);
    }

    // Feedback (microfonia) — limiar em -8 dB para evitar falso-positivo com headset
    if (rmsDb > -8) this.feedbackHold = 50;
    else if (this.feedbackHold > 0) this.feedbackHold--;
    this.cb.onFeedback?.(this.feedbackHold > 0);
  }

  private startRNNoise(node: AudioWorkletNode, initialEnabled: boolean): void {
    // Guarda o estado desejado — será enviado quando o worklet confirmar 'ready'
    let pendingEnabled = initialEnabled;

    node.port.onmessage = (e) => {
      if (!e.data) return;
      if (e.data.type === 'ready') {
        this.cb.onRNNoiseStatus?.('ready');
        // Envia o estado inicial APÓS o worklet estar pronto
        node.port.postMessage({ type: 'enable', value: pendingEnabled });
      } else if (e.data.type === 'error') {
        console.warn('[RNNoise]', e.data.message);
        this.cb.onRNNoiseStatus?.('error');
      }
    };

    // Intercepta chamadas externas a enable para manter pendingEnabled atualizado
    // caso updateSettings() seja chamado antes de 'ready'
    const origUpdateSettings = this.updateSettings.bind(this);
    void origUpdateSettings; // referência usada apenas para clareza

    this.cb.onRNNoiseStatus?.('loading');

    // Faz fetch() na main thread, envia o binário como CÓPIA (não transferable)
    // para evitar que o ArrayBuffer seja consumido (causa do erro anterior)
    fetch('/rnnoise/rnnoise.wasm')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        // Copia o buffer — NÃO usa lista de transferables, seguro para reuso
        const wasmBinary = buf.slice(0);
        node.port.postMessage({ type: 'load', jsUrl: '/rnnoise/rnnoise.js', wasmBinary });
      })
      .catch((err) => {
        console.warn('[RNNoise] Falha ao carregar WASM:', err);
        this.cb.onRNNoiseStatus?.('error');
      });

    // Expõe setter para que updateSettings() atualize pendingEnabled
    (node as AudioWorkletNode & { _setPendingEnabled(v: boolean): void })._setPendingEnabled =
      (v: boolean) => { pendingEnabled = v; };
  }
}
