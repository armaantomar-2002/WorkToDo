'use strict';
// Controllable stand-in for the Python ML service (plain node:http, no dependencies). Lives outside test/ so `node --test`
// does not treat it as a test file. Handlers receive (req, res, parsedBody) and decide how to misbehave.
const http = require('node:http');
const net = require('node:net');

const sendJson = (res, status, body, headers = {}) => { const text = JSON.stringify(body); res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), ...headers }); res.end(text); };
const sendRaw = (res, status, raw, headers = {}) => { res.writeHead(status, { 'content-length': Buffer.byteLength(raw), ...headers }); res.end(raw); };

async function startFakePython({ recommend, health } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let body; try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const path = req.url.split('?')[0];
      const handler = path === '/recommend' ? recommend : path === '/health' ? health : null;
      if (!handler) return sendJson(res, 404, { error: 'http_error', message: 'Not Found' });
      return handler(req, res, body);
    });
  });
  server.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { baseUrl, requests, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const respondJson = (status, body, headers) => (req, res) => sendJson(res, status, body, headers);
const hang = () => () => { /* never answers */ };

module.exports = { startFakePython, sendJson, sendRaw, respondJson, hang, freePort };
