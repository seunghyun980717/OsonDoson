import { normalizeGlossKey } from './gloss-normalization.js';

export const SENTENCE_FAVORITES_STORAGE_KEY = 'word-dictionary-avatar-viewer.favoriteSentences.v1';

function normalizeGlosses(glosses) {
  return (Array.isArray(glosses) ? glosses : [])
    .map(normalizeGlossKey)
    .filter(Boolean);
}

function favoriteIdFor(glosses) {
  return normalizeGlosses(glosses).join('\u001f');
}

function labelFor(glosses) {
  return normalizeGlosses(glosses).join(' + ');
}

function parseFavorites(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sanitizeFavorite(entry) {
  const glosses = normalizeGlosses(entry?.glosses);

  if (!glosses.length) {
    return null;
  }

  const id = String(entry?.id || favoriteIdFor(glosses));
  return {
    id,
    label: String(entry?.label || labelFor(glosses)),
    glosses,
    createdAt: String(entry?.createdAt || new Date(0).toISOString()),
    updatedAt: String(entry?.updatedAt || entry?.createdAt || new Date(0).toISOString()),
  };
}

export function loadFavoriteSentences(storage = window.localStorage) {
  return parseFavorites(storage.getItem(SENTENCE_FAVORITES_STORAGE_KEY))
    .map(sanitizeFavorite)
    .filter(Boolean);
}

export function saveFavoriteSentence(glosses, options = {}) {
  const storage = options.storage ?? window.localStorage;
  const now = options.now ?? (() => new Date().toISOString());
  const normalizedGlosses = normalizeGlosses(glosses);

  if (!normalizedGlosses.length) {
    return {
      favorite: null,
      favorites: loadFavoriteSentences(storage),
      saved: false,
    };
  }

  const id = favoriteIdFor(normalizedGlosses);
  const existingFavorites = loadFavoriteSentences(storage);
  const existing = existingFavorites.find((favorite) => favorite.id === id);
  const favorite = {
    id,
    label: labelFor(normalizedGlosses),
    glosses: normalizedGlosses,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
  const favorites = [
    favorite,
    ...existingFavorites.filter((entry) => entry.id !== id),
  ];

  storage.setItem(SENTENCE_FAVORITES_STORAGE_KEY, JSON.stringify(favorites));

  return {
    favorite,
    favorites,
    saved: true,
  };
}

export function removeFavoriteSentence(id, storage = window.localStorage) {
  const favorites = loadFavoriteSentences(storage)
    .filter((favorite) => favorite.id !== id);

  storage.setItem(SENTENCE_FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  return favorites;
}
