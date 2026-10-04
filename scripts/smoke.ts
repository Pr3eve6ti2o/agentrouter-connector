import { createServer } from 'node:http';
import { once } from 'node:events';

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ object: 'list', data: [{ id: 'smoke-model' }] }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('failed to bind');
console.log(JSON.stringify({ ok: true, localUpstreamPort: address.port }));
server.close();
