import test from 'node:test';
import assert from 'node:assert/strict';

test('upstream URL composition uses the /v1 base correctly', () => {
  const base = 'https://agentrouter.org/v1/';
  const path = '/chat/completions';
  const url = `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  assert.equal(url, 'https://agentrouter.org/v1/chat/completions');
});
