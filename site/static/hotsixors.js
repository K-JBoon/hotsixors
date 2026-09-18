
import { createSearchTerms, searchSiteIndex, selectGridSearchState, orderSelectGridSearchEntries, updateSelectGridSearchQuery } from './js/search.js';
import { effectIndexSearchFromState, effectIndexStateFromSearch, effectSlugFromHash } from './js/effect-index.js';
import { parseTalentBuildHash, serializeTalentBuildCode, serializeTalentBuildHash, talentTierHasChoice, toggleOptionalTalent, toggleRecommendedTalent } from './js/talent-builds.js';
import { applyDataminingState, DATAMINING_STORAGE_KEY, getAvailableStorage, getStoredBoolean, getStoredString, isDataminingEnabled, isDataminingSearchEntry, loadAliases, loadGameDataTree, loadSiteIndex, setStoredBoolean, setStoredString } from './js/storage.js';
import { createXmlHighlighter, escapeHtml, highlightGalaxyCode, highlightGameDataLine } from './js/highlight.js';
import { filterTreeNode, renderGameDataTree, restoreTree } from './js/gamedata-tree.js';
import { computeFolds, createFolder } from './js/folding.js';
import { chainOf, childrenOf, createXrefLinker, defsByLine, gamedataFileLabel, gamedataHref, incomingGroups, outlineDefs, targetsOf } from './js/xref.js';
export { createSearchTerms, matchesSearchEntry, searchSiteIndex, selectGridSearchState, orderSelectGridSearchEntries, updateSelectGridSearchQuery } from './js/search.js';
export { effectIndexSearchFromState, effectIndexStateFromSearch, effectSlugFromHash } from './js/effect-index.js';
export { parseTalentBuildHash, serializeTalentBuildCode, serializeTalentBuildHash, talentStateFromHotSBuildCode, talentTierHasChoice, toggleOptionalTalent, toggleRecommendedTalent } from './js/talent-builds.js';
export { getAvailableStorage, getStoredBoolean, isDataminingSearchEntry, setStoredBoolean } from './js/storage.js';
export { createXmlHighlighter, highlightGameDataLine } from './js/highlight.js';
export { renderGameDataTree } from './js/gamedata-tree.js';
export { computeFolds, createFolder } from './js/folding.js';
export { chainOf, childrenOf, createXrefLinker, defsByLine, gamedataFileLabel, gamedataHref, incomingGroups, jumpHistory, normalizeLinkValue, outlineDefs, refValuesByLine, targetsOf } from './js/xref.js';

// Hidden anchor spans carry the secondary ids of a line and must survive re-rendering.
function rawLineText(line) {
  // A stray CR would be a hard break inside the pre, pushing appended badges
  // onto a row of their own.
  if (line.dataset.raw === undefined) line.dataset.raw = line.textContent.replace(/\r/g, "");
  return line.dataset.raw;
}

function setLineHtml(line, html) {
  const anchors = [...line.querySelectorAll(".line-anchor")].map((el) => el.outerHTML).join("");
  const marks = [...line.querySelectorAll(".xref-defrow")];
  line.innerHTML = anchors + html;
  for (const mark of marks) line.appendChild(mark);
}

// XML state (comments, multi-line tags) carries across lines, so the whole file
// is rendered in one pass.
function renderGamedataLines(pre, lang, linkerForLine) {
  const lines = [...pre.querySelectorAll(".line")];
  if (lang === "xml") {
    const highlight = createXmlHighlighter();
    lines.forEach((line, index) => {
      setLineHtml(line, highlight(rawLineText(line), linkerForLine?.(index + 1)));
    });
    return lines;
  }
  for (const line of lines) setLineHtml(line, highlightGameDataLine(rawLineText(line), lang));
  return lines;
}

function setupFolding(lines) {
  if (!lines.length) return;

  const folder = createFolder(lines, computeFolds(lines.map(rawLineText)));

  for (const start of folder.folds.keys()) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "fold-toggle";
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Fold section");
    lines[start].prepend(toggle);
  }

  const syncToggle = (line) => {
    const toggle = line.querySelector(":scope > .fold-toggle");
    toggle?.setAttribute("aria-expanded", line.hasAttribute("data-folded") ? "false" : "true");
  };

  const container = lines[0].closest(".gamedata-code");
  container?.addEventListener("click", (event) => {
    const toggle = event.target.closest?.(".fold-toggle");
    if (!toggle) return;
    const line = toggle.closest(".line");
    folder.toggle(lines.indexOf(line));
    syncToggle(line);
  });

  const foldButton = document.querySelector("[data-gd-fold]");
  foldButton?.addEventListener("click", () => {
    const collapse = foldButton.getAttribute("aria-pressed") !== "true";
    if (collapse) folder.foldAll();
    else folder.unfoldAll();
    foldButton.setAttribute("aria-pressed", String(collapse));
    foldButton.textContent = collapse ? "Expand all" : "Collapse all";
    for (const start of folder.folds.keys()) syncToggle(lines[start]);
  });

  return (index) => {
    folder.reveal(index);
    for (const start of folder.folds.keys()) syncToggle(lines[start]);
  };
}

function initGameDataHighlighting() {
  for (const pre of document.querySelectorAll(".gamedata-code[data-lang]")) {
    const lang = pre.dataset.lang;
    if (lang !== "xml" && lang !== "galaxy") continue;
    if (pre.dataset.highlighted === "true") continue;

    const lines = renderGamedataLines(pre, lang);
    pre.dataset.highlighted = "true";
    if (!pre.dataset.xrefPath) setupFolding(lines);
  }
}

