'use strict';
/* Serveur de développement local : node server.js (nécessite DATABASE_URL) */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { handler } = require('./lib/app.js');
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return handler(req, res);
  const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end('Introuvable'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data); });
});
server.listen(+process.env.PORT || 3000, () => console.log('http://localhost:' + (+process.env.PORT || 3000)));
module.exports = server;
