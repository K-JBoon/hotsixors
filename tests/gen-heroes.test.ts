import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const EMPTY_GAMESTRINGS = `{
  ability: { name: {}, shortText: {}, fullText: {} },
  talent: { name: {}, shortText: {}, fullText: {} },
  hero: { name: {}, infoText: {} },
  unit: { name: {} },
  skin: { infoText: {} },
}`;

// heroDisplayName takes the herodata item key (which the localized hero names
// are keyed by) plus the hyperlinkId (which the manual overrides are keyed by).
function resolveHeroDisplayNames(ids) {
  const script = `
    import { heroDisplayName } from "./scripts/gen-heroes.ts";
    const gs = {
      ...${EMPTY_GAMESTRINGS},
      hero: {
        name: {
          Anubarak: "Anub'arak",
          Guldan: "Gul'dan",
          KelThuzad: "Kel'Thuzad",
          MalGanis: "Mal'Ganis",
          Zuljin: "Zul'jin",
        },
        infoText: {},
      },
    };
    console.log(JSON.stringify(${JSON.stringify(ids)}.map((id) => [id, heroDisplayName(gs, id, id)])));
  `;
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  );
  return Object.fromEntries(JSON.parse(output));
}

test("hero display names prefer localized hero names with apostrophes", () => {
  assert.deepEqual(resolveHeroDisplayNames(["Anubarak", "Guldan", "KelThuzad", "MalGanis", "Zuljin"]), {
    Anubarak: "Anub'arak",
    Guldan: "Gul'dan",
    KelThuzad: "Kel'Thuzad",
    MalGanis: "Mal'Ganis",
    Zuljin: "Zul'jin",
  });
});

test("hero display names keep manual overrides and generated fallback", () => {
  assert.deepEqual(resolveHeroDisplayNames(["Chogall", "LtMorales", "LiMing", "LostVikings"]), {
    Chogall: "Cho'gall",
    LtMorales: "Lt. Morales",
    LiMing: "Li Ming",
    LostVikings: "Lost Vikings",
  });
});

function resolveHeroPageInfo(entries) {
  const script = `
    import { heroPageDisplayName, heroPageSlug } from "./scripts/gen-heroes.ts";
    const gs = ${EMPTY_GAMESTRINGS};
    const entries = ${JSON.stringify(entries)};
    console.log(JSON.stringify(entries.map(([heroName, hero]) => [
      heroName,
      {
        slug: heroPageSlug(heroName, hero),
        displayName: heroPageDisplayName(gs, heroName, hero.hyperlinkId),
      },
    ])));
  `;
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  );
  return Object.fromEntries(JSON.parse(output));
}

test("Cho and Gall generate separate page identities", () => {
  assert.deepEqual(resolveHeroPageInfo([
    ["Cho", { hyperlinkId: "Chogall" }],
    ["Gall", { hyperlinkId: "Gall" }],
  ]), {
    Cho: { slug: "cho", displayName: "Cho" },
    Gall: { slug: "gall", displayName: "Gall" },
  });
});

function resolveSubAbilityParent(parentKey) {
  const script = `
    import { parseSubAbilityParentKey } from "./scripts/gen-heroes.ts";
    import { getAbilityName } from "./scripts/lib/gamestrings.ts";
    const gs = {
      ...${EMPTY_GAMESTRINGS},
      ability: {
        name: { ":PASSIVE:|KelThuzadMasterOfTheColdDark|Trait": "Master of the Cold Dark" },
        shortText: {},
        fullText: {},
      },
      talent: {
        name: { "GenericTalentCalldownMULE|GenericCalldownMule|Active|Level7": "Calldown: MULE" },
        shortText: {},
        fullText: {},
      },
    };
    const parentKey = ${JSON.stringify(parentKey)};
    const parent = parseSubAbilityParentKey(parentKey);
    console.log(JSON.stringify({
      nameId: parent.parentNameId,
      label: getAbilityName(gs, parentKey, parent.parentNameId),
    }));
  `;
  return JSON.parse(execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  ));
}

test("passive sub-ability parents fall back to the button id and resolve its localized name", () => {
  assert.deepEqual(
    resolveSubAbilityParent(":PASSIVE:|KelThuzadMasterOfTheColdDark|Trait"),
    { nameId: "KelThuzadMasterOfTheColdDark", label: "Master of the Cold Dark" }
  );
});

test("talent-granted sub-ability parents resolve against the talent gamestrings", () => {
  assert.deepEqual(
    resolveSubAbilityParent("GenericTalentCalldownMULE|GenericCalldownMule|Active|Level7"),
    { nameId: "GenericTalentCalldownMULE", label: "Calldown: MULE" }
  );
});

