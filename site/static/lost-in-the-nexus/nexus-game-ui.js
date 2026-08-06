
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node[key.toLowerCase()] = value;
    else if (key === 'style') Object.assign(node.style, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [children].flat()) if (child) node.append(child);
  return node;
}

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const MAP_IMAGE = (slug) => `/draft/maps/${slug}.webp`;

export function createGameUi({ page }) {
  if (!document.querySelector('link[data-nexus-game]')) {
    document.head.append(el('link', {
      rel: 'stylesheet', href: '/lost-in-the-nexus/nexus-game.css', 'data-nexus-game': true,
    }));
  }
  const hud = el('div', { class: 'ng-hud' });
  const panelHost = el('div', { class: 'ng-panels' });
  const shotHost = el('div', { class: 'ng-shots' });
  const layer = el('div', { class: 'ng' }, [hud, panelHost, shotHost]);
  page.append(layer);

  function setPanel(node) {
    panelHost.replaceChildren(node || '');
    panelHost.classList.toggle('is-open', !!node);
  }

  function setHud(node) {
    hud.replaceChildren(node || '');
  }

  return { layer, setPanel, setHud, shotHost, destroy: () => layer.remove() };
}

export function namePanel({ name, lobbyCode, onSubmit }) {
  const input = el('input', { class: 'ng-input', type: 'text', maxlength: '18', value: name || '', placeholder: 'Your name' });
  const submit = () => {
    const value = input.value.trim();
    if (value) onSubmit(value);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') submit();
    e.stopPropagation();
  };
  queueMicrotask(() => input.focus());
  return el('div', { class: 'ng-panel' }, [
    el('h2', { text: lobbyCode ? `Join lobby ${lobbyCode}` : 'Lost in the Nexus' }),
    el('p', { class: 'ng-muted', text: 'The lobby host will have one minute to fly around the map and take a picture. Players then have a few minutes to find the exact spot they took that picture! How close can you get?' }),
    input,
    el('button', { class: 'ng-btn ng-btn--primary', text: lobbyCode ? 'Join' : 'Create lobby', onClick: submit }),
  ]);
}

export function lobbyPanel({ lobbyCode, players, selfPeerId, isHost, onStart, onLeave, onMakeHost }) {
  const link = `${location.origin}${location.pathname}?game=${lobbyCode}`;
  const copy = el('button', { class: 'ng-btn', text: 'Copy invite link' });
  copy.onclick = () => {
    navigator.clipboard?.writeText(link).then(() => { copy.textContent = 'Copied'; });
  };
  const enough = players.length >= 2;
  return el('div', { class: 'ng-panel' }, [
    el('h2', { text: 'Lobby' }),
    el('div', { class: 'ng-code', text: lobbyCode }),
    el('ul', { class: 'ng-players' }, players.map((p) => el('li', {
      class: 'ng-player' + (p.peerId === selfPeerId ? ' is-self' : ''),
    }, [
      el('span', { class: 'ng-player__name', text: p.name }),
      el('span', { class: 'ng-player__actions' }, [
        p.isHost ? el('span', { class: 'ng-tag', text: 'host' }) : null,
        isHost && !p.isHost ? el('button', {
          class: 'ng-btn ng-btn--quiet ng-btn--small',
          text: 'Make host',
          onClick: () => onMakeHost(p.peerId),
        }) : null,
      ]),
    ]))),
    el('p', { class: 'ng-muted', text: `${players.length}/8 players.` }),
    el('div', { class: 'ng-row' }, [
      copy,
      isHost ? el('button', {
        class: 'ng-btn ng-btn--primary',
        text: enough ? 'Start' : 'Waiting for players',
        disabled: !enough,
        onClick: () => enough && onStart(),
      }) : el('span', { class: 'ng-muted', text: 'Waiting for the host to start.' }),
      el('button', { class: 'ng-btn ng-btn--quiet', text: 'Leave', onClick: onLeave }),
    ]),
  ]);
}

const ROLL_MS = 1600;
const ROLL_STEP_MS = 90;

