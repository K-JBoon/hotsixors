import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { MinionMercGroup, MinionMercStats, MinionMercWeapon } from "./types.ts";
import { GAMEDATA_DIR, SITE_CONTENT, SITE_DATA } from "./lib/paths.ts";
import {
  MINION_SCALING_FIELDS,
  attr,
  block,
  links,
  numberTag,
  readCached,
  summarizeArmor,
  summarizeScaling,
  summarizeScalingRows,
} from "./lib/catalog-xml.ts";

type UnitDef = {
  id: string;
  name: string;
  role: string;
  context: string;
  unitXml: string;
  behaviorXml?: string;
  weaponXml?: string;
  effectXml?: string;
  armorXml?: string;
  unitOverrideXml?: string;
  behaviorOverrideXml?: string;
  // The unit awards experience-globe XP even when the behavior is hidden here.
  hasGlobeXp?: boolean;
};

type GroupDef = Omit<MinionMercGroup, "units"> & { units: UnitDef[] };

const heroesData = path.join(GAMEDATA_DIR, "heroesdata.stormmod/base.stormdata/gamedata");
const battlegroundData = path.join(GAMEDATA_DIR, "heroesmapmods/battlegroundmapmods");
const heavenHellUnitXml = path.join(battlegroundData, "heavenhell.stormmod/base.stormdata/gamedata/unitdata.xml");
const hanamuraUnitXml = path.join(battlegroundData, "hanamura.stormmod/base.stormdata/gamedata/unitdata.xml");
const hanamuraBehaviorXml = path.join(battlegroundData, "hanamura.stormmod/base.stormdata/gamedata/behaviordata.xml");
const base = {
  unitXml: path.join(heroesData, "unitdata.xml"),
  behaviorXml: path.join(heroesData, "behaviordata.xml"),
  weaponXml: path.join(heroesData, "weapondata.xml"),
  effectXml: path.join(heroesData, "effectdata.xml"),
  armorXml: path.join(heroesData, "unitdata.xml"),
};
const tomb = {
  unitXml: path.join(battlegroundData, "tombofthespiderqueen.stormmod/base.stormdata/gamedata/unitdata.xml"),
  behaviorXml: path.join(battlegroundData, "tombofthespiderqueen.stormmod/base.stormdata/gamedata/behaviordata.xml"),
  weaponXml: path.join(battlegroundData, "tombofthespiderqueen.stormmod/base.stormdata/gamedata/weapondata.xml"),
  effectXml: path.join(battlegroundData, "tombofthespiderqueen.stormmod/base.stormdata/gamedata/effectdata.xml"),
  armorXml: path.join(battlegroundData, "tombofthespiderqueen.stormmod/base.stormdata/gamedata/unitdata.xml"),
};
const alteracReaverXml = path.join(battlegroundData, "alteracpass.stormmod/base.stormdata/gamedata/reaver.xml");
const alteracReaver = {
  unitXml: alteracReaverXml,
  behaviorXml: alteracReaverXml,
  weaponXml: alteracReaverXml,
  effectXml: alteracReaverXml,
  armorXml: alteracReaverXml,
};
const gamelibGalaxyPath = path.join(GAMEDATA_DIR, "heroesdata.stormmod/base.stormdata/triggerlibs/gamelib.galaxy");

function mercFile(file: string) {
  const xml = path.join(heroesData, `mercenaries/${file}`);
  return { unitXml: xml, behaviorXml: xml, weaponXml: xml, effectXml: xml, armorXml: xml };
}

function unit(id: string, name: string, role: string, context: string, source = base): UnitDef {
  return { ...source, id, name, role, context };
}

function withOverrides(def: UnitDef, overrides: Pick<UnitDef, "unitOverrideXml" | "behaviorOverrideXml">): UnitDef {
  return { ...def, ...overrides };
}

