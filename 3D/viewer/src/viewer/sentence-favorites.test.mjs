import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SENTENCE_FAVORITES_STORAGE_KEY,
  loadFavoriteSentences,
  removeFavoriteSentence,
  saveFavoriteSentence,
} from './sentence-favorites.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('favorite sentences are saved and loaded in most-recent order', () => {
  const storage = createMemoryStorage();

  saveFavoriteSentence(['돈', '드리다'], {
    storage,
    now: () => '2026-01-01T00:00:00.000Z',
  });
  saveFavoriteSentence(['통하다'], {
    storage,
    now: () => '2026-01-02T00:00:00.000Z',
  });

  assert.deepEqual(
    loadFavoriteSentences(storage).map((favorite) => favorite.label),
    ['통하다', '돈 + 드리다'],
  );
});

test('saving the same sentence updates one favorite instead of duplicating it', () => {
  const storage = createMemoryStorage();

  saveFavoriteSentence(['돈', '드리다'], {
    storage,
    now: () => '2026-01-01T00:00:00.000Z',
  });
  saveFavoriteSentence(['돈', '드리다'], {
    storage,
    now: () => '2026-01-02T00:00:00.000Z',
  });

  const favorites = loadFavoriteSentences(storage);
  assert.equal(favorites.length, 1);
  assert.equal(favorites[0].createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(favorites[0].updatedAt, '2026-01-02T00:00:00.000Z');
});

test('favorite sentences can be removed by id', () => {
  const storage = createMemoryStorage();
  const { favorite } = saveFavoriteSentence(['돈'], { storage });

  removeFavoriteSentence(favorite.id, storage);

  assert.deepEqual(loadFavoriteSentences(storage), []);
  assert.equal(storage.getItem(SENTENCE_FAVORITES_STORAGE_KEY), '[]');
});
