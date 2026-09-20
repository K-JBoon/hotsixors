import { createSearchTerms, searchSiteIndex, selectGridSearchState, updateSelectGridSearchQuery } from './js/search.js';
import { applyDataminingState, DATAMINING_STORAGE_KEY, getAvailableStorage, getStoredBoolean, getStoredString, isDataminingEnabled, isDataminingSearchEntry, loadAliases, loadSiteIndex, setStoredBoolean, setStoredString } from './js/storage.js';
import { escapeHtml } from './js/escape.js';

function initGlobalSearch() {
  const root = document.querySelector("[data-site-search]");
  if (!root) return;

  const input = root.querySelector("[data-site-search-input]");
  const results = root.querySelector("[data-site-search-results]");
  const status = root.querySelector("[data-site-search-status]");
  if (!input || !results) return;

  let timer = 0;
  let options = [];
  let activeIndex = -1;

  function setActive(index) {
    activeIndex = index;
    options.forEach((option, i) => {
      const active = i === index;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", String(active));
    });
    const active = options[index];
    if (active) {
      input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function hideResults() {
    results.hidden = true;
    results.innerHTML = "";
    options = [];
    setActive(-1);
    input.setAttribute("aria-expanded", "false");
    if (status) status.textContent = "";
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
      results.innerHTML = '<div class="site-search__empty" role="presentation">No results</div>';
      options = [];
      setActive(-1);
      if (status) status.textContent = "No results";
      return;
    }

    results.innerHTML = matches.map((entry, i) => `
      <a class="site-search__result" role="option" aria-selected="false" id="site-search-option-${i}" href="${escapeHtml(entry.url)}">
        <span class="site-search__result-title">${escapeHtml(entry.title)}</span>
        <span class="site-search__result-meta">${escapeHtml(entry.type || "Page")}</span>
      </a>
    `).join("");
    options = [...results.querySelectorAll("[role=option]")];
    setActive(-1);
    if (status) status.textContent = `${matches.length} result${matches.length === 1 ? "" : "s"}`;
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => render(input.value), 100);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = "";
      hideResults();
      return;
    }
    if (!options.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      // Index -1 is the bare input, so the ring is one longer than the list.
      const step = event.key === "ArrowDown" ? 1 : -1;
      const ring = options.length + 1;
      setActive((((activeIndex + 1 + step) % ring) + ring) % ring - 1);
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      options[activeIndex].click();
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
    if (!mq.matches) return;
    if (event.target.closest(".nav-dropdown__trigger, .datamining-toggle")) return;
    if (event.target.closest(".nav-link, .nav-dropdown__item")) setExpanded(false);
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

async function initSelectGridSearch() {
  const roots = [...document.querySelectorAll("[data-select-search]")];
  if (roots.length === 0) return;

  const aliases = await loadAliases();

  for (const root of roots) {
    const status = root.querySelector("[data-select-search-status]");
    const input = root.querySelector("[data-select-search-input]");
    const count = root.querySelector("[data-select-search-count]");
    const noun = root.dataset.selectSearchNoun || "results";
    const cards = [...root.querySelectorAll("[data-select-search-card]")];
    if (cards.length === 0) continue;

    const entries = cards.map((card, index) => ({
      id: card.dataset.selectSearchId || String(index),
      // One hero renders as a grid card and a table row; both are one result.
      key: card.dataset.selectSearchKey || card.dataset.selectSearchId || String(index),
      title: card.dataset.selectSearchText || card.textContent || "",
      element: card,
    }));
    const total = new Set(entries.map((entry) => entry.key)).size;

    let query = "";
    let appliedOrder = null;

    function applySearch() {
      const hasQuery = createSearchTerms(query, aliases).length > 0;
      const state = selectGridSearchState(entries, query, aliases);
      const matched = new Set();

      root.classList.toggle("select-search--active", hasQuery);

      state.forEach((entryState, index) => {
        const card = cards[index];
        const matches = entryState.matches;
        if (matches) matched.add(entries[index].key);
        card.classList.toggle("select-search-card--match", hasQuery && matches);
        card.classList.toggle("select-search-card--dim", hasQuery && !matches);
      });

      if (count) {
        count.textContent = hasQuery ? `${matched.size} of ${total} ${noun}` : `${total} ${noun}`;
      }
      if (status) {
        status.textContent = hasQuery
          ? `Filtering by ${query}. ${matched.size} of ${total} matches.`
          : "";
      }
      // Ordering reuses the match pass above rather than running a second one.
      const order = hasQuery
        ? entries
            .map((entry, index) => ({ element: entry.element, matches: state[index].matches, index }))
            .sort((a, b) => Number(b.matches) - Number(a.matches) || a.index - b.index)
            .map((item) => item.element)
        : entries.map((entry) => entry.element);
      if (!appliedOrder || order.some((element, index) => appliedOrder[index] !== element)) {
        appliedOrder = order;
        for (const element of order) element.parentElement?.appendChild(element);
      }
    }

    function setQuery(next) {
      if (next === query) return;
      query = next;
      applySearch();
    }

    if (input) {
      input.addEventListener("input", () => setQuery(input.value));
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        input.value = "";
        setQuery("");
      });
    }

    // Typing anywhere on the page still filters; it just lands in the field now.
    document.addEventListener("keydown", (event) => {
      const target = event.target;
      if (target?.isContentEditable) return;
      if (target?.matches?.("input, textarea, select")) return;

      const nextQuery = updateSelectGridSearchQuery(query, event);
      if (nextQuery === query) return;

      event.preventDefault();
      if (input) {
        input.value = nextQuery;
        input.focus();
      }
      setQuery(nextQuery);
    });

    applySearch();
  }
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

  function setView(view, { focus = false } = {}) {
    for (const btn of buttons) {
      const active = btn.dataset.heroView === view;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.tabIndex = active ? 0 : -1;
      if (active && focus) btn.focus();
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

  toggle.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -buttons.length, End: buttons.length }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const current = buttons.findIndex((btn) => btn.getAttribute("aria-selected") === "true");
    const next = Math.min(buttons.length - 1, Math.max(0, current + step));
    setView(buttons[next].dataset.heroView, { focus: true });
  });
}

