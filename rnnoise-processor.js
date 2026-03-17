/**
 * RNNoiseProcessor – AudioWorkletProcessor
 *
 * Usa o @jitsi/rnnoise-wasm (copiado localmente como rnnoise-browser.js + rnnoise.wasm).
 * RNNoise precisa de frames de exatamente 480 samples a 48 kHz.
 * O ring buffer acumula blocos de 128 samples do Web Audio e processa em frames de 480.
 *
 * Mensagens recebidas via port:
 *   { type: 'load', jsUrl, wasmUrl }   — inicia carregamento
 *   { type: 'enable', value: bool }    — liga/desliga sem parar o áudio
 */

const FRAME_SIZE = 480;

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._enabled = false;
    this._ready = false;
    this._loading = false;

    this._inBuf  = new Float32Array(FRAME_SIZE * 4);
    this._outBuf = new Float32Array(FRAME_SIZE * 4);
    this._inWrite  = 0;
    this._outRead  = 0;
    this._outWrite = 0;

    this._module = null;
    this._st     = null;
    this._ptrIn  = 0;
    this._ptrOut = 0;
    this._heapIn  = null;
    this._heapOut = null;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'load') this._loadWasm(msg.jsUrl, msg.wasmUrl);
      else if (msg.type === 'enable') this._enabled = Boolean(msg.value);
    };
  }

  async _loadWasm(jsUrl, wasmUrl) {
    if (this._loading || this._ready) return;
    this._loading = true;
    try {
      // importScripts carrega o script síncrono no escopo do AudioWorklet.
      // rnnoise-browser.js expõe createRNNWasmModule em globalThis.
      importScripts(jsUrl);

      const factory = globalThis.createRNNWasmModule;
      if (typeof factory !== 'function') {
        throw new Error('createRNNWasmModule not found after importScripts');
      }

      // locateFile redireciona o Emscripten para o .wasm local
      this._module = await factory({
        locateFile: (name) => name.endsWith('.wasm') ? wasmUrl : name
      });

      this._st     = this._module._rnnoise_create(0);
      const bytes  = FRAME_SIZE * 4;
      this._ptrIn  = this._module._malloc(bytes);
      this._ptrOut = this._module._malloc(bytes);
      this._heapIn  = new Float32Array(this._module.HEAPF32.buffer, this._ptrIn,  FRAME_SIZE);
      this._heapOut = new Float32Array(this._module.HEAPF32.buffer, this._ptrOut, FRAME_SIZE);

      this._ready = true;
      this.port.postMessage({ type: 'ready' });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String(err) });
    }
    this._loading = false;
  }

  /**
   * Push one Web Audio worklet block (128 samples) into the ring buffer,
   * drain full RNNoise frames (480 samples), then copy output into `out`.
   */
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    const inCh = input && input[0] ? input[0] : null;
    const outCh = output && output[0] ? output[0] : null;
    if (!outCh) return true;

    const blockSize = outCh.length; // typically 128

    // If not enabled or not ready, pass through
    if (!this._enabled || !this._ready) {
      if (inCh) {
        outCh.set(inCh);
      } else {
        outCh.fill(0);
      }
      return true;
    }

    // --- Feed input into ring ---
    const BUF = FRAME_SIZE * 4;
    const src = inCh || new Float32Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      this._inBuf[this._inWrite % BUF] = src[i];
      this._inWrite++;
    }

    // --- Process all complete 480-sample frames ---
    while (this._inWrite - this._outWrite >= FRAME_SIZE) {
      // Escala para [-32768, 32768] conforme esperado pelo RNNoise
      for (let i = 0; i < FRAME_SIZE; i++) {
        this._heapIn[i] = this._inBuf[(this._outWrite + i) % BUF] * 32768;
      }

      this._module._rnnoise_process_frame(this._st, this._ptrOut, this._ptrIn);

      // Atualiza view se a memória WASM cresceu
      if (this._heapIn.buffer !== this._module.HEAPF32.buffer) {
        this._heapIn  = new Float32Array(this._module.HEAPF32.buffer, this._ptrIn,  FRAME_SIZE);
        this._heapOut = new Float32Array(this._module.HEAPF32.buffer, this._ptrOut, FRAME_SIZE);
      }

      for (let i = 0; i < FRAME_SIZE; i++) {
        this._outBuf[(this._outWrite + i) % BUF] = this._heapOut[i] / 32768;
      }
      this._outWrite += FRAME_SIZE;
    }

    // --- Copiar saída processada ---
    if (this._outWrite - this._outRead >= blockSize) {
      for (let i = 0; i < blockSize; i++) {
        outCh[i] = this._outBuf[(this._outRead + i) % BUF];
      }
      this._outRead += blockSize;
    } else {
      outCh.fill(0); // silêncio enquanto buffer aquece (~30ms)
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
