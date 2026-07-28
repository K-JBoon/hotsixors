
import { createSearchTerms, searchSiteIndex, selectGridSearchState, orderSelectGridSearchEntries, updateSelectGridSearchQuery } from './js/search.js';
import { effectIndexSearchFromState, effectIndexStateFromSearch, effectSlugFromHash } from './js/effect-index.js';
import { parseTalentBuildHash, serializeTalentBuildCode, serializeTalentBuildHash, talentTierHasChoice, toggleOptionalTalent, toggleRecommendedTalent } from './js/talent-builds.js';
import { applyDataminingState, DATAMINING_STORAGE_KEY, getAvailableStorage, getStoredBoolean, getStoredString, isDataminingEnabled, isDataminingSearchEntry, loadAliases, loadGameDataTree, loadSiteIndex, setStoredBoolean, setStoredString } from './js/storage.js';
import { escapeHtml, highlightGalaxyCode, highlightGameDataLine } from './js/highlight.js';
import { filterTreeNode, renderGameDataTree, restoreTree } from './js/gamedata-tree.js';
export { createSearchTerms, matchesSearchEntry, searchSiteIndex, selectGridSearchState, orderSelectGridSearchEntries, updateSelectGridSearchQuery } from './js/search.js';
export { effectIndexSearchFromState, effectIndexStateFromSearch, effectSlugFromHash } from './js/effect-index.js';
export { parseTalentBuildHash, serializeTalentBuildCode, serializeTalentBuildHash, talentStateFromHotSBuildCode, talentTierHasChoice, toggleOptionalTalent, toggleRecommendedTalent } from './js/talent-builds.js';
export { getAvailableStorage, getStoredBoolean, isDataminingSearchEntry, setStoredBoolean } from './js/storage.js';
export { highlightGameDataLine } from './js/highlight.js';
export { renderGameDataTree } from './js/gamedata-tree.js';

function initGameDataHighlighting() {
  for (const pre of document.querySelectorAll(".gamedata-code[data-lang]")) {
    const lang = pre.dataset.lang;
    if (lang !== "xml" && lang !== "galaxy") continue;
    if (pre.dataset.highlighted === "true") continue;

    for (const line of pre.querySelectorAll(".line")) {
      line.innerHTML = highlightGameDataLine(line.textContent, lang);
    }

    pre.dataset.highlighted = "true";
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
    if (mq.matches && event.target.closest(".nav-link")) setExpanded(false);
  });

  mq.addEventListener("change", applyLayout);
  applyLayout();
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

  applyState(getStoredBoolean(storage, LS_KEY, false));

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

  const mq = window.matchMedia("(max-width: 700px)");

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
    initDataminingToggle();
    initGlobalSearch();
    initSelectGridSearch();
    initGameDataSearch();
    initGameDataHighlighting();
    initBattlegroundHighlighting();
    initTalentBuilds();
    initGameDataSidebarToggle();
    initAbilityDetails();
    initBreadcrumbCollapse();
    initHeroViewToggle();
    initHeroTableSort();
    initEffectIndex();
  });
}
