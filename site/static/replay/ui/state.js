
export const root = document.getElementById('replay-root');
export const dropZone = root.querySelector('[data-drop-zone]');
export const dropStatus = dropZone.querySelector('[data-drop-status]');
export const fileInput = document.querySelector('[data-file-input]');
export const BASE_CANVAS_WIDTH = 1200;

export const TEAM_COLORS = ['#4da3ff', '#ff5d5d'];
export const ILLUSION_TINT = 'rgba(90, 150, 255, 0.45)';
export const ILLUSION_EDGE = 'rgba(170, 210, 255, 0.9)';
export let state = null;

export function setState(next) {
  state = next;
}
