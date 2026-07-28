import assert from "node:assert/strict";
import test from "node:test";

import {
  createSearchTerms,
  highlightGameDataLine,
  isDataminingSearchEntry,
  matchesSearchEntry,
  orderSelectGridSearchEntries,
  selectGridSearchState,
  updateSelectGridSearchQuery,
  effectIndexSearchFromState,
  effectIndexStateFromSearch,
  effectSlugFromHash,
  parseTalentBuildHash,
  renderGameDataTree,
  searchSiteIndex,
  serializeTalentBuildHash,
  serializeTalentBuildCode,
  getAvailableStorage,
  getStoredBoolean,
  setStoredBoolean,
  talentStateFromHotSBuildCode,
  talentTierHasChoice,
  toggleOptionalTalent,
  toggleRecommendedTalent,
} from "../site/static/hotsixors.js";

const DECKARD_TALENT_ROWS = [
  { tier: "level1", talentIds: ["DeckardScrollOfIdentify", "DeckardFieldStudy", "DeckardSapphire"] },
  { tier: "level4", talentIds: ["DeckardPotionOfShielding", "DeckardRuby", "DeckardRejuvenationPotion"] },
  { tier: "level7", talentIds: ["DeckardCubeMastery", "DeckardEmerald", "DeckardKanaiCube"] },
  { tier: "level10", talentIds: ["DeckardStayAWhileAndListen", "DeckardLorenado"] },
  { tier: "level13", talentIds: ["DeckardSuperHealingPotion", "DeckardPotionOfRevival", "DeckardAncientBlessings"] },
  { tier: "level16", talentIds: ["DeckardSafetyInNumbers", "DeckardHoradricStaff", "DeckardScrollOfStoneCurse"] },
  { tier: "level20", talentIds: ["DeckardRespectTheElderly", "DeckardMorenados", "DeckardPerfectGems"] },
];

test("expands game data searches through hero aliases", () => {
  const aliases = { brightwing: "faeriedragon" };
  const terms = createSearchTerms("Brightwing", aliases);

  assert.deepEqual(terms, ["brightwing", "faeriedragon"]);
  assert.equal(
    matchesSearchEntry(
      { title: "faeriedragondata.xml", path: "mods/heromods/faeriedragon.stormmod/base.stormdata/gamedata/faeriedragondata-xml" },
      "Brightwing",
      aliases
    ),
    true
  );
});

test("renderGameDataTree marks current nodes and escapes labels", () => {
  const html = renderGameDataTree({
    name: "mods",
    path: "mods",
    type: "dir",
    children: [
      {
        name: "dva.stormmod",
        path: "mods/heromods/dva.stormmod",
        type: "dir",
        children: [
          {
            name: "dvadata.xml",
            path: "mods/heromods/dva.stormmod/base.stormdata/gamedata/dvadata-xml",
            type: "file",
            lang: "xml",
          },
        ],
      },
      {
        name: "<bad>.galaxy",
        path: "mods/heromods/bad.stormmod/base.stormdata/libbad-galaxy",
        type: "file",
        lang: "galaxy",
      },
    ],
  }, "content/gamedata/mods/heromods/dva.stormmod/base.stormdata/gamedata/dvadata-xml.md");

  assert.match(html, /<details class="tree-dir"/);
  assert.match(html, /open/);
  assert.match(html, /tree-file tree-active/);
  assert.match(html, /&lt;bad&gt;.galaxy/);
  assert.doesNotMatch(html, /<bad>/);
});

test("highlightGameDataLine adds basic XML token spans", () => {
  const html = highlightGameDataLine('<CAbilEffectTarget id="ChromieSandBlast" parent="Base" />', "xml");

  assert.match(html, /<span class="syntax-tag">&lt;CAbilEffectTarget/);
  assert.match(html, /<span class="syntax-attr">id<\/span>=/);
  assert.match(html, /<span class="syntax-string">&quot;ChromieSandBlast&quot;<\/span>/);
  assert.match(html, /<span class="syntax-punctuation">\/&gt;<\/span>/);
});

test("highlightGameDataLine adds basic Galaxy token spans", () => {
  const html = highlightGameDataLine('if (count >= 10) { return "ready"; } // done', "galaxy");

  assert.match(html, /<span class="syntax-keyword">if<\/span>/);
  assert.match(html, /<span class="syntax-number">10<\/span>/);
  assert.match(html, /<span class="syntax-keyword">return<\/span>/);
  assert.match(html, /<span class="syntax-string">&quot;ready&quot;<\/span>/);
  assert.match(html, /<span class="syntax-comment">\/\/ done<\/span>/);
});

test("searchSiteIndex ranks title matches before body matches", () => {
  const results = searchSiteIndex(
    [
      { title: "Alarak", url: "/heroes/alarak/", type: "Hero", text: "Highlord" },
      { title: "Example Guide", url: "/guides/example/", type: "Guide", text: "Alarak build" },
      { title: "Jaina", url: "/heroes/jaina/", type: "Hero", text: "Frost mage" },
    ],
    "alarak"
  );

  assert.deepEqual(results.map((entry) => entry.url), ["/heroes/alarak/", "/guides/example/"]);
});

