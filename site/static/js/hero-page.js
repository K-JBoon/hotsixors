import { parseTalentBuildHash, serializeTalentBuildCode, serializeTalentBuildHash, talentTierHasChoice, toggleOptionalTalent, toggleRecommendedTalent } from "./talent-builds.js";

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

export { initTalentBuilds };