const XREF_HISTORY_KEY = "gamedata-xref-history";
const XREF_PANEL_KEY = "gamedata-xref-panel-open";

function readXrefHistory() {
  try {
    const raw = sessionStorage.getItem(XREF_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [], index: -1 };
    return parsed;
  } catch {
    return { entries: [], index: -1 };
  }
}

function writeXrefHistory(state) {
  try {
    sessionStorage.setItem(XREF_HISTORY_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable; history stays in-page only.
  }
}

function initGameDataJumpHistory() {
  const here = location.pathname + location.hash;
  const state = readXrefHistory();
  if (state.entries[state.index] !== here) {
    state.entries = state.entries.slice(0, state.index + 1);
    state.entries.push(here);
    if (state.entries.length > 50) state.entries.shift();
    state.index = state.entries.length - 1;
    writeXrefHistory(state);
  }

  document.addEventListener("keydown", (event) => {
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    const current = readXrefHistory();
    const next = current.index + (event.key === "ArrowLeft" ? -1 : 1);
    if (next < 0 || next >= current.entries.length) return;
    event.preventDefault();
    current.index = next;
    writeXrefHistory(current);
    location.href = current.entries[next];
  });
}

function createXrefPanel() {
  const panel = document.createElement("aside");
  panel.className = "xref-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <header class="xref-panel__header">
      <button type="button" class="xref-panel__back" hidden>&lsaquo; Outline</button>
      <span class="xref-panel__title"></span>
      <button type="button" class="xref-panel__close" aria-label="Close panel">&times;</button>
    </header>
    <nav class="xref-panel__chain"></nav>
    <div class="xref-panel__body"></div>`;
  (document.querySelector("[data-gd-shell]") ?? document.body).appendChild(panel);
  panel.querySelector(".xref-panel__close").addEventListener("click", () => { panel.hidden = true; });
  return panel;
}

function renderXrefChain(sidecar, currentPath, id) {
  const chain = chainOf(sidecar, id);
  if (!chain.length) return "";
  const links = chain.map(({ id: ancestorId, targets }) => {
    if (!targets.length) return `<span>${escapeHtml(ancestorId)}</span>`;
    const href = gamedataHref(targets[0].path, ancestorId, currentPath);
    return `<a href="${escapeHtml(href)}">${escapeHtml(ancestorId)}</a>`;
  });
  return `<span class="xref-panel__chain-label">inherits</span> ${links.join(" <span>‹</span> ")}`;
}

function renderTreeRow(node, currentPath, trail) {
  const expandable = !trail.includes(node.id);
  const toggle = expandable
    ? `<button type="button" class="xref-tree__toggle" aria-expanded="false" aria-label="Expand ${escapeHtml(node.id)}"></button>`
    : `<span class="xref-tree__toggle xref-tree__toggle--leaf">&#8635;</span>`;
  const icon = node.icon
    ? `<img class="xref-tree__icon" src="/images/abilitytalents/${escapeHtml(node.icon)}" alt="" width="18" height="18" loading="lazy">`
    : "";
  const label = node.label ?? node.id;
  const sub = node.label && node.label !== node.id ? `<span class="xref-tree__sub">${escapeHtml(node.id)}</span>` : "";
  const field = node.field ? `<span class="xref-tree__field">${escapeHtml(node.field)}</span>` : "";

  return `<li class="xref-tree__item" data-xref-node="${escapeHtml(node.id)}" data-xref-node-path="${escapeHtml(node.path)}" data-xref-trail="${escapeHtml(trail.join(" "))}">
      <div class="xref-tree__row">
        ${toggle}
        ${icon}
        <a class="xref-tree__name" href="${escapeHtml(gamedataHref(node.path, node.id, currentPath))}">${escapeHtml(label)}${sub}</a>
        ${field}
      </div>
      <ul class="xref-tree__children" hidden></ul>
    </li>`;
}

// Ability and talent metadata for any id, once the index has loaded.
let entryIndex = {};

function decorateNode(node) {
  const meta = entryIndex[node.id];
  if (!meta) return node;
  const [name, icon, , abilityType] = meta;
  return {
    ...node,
    label: abilityType ? `${name} (${abilityType})` : name,
    icon: icon || node.icon,
  };
}

function renderOutlineRows(items, currentPath) {
  return items.map((entry) => renderTreeRow({
    id: entry.id,
    path: currentPath,
    label: entry.abilityType ? `${entry.name} (${entry.abilityType})` : entry.name,
    icon: entry.icon,
  }, currentPath, [])).join("");
}

// Talents keep their in-game tier grouping; anything without a level falls into
// a trailing "Other" group.
function renderTalentTiers(talents, currentPath) {
  const tiers = new Map();
  for (const entry of talents) {
    const level = entry.level ?? 0;
    tiers.set(level, [...(tiers.get(level) ?? []), entry]);
  }
  return [...tiers.entries()]
    .sort((a, b) => (a[0] || 99) - (b[0] || 99))
    .map(([level, items]) =>
      `<h5 class="xref-panel__tier">${level ? `Level ${level}` : "Other"}</h5><ul class="xref-tree">${renderOutlineRows(items, currentPath)}</ul>`)
    .join("");
}

function renderXrefOutline(entryFile, sidecar, currentPath) {
  const entries = entryFile?.entries ?? [];
  if (entries.length) {
    const abilities = entries.filter((entry) => entry.kind === "ability");
    const talents = entries.filter((entry) => entry.kind === "talent");
    const sections = [];
    if (abilities.length) {
      sections.push(`<section><h4>Abilities <span>${abilities.length}</span></h4><ul class="xref-tree">${renderOutlineRows(abilities, currentPath)}</ul></section>`);
    }
    if (talents.length) {
      sections.push(`<section><h4>Talents <span>${talents.length}</span></h4>${renderTalentTiers(talents, currentPath)}</section>`);
    }
    return sections.join("");
  }

  const { items, total } = outlineDefs(sidecar);
  if (!items.length) return `<p class="xref-panel__empty">Nothing to outline in this file.</p>`;
  const rows = items.map((def) => renderTreeRow({
    id: def.id,
    path: currentPath,
    tag: def.tag,
  }, currentPath, [])).join("");
  const note = total > items.length
    ? `<p class="xref-panel__empty">Showing first ${items.length} of ${total}.</p>`
    : "";
  return `<section><h4>Definitions <span>${total}</span></h4><ul class="xref-tree">${rows}</ul></section>${note}`;
}

function renderXrefChildren(children, currentPath, trail) {
  if (!children.length) return `<li class="xref-tree__empty">No further references.</li>`;
  return children.map((child) => renderTreeRow(decorateNode(child), currentPath, trail)).join("");
}

function renderXrefGroups(incomingFile, currentPath, id) {
  const groups = incomingGroups(incomingFile, id);
  if (!groups.length) return `<p class="xref-panel__empty">No references.</p>`;

  const truncated = incomingFile.truncated?.[id];
  const sections = groups.map(({ field, items }) => {
    const rows = items.map(({ path, line, from }) => {
      const href = gamedataHref(path, from, currentPath);
      const file = gamedataFileLabel(path);
      const meta = entryIndex[from];
      const icon = meta?.[1]
        ? `<img class="xref-panel__icon" src="/images/abilitytalents/${escapeHtml(meta[1])}" alt="" width="20" height="20" loading="lazy">`
        : "";
      const label = meta ? `${meta[0]}${meta[3] ? ` (${meta[3]})` : ""}` : (from || file);
      const sub = meta ? `<span class="xref-panel__sub">${escapeHtml(from)}</span>` : "";
      return `<li><a href="${escapeHtml(href)}">${icon}<span class="xref-panel__rowtext"><span class="xref-panel__id">${escapeHtml(label)}</span>${sub}<span class="xref-panel__loc">${escapeHtml(file)}:${line}</span></span></a></li>`;
    }).join("");
    return `<section><h4>${escapeHtml(field)} <span>${items.length}</span></h4><ul>${rows}</ul></section>`;
  }).join("");

  const note = truncated ? `<p class="xref-panel__empty">Showing first ${MAX_SHOWN_REFS} of ${truncated}.</p>` : "";
  return sections + note;
}

const MAX_SHOWN_REFS = 200;

async function fetchJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function initGameDataXref() {
  const pre = document.querySelector(".gamedata-code[data-xref-path]");
  if (!pre) return;

  const currentPath = pre.dataset.xrefPath;
  const sidecar = await fetchJson(`/gamedata-xref/${currentPath}.json`);
  if (!sidecar) return;

  const linkerForLine = createXrefLinker(sidecar, currentPath);
  const lines = renderGamedataLines(pre, "xml", linkerForLine);
  const revealLine = setupFolding(lines);

  const revealTarget = (element) => {
    const line = element.closest?.(".line") ?? element;
    const index = lines.indexOf(line);
    if (index >= 0) revealLine?.(index);
    return line;
  };

  const panel = createXrefPanel();
  const body = panel.querySelector(".xref-panel__body");
  const back = panel.querySelector(".xref-panel__back");
  const chain = panel.querySelector(".xref-panel__chain");
  const title = panel.querySelector(".xref-panel__title");

  let incomingRequest = null;
  const loadIncoming = () => (incomingRequest ??= fetchJson(`/gamedata-xref/${currentPath}.refs.json`));

  const sidecarCache = new Map([[currentPath, Promise.resolve(sidecar)]]);
  const loadSidecar = (path) => {
    if (!sidecarCache.has(path)) sidecarCache.set(path, fetchJson(`/gamedata-xref/${path}.json`));
    return sidecarCache.get(path);
  };

  let entryRequest = null;
  const loadEntries = () => (entryRequest ??= fetchJson(`/gamedata-xref/${currentPath}.entries.json`));

  let indexRequest = null;
  const loadEntryIndex = async () => {
    indexRequest ??= fetchJson("/gamedata-xref/entry-index.json");
    entryIndex = (await indexRequest) ?? {};
    return entryIndex;
  };

  const showOutline = async () => {
    panel.hidden = false;
    panel.dataset.xrefMode = "outline";
    panel.dataset.xrefShowing = "";
    back.hidden = true;
    title.textContent = gamedataFileLabel(currentPath);
    chain.innerHTML = "";
    body.innerHTML = `<p class="xref-panel__empty">Loading…</p>`;
    const [entryFile] = await Promise.all([loadEntries(), loadEntryIndex()]);
    if (panel.dataset.xrefMode !== "outline") return;
    body.innerHTML = renderXrefOutline(entryFile, sidecar, currentPath);
  };

  const showReferences = async (id) => {
    panel.hidden = false;
    panel.dataset.xrefMode = "refs";
    panel.dataset.xrefShowing = id;
    back.hidden = false;
    title.textContent = id;
    chain.innerHTML = renderXrefChain(sidecar, currentPath, id);
    body.innerHTML = `<p class="xref-panel__empty">Loading references…</p>`;
    const [incomingFile] = await Promise.all([loadIncoming(), loadEntryIndex()]);
    if (panel.dataset.xrefShowing !== id) return;
    body.innerHTML = incomingFile
      ? renderXrefGroups(incomingFile, currentPath, id)
      : `<p class="xref-panel__empty">References unavailable.</p>`;
  };

  back.addEventListener("click", showOutline);

  // Lazy, cycle-guarded expansion: a node's children come from the sidecar of
  // the file that defines it.
  body.addEventListener("click", async (event) => {
    const toggle = event.target.closest?.("button.xref-tree__toggle");
    if (!toggle) return;
    const item = toggle.closest(".xref-tree__item");
    const children = item.querySelector(".xref-tree__children");
    const expanded = toggle.getAttribute("aria-expanded") === "true";

    if (expanded) {
      toggle.setAttribute("aria-expanded", "false");
      children.hidden = true;
      return;
    }

    toggle.setAttribute("aria-expanded", "true");
    children.hidden = false;
    if (item.dataset.xrefLoaded === "true") return;
    item.dataset.xrefLoaded = "true";
    children.innerHTML = `<li class="xref-tree__empty">Loading…</li>`;

    const nodePath = item.dataset.xrefNodePath;
    const nodeSidecar = await loadSidecar(nodePath);
    if (!nodeSidecar) {
      children.innerHTML = `<li class="xref-tree__empty">Unavailable.</li>`;
      return;
    }
    const trail = [...(item.dataset.xrefTrail ? item.dataset.xrefTrail.split(" ") : []), item.dataset.xrefNode];
    children.innerHTML = renderXrefChildren(childrenOf(nodeSidecar, item.dataset.xrefNode), currentPath, trail);
  });

  const storage = getAvailableStorage(window);
  const outlineButton = document.createElement("button");
  outlineButton.type = "button";
  outlineButton.textContent = "Outline";
  outlineButton.addEventListener("click", () => {
    if (panel.hidden || panel.dataset.xrefMode !== "outline") showOutline();
    else panel.hidden = true;
    outlineButton.setAttribute("aria-pressed", String(!panel.hidden));
    setStoredBoolean(storage, XREF_PANEL_KEY, !panel.hidden);
  });
  outlineButton.className = "gd-btn";
  outlineButton.setAttribute("aria-pressed", "false");
  document.querySelector("[data-gd-actions]")?.appendChild(outlineButton);

  panel.querySelector(".xref-panel__close").addEventListener("click", () => {
    outlineButton.setAttribute("aria-pressed", "false");
    setStoredBoolean(storage, XREF_PANEL_KEY, false);
  });
  const wideEnough = window.matchMedia("(min-width: 901px)").matches;
  if (wideEnough && getStoredBoolean(storage, XREF_PANEL_KEY, true)) {
    outlineButton.setAttribute("aria-pressed", "true");
    showOutline();
  }

  // Same-page targets do not re-fire when the hash is unchanged.
  panel.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href^='#']");
    const id = link?.getAttribute("href").slice(1);
    const target = id && document.getElementById(decodeURIComponent(id));
    if (!target) return;
    event.preventDefault();
    location.hash = id;
    revealTarget(target).scrollIntoView({ block: "center" });
  });

  // A hash from another file lands on a line that may sit inside a closed fold.
  const revealHash = () => {
    const id = location.hash.slice(1);
    const target = id && document.getElementById(decodeURIComponent(id));
    if (target) revealTarget(target).scrollIntoView({ block: "center" });
  };
  revealHash();
  window.addEventListener("hashchange", revealHash);

  await loadEntryIndex();
  const badgeRow = (line) => {
    let row = line.querySelector(":scope > .xref-defrow");
    if (!row) {
      row = document.createElement("span");
      row.className = "xref-defrow";
      line.appendChild(row);
    }
    return row;
  };

  for (const [line, defs] of defsByLine(sidecar)) {
    const host = lines[line - 1];
    if (!host) continue;
    const target = badgeRow(host);
    for (const def of defs) {
      const meta = entryIndex[def.id];
      if (meta) {
        const chip = document.createElement("span");
        chip.className = "xref-defchip";
        const [name, icon, , abilityType] = meta;
        chip.innerHTML = `${icon ? `<img src="/images/abilitytalents/${escapeHtml(icon)}" alt="" width="16" height="16" loading="lazy">` : ""}${escapeHtml(abilityType ? `${name} (${abilityType})` : name)}`;
        target.appendChild(chip);
      }
      if (!def.refCount) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "xref-defmark";
      button.dataset.xrefDef = def.id;
      button.textContent = def.refCount === 1 ? "1 ref" : `${def.refCount} refs`;
      button.addEventListener("mouseenter", loadIncoming, { once: true });
      button.addEventListener("click", () => showReferences(def.id));
      target.appendChild(button);
    }
  }

  pre.addEventListener("click", (event) => {
    const link = event.target.closest?.("a.xref-link");
    if (!link) return;
    const state = readXrefHistory();
    state.entries = state.entries.slice(0, state.index + 1);
    state.entries.push(new URL(link.href).pathname + new URL(link.href).hash);
    state.index = state.entries.length - 1;
    writeXrefHistory(state);
  });
}

