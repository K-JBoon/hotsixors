import * as path from "node:path";
import type { ScalingSummaryRow, StructureGroup, StructureStats } from "./types.ts";
import { GAMEDATA_DIR, SITE_CONTENT, SITE_DATA } from "./lib/paths.ts";
import { writeJson, writeText } from "./lib/fs.ts";
import { frontmatter } from "./lib/frontmatter.ts";
import { runScript } from "./lib/script.ts";
import {
  STRUCTURE_SCALING_FIELDS,
  block,
  links,
  numberTag,
  readCached,
  readWeapon,
  summarizeScaling,
  summarizeScalingRows,
} from "./lib/catalog-xml.ts";

type StructureDef = {
  id: string;
  name: string;
  role: string;
};

type GroupDef = Omit<StructureGroup, "units"> & { units: StructureDef[] };

const heroesData = path.join(GAMEDATA_DIR, "heroesdata.stormmod/base.stormdata/gamedata");
const mapMods = path.join(GAMEDATA_DIR, "heroesmapmods/battlegroundmapmods");
const source = {
  unitXml: path.join(heroesData, "unitdata.xml"),
  behaviorXml: path.join(heroesData, "behaviordata.xml"),
  weaponXml: path.join(heroesData, "weapondata.xml"),
  effectXml: path.join(heroesData, "effectdata.xml"),
  galaxy: path.join(GAMEDATA_DIR, "heroesdata.stormmod/base.stormdata/triggerlibs/heroeslib_h.galaxy"),
};

// Map mods that re-declare a town structure with its own KillXP.
const killXpOverrides = [
  { label: "Towers of Doom", unitXml: path.join(mapMods, "towersofdoom.stormmod/base.stormdata/gamedata/unitdata.xml") },
];

function structure(id: string, name: string, role: string): StructureDef {
  return { id, name, role };
}

const groupsConfig: GroupDef[] = [
  {
    id: "core",
    title: "Core",
    units: [
      structure("KingsCore", "Core", "Core"),
    ],
  },
  {
    id: "forts-and-keeps",
    title: "Forts & Keeps",
    units: [
      structure("TownTownHallL2", "Fort", "Fort"),
      structure("TownTownHallL3", "Keep", "Keep"),
    ],
  },
  {
    id: "towers",
    title: "Towers",
    units: [
      structure("TownCannonTower", "Gate Tower", "Tower"),
      structure("TownCannonTowerL2", "Fort Tower", "Tower"),
      structure("TownCannonTowerL3", "Keep Tower", "Tower"),
    ],
  },
  {
    id: "gates",
    title: "Gates",
    units: [
      structure("TownGateL1", "Outer Gate", "Gate"),
      structure("TownGateL2", "Fort Gate", "Gate"),
      structure("TownGateL3", "Keep Gate", "Gate"),
    ],
  },
  {
    id: "walls",
    title: "Walls",
    units: [
      structure("TownWallL1Parent", "Outer Wall", "Wall"),
      structure("TownWallL2Parent", "Fort Wall", "Wall"),
      structure("TownWallL3Parent", "Keep Wall", "Wall"),
    ],
  },
];

function galaxyConst(galaxy: string, name: string) {
  const value = new RegExp(`const fixed ${name} = ([\\d.]+);`).exec(galaxy)?.[1];
  if (!value) throw new Error(`gen-structures: ${name} not found in heroeslib_h.galaxy`);
  return Number.parseFloat(value);
}

// Town halls award no kill XP off Towers of Doom; each one lost raises the
// enemy team's passive trickle instead.
function trickleNote(galaxy: string) {
  const perTick = galaxyConst(galaxy, "libCore_gv_data_XP_TrickleAmount_C");
  const period = galaxyConst(galaxy, "libCore_gv_data_XP_TricklePeriod_C");
  const mod = galaxyConst(galaxy, "libCore_gv_data_XP_TrickleTownHallMod_C");
  const bonus = Number(((perTick * mod) / period).toFixed(2));
  return `Each one destroyed adds +${mod} to the enemy team's XP trickle multiplier (+${bonus} XP/s). Towers of Doom uses kill XP instead.`;
}

async function killXpRows(def: StructureDef, baseKillXp: number | null): Promise<ScalingSummaryRow[]> {
  const overrides = await Promise.all(killXpOverrides.map(async (map) => {
    const unitBlock = block(await readCached(map.unitXml), "CUnit", def.id);
    return { label: map.label, value: unitBlock ? numberTag(unitBlock, "KillXP") : null };
  }));
  const differing = overrides.filter((map) => map.value != null && map.value !== baseKillXp);
  if (!differing.length) return [];
  return [
    { label: "Most maps", summary: baseKillXp == null ? "None" : String(baseKillXp) },
    ...differing.map((map) => ({ label: map.label, summary: String(map.value) })),
  ];
}

async function processStructure(def: StructureDef): Promise<StructureStats> {
  const [unitXml, behaviorXml, weaponXml, effectXml, galaxy] = await Promise.all([
    readCached(source.unitXml),
    readCached(source.behaviorXml),
    readCached(source.weaponXml),
    readCached(source.effectXml),
    readCached(source.galaxy),
  ]);
  const unitBlock = block(unitXml, "CUnit", def.id);
  const empty = { id: def.id, name: def.name, role: def.role, hp: null, shields: null, killXp: null, killXpRows: [], killXpNote: null, scaling: null, scalingRows: [], weapons: [] };
  if (!unitBlock) return empty;
  const scalingLinks = links(unitBlock, "BehaviorArray", "Link").filter((id) => /scaling/i.test(id));
  const weaponLinks = links(unitBlock, "WeaponArray", "Link");
  const isTownHall = /<FlagArray\b[^>]*index="TownStructureTownHall"[^>]*value="1"/i.test(unitBlock);
  const killXp = numberTag(unitBlock, "KillXP");
  return {
    ...empty,
    hp: numberTag(unitBlock, "LifeMax"),
    shields: numberTag(unitBlock, "ShieldsMax"),
    killXp,
    killXpRows: await killXpRows(def, killXp),
    killXpNote: isTownHall ? trickleNote(galaxy) : null,
    scaling: summarizeScaling(behaviorXml, scalingLinks, STRUCTURE_SCALING_FIELDS),
    scalingRows: summarizeScalingRows(behaviorXml, scalingLinks, STRUCTURE_SCALING_FIELDS),
    weapons: weaponLinks.map((id) => readWeapon(weaponXml, id, effectXml, true)),
  };
}

async function main() {
  const groups: StructureGroup[] = [];
  for (const group of groupsConfig) groups.push({ ...group, units: await Promise.all(group.units.map(processStructure)) });
  await writeJson(path.join(SITE_DATA, "structures.json"), { groups }, 2);
  await writeText(
    path.join(SITE_CONTENT, "structures.md"),
    frontmatter({ title: "Structures", template: "structures.html" }),
  );
  console.log(`gen-structures: wrote ${groups.reduce((sum, group) => sum + group.units.length, 0)} structures`);
}

runScript(import.meta.url, main);
