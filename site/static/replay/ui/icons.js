export const ICONS = {
  core: ['/replay/icons/storm_ui_minimapicon_core_blue.png', '/replay/icons/storm_ui_minimapicon_core_red.png'],
  town: ['/replay/icons/storm_ui_minimapicon_town_blue.png', '/replay/icons/storm_ui_minimapicon_town_red.png'],
  merccamp: [
    '/replay/icons/storm_ui_minimapicon_merccamp_blue.png',
    '/replay/icons/storm_ui_minimapicon_merccamp_red.png',
    '/replay/icons/storm_ui_minimapicon_merccamp_yellow.png',
  ],
  golemmerccamp: [
    '/replay/icons/storm_ui_minimapicon_golemmerccamp_blue.png',
    '/replay/icons/storm_ui_minimapicon_golemmerccamp_red.png',
    '/replay/icons/storm_ui_minimapicon_golemmerccamp_yellow.png',
  ],
  elitemerccamp: [
    '/replay/icons/storm_ui_minimapicon_elitemerccamp_blue.png',
    '/replay/icons/storm_ui_minimapicon_elitemerccamp_red.png',
    '/replay/icons/storm_ui_minimapicon_elitemerccamp_yellow.png',
  ],
  sunshrine: teamIcons('sunshrine'),
  moonshrine: teamIcons('moonshrine'),
  dragonknight: teamIcons('dragonknight'),
  skytempletop: teamIcons('skytempletop'),
  skytemplemid: teamIcons('skytemplemid'),
  skytemplebot: teamIcons('skytemplebot'),
  beacon_top: teamIcons('beacon_top'),
  beacon_bottom: teamIcons('beacon_bottom'),
  tod_waygate_in: teamIcons('tod_waygate_in'),
  tod_waygate_out: ['/replay/icons/storm_ui_minimapicon_tod_waygate_out.png'],
  spiderqueen_turnin: ['/replay/icons/storm_ui_minimapicon_spiderqueen_turnin.png'],
  piratecamp_full: ['/replay/icons/storm_ui_minimapicon_piratecamp_full.png'],
  ghostship: ['/replay/icons/storm_ui_minimapicon_ghostship.png'],
};
export function teamIcons(name) {
  return ['blue', 'red', 'yellow'].map((c) => `/replay/icons/storm_ui_minimapicon_${name}_${c}.png`);
}
export const iconImages = {};
for (const [key, srcs] of Object.entries(ICONS)) {
  iconImages[key] = srcs.map((src) => {
    const img = new Image();
    img.src = src;
    return img;
  });
}
const ICON_PATHS = {
  play: '<path d="M4.5 2.8 13 8l-8.5 5.2z"/>',
  pause: '<path d="M4.5 2.5h2.6v11H4.5zm4.4 0h2.6v11H8.9z"/>',
  expand:
    '<path d="M2 2h5v1.6H3.6V7H2zm7 0h5v5h-1.6V3.6H9zM2 9h1.6v3.4H7V14H2zm10.4 0H14v5H9v-1.6h3.4z"/>',
  collapse:
    '<path d="M6.4 2H8v5H3V5.4h3.4zM8 9v5H6.4v-3.4H3V9zm1-7h1.6v3.4H14V7H9zm0 7V9h5v1.6h-3.4V14z"/>',
  crown: '<path d="M1.5 4.6 4.6 7 8 2.4 11.4 7l3.1-2.4-1.2 8.1H2.7z"/>',
  skull:
    '<path d="M8 1.2c-3.2 0-5.4 2.1-5.4 5 0 1.7.8 3 2 3.8v1.9c0 .5.4.9.9.9h5c.5 0 .9-.4.9-.9V10c1.2-.8 2-2.1 2-3.8 0-2.9-2.2-5-5.4-5zM5.9 7.5a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4.2 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zM6.6 14v-2h1.1v2zm1.9 0v-2h1.1v2z"/>',
  swords:
    '<path d="M1.4 1.4h2.5l7.3 7.3-2.5 2.5-7.3-7.3zm13.2 0v2.5l-3.3 3.3-2.5-2.5 3.3-3.3zM4.5 8.8l2.4 2.4-3 3-1.3-.6-.6-1.3zm7 0 2.5 2.5-.6 1.3-1.3.6-3-3z"/>',
  fort: '<path d="M1.5 1.5h2v1.7h1.6V1.5h2v1.7h1.8V1.5h2v1.7h1.6V1.5h2V6h-1.2v8.5H2.7V6H1.5zm5.2 6.2h2.6v2.6H6.7z"/>',
  target:
    '<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.8a5.2 5.2 0 1 1 0 10.4 5.2 5.2 0 0 1 0-10.4zm0 1.9a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6zm0 1.9a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z"/>',
  levelUp: '<path d="M8 1.8 14 8h-3.4v6.2H5.4V8H2z"/>',
};
export function icon(name, cls) {
  return `<svg class="rp-icon${cls ? ` ${cls}` : ''}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${
    ICON_PATHS[name]
  }</svg>`;
}
export function drawDeathCross(ctx, x, y, r, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, r / 3);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
  ctx.stroke();
  ctx.restore();
}
export function drawIcon(ctx, img, x, y, size) {
  if (!img.complete || !img.naturalWidth) return;
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
}
