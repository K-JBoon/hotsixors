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

function resolveHeroUnitStats(hero) {
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
    const stats = buildHeroStats(hero);
    console.log(JSON.stringify({ stats, unitStats: buildHeroUnitStats(hero, gs, stats) }));
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