function initHeroRoleFilter() {
  const root = document.querySelector("[data-hero-list]");
  if (!root) return;
  const filter = root.querySelector("[data-hero-role-filter]");
  if (!filter) return;
  const buttons = [...filter.querySelectorAll("[data-role]")];
  const cards = [...root.querySelectorAll("[data-hero-role]")];
  const status = root.querySelector("[data-hero-role-status]");
  // A hero appears once per view pane; count the hero, not the card.
  const keyOf = (card) => card.dataset.selectSearchKey || card.dataset.selectSearchId || "";
  const total = new Set(cards.map(keyOf)).size;

  function setRole(role) {
    for (const btn of buttons) {
      const active = btn.dataset.role === role;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
    const shown = new Set();
    for (const card of cards) {
      const hidden = role !== "all" && card.dataset.heroRole !== role;
      card.hidden = hidden;
      if (!hidden) shown.add(keyOf(card));
    }
    restripe(cards);
    if (status) {
      const label = buttons.find((btn) => btn.dataset.role === role)?.textContent.trim() ?? role;
      status.textContent = role === "all"
        ? `Showing all ${total} heroes.`
        : `${label}: showing ${shown.size} of ${total} heroes.`;
    }
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

// Page-specific code is fetched only where its markup exists, so an ordinary
// page never pays for the game data explorer, talent builder or effect index.
async function initPageModules() {
  if (document.querySelector("[data-gd-shell], [data-gamedata-tree], .gamedata-code[data-lang]")) {
    const mod = await import("./js/gamedata-page.js");
    mod.initGameDataPage();
  }
  if (document.querySelector("pre.bg-code-block__pre code.language-galaxy")) {
    const mod = await import("./js/gamedata-page.js");
    mod.initBattlegroundHighlighting();
  }
  if (document.querySelector("[data-talent-hero]")) {
    const mod = await import("./js/hero-page.js");
    mod.initTalentBuilds();
  }
  if (document.querySelector("[data-effect-search]")) {
    const mod = await import("./js/effect-index-page.js");
    mod.initEffectIndex();
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initPrimaryNav();
    initNavDropdowns();
    initDataminingToggle();
    initGlobalSearch();
    initSelectGridSearch();
    initBreadcrumbCollapse();
    initHeroViewToggle();
    initHeroRoleFilter();
    initHeroTableSort();
    initPageModules();
  });
}