test("datamining search entry detection catches game data URLs and types", () => {
  assert.equal(isDataminingSearchEntry({ title: "Game Data", url: "/gamedata/" }), true);
  assert.equal(isDataminingSearchEntry({ title: "Abathur XML", path: "/gamedata/mods/heromods/abathur/" }), true);
  assert.equal(isDataminingSearchEntry({ title: "unitdata.xml", url: "/other/", type: "Game Data File" }), true);
  assert.equal(isDataminingSearchEntry({ title: "Abathur", url: "/heroes/abathur/", type: "Hero" }), false);
});

test("select grid search state marks matches without hiding non-matches", () => {
  const state = selectGridSearchState(
    [
      { id: "jaina", title: "Jaina", text: "Ranged Assassin" },
      { id: "brightwing", title: "Brightwing", text: "Healer" },
      { id: "towers", title: "Towers of Doom", text: "Battleground" },
    ],
    "faerie",
    { faerie: "brightwing" }
  );

  assert.deepEqual(state, [
    { id: "jaina", matches: false },
    { id: "brightwing", matches: true },
    { id: "towers", matches: false },
  ]);

  assert.deepEqual(selectGridSearchState(state, ""), [
    { id: "jaina", matches: true },
    { id: "brightwing", matches: true },
    { id: "towers", matches: true },
  ]);
});

test("select grid search ordering moves matches first while preserving group order", () => {
  const entries = [
    { id: "abathur", title: "Abathur", text: "Specialist" },
    { id: "jaina", title: "Jaina", text: "Caster" },
    { id: "brightwing", title: "Brightwing", text: "Support" },
    { id: "arthas", title: "Arthas", text: "Tank" },
  ];

  assert.deepEqual(orderSelectGridSearchEntries(entries, "a").map((entry) => entry.id), [
    "abathur",
    "jaina",
    "arthas",
    "brightwing",
  ]);

  assert.deepEqual(orderSelectGridSearchEntries(entries, "").map((entry) => entry.id), [
    "abathur",
    "jaina",
    "brightwing",
    "arthas",
  ]);
});

test("select grid typeahead appends printable keys and escape clears the filter", () => {
  let query = "";
  query = updateSelectGridSearchQuery(query, { key: "j" });
  query = updateSelectGridSearchQuery(query, { key: "a" });
  query = updateSelectGridSearchQuery(query, { key: "i" });

  assert.equal(query, "jai");
  assert.equal(updateSelectGridSearchQuery(query, { key: "Backspace" }), "ja");
  assert.equal(updateSelectGridSearchQuery(query, { key: "Escape" }), "");
  assert.equal(updateSelectGridSearchQuery(query, { key: "ArrowDown" }), query);
  assert.equal(updateSelectGridSearchQuery(query, { key: "k", ctrlKey: true }), query);
});

test("effect index hash filters only known effect slugs", () => {
  const validSlugs = ["stunned", "slowed"];

  assert.equal(effectSlugFromHash("#stunned", validSlugs), "stunned");
  assert.equal(effectSlugFromHash("#unknown", validSlugs), "");
  assert.equal(effectSlugFromHash("", validSlugs), "");
});

test("effect index query string parses effect and text filters", () => {
  const validSlugs = ["stunned", "slowed", "armor"];

  assert.deepEqual(effectIndexStateFromSearch("?effects=armor,unknown,stunned&q=Jaina", validSlugs), {
    effects: ["stunned", "armor"],
    query: "Jaina",
  });
  assert.deepEqual(effectIndexStateFromSearch("", validSlugs), {
    effects: validSlugs,
    query: "",
  });
  assert.deepEqual(effectIndexStateFromSearch("?effects=", validSlugs), {
    effects: [],
    query: "",
  });
});

test("effect index query string omits default filters", () => {
  const validSlugs = ["stunned", "slowed", "armor"];

  assert.equal(
    effectIndexSearchFromState({ effects: ["armor", "stunned"], query: " Jaina " }, validSlugs),
    "?effects=stunned%2Carmor&q=Jaina"
  );
  assert.equal(effectIndexSearchFromState({ effects: validSlugs, query: "" }, validSlugs), "");
  assert.equal(effectIndexSearchFromState({ effects: [], query: "" }, validSlugs), "?effects=");
});

test("talent build hash parses and serializes HotS talent codes with optional choices", () => {
  const state = parseTalentBuildHash("#[T3121121,Deckard]&o=1.2", DECKARD_TALENT_ROWS, "Deckard");

  assert.deepEqual(state.recommended, {
    level1: "DeckardSapphire",
    level4: "DeckardPotionOfShielding",
    level7: "DeckardEmerald",
    level10: "DeckardStayAWhileAndListen",
    level13: "DeckardSuperHealingPotion",
    level16: "DeckardHoradricStaff",
    level20: "DeckardRespectTheElderly",
  });
  assert.deepEqual([...state.optional], ["DeckardFieldStudy"]);

  assert.equal(
    serializeTalentBuildHash(state, DECKARD_TALENT_ROWS, "Deckard"),
    "#[T3121121,Deckard]&o=1.2"
  );
});

