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

  constructor() {
    super();
    this.gain = 1;
    this.hold = 0;
    this.holdFrames = 6;
    this.msgCounter = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const inCh = input[0];
    const len = inCh.length;
    let sum = 0;
    let peak = 0;

    for (let i = 0; i < len; i += 1) {
      const v = inCh[i];
      const av = v < 0 ? -v : v;
      sum += v * v;
      if (av > peak) peak = av;
    }

    const rms = Math.sqrt(sum / len);
    const rmsDb = 20 * Math.log10(rms + 1e-8);

    const gateEnabled = (parameters.gateEnabled[0] || 0) >= 0.5;
    const thresholdDb = parameters.thresholdDb[0] ?? -50;
    const minGain = parameters.minGain[0] ?? 0.08;

    let target = 1;
    if (gateEnabled) {
      if (rmsDb > thresholdDb) {
        this.hold = this.holdFrames;
        target = 1;
      } else if (this.hold > 0) {
        this.hold -= 1;
        target = 1;
      } else {
        target = minGain;
      }
    }

    this.gain += (target - this.gain) * 0.2;

    for (let ch = 0; ch < output.length; ch += 1) {
      const outCh = output[ch];
      const inC = input[ch] || inCh;
      for (let i = 0; i < len; i += 1) {
        outCh[i] = inC[i] * this.gain;
      }
    }

    this.msgCounter += 1;
    if (this.msgCounter % 4 === 0) {
      this.port.postMessage({ type: 'meter', rmsDb, peak });
    }

    return true;
  }
}

registerProcessor('gate-meter-processor', GateMeterProcessor);
