import { effectIndexSearchFromState, effectIndexStateFromSearch, effectSlugFromHash } from "./effect-index.js";

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

export { initEffectIndex };
