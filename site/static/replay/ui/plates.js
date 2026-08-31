// The 3D plate layer: a top-down render of the map with its buildings left
// out, plus one pitched sprite per building pasted back over it. A building
// matched to a structure the replay says died stops being drawn.

const MATCH_DIST = 4; // game units between a placed building and its replay structure

let indexPromise = null;
function renderIndex() {
  indexPromise ||= fetch('/replay/plates/index.json')
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  return indexPromise;
}

function image(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Nearest structure inside MATCH_DIST, each structure claimed once. */
function matchBuildings(buildings, structures) {
  const taken = new Set();
  for (const b of buildings) {
    let best = null;
    let bestDist = MATCH_DIST * MATCH_DIST;
    for (const s of structures) {
      if (taken.has(s)) continue;
      const d = (s.x - b.x) ** 2 + (s.y - b.y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    if (best) {
      taken.add(best);
      b.structure = best;
      best.plated = true;
    }
  }
}

/** Whether this map has a plate, from the index alone: nothing heavy downloads. */
export async function hasPlate(mapMeta) {
  const slug = mapMeta && mapMeta.slug;
  return Boolean(slug) && (await renderIndex()).includes(slug);
}

/**
 * Resolves to the plate for this map, or null when it has not been rendered.
 * Sprites keep loading after that; `onReady` fires as each arrives.
 */
export async function loadPlate(mapMeta, model, onReady = () => {}) {
  const slug = mapMeta && mapMeta.slug;
  if (!(await hasPlate(mapMeta))) return null;

  const data = await fetch(`/replay/plates/${slug}.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const picture = await image(`/replay/plates/${slug}.webp`);
  if (!data || !picture) return null;

  matchBuildings(data.buildings, model.structures);
  const plate = {
    image: picture,
    scale: data.scale,
    sprites: data.sprites,
    // Painter's order: whatever stands further north is drawn first.
    buildings: data.buildings.slice().sort((a, b) => b.y - a.y),
    images: new Map(),
  };
  onReady();

  const files = new Map(Object.entries(data.sprites).map(([key, s]) => [key, s.file]));
  await Promise.all(
    [...files].map(async ([key, file]) => {
      const img = await image(file);
      if (img) plate.images.set(key, img);
    }),
  );
  onReady();
  return plate;
}
