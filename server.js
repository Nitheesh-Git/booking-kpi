import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import handler from './app.js';

const port = Number(process.env.PORT ?? 3000);
const publicDirectory = join(process.cwd(), 'public');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @returns {void}
 */
function serve(request, response) {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    handler(request, response);
    return;
  }

  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = normalize(join(publicDirectory, requestedPath));
  if (!filePath.startsWith(publicDirectory) || !existsSync(filePath)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream'
  });
  createReadStream(filePath).pipe(response);
}

createServer(serve).listen(port, () => {
  console.log(`Azzurro Review Insights is running at http://localhost:${port}`);
});
