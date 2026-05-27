import assert from 'node:assert/strict';
import test from 'node:test';

import { createTypedWordSubmitGuard } from './typed-word-submit.js';

test('typed word submit guard accepts one Enter submit per key press', () => {
  let currentTime = 1000;
  const shouldAccept = createTypedWordSubmitGuard({
    now: () => currentTime,
  });

  assert.equal(shouldAccept('돈', { key: 'Enter' }), true);
  assert.equal(shouldAccept('돈', { key: 'Enter' }), false);

  currentTime += 300;
  assert.equal(shouldAccept('돈', { key: 'Enter' }), true);
});

test('typed word submit guard ignores IME composition and held Enter repeats', () => {
  const shouldAccept = createTypedWordSubmitGuard({
    now: () => 1000,
  });

  assert.equal(shouldAccept('돈', { key: 'Enter', isComposing: true }), false);
  assert.equal(shouldAccept('돈', { key: 'Enter', repeat: true }), false);
  assert.equal(shouldAccept('돈', { key: 'Enter' }), true);
});

test('typed word submit guard allows different words without waiting', () => {
  const shouldAccept = createTypedWordSubmitGuard({
    now: () => 1000,
  });

  assert.equal(shouldAccept('돈', { key: 'Enter' }), true);
  assert.equal(shouldAccept('드리다', { key: 'Enter' }), true);
});
