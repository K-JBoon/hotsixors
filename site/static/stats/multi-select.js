// Checkbox dropdown that posts its selection as repeated hidden inputs, so
// FormData.getAll(name) reads it like a native multi-select. A group value
// selects all of its options, including ones added later (e.g. patch 2.55).

import { escapeHtml } from './view.js';

const SEARCH_FROM = 12;

/**
 * `el` holds `data-multi="<name>"`. `setOptions(options, selected)` takes
 * `[{ value, label, group? }]` and an optional `groups`, which maps a group
 * value to its label. The button stays disabled until the first call.
 */
export function multiSelect(el, { allLabel = 'All', groups = {} } = {}) {
  const name = el.dataset.multi;
  el.classList.add('multi');
  el.innerHTML = `
    <button class="input multi__button" type="button" aria-haspopup="listbox" aria-expanded="false"></button>
    <div class="multi__panel" hidden>
      <div class="multi__head">
        <input class="input multi__search" type="search" placeholder="Filter" hidden>
        <button class="multi__clear" type="button" data-select-all>Select all</button>
        <button class="multi__clear" type="button" data-clear>Clear</button>
      </div>
      <div class="multi__list" role="listbox" aria-multiselectable="true"></div>
    </div>
    <div class="multi__values"></div>`;
  const button = el.querySelector('.multi__button');
  const panel = el.querySelector('.multi__panel');
  const search = el.querySelector('.multi__search');
  const list = el.querySelector('.multi__list');
  const values = el.querySelector('.multi__values');
  if (el.hasAttribute('aria-labelledby')) {
    button.setAttribute('aria-labelledby', el.getAttribute('aria-labelledby'));
    el.removeAttribute('aria-labelledby');
  }
  button.disabled = true;
  let options = [];
  let selected = new Set();

  const groupOf = (value) => options.find((o) => o.value === value)?.group;
  const covered = (o) => selected.has(o.value) || (o.group != null && selected.has(o.group));
  const labelOf = (v) => (v in groups ? groups[v] : options.find((o) => o.value === v)?.label ?? v);

  function summary() {
    const picked = [...selected];
    if (!picked.length) return allLabel;
    if (picked.length <= 2) return picked.map(labelOf).join(', ');
    return `${picked.length} selected`;
  }

  function sync(notify) {
    values.innerHTML = [...selected].map((v) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(v)}">`).join('');
    button.textContent = summary();
    button.classList.toggle('is-set', selected.size > 0);
    for (const box of list.querySelectorAll('input[type=checkbox]')) {
      const v = box.value;
      box.checked = box.dataset.group != null ? selected.has(v) : covered(options.find((o) => o.value === v));
    }
    if (notify) el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = [];
    let lastGroup;
    for (const o of options) {
      if (q && !o.label.toLowerCase().includes(q)) continue;
      if (o.group != null && o.group !== lastGroup && o.group in groups) {
        rows.push(`<label class="multi__option multi__option--group"><input type="checkbox" value="${escapeHtml(o.group)}" data-group> ${escapeHtml(groups[o.group])}</label>`);
      }
      lastGroup = o.group;
      rows.push(`<label class="multi__option${o.group in groups ? ' multi__option--child' : ''}"><input type="checkbox" value="${escapeHtml(o.value)}"> ${escapeHtml(o.label)}</label>`);
    }
    list.innerHTML = rows.join('') || '<p class="multi__empty">No matches</p>';
    sync(false);
  }

  function toggle(value, isGroup, on) {
    if (isGroup) {
      for (const o of options) if (o.group === value) selected.delete(o.value);
      if (on) selected.add(value);
      else selected.delete(value);
      return;
    }
    const group = groupOf(value);
    if (group != null && selected.has(group) && !on) {
      selected.delete(group);
      for (const o of options) if (o.group === group && o.value !== value) selected.add(o.value);
      return;
    }
    if (on) selected.add(value);
    else selected.delete(value);
  }

  const open = (state) => {
    panel.hidden = !state;
    button.setAttribute('aria-expanded', String(state));
    if (state && !search.hidden) search.focus();
  };

  button.addEventListener('click', () => open(panel.hidden));
  list.addEventListener('change', (e) => {
    e.stopPropagation();
    const box = e.target;
    toggle(box.value, box.dataset.group != null, box.checked);
    sync(true);
  });
  search.addEventListener('input', draw);
  search.addEventListener('change', (e) => e.stopPropagation());
  el.querySelector('[data-select-all]').addEventListener('click', () => {
    for (const box of list.querySelectorAll('input[type=checkbox]:not([data-group])')) {
      if (!box.checked) toggle(box.value, false, true);
    }
    sync(true);
  });
  el.querySelector('[data-clear]').addEventListener('click', () => {
    selected.clear();
    sync(true);
  });
  document.addEventListener('click', (e) => {
    if (!el.contains(e.target)) open(false);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      open(false);
      button.focus();
    }
  });
  sync(false);

  return {
    setOptions(next, picked = [], nextGroups = groups) {
      const same = JSON.stringify(nextGroups) === JSON.stringify(groups) && next.length === options.length && next.every((o, i) => o.value === options[i].value && o.label === options[i].label);
      button.disabled = false;
      options = next;
      groups = nextGroups;
      selected = new Set(picked);
      if (same) return sync(false);
      search.hidden = options.length < SEARCH_FROM;
      if (search.hidden) search.value = '';
      draw();
    },
  };
}
