/**
 * Copia os arquivos do @jitsi/rnnoise-wasm para public/rnnoise/
 * e patcha o rnnoise.js para funcionar com importScripts no AudioWorklet.
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

// 2. Patchar rnnoise.js: trocar "export default" por globalThis assignment
//    O AudioWorklet classico nao suporta ES modules, mas suporta importScripts.
let js = fs.readFileSync(path.join(src, 'rnnoise.js'), 'utf8');

if (!js.includes('export default createRNNWasmModule')) {
  console.error('AVISO: padrao de export nao encontrado em rnnoise.js. Verifique a versao do pacote.');
  process.exit(1);
}

js = js.replace(
  'export default createRNNWasmModule;',
  // Funciona tanto em AudioWorkletGlobalScope (self) quanto em globalThis
  '(typeof globalThis !== "undefined" ? globalThis : self).createRNNWasmModule = createRNNWasmModule;'
);

fs.writeFileSync(path.join(dest, 'rnnoise.js'), js, 'utf8');

console.log('✓ RNNoise: rnnoise.wasm e rnnoise.js copiados para public/rnnoise/');