const groupsConfig: GroupDef[] = [
  {
    id: "standard-minions",
    title: "Standard Minions",
    units: [
      unit("FootmanMinion", "Melee Minion", "Melee", "Most battlegrounds"),
      unit("RangedMinion", "Ranged Minion", "Ranged", "Most battlegrounds"),
      unit("WizardMinion", "Leader Minion", "Leader", "Most battlegrounds"),
      unit("CatapultMinion", "Catapult Minion", "Catapult", "Most battlegrounds after forts/keeps fall"),
    ],
  },
  {
    id: "battleground-variants",
    title: "Battleground Variants",
    units: [
      unit("ReaverMinion", "Reaver Minion", "Catapult replacement", "Alterac Pass", alteracReaver),
      unit("RangedMinion", "Ranged Minion", "Ranged", "Tomb of the Spider Queen", tomb),
      { ...unit("SpectralMinion", "Spectral Minion", "Melee", "Tomb of the Spider Queen", tomb), hasGlobeXp: true },
      unit("SoulPriest", "Soul Priest", "Leader", "Tomb of the Spider Queen", tomb),
      unit("LostSoul", "Lost Soul", "Summoned minion", "Tomb of the Spider Queen", tomb),
    ],
  },
  {
    id: "mercenary-defenders",
    title: "Mercenary Defenders",
    units: [
      unit("MercDefenderSiegeGiant", "Siege Giant", "Siege camp defender", "Siege camps"),
      unit("MercDefenderMeleeKnight", "Knight", "Bruiser camp defender", "Bruiser camps"),
      unit("MercDefenderRangedMage", "Mage", "Bruiser camp defender", "Bruiser camps"),
      unit("TerranHellbatDefender", "Hellbat", "Mercenary defender", "StarCraft variants", mercFile("hellbat.xml")),
      withOverrides(unit("MercSiegeTrooperDefender", "Assault Trooper / Impaler", "Mercenary defender", "Volskaya/Diablo variants", mercFile("siegetrooper.xml")), {
        unitOverrideXml: heavenHellUnitXml,
      }),
      unit("MercGoblinSapperDefender", "Sapper", "Mercenary defender", "Towers of Doom and variants", mercFile("sapper.xml")),
      withOverrides(unit("MercDefenderSentinel", "Sentinel", "Mercenary defender", "Hanamura Temple", mercFile("swordsman.xml")), {
        unitOverrideXml: hanamuraUnitXml,
        behaviorOverrideXml: hanamuraBehaviorXml,
      }),
      withOverrides(unit("MercSummonerDefender", "Fallen Shaman", "Mercenary defender", "Diablo variants", mercFile("summoner.xml")), {
        unitOverrideXml: heavenHellUnitXml,
      }),
      unit("MercSummonerDefenderMinion", "Fallen Hound", "Summoned defender", "Diablo variants", mercFile("summoner.xml")),
    ],
  },
  {
    id: "mercenary-laners",
    title: "Mercenary Laners",
    units: [
      unit("MercLanerSiegeGiant", "Siege Giant", "Siege camp laner", "Siege camps"),
      unit("MercLanerMeleeKnight", "Knight", "Bruiser camp laner", "Bruiser camps"),
      unit("MercLanerRangedMage", "Mage", "Bruiser camp laner", "Bruiser camps"),
      unit("TerranHellbat", "Hellbat / Gnoll", "Mercenary laner", "StarCraft/Warcraft variants", mercFile("hellbat.xml")),
      unit("MercSiegeTrooperLaner", "Assault Trooper / Impaler", "Mercenary laner", "Volskaya/Diablo variants", mercFile("siegetrooper.xml")),
      unit("MercGoblinSapperLaner", "Sapper", "Mercenary laner", "Towers of Doom and variants", mercFile("sapper.xml")),
      unit("MercLanerSentinel", "Sentinel", "Mercenary laner", "Hanamura Temple", mercFile("swordsman.xml")),
      unit("MercSummonerLaner", "Fallen Shaman", "Mercenary laner", "Diablo variants", mercFile("summoner.xml")),
      unit("MercSummonerLanerMinion", "Fallen Hound", "Summoned laner", "Diablo variants", mercFile("summoner.xml")),
    ],
  },
  {
    id: "boss-mercenaries",
    title: "Boss Mercenaries",
    units: [
      unit("JungleGraveGolemDefender", "Boss", "Boss defender", "Boss camps"),
      unit("JungleGraveGolemLaner", "Boss", "Boss laner", "Boss camps"),
    ],
  },
];

function ordinal(value: number) {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1: return `${value}st`;
    case 2: return `${value}nd`;
    case 3: return `${value}rd`;
    default: return `${value}th`;
  }
}

function compressCycle(values: string[]) {
  if (!values.length) return [];
  for (let size = 1; size <= Math.floor(values.length / 2); size += 1) {
    let matches = true;
    for (let i = 0; i < values.length; i += 1) {
      if (values[i] !== values[i % size]) {
        matches = false;
        break;
      }
    }
    if (matches) return values.slice(0, size);
  }
  return values;
}

