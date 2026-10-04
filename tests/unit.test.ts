import test from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableStatus, isFallbackWorthyStatus } from '../src/retry.js';
import { extractModelIds } from '../src/catalog.js';
import { redactText } from '../src/redact.js';

test('retry classification', () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(404), false);
  assert.equal(isFallbackWorthyStatus(404), true);
});

test('model extraction', () => {
  assert.deepEqual(extractModelIds({ data: [{ id: 'a' }, { id: 'b' }] }), ['a', 'b']);
});

test('secret redaction', () => {
  assert.equal(redactText('token ' + ['sk-', 'TEST_SECRET_123'].join('') + ' and Bearer abc123'), 'token [REDACTED_SECRET] and [REDACTED_SECRET]');
});
