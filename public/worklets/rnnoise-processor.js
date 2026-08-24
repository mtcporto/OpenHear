/**
 * RNNoiseProcessor – AudioWorkletProcessor
 *
 * O glue Emscripten e importado como ES module. A main thread busca o WASM e
 * envia o ArrayBuffer, evitando fetch e dependencias de DOM na thread de audio.
 *
 * RNNoise requer frames de exatamente 480 samples a 48 kHz.
 * O ring buffer acumula blocos de 128 samples do Web Audio e processa em bateladas de 480.
 */

import createRNNWasmModule from '../rnnoise/rnnoise.js';

const FRAME_SIZE = 480;
const BUF_LEN    = FRAME_SIZE * 4; // ring buffer grande o suficiente para 4 frames

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._enabled  = false;
    this._ready    = false;
    this._loading  = false;

    // Ring buffers
    this._inBuf    = new Float32Array(BUF_LEN);
    this._outBuf   = new Float32Array(BUF_LEN);
    this._inWrite  = 0;
    this._outRead  = 0;
    this._outWrite = 0;
    this._primed   = false;

    // WASM handles
    this._module  = null;
    this._st      = 0;
    this._ptrIn   = 0;
    this._ptrOut  = 0;
    this._heapIn  = null;
    this._heapOut = null;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'load') this._loadWasm(msg.wasmBinary);
      if (msg.type === 'enable') this._setEnabled(Boolean(msg.value));
      if (msg.type === 'destroy') this._destroy();
    };
  }

  _loadWasm(wasmBinary) {
    if (this._loading || this._ready) return;
    this._loading = true;

    try {
      const promise = createRNNWasmModule({
        wasmBinary: new Uint8Array(wasmBinary),
        print:    () => {},
        printErr: () => {},
        locateFile: (f) => f,
      });

      promise.then((mod) => {
        this._module = mod;
        this._st     = mod._rnnoise_create(0);
        const bytes  = FRAME_SIZE * 4;
        this._ptrIn  = mod._malloc(bytes);
        this._ptrOut = mod._malloc(bytes);
        this._heapIn  = new Float32Array(mod.HEAPF32.buffer, this._ptrIn,  FRAME_SIZE);
        this._heapOut = new Float32Array(mod.HEAPF32.buffer, this._ptrOut, FRAME_SIZE);
        this._ready   = true;
        this._loading = false;
        this.port.postMessage({ type: 'ready' });
      }).catch((err) => {
        this._loading = false;
        this.port.postMessage({ type: 'error', message: String(err) });
      });

    } catch (err) {
      this._loading = false;
      this.port.postMessage({ type: 'error', message: String(err) });
    }
  }

  _setEnabled(enabled) {
    if (enabled && !this._enabled) this._resetBuffers();
    this._enabled = enabled;
  }

  _resetBuffers() {
    this._inBuf.fill(0);
    this._outBuf.fill(0);
    this._inWrite = 0;
    this._outRead = 0;
    this._outWrite = 0;
    this._primed = false;
  }

  _destroy() {
    try {
      if (this._module && this._st) this._module._rnnoise_destroy(this._st);
      if (this._module && this._ptrIn) this._module._free(this._ptrIn);
      if (this._module && this._ptrOut) this._module._free(this._ptrOut);
    } catch { /* contexto sera encerrado em seguida */ }
    this._st = 0;
    this._ptrIn = 0;
    this._ptrOut = 0;
    this._ready = false;
  }

  process(inputs, outputs) {
    const inCh  = inputs[0]?.[0]  ?? null;
    const outCh = outputs[0]?.[0] ?? null;
    if (!outCh) return true;

    const blockSize = outCh.length;

    // Pass-through se nao habilitado ou WASM nao pronto
    if (!this._enabled || !this._ready) {
      if (inCh) outCh.set(inCh);
      else outCh.fill(0);
      return true;
    }

    // Alimenta o ring de entrada
    const src = inCh ?? new Float32Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      this._inBuf[this._inWrite % BUF_LEN] = src[i];
      this._inWrite++;
    }

    // Processa todos os frames completos de 480 samples
    while (this._inWrite - this._outWrite >= FRAME_SIZE) {
      // RNNoise espera amostras em [-32768, 32768]
      for (let i = 0; i < FRAME_SIZE; i++) {
        this._heapIn[i] = this._inBuf[(this._outWrite + i) % BUF_LEN] * 32768;
      }

      this._module._rnnoise_process_frame(this._st, this._ptrOut, this._ptrIn);

      // Atualiza view caso a memoria WASM tenha crescido
      if (this._heapIn.buffer !== this._module.HEAPF32.buffer) {
        this._heapIn  = new Float32Array(this._module.HEAPF32.buffer, this._ptrIn,  FRAME_SIZE);
        this._heapOut = new Float32Array(this._module.HEAPF32.buffer, this._ptrOut, FRAME_SIZE);
      }

      for (let i = 0; i < FRAME_SIZE; i++) {
        this._outBuf[(this._outWrite + i) % BUF_LEN] = this._heapOut[i] / 32768;
      }
      this._outWrite += FRAME_SIZE;
    }

    // Espera um quantum extra depois do primeiro frame. Isso evita o underflow
    // causado pelo desalinhamento entre blocos de 128 e frames de 480 samples.
    if (!this._primed && this._outWrite >= FRAME_SIZE && this._inWrite >= FRAME_SIZE + blockSize) {
      this._primed = true;
    }

    if (this._primed && this._outWrite - this._outRead >= blockSize) {
      for (let i = 0; i < blockSize; i++) {
        outCh[i] = this._outBuf[(this._outRead + i) % BUF_LEN];
      }
      this._outRead += blockSize;
    } else {
      outCh.fill(0);
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