// `catalog` is a JS expression for a CatalogLookup; undefined uses the empty default.
function resolveHeroUnitStats(hero, catalog = "undefined") {
  const script = `
    import { buildHeroStats, buildHeroUnitStats } from "./scripts/gen-heroes.ts";
    const gs = {
      ...${EMPTY_GAMESTRINGS},
      unit: {
        name: {
          HeroBaleog: "Baleog",
          HeroErik: "Erik",
          HeroOlaf: "Olaf",
          RexxarMisha: "Misha",
        },
      },
    };
    const hero = ${JSON.stringify(hero)};
    const catalog = ${catalog};
    const stats = buildHeroStats(hero, catalog);
    console.log(JSON.stringify({ stats, unitStats: buildHeroUnitStats(hero, gs, stats, catalog) }));
  `;
  return JSON.parse(execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  ));
}

test("controller heroes with placeholder stats expose combat stats for each hero unit", () => {
  const { stats, unitStats } = resolveHeroUnitStats({
    life: { amount: 1, scale: 0, regenRate: 0, regenScale: 0 },
    speed: 20,
    heroUnits: {
      HeroBaleog: {
        abilities: {},
        life: { amount: 1130, scale: 0.04, regenRate: 2.3554, regenScale: 0.04 },
        speed: 4.8398,
        weapons: [{ nameId: "HeroBaleogSword", range: 1.25, period: 0.9, damage: 75, damageScale: 0.04 }],
      },
      HeroErik: {
        abilities: {},
        life: { amount: 804, scale: 0.04, regenRate: 1.6757, regenScale: 0.04 },
        speed: 4.8398,
        weapons: [{ nameId: "HeroErikSlingshot", range: 6.5, period: 0.7, damage: 62, damageScale: 0.04 }],
      },
      HeroOlaf: {
        abilities: {},
        life: { amount: 1482, scale: 0.04, regenRate: 3.086, regenScale: 0.04 },
        speed: 4.8398,
        weapons: [{ nameId: "HeroOlaf", range: 1.25, period: 1, damage: 54, damageScale: 0.04 }],
      },
    },
  });

  assert.equal(stats.life.amount, 1);
  assert.deepEqual(unitStats.map((unit) => [unit.unitName, unit.stats.life.amount, unit.stats.weapon.damage, unit.stats.weapon.range]), [
    ["Baleog", 1130, 75, 1.25],
    ["Erik", 804, 62, 6.5],
    ["Olaf", 1482, 54, 1.25],
  ]);
});

test("normal heroes keep primary stats even when they have a hero unit", () => {
  const { unitStats } = resolveHeroUnitStats({
    life: { amount: 1810, scale: 0.04, regenRate: 3.7695, regenScale: 0.04 },
    speed: 4.8398,
    weapons: [{ nameId: "Rexxar", range: 1.5, period: 1.15, damage: 134, damageScale: 0.04 }],
    heroUnits: {
      RexxarMisha: {
        abilities: {},
        life: { amount: 1762, scale: 0.04, regenRate: 3.6718, regenScale: 0.04 },
        speed: 4.8398,
        weapons: [{ nameId: "RexxarMisha", range: 1.5, period: 1.25, damage: 50, damageScale: 0.04 }],
      },
    },
  });

  assert.deepEqual(unitStats, []);
});

test("D.Va shows mech and pilot stats side by side", () => {
  const { unitStats } = resolveHeroUnitStats({
    unitId: "HeroDVaMech",
    hyperlinkId: "DVa",
    radius: 1.1875,
    life: { amount: 2150, scale: 0.04, regenRate: 4.4804, regenScale: 0.04 },
    speed: 4.8398,
    weapons: [{ nameId: "DVaMechWeapon", range: 3.75, period: 0.25, damage: 22, damageScale: 0.04 }],
    heroUnits: {
      HeroDVaPilot: {
        abilities: {},
        radius: 0.625,
        life: { amount: 1109, scale: 0.04, regenRate: 2.5664, regenScale: 0.04 },
        speed: 4.8398,
        weapons: [{ nameId: "DVaPilotWeapon", range: 5.5, period: 0.25, damage: 55, damageScale: 0.04 }],
      },
    },
  });

  assert.deepEqual(unitStats.map((unit) => [unit.unitName, unit.stats.life.amount, unit.stats.radius]), [
    ["Mech Form", 2150, 1.1875],
    ["Pilot Form", 1109, 0.625],
  ]);
});

test("Greymane's Worgen form applies the Worgen buff and its damage modifier", () => {
  const { unitStats } = resolveHeroUnitStats({
    unitId: "HeroGreymane",
    hyperlinkId: "Greymane",
    isMelee: false,
    radius: 0.6875,
    life: { amount: 2210, scale: 0.04, regenRate: 4.6, regenScale: 0.04 },
    speed: 4.8398,
    weapons: [
      { nameId: "HeroGreymaneMeleeWeapon", range: 1.5, period: 1, damage: 148, damageScale: 0.04 },
      { nameId: "HeroGreymaneRangedWeapon", range: 5.5, period: 1, damage: 148, damageScale: 0.04 },
      { nameId: "HeroGreymaneWorgenWeapon", range: 1.25, period: 1, damage: 148, damageScale: 0.04, isDisabled: true },
    ],
  }, `{
    weaponTiming: () => null,
    weaponDamageMultiplier: (id) => (id === "HeroGreymaneWorgenWeapon" ? 1.4 : 1),
    buff: (id) => id === "GreymaneWorgenForm"
      ? { lifeMax: 0, weaponEnable: ["HeroGreymaneWorgenWeapon"], weaponDisable: ["HeroGreymaneRangedWeapon", "HeroGreymaneMeleeWeapon"] }
      : null,
  }`);

  assert.deepEqual(unitStats.map((unit) => [unit.unitName, Math.round(unit.stats.weapon.damage * 10) / 10, unit.stats.weapon.range]), [
    ["Human Form", 148, 5.5],
    ["Worgen Form", 207.2, 1.25],
  ]);
});

