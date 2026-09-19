import { escapeHtml } from "./escape.js";
import { createXmlHighlighter, highlightGalaxyCode, highlightGameDataLine } from "./highlight.js";
import { filterTreeNode, renderGameDataTree, restoreTree } from "./gamedata-tree.js";
import { computeFolds, createFolder } from "./folding.js";
import { chainOf, childrenOf, createXrefLinker, defsByLine, gamedataFileLabel, gamedataHref, incomingGroups, outlineDefs, targetsOf } from "./xref.js";
import { getAvailableStorage, getStoredBoolean, loadGameDataTree, setStoredBoolean } from "./storage.js";

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

export function initGameDataPage() {
  initGameDataShell();
  initGameDataSearch();
  initGameDataHighlighting();
  initGameDataXref();
  initGameDataJumpHistory();
  initGameDataSidebarToggle();
}

export { initBattlegroundHighlighting };