const GAMEDATA_WRAP_KEY = "gamedata-wrap";

function initGameDataShell() {
  const shell = document.querySelector("[data-gd-shell]");
  if (!shell) return;

  // The shell fills what the nav and footer leave, so nothing scrolls the page.
  const nav = document.querySelector(".site-nav");
  const footer = document.querySelector(".site-footer");
  const syncChromeHeight = () => {
    const height = (nav?.getBoundingClientRect().height ?? 0) + (footer?.getBoundingClientRect().height ?? 0);
    shell.style.setProperty("--gd-nav-h", `${Math.ceil(height)}px`);
  };
  syncChromeHeight();
  window.addEventListener("resize", syncChromeHeight);
  if (typeof ResizeObserver === "function" && footer) new ResizeObserver(syncChromeHeight).observe(footer);

  const copy = shell.querySelector("[data-gd-copy-path]");
  const path = shell.querySelector("[data-gd-file-path]")?.dataset.gdFilePath ?? "";
  copy?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(path);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Copy failed";
    }
    setTimeout(() => { copy.textContent = "Copy path"; }, 1200);
  });

  const wrap = shell.querySelector("[data-gd-wrap]");
  const code = shell.querySelector("[data-gd-code]");
  if (wrap && code) {
    const storage = getAvailableStorage(window);
    const applyWrap = (on) => {
      code.classList.toggle("is-wrapped", on);
      wrap.setAttribute("aria-pressed", String(on));
    };
    applyWrap(getStoredBoolean(storage, GAMEDATA_WRAP_KEY, false));
    wrap.addEventListener("click", () => {
      const next = wrap.getAttribute("aria-pressed") !== "true";
      setStoredBoolean(storage, GAMEDATA_WRAP_KEY, next);
      applyWrap(next);
    });
  }
}

