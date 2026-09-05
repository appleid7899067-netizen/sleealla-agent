const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 10000);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const requestPath = (req.url || '/').split('?')[0];
  const relative = requestPath === '/' || requestPath === '/chat' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep) && filePath !== path.join(root, 'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      return res.end('Not found');
    }
    res.writeHead(200, {'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
    res.end(data);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Sleealla Agent listening on port ${port}`);
});
