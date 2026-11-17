const mapKey = (s) =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// A replay names its map in the recorder's language, so fall back to the map's
// content hash and then to its other localized names.
export function findMap(mapsData, title, hashes = []) {
  if (!mapsData) return null;
  const known = new Set(hashes);
  for (const entry of Object.values(mapsData)) {
    if (entry.hash && known.has(entry.hash)) return entry;
  }
  if (mapsData[title]) return mapsData[title];
  const want = mapKey(title || '');
  if (!want) return null;
  for (const entry of Object.values(mapsData)) {
    if ((entry.names || []).some((n) => mapKey(n) === want)) return entry;
  }
  return null;
}