// Every battleground is on the board; the roll flickers over them before the
// three playable ones settle and the rest go dark.
export function mapSelectPanel({ maps, choices, limitSec, isHost, onPick, onLimit }) {
  const offered = new Set(choices.map((c) => c.slug));
  const cards = maps.map((map) => {
    const card = el('button', { class: 'ng-map is-dealing', disabled: true }, [
      el('span', { class: 'ng-map__name', text: map.name }),
      el('span', { class: 'ng-map__size', text: `${Math.round((map.bytes || 0) / 1e6)} MB` }),
    ]);
    card.style.backgroundImage = `url(${MAP_IMAGE(map.slug)})`;
    if (offered.has(map.slug)) {
      card.onclick = () => {
        if (!isHost || card.disabled) return;
        grid.classList.add('is-settled');
        card.classList.add('is-picked');
        onPick(map.slug);
      };
    }
    return card;
  });
  const grid = el('div', { class: 'ng-maps' }, cards);

  const roll = setInterval(() => {
    for (const card of cards) card.classList.remove('is-rolling');
    cards[Math.floor(Math.random() * cards.length)].classList.add('is-rolling');
  }, ROLL_STEP_MS);
  setTimeout(() => {
    clearInterval(roll);
    for (const card of cards) card.classList.remove('is-rolling', 'is-dealing');
    for (const [index, map] of maps.entries()) {
      const card = cards[index];
      if (!offered.has(map.slug)) {
        card.classList.add('is-out');
        continue;
      }
      card.classList.add('is-offered');
      card.disabled = !isHost;
    }
  }, ROLL_MS);

  const limitLabel = el('span', { class: 'ng-limit__value', text: `${Math.round(limitSec / 60)} min` });
  const slider = el('input', {
    class: 'ng-slider', type: 'range', min: '1', max: '5', step: '1', value: String(Math.round(limitSec / 60)),
  });
  slider.oninput = () => {
    limitLabel.textContent = `${slider.value} min`;
    onLimit(Number(slider.value) * 60);
  };
  slider.onkeydown = (e) => e.stopPropagation();

  return el('div', { class: 'ng-panel ng-panel--wide' }, [
    el('h2', { text: isHost ? 'Pick a battleground' : 'The host is picking a battleground' }),
    grid,
    isHost ? el('label', { class: 'ng-limit' }, [
      el('span', { text: 'Guessing time' }),
      slider,
      limitLabel,
    ]) : el('p', { class: 'ng-muted', text: `Guessing time: ${Math.round(limitSec / 60)} min` }),
  ]);
}

// The clock is a live node the caller ticks: rebuilding the HUD every frame
// would swap the action button out from under a click.
export function hudView({ label, timeLeft, players, selfPeerId, action }) {
  const clock = el('span', { class: 'ng-clock' });
  const node = el('div', { class: 'ng-hud__inner' }, [
    el('div', { class: 'ng-hud__main' }, [
      el('span', { class: 'ng-hud__label', text: label }),
      timeLeft === null ? null : clock,
      action || null,
    ]),
    el('ul', { class: 'ng-hud__players' }, players.map((p) => el('li', {
      class: 'ng-chip' + (p.done ? ' is-done' : '') + (p.peerId === selfPeerId ? ' is-self' : ''),
    }, [
      el('span', { class: 'ng-chip__dot', style: { background: p.color } }),
      el('span', { text: p.name }),
      el('span', { class: 'ng-chip__state', text: p.state }),
    ]))),
  ]);

  const setClock = (ms) => {
    if (ms === null) return;
    clock.textContent = formatClock(ms);
    clock.classList.toggle('is-critical', ms <= 10000);
  };
  setClock(timeLeft);
  return { node, setClock };
}

export function confirmPanel({ image, onLockIn, onRetake }) {
  return el('div', { class: 'ng-panel ng-panel--wide' }, [
    el('h2', { text: 'Lock in this picture?' }),
    el('img', { class: 'ng-preview ng-preview--large', src: image, alt: 'Your picture' }),
    el('div', { class: 'ng-row' }, [
      el('button', { class: 'ng-btn ng-btn--primary', text: 'Lock in', onClick: onLockIn }),
      el('button', { class: 'ng-btn ng-btn--quiet', text: 'Keep looking', onClick: onRetake }),
    ]),
  ]);
}