test("Alexstrasza's Dragon Form adds the Dragonqueen health buff", () => {
  const life = { amount: 1780, scale: 0.04, regenRate: 3.7, regenScale: 0.04 };
  const weapon = { range: 5.5, period: 1, damage: 73, damageScale: 0.04 };
  const { unitStats } = resolveHeroUnitStats({
    unitId: "HeroAlexstrasza",
    hyperlinkId: "Alexstrasza",
    life,
    weapons: [{ nameId: "AlexstraszaAttackWeapon", ...weapon }],
    heroUnits: {
      HeroAlexstraszaDragon: { abilities: {}, life, weapons: [{ nameId: "AlexstraszaDragonConeWeapon", ...weapon }] },
    },
  }, `{
    weaponTiming: () => null,
    weaponDamageMultiplier: () => 1,
    buff: (id) => (id === "AlexstraszaDragonqueenHealthIncrease" ? { lifeMax: 500, weaponEnable: [], weaponDisable: [] } : null),
  }`);

  assert.deepEqual(unitStats.map((unit) => [unit.unitName, unit.stats.life.amount]), [
    ["Normal Form", 1780],
    ["Dragon Form", 2280],
  ]);
});

test("hero forms use their own portrait, else the form ability icon", () => {
  const life = { amount: 1780, scale: 0.04, regenRate: 3.7, regenScale: 0.04 };
  const weapons = [{ nameId: "W", range: 5.5, period: 1, damage: 73, damageScale: 0.04 }];
  const portraits = { targetInfo: "storm_ui_ingame_partyframe_alexstrasza.png" };
  const { unitStats } = resolveHeroUnitStats({
    unitId: "HeroAlexstrasza",
    hyperlinkId: "Alexstrasza",
    portraits: { ...portraits, target: "ui_targetportrait_hero_alexstrasza.png" },
    life,
    weapons,
    heroUnits: { HeroAlexstraszaDragon: { abilities: {}, life, weapons, portraits } },
  });
  const { unitStats: dva } = resolveHeroUnitStats({
    unitId: "HeroDVaMech",
    hyperlinkId: "DVa",
    portraits: { targetInfo: "storm_ui_ingame_partyframe_dva_mech.png" },
    life,
    weapons,
    heroUnits: { HeroDVaPilot: { abilities: {}, life, weapons, portraits: { targetInfo: "storm_ui_ingame_partyframe_dva.png" } } },
  });

  const { unitStats: vikings } = resolveHeroUnitStats({
    life: { amount: 1, scale: 0, regenRate: 0, regenScale: 0 },
    portraits: { targetInfo: "" },
    heroUnits: { HeroErik: { abilities: {}, life, weapons, portraits: { targetInfo: "storm_ui_ingame_targetinfopanel_unit_hero_eric.png" } } },
  });

  assert.deepEqual([...unitStats, ...dva, ...vikings].map((unit) => [unit.unitName, unit.portrait]), [
    ["Normal Form", "heroportraits/ui_targetportrait_hero_alexstrasza.png"],
    ["Dragon Form", "abilitytalents/storm_ui_icon_alexstrasza_dragon_queen.png"],
    ["Mech Form", "heroportraits/storm_ui_ingame_partyframe_dva_mech.png"],
    ["Pilot Form", "heroportraits/storm_ui_ingame_partyframe_dva.png"],
    ["Erik", "heroportraits/storm_ui_ingame_targetinfopanel_unit_hero_eric.png"],
  ]);
});

function resolveHeroUnitAbilityCardVisibility(ids) {
  const script = `
    import { shouldRenderHeroUnitAbilityCards } from "./scripts/gen-heroes.ts";
    console.log(JSON.stringify(${JSON.stringify(ids)}.map((id) => [id, shouldRenderHeroUnitAbilityCards({ hyperlinkId: id })])));
  `;
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  );
  return Object.fromEntries(JSON.parse(output));
}

test("Lost Vikings suppress duplicated alternate-form ability cards", () => {
  assert.deepEqual(resolveHeroUnitAbilityCardVisibility(["LostVikings", "Rexxar", "DVa"]), {
    LostVikings: false,
    Rexxar: true,
    DVa: true,
  });
});
