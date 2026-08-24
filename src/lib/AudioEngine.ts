/**
 * Motor de audio em tempo real do OpenHear.
 *
 * Modos de diagnostico:
 *   raw  — microfone sem ganho ou DSP
 *   gain — microfone + ganho
 *   dsp  — filtros + EQ + compressor moderado + ganho
 *   full — RNNoise opcional + DSP + gate opcional
 */

export type RNNoiseStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ProcessingMode = 'raw' | 'gain' | 'dsp' | 'full';
export type AudioSessionState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'degraded'
  | 'suspended'
  | 'error';

export interface EngineSettings {
  processingMode: ProcessingMode;
  volume: number;
  speech: number;
  noiseCut: number;
  gateThreshold: number;
  noiseGate: boolean;
  browserNoise: boolean;
  rnnoiseEnabled: boolean;
  lowLatency: boolean;
  inputDeviceId?: string;
  outputDeviceId?: string;
}

export interface MeterData {
  rmsDb: number;
  peak: number;
}

export type OutputRoute = 'system-default' | 'audio-context' | 'media-element' | 'fallback';

export interface AudioDiagnostics {
  contextSampleRate: number;
  inputSampleRate: number | null;
  inputChannelCount: number | null;
  inputLatencyMs: number | null;
  baseLatencyMs: number | null;
  outputLatencyMs: number | null;
  inputDeviceId: string | null;
  inputDeviceLabel: string;
  inputFallback: boolean;
  outputDeviceId: string | null;
  outputRoute: OutputRoute;
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  processingMode: ProcessingMode;
  secureContext: boolean;
}

export interface EngineCallbacks {
  onMeter?(data: MeterData): void;
  onRNNoiseStatus?(status: RNNoiseStatus): void;
  onDeviceLabel?(label: string): void;
  onClip?(active: boolean): void;
  onDiagnostics?(diagnostics: AudioDiagnostics): void;
  onSessionState?(state: AudioSessionState): void;
  onWarning?(message: string): void;
}

interface AudioNodes {
  source?: MediaStreamAudioSourceNode;
  inputMeter?: AudioWorkletNode;
  rnnoise?: AudioWorkletNode;
  noiseCut?: BiquadFilterNode;
  lowpass?: BiquadFilterNode;
  speech?: BiquadFilterNode;
  gainVolume?: GainNode;
  dspVolume?: GainNode;
  compressor?: DynamicsCompressorNode;
  gate?: AudioWorkletNode;
  rawMode?: GainNode;
  gainMode?: GainNode;
  dspMode?: GainNode;
  fullMode?: GainNode;
  dspDirectInput?: GainNode;
  dspRNInput?: GainNode;
  outputBus?: GainNode;
  safetyLimiter?: DynamicsCompressorNode;
  masterFade?: GainNode;
  analyser?: AnalyserNode;
  mediaDest?: MediaStreamAudioDestinationNode;
}

type AudioContextWithSink = AudioContext & {
  sinkId?: string;
  setSinkId?(sinkId: string): Promise<void>;
};

type AudioConstraintsWithLatency = MediaTrackConstraints & {
  latency?: { ideal: number };
};

type AudioSettingsWithLatency = MediaTrackSettings & {
  latency?: number;
};

const MODE_KEYS: ProcessingMode[] = ['raw', 'gain', 'dsp', 'full'];

export class AudioEngine {
  private ctx: AudioContextWithSink | null = null;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private nodes: AudioNodes = {};
  private outputEl: HTMLAudioElement | null = null;
  private callbacks: EngineCallbacks;
  private settings: EngineSettings | null = null;
  private currentRmsDb = -96;
  private clipHold = 0;
  private inputFallback = false;
  private outputRoute: OutputRoute = 'system-default';
  private rnnoiseFailed = false;
  private stopping = false;

