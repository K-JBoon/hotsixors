
export function effectSlugFromHash(hash, validSlugs = []) {
  let slug = "";
  try {
    slug = decodeURIComponent(String(hash || "").replace(/^#/, "")).trim();
  } catch {
    return "";
  }
  if (!slug) return "";
  return validSlugs.includes(slug) ? slug : "";
}

export function effectIndexStateFromSearch(search, validSlugs = []) {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const hasEffects = params.has("effects") || params.has("effect");
  const rawEffects = params.get("effects") ?? params.get("effect") ?? "";
  const selected = new Set(
    rawEffects
      .split(",")
      .map((slug) => slug.trim())
      .filter(Boolean)
  );
  const effects = hasEffects
    ? validSlugs.filter((slug) => selected.has(slug))
    : [...validSlugs];

  return {
    effects,
    query: params.get("q") || "",
  };
}

export function effectIndexSearchFromState(state, validSlugs = []) {
  const params = new URLSearchParams();
  const selected = new Set(state?.effects || []);
  const effects = validSlugs.filter((slug) => selected.has(slug));
  const query = String(state?.query || "").trim();

  if (effects.length < validSlugs.length) {
    params.set("effects", effects.join(","));
  }
  if (query) params.set("q", query);

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export const NUMERIC_SORT_KEYS = ["amount", "duration"];

// Rows are { hero, name, kind, amount, duration } with numbers as strings; blanks sort last either way.
export function compareEffectRows(a, b, key, direction = "ascending") {
  const sign = direction === "descending" ? -1 : 1;
  const tieBreak = () => a.hero.localeCompare(b.hero) || a.name.localeCompare(b.name);
  if (NUMERIC_SORT_KEYS.includes(key)) {
    const x = a[key] === "" ? null : Number(a[key]);
    const y = b[key] === "" ? null : Number(b[key]);
    if (x === null || y === null) return x === y ? tieBreak() : x === null ? 1 : -1;
    return sign * (x - y) || tieBreak();
  }
  return sign * String(a[key]).localeCompare(String(b[key])) || tieBreak();
}
