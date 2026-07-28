import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { StructureGroup, StructureStats, StructureWeapon } from "./types.ts";
import { GAMEDATA_DIR, SITE_CONTENT, SITE_DATA } from "./lib/paths.ts";
import {
  STRUCTURE_SCALING_FIELDS,
  attr,
  block,
  links,
  numberTag,
  readCached,
  summarizeArmor,
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
const source = {
  unitXml: path.join(heroesData, "unitdata.xml"),
  behaviorXml: path.join(heroesData, "behaviordata.xml"),
  weaponXml: path.join(heroesData, "weapondata.xml"),
  effectXml: path.join(heroesData, "effectdata.xml"),
  armorXml: path.join(heroesData, "unitdata.xml"),
};

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
    id: "healing-fountains",
    title: "Healing Fountains",
    units: [
      structure("TownMoonwell", "Healing Fountain", "Fountain"),
      structure("TownMoonwellL2", "Fort Healing Fountain", "Fountain"),
      structure("TownMoonwellL3", "Keep Healing Fountain", "Fountain"),
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

function withParentBlock(xml: string, currentBlock: string | null, fallbackParentId?: string | null) {
  if (!currentBlock) return null;
  const currentTag = currentBlock.match(/^<\w+\b[^>]*>/i)?.[0] ?? "";
  const parentId = fallbackParentId ?? attr(currentTag, "parent");
  const parentBlock = parentId ? block(xml, currentTag.match(/^<(\w+)/i)?.[1] ?? "CWeapon", parentId) : null;
  return { currentBlock, parentBlock };
}

function inheritedNumber(xml: string, currentBlock: string | null, tag: string) {
  const blocks = withParentBlock(xml, currentBlock);
  if (!blocks) return null;
  return numberTag(blocks.currentBlock, tag) ?? (blocks.parentBlock ? numberTag(blocks.parentBlock, tag) : null);
}

function weapon(xml: string, id: string, effectXml: string): StructureWeapon {
  const weaponBlock = block(xml, "CWeapon", id);
  const effectId = weaponBlock
    ? attr(weaponBlock.match(/<DisplayEffect\b[^>]+/i)?.[0] ?? "", "value")
      ?? attr(weaponBlock.match(/<Effect\b[^>]+/i)?.[0] ?? "", "value")
    : null;
  const effectBlock = effectId ? block(effectXml, "CEffect", effectId) : null;
  return {
    id,
    damage: effectBlock ? numberTag(effectBlock, "Amount") : null,
    period: inheritedNumber(xml, weaponBlock, "Period"),
    range: inheritedNumber(xml, weaponBlock, "Range"),
  };
}

async function processStructure(def: StructureDef): Promise<StructureStats> {
  const [unitXml, behaviorXml, weaponXml, effectXml, armorXml] = await Promise.all([
    readCached(source.unitXml),
    readCached(source.behaviorXml),
    readCached(source.weaponXml),
    readCached(source.effectXml),
    readCached(source.armorXml),
  ]);
  const unitBlock = block(unitXml, "CUnit", def.id);
  const empty = { id: def.id, name: def.name, role: def.role, hp: null, shields: null, killXp: null, scaling: null, scalingRows: [], armor: null, weapons: [] };
  if (!unitBlock) return empty;
  const scalingLinks = links(unitBlock, "BehaviorArray", "Link").filter((id) => /scaling/i.test(id));
  const weaponLinks = links(unitBlock, "WeaponArray", "Link");
  return {
    ...empty,
    hp: numberTag(unitBlock, "LifeMax"),
    shields: numberTag(unitBlock, "ShieldsMax"),
    killXp: numberTag(unitBlock, "KillXP"),
    scaling: summarizeScaling(behaviorXml, scalingLinks, STRUCTURE_SCALING_FIELDS),
    scalingRows: summarizeScalingRows(behaviorXml, scalingLinks, STRUCTURE_SCALING_FIELDS),
    armor: summarizeArmor(unitBlock, armorXml),
    weapons: weaponLinks.map((id) => weapon(weaponXml, id, effectXml)),
  };
}

async function main() {
  console.log("gen-structures: starting");
  await mkdir(SITE_DATA, { recursive: true });
  await mkdir(SITE_CONTENT, { recursive: true });
  const groups: StructureGroup[] = [];
  for (const group of groupsConfig) groups.push({ ...group, units: await Promise.all(group.units.map(processStructure)) });
  await writeFile(path.join(SITE_DATA, "structures.json"), JSON.stringify({ groups }, null, 2), "utf-8");
  await writeFile(path.join(SITE_CONTENT, "structures.md"), `+++\ntitle = "Structures"\ntemplate = "structures.html"\n+++\n`, "utf-8");
  console.log(`gen-structures: wrote ${groups.reduce((sum, group) => sum + group.units.length, 0)} structures`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
