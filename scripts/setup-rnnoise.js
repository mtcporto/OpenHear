/**
 * Copia os arquivos ES module do @jitsi/rnnoise-wasm para public/rnnoise/.
 * O AudioWorklet importa o factory diretamente como modulo; importScripts nao
 * existe em AudioWorkletGlobalScope.
 *
 * Uso: node scripts/setup-rnnoise.js
 * Roda automaticamente via postinstall.
 */
const fs = require('fs');
const path = require('path');

const src  = path.join(__dirname, '../node_modules/@jitsi/rnnoise-wasm/dist');
const dest = path.join(__dirname, '../public/rnnoise');

fs.mkdirSync(dest, { recursive: true });

// 1. Copiar rnnoise.wasm sem modificacao
fs.copyFileSync(path.join(src, 'rnnoise.wasm'), path.join(dest, 'rnnoise.wasm'));
fs.chmodSync(path.join(dest, 'rnnoise.wasm'), 0o644);

// 2. Copiar o glue Emscripten sem alterar o export ES module.
fs.copyFileSync(path.join(src, 'rnnoise.js'), path.join(dest, 'rnnoise.js'));
fs.chmodSync(path.join(dest, 'rnnoise.js'), 0o644);

console.log('✓ RNNoise: modulo ES e WASM copiados para public/rnnoise/');