function initBattlegroundHighlighting() {
  for (const code of document.querySelectorAll("pre.bg-code-block__pre code.language-galaxy")) {
    const pre = code.closest("pre");
    if (pre && pre.dataset.highlighted === "true") continue;
    const lines = code.textContent.split("\n");
    code.innerHTML = lines.map(line => highlightGalaxyCode(line)).join("\n");
    if (pre) pre.dataset.highlighted = "true";
  }
}


function initGlobalSearch() {
  const root = document.querySelector("[data-site-search]");
  if (!root) return;

  const input = root.querySelector("[data-site-search-input]");
  const results = root.querySelector("[data-site-search-results]");
  if (!input || !results) return;

  let timer = 0;

  function hideResults() {
    results.hidden = true;
    results.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
  }

  async function render(query) {
    const trimmed = query.trim();
    if (!trimmed) {
      hideResults();
      return;
    }

    const [index, aliases] = await Promise.all([loadSiteIndex(), loadAliases()]);
    const visibleIndex = isDataminingEnabled()
      ? index
      : index.filter((entry) => !isDataminingSearchEntry(entry));
    const matches = searchSiteIndex(visibleIndex, trimmed, aliases, 10);
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");

    if (matches.length === 0) {
      results.innerHTML = '<div class="site-search__empty">No results</div>';
      return;
    }

    results.innerHTML = matches.map((entry) => `
      <a class="site-search__result" href="${escapeHtml(entry.url)}">
        <span class="site-search__result-title">${escapeHtml(entry.title)}</span>
        <span class="site-search__result-meta">${escapeHtml(entry.type || "Page")}</span>
      </a>
    `).join("");
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => render(input.value), 100);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = "";
      hideResults();
    }
  });

  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) hideResults();
  });

  document.addEventListener("dataminingchange", () => {
    if (input.value.trim()) render(input.value);
  });
}

