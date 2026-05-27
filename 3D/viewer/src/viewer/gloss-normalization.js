export function normalizeGlossKey(value) {
  return String(value ?? '').trim().normalize('NFC');
}

export function normalizeGlossSearch(value) {
  return normalizeGlossKey(value).toLocaleLowerCase('ko');
}
