import { createServer } from 'node:http';
import { logRendererInfo } from './logging.js';

const PORT = Number(process.env.PORT ?? '8080');

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        ok: true,
        mode: 'service',
        rendererVersion: process.env.RENDERER_VERSION?.trim() || 'v1',
      }),
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/internal/render') {
    res.statusCode = 410;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      ok: false,
      errorCode: 'RENDER_FAILED',
      errorMessage: 'Legacy internal render is disabled. Use Cloud Run Jobs.',
    }));
    return;
  }

  res.statusCode = 404;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
});

server.listen(PORT, () => {
  logRendererInfo('debug', '[DBG_RENDERER_LISTEN]', {
    port: PORT,
    rendererVersion: process.env.RENDERER_VERSION?.trim() || 'v1',
    mode: 'service',
  });
});