function summarizeIncrementPattern(values: string[]) {
  if (!values.length) return null;
  const cycle = compressCycle(values);
  if (cycle.length === 1) return `+${cycle[0]}/min`;

  const counts = new Map<string, number>();
  for (const value of cycle) counts.set(value, (counts.get(value) ?? 0) + 1);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [baseValue, baseCount] = entries[0];
  const outliers = cycle
    .map((value, index) => ({ value, index }))
    .filter((entry) => entry.value !== baseValue);

  if (
    entries.length === 2
    && baseCount === cycle.length - 1
    && outliers.length === 1
    && outliers[0].index === cycle.length - 1
    && Number.parseFloat(outliers[0].value) > Number.parseFloat(baseValue)
  ) {
    return `+${baseValue}/min; +${outliers[0].value} every ${ordinal(cycle.length)} minute`;
  }

  return `repeats +${cycle.join("/+")} every ${cycle.length} minutes`;
}

// Lane minions grant XP through the experience-globe system.
let globeXpPerMinutePromise: Promise<number> | null = null;

function globeXpPerMinute() {
  if (!globeXpPerMinutePromise) {
    globeXpPerMinutePromise = (async () => {
      const galaxy = await readCached(gamelibGalaxyPath);
      const perMinute = /ExperienceGlobeScaling_Func[\s\S]{0,500}?lv_xPScaling = ([\d.]+);/.exec(galaxy)?.[1];
      if (!perMinute) throw new Error("gen-minions: ExperienceGlobeScaling xPScaling not found in gamelib.galaxy");
      return Number.parseFloat(perMinute);
    })();
  }
  return globeXpPerMinutePromise;
}

function globeBaseXp(effectXmls: (string | null)[]) {
  for (const xml of effectXmls) {
    if (!xml) continue;
    const globeEffect = block(xml, "CEffect", "ExperienceAcquiredMinions");
    const value = globeEffect ? numberTag(globeEffect, "XP") : null;
    if (value != null) return value;
  }
  throw new Error("gen-minions: ExperienceAcquiredMinions XP not found in effectdata.xml");
}

// The first behavior source that names any KillXPBonus wins; the values are the
// per-minute increments, in behavior order.
function xpScalingValues(behaviorXmls: (string | null)[], ids: string[]): string[] {
  const uniqueIds = [...new Set(ids)];
  for (const behaviorXml of behaviorXmls) {
    if (!behaviorXml) continue;
    const values: string[] = [];
    for (const id of uniqueIds) {
      const b = block(behaviorXml, "CBehavior", id);
      if (!b) continue;
      values.push(...[...b.matchAll(/KillXPBonus="([\d.]+)"/gi)].map((match) => String(Number.parseFloat(match[1]))));
    }
    if (values.length) return values;
  }
  return [];
}

function summarizeXpScaling(behaviorXmls: (string | null)[], ids: string[]) {
  const values = xpScalingValues(behaviorXmls, ids);
  return values.length ? `+${values.join("/")} per minute` : null;
}

function summarizeXpScalingPattern(behaviorXmls: (string | null)[], ids: string[]) {
  return summarizeIncrementPattern(xpScalingValues(behaviorXmls, ids));
}

function weapon(xml: string, id: string, effectXml: string): MinionMercWeapon {
  const weaponBlock = block(xml, "CWeapon", id);
  const effectId = weaponBlock
    ? attr(weaponBlock.match(/<DisplayEffect\b[^>]+/i)?.[0] ?? "", "value")
      ?? attr(weaponBlock.match(/<Effect\b[^>]+/i)?.[0] ?? "", "value")
    : null;
  const effectBlock = effectId ? block(effectXml, "CEffect", effectId) : null;
  return {
    id,
    damage: effectBlock ? numberTag(effectBlock, "Amount") : null,
    period: weaponBlock ? numberTag(weaponBlock, "Period") : null,
    range: weaponBlock ? numberTag(weaponBlock, "Range") : null,
  };
}