function initDataminingToggle() {
  const storage = getAvailableStorage(window);
  const toggles = [...document.querySelectorAll("[data-datamining-toggle]")];
  if (toggles.length === 0) return;

  applyDataminingState(getStoredBoolean(storage, DATAMINING_STORAGE_KEY, false));

  for (const toggle of toggles) {
    toggle.addEventListener("change", () => {
      const enabled = toggle.checked;
      setStoredBoolean(storage, DATAMINING_STORAGE_KEY, enabled);
      applyDataminingState(enabled);
      document.dispatchEvent(new CustomEvent("dataminingchange", { detail: { enabled } }));
    });
  }
}

function initPrimaryNav() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const menu = document.querySelector("[data-nav-menu]");
  if (!toggle || !menu) return;

  const mq = window.matchMedia("(max-width: 760px)");

  function setExpanded(expanded) {
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", expanded ? "Close menu" : "Open menu");
    menu.hidden = mq.matches && !expanded;
  }

  function applyLayout() {
    if (mq.matches) {
      setExpanded(toggle.getAttribute("aria-expanded") === "true");
    } else {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
      menu.hidden = false;
    }
  }

  toggle.addEventListener("click", () => {
    setExpanded(toggle.getAttribute("aria-expanded") !== "true");
  });

  menu.addEventListener("click", (event) => {
    if (mq.matches && event.target.closest(".nav-link, .nav-dropdown__item")) setExpanded(false);
  });

  mq.addEventListener("change", applyLayout);
  applyLayout();
}

function initNavDropdowns() {
  const dropdowns = [...document.querySelectorAll("[data-nav-dropdown]")];
  if (dropdowns.length === 0) return;

  document.addEventListener("click", (event) => {
    for (const dropdown of dropdowns) {
      if (dropdown.open && !dropdown.contains(event.target)) dropdown.open = false;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const dropdown of dropdowns) dropdown.open = false;
  });
}


async function initGameDataSearch() {
  const root = document.querySelector("[data-gamedata-tree]");
  const input = document.querySelector("[data-gamedata-search-input]");
  const clear = document.querySelector("[data-gamedata-search-clear]");
  if (!root || !input) return;

  const tree = await loadGameDataTree();
  root.innerHTML = renderGameDataTree(tree, root.dataset.currentPath || "");

  for (const details of root.querySelectorAll("details[data-tree-node]")) {
    details.dataset.initialOpen = details.open ? "true" : "false";
  }

  let timer = 0;

  async function applyFilter() {
    const query = input.value.trim();
    if (!query) {
      restoreTree(root);
      if (clear) clear.hidden = true;
      return;
    }

    if (clear) clear.hidden = false;
    const aliases = await loadAliases();
    const topNodes = [...root.querySelectorAll(":scope > [data-tree-node]")];
    for (const node of topNodes) filterTreeNode(node, query, aliases);
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(applyFilter, 100);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = "";
      applyFilter();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
    event.preventDefault();
    input.focus();
    input.select();
  });

  clear?.addEventListener("click", () => {
    input.value = "";
    applyFilter();
    input.focus();
  });
}

