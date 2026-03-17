/**
 * Servidor HTTP local para o OpenHear
 * Uso: node server.js
 * Acesse: http://localhost:3000
 *
 * Todos os arquivos da pasta sao servidos estaticamente.
 * Os headers necessarios para AudioWorklet e SharedArrayBuffer estao incluidos.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.wav':  'audio/wav',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
};

const server = http.createServer((req, res) => {
  // Normaliza o caminho e evita path traversal
  const urlPath = req.url.split('?')[0];
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '');
  let filePath = path.join(ROOT, safePath);

  // Se for diretorio, serve index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // Header necessário para AudioWorklet em contexto seguro
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`OpenHear rodando em: http://localhost:${PORT}`);
  console.log('Pressione Ctrl+C para parar.');
});
