
import { layoutObjectivePhases, LOOPS_PER_SECOND } from '../analyze.js';
import { castLabel } from './abilities.js';
import { clockText, escapeHtml, formatLoop, killerNames, portraitHtml } from './html.js';
import { icon } from './icons.js';
import { TALENT_TIERS } from './panel.js';
import { seekTo } from './playback.js';
import { root, state, TEAM_COLORS } from './state.js';
export function objectiveBandHtml(model) {
  const cells = layoutObjectivePhases(model.objectivePhases || [], model.durationLoops);
  if (!cells.length) return '';
  const clock = (loop) =>
    clockText(Math.max(0, Math.floor((loop - model.gatesOpenLoop) / LOOPS_PER_SECOND)));
  const rows = Math.max(...cells.map((c) => c.row)) + 1;
  const html = cells
    .map((c) => {
      const team = c.team === 0 || c.team === 1 ? c.team : null;
      const span = c.to > c.from ? `${clock(c.from)}-${clock(c.to)}` : clock(c.from);
      const held = c.counts
        ? c.counts[0] || c.counts[1]
          ? `, ${c.counts[0]} blue / ${c.counts[1]} red shots`
          : ', never held'
        : team == null
          ? ''
          : `, won by ${team === 0 ? 'blue' : 'red'}`;
      const title = `${c.label}${held} (${span})`;
      const runs = (c.segments || [])
        .map((s) => {
          const width = ((s.to - s.from) / (c.to - c.from)) * 100;
          const left = ((s.from - c.from) / (c.to - c.from)) * 100;
          return `<i class="replay-phase__run is-team${s.team}" style="left:${left}%;width:${width}%"></i>`;
        })
        .join('');
      return `<button class="replay-phase${team == null ? '' : ` is-team${team}`}${c.width ? '' : ' is-moment'}"
      data-phase-loop="${c.from}" style="left:${c.left}%;width:${c.width}%;--row:${c.row}"
      title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${runs}</button>`;
    })
    .join('');
  return `<div class="replay-phases" data-phase-band style="--rows:${rows}">${html}</div>`;
}
export const FEED_KINDS = [
  { id: 'ultimate', label: 'Ultimates' },
  { id: 'death', label: 'Deaths' },
  { id: 'level', label: 'Level ups' },
  { id: 'merc', label: 'Mercs' },
  { id: 'structure', label: 'Structures' },
  { id: 'objective', label: 'Objectives' },
  { id: 'verbose', label: 'Verbose', off: true },
];

export function buildFeed() {
  const { model } = state;
  const items = [];

  for (const p of model.players) {
    const selected = state.selected === p.playerId;
    if (state.selected && !selected) continue;
    for (const c of p.casts) {
      const { label, icon, slot } = castLabel(p, c);
      if (!state.selected && slot !== 'R') continue;
      if (slot === 'A' || slot === 'S' || slot === 'Z') continue;
      items.push({
        loop: c.loop,
        kind: 'ultimate',
        playerId: p.playerId,
        text: `${p.hero} ${p.name} ${label}`,
        html: `${portraitHtml(p)} ${icon ? `<img class="feed-icon" src="/images/abilitytalents/${icon}" alt="">` : ''} <span>${escapeHtml(label)}${
          c.presses > 1 ? ` <small>(×${c.presses} pressed)</small>` : ''
        }</span>`,
        cls: slot === 'R' ? 'is-heroic' : '',
      });
    }
    for (const d of p.deaths) {
      const killers = killerNames(model, d);
      items.push({
        loop: d.loop,
        kind: 'death',
        playerId: p.playerId,
        text: `${p.hero} ${p.name} killed ${killers.join(' ')}`,
        html: `${portraitHtml(p)} <span>${icon('skull')} ${escapeHtml(p.hero)} killed${
          killers.length ? ` by ${escapeHtml(killers.join(', '))}` : ''
        }</span>`,
        cls: 'is-death',
      });
    }
  }
  if (!state.selected) {
    const tierLevels = new Set(TALENT_TIERS);
    for (const c of model.camps) {
      const color = c.team === 0 || c.team === 1 ? TEAM_COLORS[c.team] : 'inherit';
      items.push({
        loop: c.loop,
        kind: 'merc',
        text: `${c.campType} captured`,
        html: `<span style="color:${color}">${icon('swords')} ${escapeHtml(c.campType)} captured</span>`,
        cls: 'is-camp',
      });
    }
    for (const s of model.structures) {
      if (s.diedLoop == null || !s.kind || s.kind === 'Tower' || s.kind === 'Healing Fountain') continue;
      items.push({
        loop: s.diedLoop,
        kind: 'structure',
        text: `${s.label} destroyed`,
        html: `<span style="color:${TEAM_COLORS[s.team]}">${icon('fort')} ${escapeHtml(s.label)} destroyed</span>`,
        cls: 'is-structure',
      });
    }
    for (const o of model.objectives) {
      const color = o.team === 0 || o.team === 1 ? TEAM_COLORS[o.team] : 'inherit';
      items.push({
        loop: o.loop,
        kind: o.kind || 'objective',
        text: o.text,
        html: `<span style="color:${color}">${icon('target')} ${escapeHtml(o.text)}</span>`,
        cls: o.kind === 'verbose' ? 'is-objective is-verbose' : 'is-objective',
      });
    }
    for (const t of [0, 1]) {
      for (const l of model.teamLevels[t]) {
        if (!tierLevels.has(l.level)) continue;
        items.push({
          loop: l.loop,
          kind: 'level',
          text: `Team reaches level ${l.level}`,
          html: `<span style="color:${TEAM_COLORS[t]}">${icon('levelUp')} Team reaches level ${l.level}</span>`,
          cls: 'is-level',
        });
      }
    }
  }

  items.sort((a, b) => a.loop - b.loop);
  state.allFeedItems = items;
  renderFeed();
}
export function renderFeed() {
  const feed = root.querySelector('[data-feed]');
  const query = state.feedQuery.trim().toLowerCase();
  const items = (state.allFeedItems || []).filter((it) => {
    if (!state.selected) {
      if (!state.feedKinds.has(it.kind)) return false;
      if (it.playerId != null && !state.feedHeroes.has(it.playerId)) return false;
    }
    return !query || it.text.toLowerCase().includes(query);
  });
  state.feedItems = items;
  feed.innerHTML = items.length
    ? items
        .map(
          (it, i) =>
            `<li class="feed-item ${it.cls}" data-loop="${it.loop}" data-idx="${i}">
          <span class="feed-time">${formatLoop(it.loop)}</span> ${it.html}
        </li>`
        )
        .join('')
    : '<li class="feed-empty">No events match these filters.</li>';
  for (const li of feed.querySelectorAll('.feed-item')) {
    li.addEventListener('click', () => {
      seekTo(Number(li.dataset.loop));
    });
  }
  lastActiveIdx = -1; // indices just changed, so the highlight has to be redone
  syncFeed();
}

let lastActiveIdx = -1;

export function syncFeed() {
  const items = state.feedItems || [];
  const loop = state.loop;
  let active = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].loop <= loop) active = i;
    else break;
  }
  if (active === lastActiveIdx) return;
  lastActiveIdx = active;
  const feed = root.querySelector('[data-feed]');
  const lis = feed.children;
  for (let i = 0; i < lis.length; i++) {
    lis[i].classList.toggle('is-past', i <= active);
    lis[i].classList.toggle('is-current', i === active);
  }
  if (active >= 0 && lis[active]) {
    const li = lis[active];
    feed.scrollTop = li.offsetTop - feed.clientHeight / 2 + li.clientHeight / 2;
  }
}
