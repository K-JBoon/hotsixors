// Mirrors --bp-* in css/tokens.css. Fallbacks cover a stylesheet that has not
// loaded yet.
const FALLBACKS = { "--bp-nav": 900, "--bp-compact": 900 };

function widthOf(name) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  return parseFloat(raw) || FALLBACKS[name];
}

export function below(name) {
  return window.matchMedia(`(max-width: ${widthOf(name)}px)`);
}

export function above(name) {
  return window.matchMedia(`(min-width: ${widthOf(name) + 1}px)`);
}
