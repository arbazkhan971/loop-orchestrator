import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  // GET /
  if (req.method === 'GET' && pathname === '/') {
    const indexPath = path.join(__dirname, 'index.html');
    fs.readFile(indexPath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // GET /api/todos
  if (req.method === 'GET' && pathname === '/api/todos') {
    send(res, 200, store.list());
    return;
  }

  // POST /api/todos
  if (req.method === 'POST' && pathname === '/api/todos') {
    let body;
    try { body = await readBody(req); }
    catch { send(res, 400, { error: 'Invalid JSON' }); return; }

    const title = body.title;
    if (!title || typeof title !== 'string' || !title.trim()) {
      send(res, 400, { error: 'title is required' });
      return;
    }
    const todo = store.add(title.trim());
    send(res, 201, todo);
    return;
  }

  // POST /api/todos/:id/toggle
  const toggleMatch = pathname.match(/^\/api\/todos\/(\d+)\/toggle$/);
  if (req.method === 'POST' && toggleMatch) {
    const id = Number(toggleMatch[1]);
    const todo = store.toggle(id);
    if (!todo) { send(res, 404, { error: 'Not found' }); return; }
    send(res, 200, todo);
    return;
  }

  // DELETE /api/todos/:id
  const deleteMatch = pathname.match(/^\/api\/todos\/(\d+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const id = Number(deleteMatch[1]);
    const removed = store.delete(id);
    if (!removed) { send(res, 404, { error: 'Not found' }); return; }
    res.writeHead(204);
    res.end();
    return;
  }

  // 404
  send(res, 404, { error: 'Not found' });
});

// Only start listening when run directly (so tests can import the server and
// pick an ephemeral port).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

export { server };