  constructor(callbacks: EngineCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async start(settings: EngineSettings): Promise<void> {
    if (this.ctx) return;

    this.settings = settings;
    this.callbacks.onSessionState?.('starting');

    try {
      this.ctx = new AudioContext({
        latencyHint: settings.lowLatency ? 0.01 : 'interactive',
        sampleRate: 48000,
      } as AudioContextOptions) as AudioContextWithSink;
      this.ctx.onstatechange = () => this.handleContextState();
      await this.ctx.resume();

      await Promise.all([
        this.ctx.audioWorklet.addModule('/worklets/gate-meter-processor.js'),
        this.ctx.audioWorklet.addModule('/worklets/rnnoise-processor.js'),
      ]);

      this.stream = await this.openInput(settings);
      this.track = this.stream.getAudioTracks()[0] ?? null;
      if (!this.track) throw new Error('Nenhuma faixa de audio foi disponibilizada pelo navegador.');

      this.track.onended = () => {
        this.callbacks.onWarning?.('O microfone foi desconectado ou deixou de estar disponível.');
        void this.stop(false)
          .catch(() => { /* o estado de erro ainda precisa chegar à UI */ })
          .finally(() => this.callbacks.onSessionState?.('error'));
      };
      this.track.onmute = () => this.callbacks.onSessionState?.('suspended');
      this.track.onunmute = () => this.emitOperationalState();

      if (this.track.label) this.callbacks.onDeviceLabel?.(this.track.label);

      this.createGraph(settings);
      await this.configureOutput(settings.outputDeviceId ?? '');
      this.emitDiagnostics();

      const now = this.ctx.currentTime;
      this.nodes.masterFade?.gain.setValueAtTime(0, now);
      this.nodes.masterFade?.gain.linearRampToValueAtTime(1, now + 0.08);

      this.emitOperationalState();
    } catch (error) {
      const message = AudioEngine.describeError(error);
      await this.stop(false);
      this.callbacks.onSessionState?.('error');
      throw new Error(message, { cause: error });
    }
  }

  async stop(notify = true): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;

    const ctx = this.ctx;
    if (ctx && ctx.state === 'running' && this.nodes.masterFade) {
      const now = ctx.currentTime;
      this.nodes.masterFade.gain.cancelScheduledValues(now);
      this.nodes.masterFade.gain.setValueAtTime(this.nodes.masterFade.gain.value, now);
      this.nodes.masterFade.gain.linearRampToValueAtTime(0, now + 0.05);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    this.nodes.rnnoise?.port.postMessage({ type: 'destroy' });
    if (this.nodes.inputMeter?.port) this.nodes.inputMeter.port.onmessage = null;
    if (this.nodes.rnnoise?.port) this.nodes.rnnoise.port.onmessage = null;

    Object.values(this.nodes).forEach((node) => {
      try { (node as AudioNode).disconnect(); } catch { /* no-op */ }
    });

    if (this.track) {
      this.track.onended = null;
      this.track.onmute = null;
      this.track.onunmute = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());

    if (this.outputEl) {
      this.outputEl.pause();
      this.outputEl.srcObject = null;
    }

    if (ctx) {
      ctx.onstatechange = null;
      if (ctx.state !== 'closed') await ctx.close();
    }

    this.ctx = null;
    this.stream = null;
    this.track = null;
    this.nodes = {};
    this.outputEl = null;
    this.settings = null;
    this.currentRmsDb = -96;
    this.clipHold = 0;
    this.inputFallback = false;
    this.outputRoute = 'system-default';
    this.rnnoiseFailed = false;
    this.stopping = false;

    this.callbacks.onRNNoiseStatus?.('idle');
    if (notify) this.callbacks.onSessionState?.('idle');
  }

  async resume(): Promise<void> {
    if (!this.ctx || this.ctx.state === 'closed') return;
    await this.ctx.resume();
    this.emitOperationalState();
  }

  updateSettings(patch: Partial<EngineSettings>): void {
    if (!this.ctx || !this.settings) return;
    this.settings = { ...this.settings, ...patch };
    const now = this.ctx.currentTime;

    if (patch.processingMode !== undefined) this.applyMode(patch.processingMode, now);

    if (patch.volume !== undefined) {
      const gain = this.dbToGain(patch.volume);
      this.nodes.gainVolume?.gain.setTargetAtTime(gain, now, 0.015);
      this.nodes.dspVolume?.gain.setTargetAtTime(gain, now, 0.015);
    }
    if (patch.speech !== undefined)
      this.nodes.speech?.gain.setTargetAtTime(patch.speech, now, 0.015);
    if (patch.noiseCut !== undefined)
      this.nodes.noiseCut?.frequency.setTargetAtTime(patch.noiseCut, now, 0.015);
    if (patch.gateThreshold !== undefined)
      this.nodes.gate?.parameters.get('thresholdDb')?.setValueAtTime(patch.gateThreshold, now);
    if (patch.noiseGate !== undefined)
      this.nodes.gate?.parameters.get('gateEnabled')?.setValueAtTime(patch.noiseGate ? 1 : 0, now);

    if (patch.rnnoiseEnabled !== undefined || patch.processingMode !== undefined) {
      this.syncRNNoise();
      this.emitOperationalState();
    }
    this.emitDiagnostics();
  }

  async calibrateGate(): Promise<number> {
    const start = performance.now();
    let powerSum = 0;
    let count = 0;

    while (performance.now() - start < 1500) {
      powerSum += Math.pow(10, this.currentRmsDb / 10);
      count += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (!count) return -50;
    const noiseFloorDb = 10 * Math.log10(powerSum / count + 1e-12);
    return Math.min(-20, Math.max(-70, Math.round(noiseFloorDb + 6)));
  }

  getAnalyser(): AnalyserNode | null {
    return this.nodes.analyser ?? null;
  }

  isRunning(): boolean {
    return this.ctx !== null && this.ctx.state !== 'closed';
  }

  static async enumerateDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
    if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [] };
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      return {
        inputs: list.filter((device) => device.kind === 'audioinput'),
        outputs: list.filter((device) => device.kind === 'audiooutput'),
      };
    } catch {
      return { inputs: [], outputs: [] };
    }
  }

  static describeError(error: unknown): string {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError')
        return 'Acesso ao microfone negado. Libere a permissão do navegador e tente novamente.';
      if (error.name === 'NotFoundError') return 'Nenhum microfone compatível foi encontrado.';
      if (error.name === 'NotReadableError') return 'O microfone está ocupado ou indisponível para o navegador.';
      if (error.name === 'OverconstrainedError')
        return 'O dispositivo selecionado não aceita a configuração solicitada.';
      if (error.name === 'NotSupportedError')
        return 'Este navegador não oferece os recursos de áudio necessários.';
    }
    if (error instanceof Error && error.message) return error.message;
    return 'Não foi possível iniciar o processamento de áudio.';
  }

  private async openInput(settings: EngineSettings): Promise<MediaStream> {
    const constraints: AudioConstraintsWithLatency = {
      echoCancellation: settings.browserNoise,
      noiseSuppression: settings.browserNoise,
      autoGainControl: settings.browserNoise,
      channelCount: { ideal: 1 },
      latency: { ideal: settings.lowLatency ? 0.01 : 0.03 },
      sampleRate: { ideal: 48000 },
    };

    if (settings.inputDeviceId) constraints.deviceId = { exact: settings.inputDeviceId };

    try {
      return await navigator.mediaDevices.getUserMedia({ audio: constraints });
    } catch (error) {
      const canFallback =
        Boolean(settings.inputDeviceId) &&
        error instanceof DOMException &&
        ['NotFoundError', 'OverconstrainedError'].includes(error.name);
      if (!canFallback) throw error;

      this.inputFallback = true;
      this.callbacks.onWarning?.('O microfone escolhido não está disponível; usando a entrada padrão.');
      return navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: settings.browserNoise,
          noiseSuppression: settings.browserNoise,
          autoGainControl: settings.browserNoise,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
        },
      });
    }
  }

  private createGraph(settings: EngineSettings): void {
    const ctx = this.ctx;
    const stream = this.stream;
    if (!ctx || !stream) throw new Error('Contexto de áudio não inicializado.');

    this.nodes.source = ctx.createMediaStreamSource(stream);
    this.nodes.inputMeter = new AudioWorkletNode(ctx, 'gate-meter-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { meterEnabled: true },
      parameterData: { gateEnabled: 0 },
    });
    this.nodes.inputMeter.port.onmessage = (event) => this.handleMeter(event.data);

    this.nodes.rnnoise = new AudioWorkletNode(ctx, 'rnnoise-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.nodes.rnnoise.onprocessorerror = () => this.handleRNNoiseError('Falha na thread de processamento.');
    this.startRNNoise(this.nodes.rnnoise);

    this.nodes.noiseCut = ctx.createBiquadFilter();
    this.nodes.noiseCut.type = 'highpass';
    this.nodes.noiseCut.frequency.value = settings.noiseCut;
    this.nodes.noiseCut.Q.value = 0.707;

    this.nodes.lowpass = ctx.createBiquadFilter();
    this.nodes.lowpass.type = 'lowpass';
    this.nodes.lowpass.frequency.value = 10000;
    this.nodes.lowpass.Q.value = 0.707;

    this.nodes.speech = ctx.createBiquadFilter();
    this.nodes.speech.type = 'peaking';
    this.nodes.speech.frequency.value = 3000;
    this.nodes.speech.Q.value = 1;
    this.nodes.speech.gain.value = settings.speech;

    this.nodes.gainVolume = ctx.createGain();
    this.nodes.gainVolume.gain.value = this.dbToGain(settings.volume);
    this.nodes.dspVolume = ctx.createGain();
    this.nodes.dspVolume.gain.value = this.dbToGain(settings.volume);

    this.nodes.compressor = ctx.createDynamicsCompressor();
    this.nodes.compressor.threshold.value = -24;
    this.nodes.compressor.knee.value = 12;
    this.nodes.compressor.ratio.value = 3;
    this.nodes.compressor.attack.value = 0.008;
    this.nodes.compressor.release.value = 0.18;

    this.nodes.gate = new AudioWorkletNode(ctx, 'gate-meter-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { meterEnabled: false },
      parameterData: {
        thresholdDb: settings.gateThreshold,
        gateEnabled: settings.noiseGate ? 1 : 0,
        minGain: 0.15,
      },
    });

    this.nodes.rawMode = ctx.createGain();
    this.nodes.gainMode = ctx.createGain();
    this.nodes.dspMode = ctx.createGain();
    this.nodes.fullMode = ctx.createGain();
    this.nodes.dspDirectInput = ctx.createGain();
    this.nodes.dspDirectInput.gain.value = 0;
    this.nodes.dspRNInput = ctx.createGain();
    this.nodes.dspRNInput.gain.value = 0;
    this.nodes.outputBus = ctx.createGain();

    this.nodes.safetyLimiter = ctx.createDynamicsCompressor();
    this.nodes.safetyLimiter.threshold.value = -3;
    this.nodes.safetyLimiter.knee.value = 0;
    this.nodes.safetyLimiter.ratio.value = 20;
    this.nodes.safetyLimiter.attack.value = 0.003;
    this.nodes.safetyLimiter.release.value = 0.08;

    this.nodes.masterFade = ctx.createGain();
    this.nodes.masterFade.gain.value = 0;
    this.nodes.analyser = ctx.createAnalyser();
    this.nodes.analyser.fftSize = 1024;

    this.nodes.source.connect(this.nodes.inputMeter);
    this.nodes.inputMeter.connect(this.nodes.rawMode).connect(this.nodes.outputBus);
    this.nodes.inputMeter.connect(this.nodes.gainVolume).connect(this.nodes.gainMode).connect(this.nodes.outputBus);
    this.nodes.inputMeter.connect(this.nodes.dspDirectInput).connect(this.nodes.noiseCut);
    this.nodes.inputMeter.connect(this.nodes.rnnoise).connect(this.nodes.dspRNInput).connect(this.nodes.noiseCut);
    this.nodes.noiseCut
      .connect(this.nodes.lowpass)
      .connect(this.nodes.speech)
      .connect(this.nodes.dspVolume)
      .connect(this.nodes.compressor);
    this.nodes.compressor.connect(this.nodes.dspMode).connect(this.nodes.outputBus);
    this.nodes.compressor.connect(this.nodes.gate).connect(this.nodes.fullMode).connect(this.nodes.outputBus);
    this.nodes.outputBus
      .connect(this.nodes.safetyLimiter)
      .connect(this.nodes.masterFade)
      .connect(this.nodes.analyser);

    this.applyMode(settings.processingMode, ctx.currentTime, true);
    this.syncRNNoise();
  }

  private async configureOutput(outputDeviceId: string): Promise<void> {
    const ctx = this.ctx;
    const analyser = this.nodes.analyser;
    if (!ctx || !analyser) throw new Error('Saída de áudio não inicializada.');

    if (!outputDeviceId) {
      analyser.connect(ctx.destination);
      this.outputRoute = 'system-default';
      return;
    }

    if (typeof ctx.setSinkId === 'function') {
      try {
        await ctx.setSinkId(outputDeviceId);
        analyser.connect(ctx.destination);
        this.outputRoute = 'audio-context';
        return;
      } catch (error) {
        this.callbacks.onWarning?.(`Não foi possível selecionar a saída pedida: ${AudioEngine.describeError(error)}`);
      }
    }

    if ('setSinkId' in HTMLAudioElement.prototype) {
      try {
        this.nodes.mediaDest = ctx.createMediaStreamDestination();
        analyser.connect(this.nodes.mediaDest);
        this.outputEl = new Audio();
        this.outputEl.autoplay = true;
        this.outputEl.srcObject = this.nodes.mediaDest.stream;
        await (this.outputEl as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(outputDeviceId);
        await this.outputEl.play();
        this.outputRoute = 'media-element';
        return;
      } catch (error) {
        this.callbacks.onWarning?.(`Roteamento da saída falhou; usando a saída do sistema: ${AudioEngine.describeError(error)}`);
        this.nodes.mediaDest?.disconnect();
        if (this.outputEl) {
          this.outputEl.pause();
          this.outputEl.srcObject = null;
          this.outputEl = null;
        }
      }
    }

    analyser.connect(ctx.destination);
    this.outputRoute = 'fallback';
  }

  private applyMode(mode: ProcessingMode, now: number, immediate = false): void {
    if (!MODE_KEYS.includes(mode)) return;
    const targets: Record<ProcessingMode, GainNode | undefined> = {
      raw: this.nodes.rawMode,
      gain: this.nodes.gainMode,
      dsp: this.nodes.dspMode,
      full: this.nodes.fullMode,
    };
    for (const key of MODE_KEYS) this.setModeGain(targets[key], key === mode ? 1 : 0, now, immediate);
  }

  private setModeGain(node: GainNode | undefined, target: number, now: number, immediate: boolean): void {
    if (!node) return;
    node.gain.cancelScheduledValues(now);
    if (immediate) {
      node.gain.setValueAtTime(target, now);
      return;
    }
    node.gain.setValueAtTime(node.gain.value, now);
    node.gain.linearRampToValueAtTime(target, now + 0.02);
  }

  private syncRNNoise(): void {
    if (!this.nodes.rnnoise || !this.settings) return;
    const fullMode = this.settings.processingMode === 'full';
    const useRNNoise = fullMode && this.settings.rnnoiseEnabled && !this.rnnoiseFailed;
    if (this.ctx) {
      const now = this.ctx.currentTime;
      this.setModeGain(
        this.nodes.dspDirectInput,
        this.settings.processingMode === 'dsp' || (fullMode && !useRNNoise) ? 1 : 0,
        now,
        false,
      );
      this.setModeGain(this.nodes.dspRNInput, useRNNoise ? 1 : 0, now, false);
    }
    this.nodes.rnnoise.port.postMessage({ type: 'enable', value: useRNNoise });
  }

  private startRNNoise(node: AudioWorkletNode): void {
    this.callbacks.onRNNoiseStatus?.('loading');
    node.port.onmessage = (event) => {
      if (event.data?.type === 'ready') {
        this.rnnoiseFailed = false;
        this.callbacks.onRNNoiseStatus?.('ready');
        this.syncRNNoise();
        this.emitOperationalState();
      } else if (event.data?.type === 'error') {
        this.handleRNNoiseError(String(event.data.message ?? 'Erro desconhecido.'));
      }
    };

    fetch('/rnnoise/rnnoise.wasm')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((wasmBinary) => node.port.postMessage({ type: 'load', wasmBinary }, [wasmBinary]))
      .catch((error) => this.handleRNNoiseError(AudioEngine.describeError(error)));
  }

  private handleRNNoiseError(message: string): void {
    console.warn('[RNNoise]', message);
    this.rnnoiseFailed = true;
    this.callbacks.onRNNoiseStatus?.('error');
    this.callbacks.onWarning?.(`RNNoise indisponível; o áudio continua sem redução neural. ${message}`);
    this.syncRNNoise();
    if (this.ctx) this.emitOperationalState();
  }

  private handleMeter(data: { type?: string; rmsDb?: number; peak?: number }): void {
    if (data?.type !== 'meter' || typeof data.rmsDb !== 'number' || typeof data.peak !== 'number') return;
    this.currentRmsDb = data.rmsDb;
    this.callbacks.onMeter?.({ rmsDb: data.rmsDb, peak: data.peak });
    if (data.peak > 0.98) this.clipHold = 8;
    if (this.clipHold > 0) this.clipHold -= 1;
    this.callbacks.onClip?.(this.clipHold > 0);
  }

  private handleContextState(): void {
    const state = this.ctx?.state as string | undefined;
    if (!state || state === 'closed' || this.stopping) return;
    if (state === 'running') this.emitOperationalState();
    else this.callbacks.onSessionState?.('suspended');
  }

  private emitOperationalState(): void {
    const rnnoiseRequired =
      this.settings?.processingMode === 'full' && this.settings.rnnoiseEnabled;
    this.callbacks.onSessionState?.(this.rnnoiseFailed && rnnoiseRequired ? 'degraded' : 'running');
  }

  private emitDiagnostics(): void {
    if (!this.ctx || !this.track || !this.settings) return;
    const trackSettings = this.track.getSettings() as AudioSettingsWithLatency;
    this.callbacks.onDiagnostics?.({
      contextSampleRate: this.ctx.sampleRate,
      inputSampleRate: trackSettings.sampleRate ?? null,
      inputChannelCount: trackSettings.channelCount ?? null,
      inputLatencyMs: typeof trackSettings.latency === 'number' ? trackSettings.latency * 1000 : null,
      baseLatencyMs: Number.isFinite(this.ctx.baseLatency) ? this.ctx.baseLatency * 1000 : null,
      outputLatencyMs:
        typeof this.ctx.outputLatency === 'number' && Number.isFinite(this.ctx.outputLatency)
          ? this.ctx.outputLatency * 1000
          : null,
      inputDeviceId: trackSettings.deviceId ?? null,
      inputDeviceLabel: this.track.label,
      inputFallback: this.inputFallback,
      outputDeviceId: this.ctx.sinkId || this.settings.outputDeviceId || null,
      outputRoute: this.outputRoute,
      echoCancellation: trackSettings.echoCancellation ?? null,
      noiseSuppression: trackSettings.noiseSuppression ?? null,
      autoGainControl: trackSettings.autoGainControl ?? null,
      processingMode: this.settings.processingMode,
      secureContext: window.isSecureContext,
    });
  }

  private dbToGain(db: number): number {
    return Math.pow(10, db / 20);
  }
}
