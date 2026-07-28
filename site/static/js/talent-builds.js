

export function cloneTalentState(state) {
  return {
    recommended: { ...(state?.recommended || {}) },
    optional: new Set(state?.optional || []),
  };
}


function normalizeTalentHeroName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function formatTalentHeroName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "");
}

function parseHotSBuildHash(hash) {
  const rawHash = String(hash || "").replace(/^#/, "").trim();
  let decodedHash = rawHash;
  try {
    decodedHash = decodeURIComponent(rawHash);
  } catch {
    decodedHash = rawHash;
  }

  const match = decodedHash.match(/^\[T([0-9]+),([^\]]+)\](?:&(.*))?$/i);
  if (!match) return null;

  return {
    picks: match[1],
    heroName: match[2],
    params: new URLSearchParams(match[3] || ""),
  };
}

export function talentStateFromHotSBuildCode(hash, talentRows = [], heroName = "") {
  const parsed = parseHotSBuildHash(hash);
  if (!parsed) return null;
  if (heroName && normalizeTalentHeroName(parsed.heroName) !== normalizeTalentHeroName(heroName)) return null;

  const recommended = {};
  const optional = new Set();

  [...parsed.picks].forEach((pick, index) => {
    const row = talentRows[index];
    const talentIndex = Number(pick) - 1;
    const talentId = row?.talentIds?.[talentIndex];
    if (row?.tier && talentId) recommended[row.tier] = talentId;
  });

  const optionalRaw = parsed.params.get("o");
  if (optionalRaw) {
    for (const pair of optionalRaw.split(",")) {
      const [rowIndexRaw, talentIndexRaw] = pair.split(".");
      const row = talentRows[Number(rowIndexRaw) - 1];
      const talentId = row?.talentIds?.[Number(talentIndexRaw) - 1];
      if (talentId) optional.add(talentId);
    }
  }

  for (const talentId of Object.values(recommended)) {
    optional.delete(talentId);
  }

  return { recommended, optional };
}

export function parseTalentBuildHash(hash, talentRows = [], heroName = "") {
  return talentStateFromHotSBuildCode(hash, talentRows, heroName) || {
    recommended: {},
    optional: new Set(),
  };
}

function serializeHotSBuildHash(state, talentRows = [], heroName = "") {
  if (!heroName || talentRows.length === 0) return "";

  const digits = [];
  let hasChoice = false;

  talentRows.forEach(({ tier, talentIds }, index) => {
    const talentId = state?.recommended?.[tier];
    if (!talentId) {
      digits[index] = "0";
      return;
    }

    const talentIndex = talentIds.indexOf(talentId);
    if (talentIndex === -1) {
      digits[index] = "0";
      return;
    }

    digits[index] = String(talentIndex + 1);
    hasChoice = true;
  });

  const optionalPositions = [];
  for (const talentId of state?.optional || []) {
    const rowIndex = talentRows.findIndex(({ talentIds }) => talentIds.includes(talentId));
    if (rowIndex === -1) continue;

    const talentIndex = talentRows[rowIndex].talentIds.indexOf(talentId);
    optionalPositions.push(`${rowIndex + 1}.${talentIndex + 1}`);
    hasChoice = true;
  }

  if (!hasChoice) return "";

  optionalPositions.sort((a, b) => {
    const [aRow, aTalent] = a.split(".").map(Number);
    const [bRow, bTalent] = b.split(".").map(Number);
    return aRow - bRow || aTalent - bTalent;
  });

  const optionalHash = optionalPositions.length > 0 ? `&o=${optionalPositions.join(",")}` : "";
  return `#[T${digits.join("")},${formatTalentHeroName(heroName)}]${optionalHash}`;
}

export function serializeTalentBuildHash(state, talentRows, heroName) {
  return serializeHotSBuildHash(state, talentRows, heroName);
}

function serializeHotSBuildCode(state, talentRows = [], heroName = "") {
  const name = formatTalentHeroName(heroName);
  if (!name || talentRows.length === 0) return "";

  const digits = talentRows.map(({ tier, talentIds }) => {
    const talentId = state?.recommended?.[tier];
    const talentIndex = talentId ? talentIds.indexOf(talentId) : -1;
    return talentIndex === -1 ? "0" : String(talentIndex + 1);
  });

  return `[T${digits.join("")},${name}]`;
}

export function serializeTalentBuildCode(state, talentRows, heroName) {
  return serializeHotSBuildCode(state, talentRows, heroName);
}

export function toggleRecommendedTalent(state, tier, talentId) {
  const next = cloneTalentState(state);
  if (next.recommended[tier] === talentId) {
    delete next.recommended[tier];
  } else {
    next.recommended[tier] = talentId;
    next.optional.delete(talentId);
  }
  return next;
}

export function toggleOptionalTalent(state, talentId) {
  const next = cloneTalentState(state);
  if (next.optional.has(talentId)) {
    next.optional.delete(talentId);
  } else {
    next.optional.add(talentId);
    for (const [tier, recommendedTalentId] of Object.entries(next.recommended)) {
      if (recommendedTalentId === talentId) delete next.recommended[tier];
    }
  }
  return next;
}

export function talentTierHasChoice(state, tier, talentIds = []) {
  const visibleTalentIds = new Set(talentIds.filter(Boolean));
  const recommendedTalentId = state?.recommended?.[tier];

  if (recommendedTalentId && visibleTalentIds.has(recommendedTalentId)) return true;

  for (const talentId of state?.optional || []) {
    if (visibleTalentIds.has(talentId)) return true;
  }

  return false;
}