test("talent build code emits the bare HotS code with zero placeholders", () => {
  const empty = { recommended: {}, optional: new Set() };
  assert.equal(serializeTalentBuildCode(empty, DECKARD_TALENT_ROWS, "Deckard"), "[T0000000,Deckard]");

  const state = parseTalentBuildHash("#[T3121121,Deckard]&o=1.2", DECKARD_TALENT_ROWS, "Deckard");
  assert.equal(serializeTalentBuildCode(state, DECKARD_TALENT_ROWS, "Deckard"), "[T3121121,Deckard]");

  assert.equal(serializeTalentBuildCode(empty, [], "Deckard"), "");
});

test("left-click toggles one recommended talent per tier", () => {
  let state = parseTalentBuildHash("");
  state = toggleRecommendedTalent(state, "level1", "AlarakRuthlessMomentum");
  state = toggleRecommendedTalent(state, "level1", "AlarakExtendedLightning");

  assert.deepEqual(state.recommended, { level1: "AlarakExtendedLightning" });

  state = toggleRecommendedTalent(state, "level1", "AlarakExtendedLightning");
  assert.deepEqual(state.recommended, {});
});

test("right-click toggles optional talents independently and removes recommended overlap", () => {
  let state = parseTalentBuildHash("#[T1000000,Alarak]", [
    { tier: "level1", talentIds: ["AlarakRuthlessMomentum", "AlarakExtendedLightning"] },
  ], "Alarak");
  state = toggleOptionalTalent(state, "AlarakRuthlessMomentum");

  assert.deepEqual(state.recommended, {});
  assert.deepEqual([...state.optional], ["AlarakRuthlessMomentum"]);

  state = toggleOptionalTalent(state, "AlarakExtendedLightning");
  assert.deepEqual([...state.optional].sort(), ["AlarakExtendedLightning", "AlarakRuthlessMomentum"]);

  state = toggleOptionalTalent(state, "AlarakRuthlessMomentum");
  assert.deepEqual([...state.optional], ["AlarakExtendedLightning"]);
});

test("talent tier choice detection only counts visible row talents", () => {
  const state = {
    recommended: { level1: "AlarakRuthlessMomentum" },
    optional: new Set(["AlarakChaosReigns", "OtherHeroTalent"]),
  };

  assert.equal(talentTierHasChoice(state, "level1", ["AlarakRuthlessMomentum", "AlarakExtendedLightning"]), true);
  assert.equal(talentTierHasChoice(state, "level4", ["AlarakChaosReigns", "AlarakShowOfForce"]), true);
  assert.equal(talentTierHasChoice(state, "level7", ["AlarakHinderedMotion", "AlarakDissonance"]), false);
});

test("HotS talent build codes resolve talent positions by visible tier rows", () => {
  assert.deepEqual(talentStateFromHotSBuildCode("#[T3121121,Deckard]", DECKARD_TALENT_ROWS, "Deckard"), {
    recommended: {
      level1: "DeckardSapphire",
      level4: "DeckardPotionOfShielding",
      level7: "DeckardEmerald",
      level10: "DeckardStayAWhileAndListen",
      level13: "DeckardSuperHealingPotion",
      level16: "DeckardHoradricStaff",
      level20: "DeckardRespectTheElderly",
    },
    optional: new Set(),
  });
});

test("HotS talent build codes ignore other heroes and invalid positions", () => {
  const rows = DECKARD_TALENT_ROWS.slice(0, 2);

  assert.equal(talentStateFromHotSBuildCode("#[T31,Deckard]", rows, "Alarak"), null);
  assert.deepEqual(talentStateFromHotSBuildCode("#%5BT91%2CDeckard%5D", rows, "Deckard"), {
    recommended: { level4: "DeckardPotionOfShielding" },
    optional: new Set(),
  });
});

test("talent build serialization uses zero placeholders for unselected tiers", () => {
  const state = {
    recommended: { level4: "DeckardRuby" },
    optional: new Set(["DeckardPerfectGems"]),
  };

  assert.equal(
    serializeTalentBuildHash(state, DECKARD_TALENT_ROWS, "Deckard"),
    "#[T0200000,Deckard]&o=7.3"
  );
});

test("stored booleans fall back when browser storage is denied", () => {
  const deniedOwner = {
    get localStorage() {
      throw new Error("storage denied");
    },
  };
  const deniedStorage = {
    getItem() {
      throw new Error("storage denied");
    },
    setItem() {
      throw new Error("storage denied");
    },
  };

  assert.equal(getAvailableStorage(deniedOwner), null);
  assert.equal(getStoredBoolean(deniedStorage, "hotsixors.details", true), true);
  assert.equal(setStoredBoolean(deniedStorage, "hotsixors.details", false), false);
});
