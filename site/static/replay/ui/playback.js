
import { LOOPS_PER_SECOND } from '../analyze.js';
import { draw } from './drawing.js';
import { buildFeed, renderFeed, syncFeed } from './feed.js';
import { icon } from './icons.js';
import { root, state } from './state.js';
export function seekTo(loop) {
  state.loop = Math.max(0, Math.min(state.model.durationLoops, Math.round(loop)));
  state.playing = false;
  updatePlayButton();
  root.querySelector('[data-scrub]').value = state.loop;
  draw();
  syncFeed();
}

export function togglePlay() {
  state.playing = !state.playing;
  state.lastTick = performance.now();
  updatePlayButton();
}

export function updatePlayButton() {
  const btn = root.querySelector('[data-play]');
  btn.innerHTML = icon(state.playing ? 'pause' : 'play');
  btn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
}

const toggleInSet = (set, value) => (set.has(value) ? set.delete(value) : set.add(value));
export function wireFilterRow(btnSelector, allSelector, enabled, idOf) {
  const buttons = [...root.querySelectorAll(btnSelector)];
  const allBtn = root.querySelector(allSelector);
  const syncAllBtn = () => {
    allBtn.textContent = enabled.size ? 'None' : 'All';
  };
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      toggleInSet(enabled, idOf(btn));
      btn.classList.toggle('is-on', enabled.has(idOf(btn)));
      syncAllBtn();
      renderFeed();
    });
  }
  allBtn.addEventListener('click', () => {
    const turnOn = enabled.size === 0;
    enabled.clear();
    for (const btn of buttons) {
      if (turnOn) enabled.add(idOf(btn));
      btn.classList.toggle('is-on', turnOn);
    }
    syncAllBtn();
    renderFeed();
  });
  syncAllBtn();
}

export function selectPlayer(playerId) {
  state.selected = state.selected === playerId ? null : playerId;
  const p = state.model.players.find((x) => x.playerId === state.selected);
  root.querySelector('[data-feed-title]').textContent = p ? `${p.hero} (${p.name})` : 'All events';
  root.querySelector('[data-clear-select]').hidden = !p;
  root.querySelector('[data-kind-row]').hidden = !!p;
  root.querySelector('[data-hero-row]').hidden = !!p;
  for (const btn of root.querySelectorAll('[data-select]')) {
    btn.classList.toggle('is-selected', Number(btn.dataset.select) === state.selected);
  }
  buildFeed();
  draw();
}

export function tick(now) {
  if (state && state.playing) {
    const dt = (now - state.lastTick) / 1000;
    state.lastTick = now;
    state.loop = Math.min(state.loop + dt * LOOPS_PER_SECOND * state.speed, state.model.durationLoops);
    if (state.loop >= state.model.durationLoops) {
      state.playing = false;
      updatePlayButton();
    }
    root.querySelector('[data-scrub]').value = state.loop;
    draw();
    syncFeed();
  }
  requestAnimationFrame(tick);
}
