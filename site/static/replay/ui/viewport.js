
import { draw } from './drawing.js';
import { icon } from './icons.js';
import { BASE_CANVAS_WIDTH, root, state } from './state.js';

export const MAX_ZOOM = 8;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export function applyView() {
  const b = state.baseView;
  const w = (b.maxX - b.minX) / state.zoom;
  const h = (b.maxY - b.minY) / state.zoom;
  const cx = clamp(state.center.x, b.minX + w / 2, b.maxX - w / 2);
  const cy = clamp(state.center.y, b.minY + h / 2, b.maxY - h / 2);
  state.center.x = cx;
  state.center.y = cy;
  state.view = { minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2 };
  const btn = root.querySelector('[data-reset-view]');
  if (btn) btn.hidden = state.zoom === 1;
}

export function resetView() {
  state.zoom = 1;
  state.center.x = (state.baseView.minX + state.baseView.maxX) / 2;
  state.center.y = (state.baseView.minY + state.baseView.maxY) / 2;
  applyView();
  draw();
}

function eventToWorld(e) {
  const v = state.view;
  const rect = state.canvas.getBoundingClientRect();
  return [
    v.minX + ((e.clientX - rect.left) / rect.width) * (v.maxX - v.minX),
    v.maxY - ((e.clientY - rect.top) / rect.height) * (v.maxY - v.minY),
  ];
}

export function onCanvasWheel(e) {
  e.preventDefault();
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * state.canvas.clientHeight : e.deltaY;
  const next = clamp(state.zoom * Math.exp(-px * 0.0015), 1, MAX_ZOOM);
  if (next === state.zoom) return;
  const [wx, wy] = eventToWorld(e);
  const k = state.zoom / next;
  state.center.x = wx + (state.center.x - wx) * k;
  state.center.y = wy + (state.center.y - wy) * k;
  state.zoom = next;
  applyView();
  draw();
}

export function onCanvasPointerDown(e) {
  if (e.button !== 0) return;
  state.drag = { x: e.clientX, y: e.clientY };
  state.dragMoved = false;
}

export function onCanvasPointerMove(e) {
  const d = state.drag;
  if (!d) return;
  const dx = e.clientX - d.x;
  const dy = e.clientY - d.y;
  if (!state.dragMoved && Math.hypot(dx, dy) < 4) return;
  if (!state.dragMoved) {
    state.dragMoved = true;
    state.canvas.classList.add('is-panning');
    state.canvas.setPointerCapture(e.pointerId);
  }
  const v = state.view;
  const rect = state.canvas.getBoundingClientRect();
  state.center.x -= (dx / rect.width) * (v.maxX - v.minX);
  state.center.y += (dy / rect.height) * (v.maxY - v.minY); // game y axis points up
  d.x = e.clientX;
  d.y = e.clientY;
  applyView();
  draw();
}

export function onCanvasPointerUp(e) {
  if (!state.drag) return;
  state.drag = null;
  state.canvas.classList.remove('is-panning');
  if (state.canvas.hasPointerCapture(e.pointerId)) state.canvas.releasePointerCapture(e.pointerId);
}
export function canvasAspect() {
  const v = state.baseView;
  return (v.maxY - v.minY) / (v.maxX - v.minX);
}

function isFullscreen() {
  return document.fullscreenElement === root;
}

export function toggleFullscreen() {
  if (isFullscreen()) document.exitFullscreen();
  else root.requestFullscreen().catch(() => {});
}

function setCanvasSize(w, h) {
  const { canvas } = state;
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  state.visionCanvas.width = canvas.width;
  state.visionCanvas.height = canvas.height;
  draw();
}
export function fitCanvas() {
  const { canvas } = state;
  if (!isFullscreen()) {
    canvas.style.width = '';
    canvas.style.height = '';
    setCanvasSize(BASE_CANVAS_WIDTH, BASE_CANVAS_WIDTH * canvasAspect());
    return;
  }
  const box = root.querySelector('[data-canvas-box]');
  canvas.style.width = '0px';
  canvas.style.height = '0px';
  const availH = box.clientHeight;
  const availW = box.clientWidth;
  const aspect = canvasAspect();
  let w = Math.max(200, availW);
  let h = w * aspect;
  if (h > availH) {
    h = Math.max(150, availH);
    w = h / aspect;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  setCanvasSize(w, h);
}

document.addEventListener('fullscreenchange', () => {
  if (!state) return;
  const fsBtn = root.querySelector('[data-fullscreen]');
  fsBtn.innerHTML = icon(isFullscreen() ? 'collapse' : 'expand');
  fsBtn.setAttribute('aria-label', isFullscreen() ? 'Exit full screen' : 'Full screen');
  requestAnimationFrame(fitCanvas);
});

window.addEventListener('resize', () => {
  if (state && isFullscreen()) fitCanvas();
});

document.addEventListener('keydown', (e) => {
  if (!state || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const key = e.key.toLowerCase();
  if (key === 'f') toggleFullscreen();
  else if (key === 'r') resetView();
});