async function initSelectGridSearch() {
  const roots = [...document.querySelectorAll("[data-select-search]")];
  if (roots.length === 0) return;

  const aliases = await loadAliases();

  for (const root of roots) {
    const status = root.querySelector("[data-select-search-status]");
    const cards = [...root.querySelectorAll("[data-select-search-card]")];
    if (cards.length === 0) continue;

    const entries = cards.map((card, index) => ({
      id: card.dataset.selectSearchId || String(index),
      title: card.dataset.selectSearchText || card.textContent || "",
      element: card,
    }));

    let query = "";
    let appliedOrder = null;

    function applySearch() {
      const hasQuery = createSearchTerms(query, aliases).length > 0;
      const state = selectGridSearchState(entries, query, aliases);
      let matchCount = 0;

      root.classList.toggle("select-search--active", hasQuery);

      state.forEach((entryState, index) => {
        const card = cards[index];
        const matches = entryState.matches;
        if (matches) matchCount += 1;
        card.classList.toggle("select-search-card--match", hasQuery && matches);
        card.classList.toggle("select-search-card--dim", hasQuery && !matches);
      });

      if (status) {
        status.textContent = hasQuery
          ? `Filtering by ${query}. ${matchCount} of ${cards.length} matches. Press Escape to clear.`
          : "";
      }
      const order = orderSelectGridSearchEntries(entries, query, aliases).map((entry) => entry.element);
      if (!appliedOrder || order.some((element, index) => appliedOrder[index] !== element)) {
        appliedOrder = order;
        for (const element of order) element.parentElement?.appendChild(element);
      }
    }

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      if (target?.isContentEditable) return;
      if (target?.matches?.("input, textarea, select")) return;

      const nextQuery = updateSelectGridSearchQuery(query, event);
      if (nextQuery === query) return;

      event.preventDefault();
      query = nextQuery;
      applySearch();
    });

    applySearch();
  }
}

