class GateMeterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'thresholdDb',
        defaultValue: -50,
        minValue: -90,
        maxValue: 0,
        automationRate: 'k-rate'
      },
      {
        name: 'gateEnabled',
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate'
      },
      {
        name: 'minGain',
        defaultValue: 0.08,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate'
      }
    ];
  }

  constructor(options) {
    super();
    this.gain = 1;
    this.open = true;
    this.hold = 0;
    this.holdFrames = 45;
    this.msgCounter = 0;
    this.meterEnabled = options?.processorOptions?.meterEnabled !== false;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    // O engine e mono. Usar o primeiro canal evita cancelamento quando uma
    // interface entrega dois canais com polaridades opostas.
    const inputChannel = input[0];
    const len = inputChannel.length;
    let sum = 0;
    let peak = 0;

    for (let i = 0; i < len; i += 1) {
      const v = inputChannel[i];
      const av = v < 0 ? -v : v;
      sum += v * v;
      if (av > peak) peak = av;
    }

    const rms = Math.sqrt(sum / len);
    const rmsDb = Math.max(-96, 20 * Math.log10(rms + 1e-8));

    const gateEnabled = (parameters.gateEnabled[0] || 0) >= 0.5;
    const thresholdDb = parameters.thresholdDb[0] ?? -50;
    const minGain = parameters.minGain[0] ?? 0.08;

    let target = 1;
    if (gateEnabled) {
      if (rmsDb > thresholdDb) {
        this.open = true;
        this.hold = this.holdFrames;
        target = 1;
      } else if (this.hold > 0) {
        this.hold -= 1;
        target = 1;
      } else if (this.open && rmsDb > thresholdDb - 4) {
        target = 1;
      } else {
        this.open = false;
        target = minGain;
      }
    } else {
      this.open = true;
    }

    this.gain += (target - this.gain) * 0.2;

    for (let ch = 0; ch < output.length; ch += 1) {
      const outCh = output[ch];
      for (let i = 0; i < len; i += 1) {
        outCh[i] = inputChannel[i] * this.gain;
      }
    }

    this.msgCounter += 1;
    // Aproximadamente 31 Hz em 48 kHz: suave para UI sem renderizar React a 94 Hz.
    if (this.meterEnabled && this.msgCounter % 12 === 0) {
      this.port.postMessage({ type: 'meter', rmsDb, peak });
    }

    return true;
  }
}

registerProcessor('gate-meter-processor', GateMeterProcessor);
