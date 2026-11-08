import { createServer } from 'node:http';
import { isIPv6 } from 'node:net';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { config, assertConfig } from './config.js';
import { createHttpApp } from './server.js';
import { mcpHandler } from './mcp.js';

assertConfig();

const app = createHttpApp();
const nodeMcp = toNodeHandler(mcpHandler);

function allowedHost(reqHost: string | undefined): boolean {
  const configured = (process.env.MCP_ALLOWED_HOSTS ?? config.server.publicHost)
    .split(',')
    .map((v) => {
      const host = v.trim().toLowerCase();
      return isIPv6(host) ? `[${host}]` : host;
    })
    .filter(Boolean);
  if (!configured.length || !reqHost) return true;
  const normalizedHost = reqHost.toLowerCase();
  const host = normalizedHost.startsWith('[')
    ? /^(\[[^\]]+\])(?::\d+)?$/.exec(normalizedHost)?.[1]
    : normalizedHost.split(':')[0];
  return host !== undefined && configured.includes(host);
}

function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const configured = (process.env.MCP_ALLOWED_ORIGINS ?? '')
    .split(',').map((v) => v.trim()).filter(Boolean);
  if (!configured.length) return true;
  return configured.includes(origin);
}

// MCP bearer protection is kept separate from the AgentRouter upstream key.
// Host/origin checks are optional but recommended for public deployments.
app.all('/mcp', (req, res, next) => {
  if (!allowedHost(req.get('host')) || !allowedOrigin(req.get('origin'))) {
    res.status(403).json({ error: 'Forbidden host or origin' });
    return;
  }
  const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!auth || auth !== config.server.mcpAuthToken) {
    res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  void Promise.resolve(nodeMcp(req, res, req.body)).catch(next);
});

app.use((_req, res) => res.status(404).json({ error: { message: 'Not found' } }));

const server = createServer(app);
server.requestTimeout = config.runtime.requestTimeoutMs + 30_000;
server.headersTimeout = Math.min(server.requestTimeout, 65_000);
server.listen(config.server.port, config.server.host, () => {
  console.log(JSON.stringify({ ok: true, port: config.server.port, host: config.server.host, mcp: '/mcp', api: '/v1' }));
});

let shuttingDown = false;

const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;

  const shutdownTimeout = setTimeout(() => {
    console.error('Shutdown timed out');
    process.exit(1);
  }, server.requestTimeout);
  shutdownTimeout.unref();

  void Promise.all([
    new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
      server.closeIdleConnections?.();
    }),
    Promise.resolve().then(() => mcpHandler.close()),
  ])
    .then(() => {
      clearTimeout(shutdownTimeout);
      process.exit(0);
    })
    .catch((error: unknown) => {
      clearTimeout(shutdownTimeout);
      console.error('Shutdown failed:', error);
      process.exit(1);
    });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
