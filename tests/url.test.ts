import test from 'node:test';
import assert from 'node:assert/strict';
import { joinUrl } from '../src/agentrouter.js';

test('upstream URL composition uses the /v1 base correctly', () => {
  const base = 'https://agentrouter.org/v1/';
  const path = '/chat/completions';
  const url = joinUrl(base, path);
  assert.equal(url, 'https://agentrouter.org/v1/chat/completions');
});