function currentBuildUrl(hash) {
  return `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("input");
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}

function initTalentBuilds() {
  const cards = [...document.querySelectorAll("[data-talent-id][data-talent-tier]")];
  if (cards.length === 0) return;

  const buildRoot = document.querySelector("[data-talent-hero]");
  const heroName = buildRoot?.dataset.talentHero || "";
  const talentRows = [];
  const rowsByElement = new Map();
  for (const card of cards) {
    const row = card.closest(".talent-row");
    if (!row) continue;

    if (!rowsByElement.has(row)) {
      const entry = { row, tier: card.dataset.talentTier, talentIds: [] };
      rowsByElement.set(row, entry);
      talentRows.push(entry);
    }

    rowsByElement.get(row).talentIds.push(card.dataset.talentId);
  }

  const shareButton = document.querySelector("[data-share-build]");
  const shareStatus = document.querySelector("[data-share-build-status]");
  const buildCodeButton = document.querySelector("[data-copy-build-code]");
  const buildCodePreview = document.querySelector("[data-build-code-preview]");
  const parseCurrentHash = () => parseTalentBuildHash(window.location.hash, talentRows, heroName);
  let state = parseCurrentHash();
  let feedbackTimer = null;

  function applyState() {
    for (const card of cards) {
      const talentId = card.dataset.talentId;
      const tier = card.dataset.talentTier;
      const isRecommended = state.recommended[tier] === talentId;
      const isOptional = state.optional.has(talentId);
      const name = card.querySelector(".talent-card__name")?.textContent?.trim() || "Talent";
      const level = card.closest(".talent-tier")?.querySelector(".talent-tier__label")?.textContent?.trim();
      const stateLabel = isRecommended ? "recommended" : isOptional ? "optional" : "not selected";
      card.classList.toggle("talent-card--recommended", isRecommended);
      card.classList.toggle("talent-card--optional", isOptional);
      card.setAttribute("aria-pressed", isRecommended || isOptional ? "true" : "false");
      card.setAttribute(
        "aria-label",
        `${name}${level ? `, ${level}` : ""}, ${stateLabel}. Press Enter to recommend or Space to mark optional.`
      );
    }

    for (const { row, tier, talentIds } of talentRows) {
      row.classList.toggle("talent-row--has-choice", talentTierHasChoice(state, tier, talentIds));
    }

    if (shareButton) shareButton.hidden = false;

    const buildCode = serializeTalentBuildCode(state, talentRows, heroName);
    if (buildCodeButton) buildCodeButton.hidden = false;
    if (buildCodePreview) {
      buildCodePreview.hidden = false;
      buildCodePreview.value = buildCode;
    }
  }

  function showCopiedFeedback(message = "Copied!") {
    if (!shareStatus) return;
    if (feedbackTimer) clearTimeout(feedbackTimer);
    shareStatus.textContent = message;
    feedbackTimer = window.setTimeout(() => {
      feedbackTimer = null;
      shareStatus.textContent = "";
    }, 1600);
  }

  function writeHash() {
    const hash = serializeTalentBuildHash(state, talentRows, heroName);
    history.replaceState(null, "", currentBuildUrl(hash));
    applyState();
  }

  for (const card of cards) {
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-pressed", "false");

    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      state = toggleRecommendedTalent(state, card.dataset.talentTier, card.dataset.talentId);
      writeHash();
    });

    card.addEventListener("contextmenu", (event) => {
      if (event.target.closest("a, button")) return;
      event.preventDefault();
      state = toggleOptionalTalent(state, card.dataset.talentId);
      writeHash();
    });

    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        state = toggleRecommendedTalent(state, card.dataset.talentTier, card.dataset.talentId);
        writeHash();
      } else if (event.key === " ") {
        event.preventDefault();
        state = toggleOptionalTalent(state, card.dataset.talentId);
        writeHash();
      }
    });
  }

  window.addEventListener("hashchange", () => {
    state = parseCurrentHash();
    applyState();
  });

  shareButton?.addEventListener("click", async () => {
    await copyText(currentBuildUrl(serializeTalentBuildHash(state, talentRows, heroName)));
    showCopiedFeedback();
  });

  buildCodeButton?.addEventListener("click", async () => {
    await copyText(serializeTalentBuildCode(state, talentRows, heroName));
    showCopiedFeedback("Copied build code!");
  });

  applyState();
}

function initAbilityDetails() {
  const section = document.querySelector("[data-ability-section]");
  const toggle = document.querySelector("[data-ability-details-toggle]");
  if (!section || !toggle) return;

  const LS_KEY = "hotsixors.details";
  const storage = getAvailableStorage(window);

  function applyState(enabled) {
    section.classList.toggle("abilities-section--detailed", enabled);
    toggle.setAttribute("aria-pressed", String(enabled));
  }

  applyState(getStoredBoolean(storage, LS_KEY, true));

  toggle.addEventListener("click", () => {
    const next = toggle.getAttribute("aria-pressed") !== "true";
    setStoredBoolean(storage, LS_KEY, next);
    applyState(next);
  });
}

function initGameDataSidebarToggle() {
  const toggle = document.querySelector("[data-gamedata-sidebar-toggle]");
  const sidebar = document.getElementById("gamedata-sidebar");
  if (!toggle || !sidebar) return;

  const mq = window.matchMedia("(max-width: 900px)");

  function applyLayout(mobile) {
    if (mobile) {
      toggle.hidden = false;
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      sidebar.hidden = !expanded;
    } else {
      toggle.hidden = true;
      sidebar.hidden = false;
    }
  }

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    sidebar.hidden = expanded;
  });

  mq.addEventListener("change", (e) => applyLayout(e.matches));
  applyLayout(mq.matches);
}

function restripe(items) {
  let visibleCount = 0;
  for (const item of items) {
    if (item.hidden) continue;
    item.classList.toggle("is-even", visibleCount % 2 === 1);
    visibleCount++;
  }
}

function initHeroTableSort() {
  const tables = document.querySelectorAll(".hero-table");
  for (const table of tables) {
    const headers = [...table.querySelectorAll("thead th[data-sort]")];
    if (headers.length === 0) continue;
    const tbody = table.tBodies[0];
    if (!tbody) continue;

    function sortBy(header) {
      const index = headers.indexOf(header);
      const type = header.dataset.sort;
      const current = header.getAttribute("aria-sort");
      const dir = current === "ascending" ? "descending" : "ascending";
      for (const h of headers) h.removeAttribute("aria-sort");
      header.setAttribute("aria-sort", dir);

      const rows = [...tbody.rows];
      const cmp = (a, b) => {
        const av = a.cells[index]?.dataset.sortValue ?? a.cells[index]?.textContent ?? "";
        const bv = b.cells[index]?.dataset.sortValue ?? b.cells[index]?.textContent ?? "";
        if (type === "num") {
          const an = av === "" ? Number.POSITIVE_INFINITY : parseFloat(av);
          const bn = bv === "" ? Number.POSITIVE_INFINITY : parseFloat(bv);
          if (an === bn) return 0;
          return an < bn ? -1 : 1;
        }
        return av.localeCompare(bv, undefined, { sensitivity: "base", numeric: true });
      };
      rows.sort(cmp);
      if (dir === "descending") rows.reverse();
      for (const row of rows) tbody.appendChild(row);
      restripe(rows);
    }

    for (const header of headers) {
      header.addEventListener("click", () => sortBy(header));
      header.tabIndex = 0;
      header.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          sortBy(header);
        }
      });
    }
  }
}

function initHeroViewToggle() {
  const root = document.querySelector("[data-hero-list]");
  if (!root) return;
  const toggle = root.querySelector("[data-hero-view-toggle]");
  if (!toggle) return;
  const buttons = [...toggle.querySelectorAll("[data-hero-view]")];
  const panes = [...root.querySelectorAll("[data-hero-view-pane]")];
  const STORAGE_KEY = "hotsixors.heroListView";
  const VIEWS = ["grid", "table"];
  const storage = getAvailableStorage(window);

  function setView(view) {
    for (const btn of buttons) {
      const active = btn.dataset.heroView === view;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    }
    for (const pane of panes) {
      const active = pane.dataset.heroViewPane === view;
      pane.hidden = !active;
    }
    setStoredString(storage, STORAGE_KEY, view);
  }

  setView(getStoredString(storage, STORAGE_KEY, "grid", VIEWS));

  for (const btn of buttons) {
    btn.addEventListener("click", () => setView(btn.dataset.heroView));
  }
}

function initHeroRoleFilter() {
  const root = document.querySelector("[data-hero-list]");
  if (!root) return;
  const filter = root.querySelector("[data-hero-role-filter]");
  if (!filter) return;
  const buttons = [...filter.querySelectorAll("[data-role]")];
  const cards = [...root.querySelectorAll("[data-hero-role]")];

  function setRole(role) {
    for (const btn of buttons) {
      btn.classList.toggle("is-active", btn.dataset.role === role);
    }
    for (const card of cards) {
      card.hidden = role !== "all" && card.dataset.heroRole !== role;
    }
    restripe(cards);
  }

  for (const btn of buttons) {
    btn.addEventListener("click", () => setRole(btn.dataset.role));
  }

  setRole("all");
}

function initBreadcrumbCollapse() {
  const breadcrumb = document.querySelector(".breadcrumb");
  if (!breadcrumb) return;

  const children = [...breadcrumb.children];
  const items = children.filter(
    el => el.tagName === "A" || el.classList.contains("breadcrumb-current")
  );
  const seps = children.filter(el => el.classList.contains("breadcrumb-sep"));

  if (items.length <= 2) return;

  const ellipsis = document.createElement("span");
  ellipsis.className = "breadcrumb-ellipsis";
  ellipsis.setAttribute("aria-hidden", "true");
  ellipsis.textContent = "…";
  seps[0].after(ellipsis);

  function applyCollapse(collapsed) {
    for (let i = 1; i < items.length - 1; i++) items[i].hidden = collapsed;
    for (let i = 1; i < seps.length - 1; i++) seps[i].hidden = collapsed;
    ellipsis.hidden = !collapsed;
  }

  const mq = window.matchMedia("(max-width: 900px)");
  applyCollapse(mq.matches);
  mq.addEventListener("change", e => applyCollapse(e.matches));
}

function initEffectIndex() {
  const search = document.querySelector("[data-effect-search]");
  if (!search) return;
  const chips = [...document.querySelectorAll("[data-effect-chip]")];
  const enableAll = document.querySelector("[data-effect-enable-all]");
  const disableAll = document.querySelector("[data-effect-disable-all]");
  const sections = [...document.querySelectorAll("[data-effect-mechanic]")];
  const categories = [...document.querySelectorAll("[data-effect-category]")].filter(
    (category) => !category.hasAttribute("data-effect-mechanic")
  );
  const validSlugs = sections.map((section) => section.dataset.effectMechanic).filter(Boolean);
  const active = new Set(validSlugs);

  function setChipStates() {
    for (const chip of chips) {
      chip.setAttribute("aria-pressed", String(active.has(chip.dataset.effectChip)));
    }
  }

  function selectedEffectSlugs() {
    return validSlugs.filter((slug) => active.has(slug));
  }

  function syncUrl() {
    if (!window.history?.replaceState) return;
    const nextSearch = effectIndexSearchFromState(
      { effects: selectedEffectSlugs(), query: search.value },
      validSlugs
    );
    window.history.replaceState(null, "", `${window.location.pathname}${nextSearch}`);
  }

  function apply() {
    const query = search.value.trim().toLowerCase();
    const visibleCategories = new Set();

    for (const section of sections) {
      const slug = section.dataset.effectMechanic;
      if (!active.has(slug)) { section.hidden = true; continue; }
      let surviving = 0;
      for (const entry of section.querySelectorAll("[data-effect-name]")) {
        const match = !query || (entry.dataset.effectName || "").toLowerCase().includes(query);
        entry.hidden = !match;
        if (match) surviving++;
      }
      section.hidden = query !== "" && surviving === 0;
      if (!section.hidden && section.dataset.effectCategory) visibleCategories.add(section.dataset.effectCategory);
    }

    for (const category of categories) {
      category.hidden = !visibleCategories.has(category.dataset.effectCategory);
    }
  }

  function applyStateFromUrl() {
    const state = effectIndexStateFromSearch(window.location.search, validSlugs);
    const hashSlug = effectSlugFromHash(window.location.hash, validSlugs);
    const slugs = hashSlug && !new URLSearchParams(window.location.search).has("effects")
      ? [hashSlug]
      : state.effects;

    active.clear();
    for (const activeSlug of slugs) active.add(activeSlug);
    search.value = state.query;
    setChipStates();
    apply();
    if (hashSlug) syncUrl();
  }

  function applyHashFilterIfValid() {
    const slug = effectSlugFromHash(window.location.hash, validSlugs);
    if (!slug) return;
    active.clear();
    active.add(slug);
    setChipStates();
    apply();
    syncUrl();
  }

  for (const chip of chips) {
    chip.addEventListener("click", () => {
      const slug = chip.dataset.effectChip;
      if (active.has(slug)) { active.delete(slug); chip.setAttribute("aria-pressed", "false"); }
      else { active.add(slug); chip.setAttribute("aria-pressed", "true"); }
      apply();
      syncUrl();
    });
  }
  enableAll?.addEventListener("click", () => {
    active.clear();
    for (const slug of validSlugs) active.add(slug);
    setChipStates();
    apply();
    syncUrl();
  });
  disableAll?.addEventListener("click", () => {
    active.clear();
    setChipStates();
    apply();
    syncUrl();
  });
  search.addEventListener("input", () => {
    apply();
    syncUrl();
  });
  window.addEventListener("hashchange", applyHashFilterIfValid);
  applyStateFromUrl();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initPrimaryNav();
    initNavDropdowns();
    initDataminingToggle();
    initGlobalSearch();
    initSelectGridSearch();
    initGameDataShell();
    initGameDataSearch();
    initGameDataHighlighting();
    initGameDataXref();
    initGameDataJumpHistory();
    initBattlegroundHighlighting();
    initTalentBuilds();
    initGameDataSidebarToggle();
    initAbilityDetails();
    initBreadcrumbCollapse();
    initHeroViewToggle();
    initHeroRoleFilter();
    initHeroTableSort();
    initEffectIndex();
  });
}