// The host's picture: full screen first, then a corner thumbnail that reopens it.
export function createShotView({ shotHost }) {
  let image = null;
  const thumb = el('button', { class: 'ng-thumb', hidden: true, title: 'Show the picture again' });
  const overlay = el('div', { class: 'ng-lightbox', hidden: true });
  shotHost.append(overlay, thumb);

  function open() {
    overlay.hidden = false;
    thumb.hidden = true;
  }
  function close() {
    overlay.hidden = true;
    thumb.hidden = !image;
  }
  overlay.onclick = close;
  thumb.onclick = open;

  return {
    show(dataUrl) {
      image = dataUrl;
      overlay.replaceChildren(
        el('img', { class: 'ng-lightbox__image', src: dataUrl, alt: "The host's picture" }),
        el('p', { class: 'ng-lightbox__hint', text: 'Find this spot. Click anywhere to start looking.' }),
      );
      thumb.replaceChildren(el('img', { src: dataUrl, alt: "The host's picture" }));
      open();
    },
    // A one-off view that leaves the host picture's own state alone.
    preview(dataUrl, caption) {
      overlay.replaceChildren(
        el('img', { class: 'ng-lightbox__image', src: dataUrl, alt: caption }),
        el('p', { class: 'ng-lightbox__hint', text: caption }),
      );
      overlay.hidden = false;
      thumb.hidden = true;
    },
    close,
    hide() {
      image = null;
      overlay.hidden = true;
      thumb.hidden = true;
    },
  };
}

const MEDALS = { 1: ['gold', '1st'], 2: ['silver', '2nd'], 3: ['bronze', '3rd'] };
const COUNT_MS = 900;

// Points roll up from zero so a reveal reads as a score, not a printed number.
function countUp(node, to) {
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / COUNT_MS);
    const eased = 1 - (1 - t) ** 3;
    node.textContent = String(Math.round(to * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function resultsPanel({ target, isHost, onLeave, onOpenImage, onPlayAgain }) {
  const list = el('ol', { class: 'ng-results' });
  const panel = el('div', { class: 'ng-panel ng-panel--wide' }, [
    el('h2', { text: 'Results' }),
    el('p', { class: 'ng-muted', text: "The host's picture. Tap any picture to enlarge it." }),
    el('img', {
      class: 'ng-preview ng-preview--zoom',
      src: target,
      alt: "The host's picture",
      onClick: () => onOpenImage({ image: target, caption: "The host's picture" }),
    }),
    list,
    el('div', { class: 'ng-row' }, [
      isHost ? el('button', { class: 'ng-btn ng-btn--primary', text: 'Play again', onClick: onPlayAgain }) : null,
      el('button', { class: 'ng-btn ng-btn--quiet', text: 'Leave', onClick: onLeave }),
    ]),
  ]);
  return {
    panel,
    reveal(entry) {
      const [medal, place] = MEDALS[entry.rank] || [];
      const points = el('span', { class: 'ng-result__points', text: '0' });
      const row = el('li', { class: 'ng-result' + (medal ? ` is-${medal}` : '') }, [
        el('span', { class: 'ng-result__rank', text: place || `#${entry.rank}` }),
        entry.image ? el('img', {
          class: 'ng-result__image',
          src: entry.image,
          alt: `${entry.name}'s picture`,
          onClick: () => onOpenImage({ image: entry.image, shot: entry.shot, caption: `${entry.name}'s picture` }),
        }) : null,
        el('div', { class: 'ng-result__body' }, [
          el('span', { class: 'ng-result__name', text: entry.name }),
          el('span', {
            class: 'ng-result__detail',
            text: entry.shot
              ? `${Math.round(entry.distance)} units away, ${Math.round((entry.angle * 180) / Math.PI)}° off${entry.auto ? ', out of time' : ''}`
              : 'no picture',
          }),
        ]),
        points,
      ]);
      list.prepend(row);
      requestAnimationFrame(() => {
        row.classList.add('is-in');
        countUp(points, entry.points);
      });
    },
  };
}

export function noticePanel({ title, body, onLeave }) {
  return el('div', { class: 'ng-panel' }, [
    el('h2', { text: title }),
    body ? el('p', { class: 'ng-muted', text: body }) : null,
    onLeave ? el('button', { class: 'ng-btn ng-btn--quiet', text: 'Leave', onClick: onLeave }) : null,
  ]);
}
