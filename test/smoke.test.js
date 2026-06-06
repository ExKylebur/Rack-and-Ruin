import { test } from 'node:test';
import assert from 'node:assert/strict';

// Confirms the node --test runner is wired up. Real module tests live alongside
// this file (geometry.test.js, physics.test.js, ...).
test('test runner is alive', () => {
  assert.equal(1 + 1, 2);
});
