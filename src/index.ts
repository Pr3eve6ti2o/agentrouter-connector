import { createServer } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { config, assertConfig } from './config.js';
import { createHttpApp } from './server.js';
import { mcpHandler } from './mcp.js';

assertConfig();

const app = createHttpApp();
const nodeMcp = toNodeHandler(mcpHandler);

function allowedHost(reqHost: string | undefined): boolean {
  const configured = (process.env.MCP_ALLOWED_HOSTS ?? config.server.publicHost)
    .split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (!configured.length || !reqHost) return true;
  const host = reqHost.toLowerCase().split(':')[0];
  return configured.includes(host);
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
app.all('/mcp', (req, res) => {
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
  void nodeMcp(req, res, req.body);
});

app.use((_req, res) => res.status(404).json({ error: { message: 'Not found' } }));

const server = createServer(app);
server.requestTimeout = config.runtime.requestTimeoutMs + 30_000;
server.headersTimeout = Math.min(server.requestTimeout, 65_000);
server.listen(config.server.port, config.server.host, () => {
  console.log(JSON.stringify({ ok: true, port: config.server.port, host: config.server.host, mcp: '/mcp', api: '/v1' }));
});

const shutdown = async () => {
  await mcpHandler.close();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
