import { STAGES } from '/lost-in-the-nexus/nexus-stages.js';

// Debug view: click a placed model to see it alone, one render stage at a time.
export function createStageView({ nexus, overlay, hint }) {
  const title = overlay.querySelector('.nexus-inspect__title');
  const crumbs = overlay.querySelector('.nexus-inspect__stages');
  const panel = overlay.querySelector('.nexus-inspect__panel');
  const details = overlay.querySelector('.nexus-inspect__details');
  const copyButton = overlay.querySelector('.nexus-inspect__copy');
  let sections = [];
  let enabled = false;
  let stage = -1;
  let features = null;

  const buttons = STAGES.map((entry, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry.title;
    button.onclick = () => {
      button.blur();
      show(index);
    };
    const item = document.createElement('li');
    item.append(button);
    crumbs.append(item);
    return button;
  });

  function show(index) {
    stage = Math.max(0, Math.min(STAGES.length - 1, index));
    nexus.setStage(stage);
    buttons.forEach((button, i) => button.setAttribute('aria-current', String(i === stage)));
  }

  function step(direction) {
    for (let i = stage + direction; i >= 0 && i < STAGES.length; i += direction) {
      if (!buttons[i].disabled) return show(i);
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function table(rows) {
    const list = element('dl', 'nexus-inspect__values');
    for (const [key, value] of rows) list.append(element('dt', '', key), element('dd', '', String(value)));
    return list;
  }

  function slider(control) {
    const row = element('label', 'nexus-inspect__slider');
    const range = Object.assign(element('input'), { type: 'range', min: control.min, max: control.max, step: control.step });
    const number = Object.assign(element('input'), { type: 'number', min: control.min, step: control.step });
    const sync = () => {
      range.value = number.value = Number(control.get().toFixed(4));
      row.classList.toggle('is-changed', Math.abs(control.get() - control.base) > 1e-6);
    };
    const take = (value) => {
      if (!Number.isFinite(value)) return;
      control.set(value);
      sync();
    };
    range.oninput = () => take(range.valueAsNumber);
    number.onchange = () => take(number.valueAsNumber);
    control.sync = sync;
    sync();
    row.append(element('span', '', control.label), range, number);
    return row;
  }

  function section(heading, rows, controls) {
    const box = element('section', 'nexus-inspect__section');
    box.append(element('h3', '', heading));
    if (rows.length) box.append(table(rows));
    for (const control of controls) box.append(slider(control));
    details.append(box);
    return { heading, controls };
  }

  function fillPanel() {
    const { model, frame, materials } = nexus.inspectDetails();
    details.replaceChildren();
    sections = [
      section('Model', model, []),
      section('Frame', [], frame),
      ...materials.map((m, i) => section(`Material ${i + 1}: ${m.name}`, m.info, m.controls)),
    ];
  }

  function changes() {
    const out = {};
    for (const { heading, controls } of sections) {
      for (const c of controls) {
        if (Math.abs(c.get() - c.base) > 1e-6) (out[heading] ||= {})[c.key] = Number(c.get().toFixed(4));
      }
    }
    return out;
  }

  overlay.querySelector('.nexus-inspect__reset').onclick = (e) => {
    e.currentTarget.blur();
    for (const { controls } of sections) {
      for (const c of controls) {
        c.set(c.base);
        c.sync();
      }
    }
  };

  copyButton.onclick = async () => {
    copyButton.blur();
    const text = JSON.stringify(changes(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = 'Copied';
    } catch {
      console.log(text);
      copyButton.textContent = 'Logged to console';
    }
    setTimeout(() => (copyButton.textContent = 'Copy changes'), 1500);
  };

  function open(node) {
    overlay.hidden = false;
    hint.hidden = true;
    const inset = panel.getBoundingClientRect().width + 16;
    features = nexus.inspect(node, { inset });
    title.textContent = node.userData.model;
    buttons.forEach((button, i) => (button.disabled = features[STAGES[i].id] === false));
    fillPanel();
    show(0);
  }

  function close() {
    if (stage < 0) return;
    stage = -1;
    nexus.endInspect();
    overlay.hidden = true;
    hint.hidden = !enabled;
  }

  function onClick(e) {
    if (stage >= 0) return;
    const node = nexus.pickModel(e.clientX, e.clientY);
    if (node) open(node);
  }

  overlay.querySelector('.nexus-inspect__close').onclick = close;

  addEventListener('keydown', (e) => {
    if (stage < 0 || e.target.matches?.('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'Escape') close();
  });

  function setEnabled(on) {
    enabled = on;
    close();
    hint.hidden = !on;
    nexus.setClickHandler(on ? onClick : null);
  }

  return { setEnabled, close };
}