async function processUnit(def: UnitDef): Promise<MinionMercStats> {
  const [
    unitXml,
    behaviorXml,
    weaponXml,
    effectXml,
    armorXml,
    unitOverrideXml,
    behaviorOverrideXml,
    fallbackUnitXml,
    fallbackBehaviorXml,
    fallbackWeaponXml,
    fallbackEffectXml,
  ] = await Promise.all([
    readCached(def.unitXml),
    readCached(def.behaviorXml ?? def.unitXml),
    readCached(def.weaponXml ?? def.unitXml),
    readCached(def.effectXml ?? def.weaponXml ?? def.unitXml),
    readCached(def.armorXml ?? def.unitXml),
    def.unitOverrideXml ? readCached(def.unitOverrideXml) : Promise.resolve(null),
    def.behaviorOverrideXml ? readCached(def.behaviorOverrideXml) : Promise.resolve(null),
    readCached(base.unitXml),
    readCached(base.behaviorXml),
    readCached(base.weaponXml),
    readCached(base.effectXml),
  ]);
  const unitBlock = block(unitXml, "CUnit", def.id);
  const unitOverrideBlock = unitOverrideXml ? block(unitOverrideXml, "CUnit", def.id) : null;
  const fallbackUnitBlock = def.unitXml === base.unitXml ? null : block(fallbackUnitXml, "CUnit", def.id);
  const empty = { id: def.id, name: def.name, role: def.role, context: def.context, hp: null, speed: null, killXp: null, xpScaling: null, xpScalingSummary: null, scaling: null, scalingRows: [], armor: null, weapons: [] };
  if (!unitBlock && !fallbackUnitBlock) return empty;
  const statsBlock = unitBlock ?? fallbackUnitBlock!;
  const fallbackLinks = fallbackUnitBlock ? links(fallbackUnitBlock, "BehaviorArray", "Link").filter((id) => /scaling/i.test(id)) : [];
  const directLinks = unitBlock ? links(unitBlock, "BehaviorArray", "Link").filter((id) => /scaling/i.test(id)) : [];
  const weaponLinks = unitBlock ? links(unitBlock, "WeaponArray", "Link") : [];
  const fallbackWeaponLinks = fallbackUnitBlock ? links(fallbackUnitBlock, "WeaponArray", "Link") : [];
  const behaviorLinks = [
    ...(unitBlock ? links(unitBlock, "BehaviorArray", "Link") : []),
    ...(fallbackUnitBlock ? links(fallbackUnitBlock, "BehaviorArray", "Link") : []),
  ];
  const isGlobeCarrier = behaviorLinks.includes("ExperienceGlobeSpawn") || def.hasGlobeXp === true;
  const globe = isGlobeCarrier
    ? { base: globeBaseXp([effectXml, fallbackEffectXml]), perMinute: await globeXpPerMinute() }
    : null;
  const linkedXpScaling = summarizeXpScaling([behaviorOverrideXml, behaviorXml, fallbackBehaviorXml], [...directLinks, ...fallbackLinks]);
  const scalingRows = summarizeScalingRows(behaviorXml, directLinks, MINION_SCALING_FIELDS);
  const fallbackScalingRows = summarizeScalingRows(fallbackBehaviorXml, fallbackLinks, MINION_SCALING_FIELDS);
  return {
    ...empty,
    hp: numberTag(unitOverrideBlock ?? "", "LifeMax") ?? numberTag(statsBlock, "LifeMax") ?? (fallbackUnitBlock ? numberTag(fallbackUnitBlock, "LifeMax") : null),
    speed: numberTag(unitOverrideBlock ?? "", "Speed") ?? numberTag(statsBlock, "Speed") ?? (fallbackUnitBlock ? numberTag(fallbackUnitBlock, "Speed") : null),
    killXp: globe?.base ?? numberTag(unitOverrideBlock ?? "", "KillXP") ?? numberTag(statsBlock, "KillXP"),
    xpScaling: globe ? `+${globe.perMinute} per minute` : linkedXpScaling,
    xpScalingSummary: globe ? `+${globe.perMinute}/min` : summarizeXpScalingPattern([behaviorOverrideXml, behaviorXml, fallbackBehaviorXml], [...directLinks, ...fallbackLinks]),
    scaling: summarizeScaling(behaviorXml, directLinks, MINION_SCALING_FIELDS) ?? summarizeScaling(fallbackBehaviorXml, fallbackLinks, MINION_SCALING_FIELDS),
    scalingRows: scalingRows.length ? scalingRows : fallbackScalingRows,
    armor: summarizeArmor(statsBlock, armorXml),
    weapons: weaponLinks.length > 0
      ? weaponLinks.map((id) => weapon(weaponXml, id, effectXml))
      : fallbackWeaponLinks.map((id) => weapon(fallbackWeaponXml, id, fallbackEffectXml)),
  };
}

async function main() {
  console.log("gen-minions: starting");
  await mkdir(SITE_DATA, { recursive: true });
  await mkdir(SITE_CONTENT, { recursive: true });
  const groups: MinionMercGroup[] = [];
  for (const group of groupsConfig) groups.push({ ...group, units: await Promise.all(group.units.map(processUnit)) });
  await writeFile(path.join(SITE_DATA, "minions-and-mercs.json"), JSON.stringify({ groups }, null, 2), "utf-8");
  await writeFile(path.join(SITE_CONTENT, "minions-and-mercs.md"), `+++\ntitle = "Minions & Mercs"\ntemplate = "minions-and-mercs.html"\n+++\n`, "utf-8");
  console.log(`gen-minions: wrote ${groups.reduce((sum, group) => sum + group.units.length, 0)} units`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
