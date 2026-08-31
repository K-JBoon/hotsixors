import { createNexusScene } from '/lost-in-the-nexus/nexus-scene.js';

// Offscreen plates for the replay viewer: one top-down map without its
// buildings, plus one sprite per building model. Driven by
// scripts/gen-replay-map3d.ts through a headless browser; the page itself shows
// only whatever was rendered last.
const view = document.getElementById('nexus-view');
const nexus = await createNexusScene({ view, pitch: 55 });

const isBuilding = (name) => name.startsWith('storm_building_');

window.nexusRender = {
  maps: nexus.maps,

  async map(slug, rect, options = {}) {
    const ok = await nexus.loadMap(slug, () => {}, { skip: isBuilding });
    if (!ok) return null;
    nexus.setShadows(true);
    return nexus.renderRect({ ...rect, ...options });
  },

  sprite(name, options = {}) {
    nexus.setShadows(false);
    return nexus.renderModel(name, options);
  },
};

window.nexusReady = true;
