import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import type { BattlegroundData, BattlegroundTimer, BattlegroundCodeBlock, BattlegroundMechanic, BattlegroundSummon, BattlegroundSummonVariant, BattlegroundWeapon, BattlegroundAbility, BattlegroundXmlFile, ScalingSummaryRow, Gamestrings } from "./types.ts";
import { BATTLEGROUNDS, type BattlegroundConfig, type SummonVariantConfig } from "./lib/battlegrounds-config.ts";
import { GAMEDATA_DIR, HEROES_DATA_DIR, SITE_CONTENT_BATTLEGROUNDS, SITE_DATA_BATTLEGROUNDS, findLatestVersion } from "./lib/paths.ts";
import { loadGamestrings, loadMapGamestringPatches, type MapGamestringPatch } from "./lib/heroes-data.ts";
import { shouldIncludeGamedataPath } from "./gen-gamedata.ts";
import { buildAbilityIndex, extractAbilities } from "./lib/ability-text.ts";
import { buildConstMap, collectLinks, extractArmor, extractScalingRows, extractUnit, extractWeapon, firstAttrValue, firstNumberAttr, unitChain } from "./lib/battleground-xml.ts";
import { type ConstEntry, buildConstBlock, extractGalaxyConstsTracked, extractPatternContext, extractTimerContext, formatSeconds, headerToImpl, sanitizeGamedataUrl } from "./lib/galaxy-source.ts";

const BATTLEGROUND_MODS_DIR = path.join(GAMEDATA_DIR, "heroesmapmods/battlegroundmapmods");
const HEROES_GAMEDATA_DIR = path.join(GAMEDATA_DIR, "heroesdata.stormmod/base.stormdata/gamedata");


async function readFileSafe(p: string): Promise<string | null> {
  try { return await readFile(p, "utf-8"); } catch { return null; }
}

async function processMap(cfg: BattlegroundConfig, abilityIndex: Map<string, { name: string; full: string }>): Promise<BattlegroundData> {
  console.log(`  Processing: ${cfg.name}`);

  const allConsts = new Map<string, ConstEntry>();
  const xmlFiles: BattlegroundXmlFile[] = [];
  // Track header files for later code blocks.
  const headerFiles: Array<{ absPath: string; name: string; src: string }> = [];

  const sharedHeaderPath = path.join(
    GAMEDATA_DIR,
    "heroesdata.stormmod/base.stormdata/triggerlibs/mapmechanicslib_h.galaxy"
  );
  const sharedSrc = await readFileSafe(sharedHeaderPath);
  if (sharedSrc) {
    extractGalaxyConstsTracked(sharedSrc, sharedHeaderPath, "mapmechanicslib_h.galaxy", allConsts);
    headerFiles.push({ absPath: sharedHeaderPath, name: "mapmechanicslib_h.galaxy", src: sharedSrc });
  } else {
    console.warn("  WARNING: mapmechanicslib_h.galaxy not found");
  }

  for (const modPath of cfg.modPaths) {
    const modDir = path.join(BATTLEGROUND_MODS_DIR, modPath);
    const gamedataDir = path.join(modDir, "base.stormdata/gamedata");
    const baseDir = path.join(modDir, "base.stormdata");

    let baseEntries: string[] = [];
    try { baseEntries = await readdir(baseDir); } catch { /* skip */ }
    for (const entry of baseEntries) {
      const relPath = `mods/heroesmapmods/battlegroundmapmods/${modPath}/base.stormdata/${entry}`;
      if (entry.endsWith("_h.galaxy")) {
        const absPath = path.join(baseDir, entry);
        const src = await readFileSafe(absPath);
        if (src) {
          extractGalaxyConstsTracked(src, absPath, entry, allConsts);
          headerFiles.push({ absPath, name: entry, src });
          if (shouldIncludeGamedataPath(relPath))
            xmlFiles.push({ label: entry, path: sanitizeGamedataUrl(relPath) });
        }
      } else if (entry.endsWith(".galaxy") && shouldIncludeGamedataPath(relPath)) {
        xmlFiles.push({ label: entry, path: sanitizeGamedataUrl(relPath) });
      }
    }

    let gamedataEntries: string[] = [];
    try { gamedataEntries = await readdir(gamedataDir); } catch { /* skip */ }
    for (const entry of gamedataEntries) {
      const relPath = `mods/heroesmapmods/battlegroundmapmods/${modPath}/base.stormdata/gamedata/${entry}`;
      if (shouldIncludeGamedataPath(relPath)) {
        xmlFiles.push({ label: `${modPath}/${entry}`, path: sanitizeGamedataUrl(relPath) });
      }
    }
  }

  const timers: BattlegroundTimer[] = [];
  for (const tc of cfg.timers) {
    let val: number | undefined;
    if (tc.seconds !== undefined) {
      val = tc.seconds;
    } else if (tc.galaxyConst) {
      const entry = allConsts.get(tc.galaxyConst);
      if (entry === undefined) {
        console.warn(`  WARNING: constant not found: ${tc.galaxyConst}`);
        continue;
      }
      val = entry.value;
    } else {
      console.warn(`  WARNING: timer "${tc.label}" has neither galaxyConst nor seconds`);
      continue;
    }
    const timer: BattlegroundTimer = { label: tc.label, seconds: val, display: formatSeconds(val) };
    if (tc.galaxyConst) timer.galaxyConst = tc.galaxyConst;
    if (tc.note) timer.note = tc.note;
    timers.push(timer);
  }

  // Build code blocks for the timer constants and their usage.
  const configuredConsts = cfg.timers
    .filter(t => t.galaxyConst)
    .map(t => t.galaxyConst!);

  const codeBlocks: BattlegroundCodeBlock[] = [];

  if (configuredConsts.length > 0) {
    // Group configured constants by the header file they came from.
    const byHeader = new Map<string, { name: string; absPath: string; constNames: string[] }>();
    for (const constName of configuredConsts) {
      const entry = allConsts.get(constName);
      if (!entry) continue;
      let group = byHeader.get(entry.headerFile);
      if (!group) {
        group = { name: entry.headerName, absPath: entry.headerFile, constNames: [] };
        byHeader.set(entry.headerFile, group);
      }
      group.constNames.push(constName);
    }

    for (const { name, absPath, constNames, src: headerSrc } of
      [...byHeader.values()].map(g => ({ ...g, src: headerFiles.find(h => h.absPath === g.absPath)?.src ?? '' }))
    ) {
      // 1. Constant definitions block from the header.
      const constBlock = buildConstBlock(headerSrc, constNames);
      if (constBlock) {
        codeBlocks.push({ label: `${name} — constants`, lang: "galaxy", code: constBlock });
      }

      // 2. Timer-start context from the corresponding implementation file.
      const implPath = headerToImpl(absPath);
      const implSrc = await readFileSafe(implPath);
      if (implSrc) {
        const implName = path.basename(implPath);
        const context = extractTimerContext(implSrc, constNames);
        if (context) {
          codeBlocks.push({ label: `${implName} — timer start`, lang: "galaxy", code: context });
        }
      }
    }
  }

  // Pre-load XML sources from the configured mod paths plus the base heroesdata
  // catalog. Stats often live on parent CUnits defined in the base catalog.
  const summonModPaths = cfg.summons.flatMap(sc => [
    ...(sc.modPaths ?? []),
    ...sc.variants.flatMap(v => v.modPaths ?? []),
  ]);
  const uniqueModPaths = [...new Set([...cfg.modPaths, ...summonModPaths])];
  const unitXmls: string[] = [];
  const weaponXmls: string[] = [];
  const effectXmls: string[] = [];
  const behaviorXmls: string[] = [];
  const armorXmls: string[] = [];
  for (const modPath of uniqueModPaths) {
    const dir = path.join(BATTLEGROUND_MODS_DIR, modPath, "base.stormdata/gamedata");
    const u = await readFileSafe(path.join(dir, "unitdata.xml")); if (u) { unitXmls.push(u); armorXmls.push(u); }
    const w = await readFileSafe(path.join(dir, "weapondata.xml")); if (w) weaponXmls.push(w);
    const e = await readFileSafe(path.join(dir, "effectdata.xml")); if (e) effectXmls.push(e);
    const b = await readFileSafe(path.join(dir, "behaviordata.xml")); if (b) behaviorXmls.push(b);
  }
  const baseUnit = await readFileSafe(path.join(HEROES_GAMEDATA_DIR, "unitdata.xml"));
  if (baseUnit) { unitXmls.push(baseUnit); armorXmls.push(baseUnit); }
  // Some battlegrounds keep their unit definitions in non-standard XMLs
  // (e.g. cavalry.xml, maps/protectors.xml). Pre-load any explicitly
  // referenced files so parent-chain resolution can find them.
  const extraUnitPaths = new Set<string>();
  for (const sc of cfg.summons) for (const v of sc.variants) if (v.unitXmlRelPath) extraUnitPaths.add(v.unitXmlRelPath);
  for (const rel of extraUnitPaths) {
    const src = await readFileSafe(path.join(GAMEDATA_DIR, rel));
    if (src) {
      unitXmls.push(src);
      armorXmls.push(src);
      // Some custom XMLs (e.g. cavalry.xml, protectors.xml) bundle weapons,
      // effects, and behaviors alongside the unit definition.
      weaponXmls.push(src);
      effectXmls.push(src);
      behaviorXmls.push(src);
    }
  }
  const baseWeapon = await readFileSafe(path.join(HEROES_GAMEDATA_DIR, "weapondata.xml"));
  if (baseWeapon) weaponXmls.push(baseWeapon);
  const baseEffect = await readFileSafe(path.join(HEROES_GAMEDATA_DIR, "effectdata.xml"));
  if (baseEffect) effectXmls.push(baseEffect);
  const baseBehavior = await readFileSafe(path.join(HEROES_GAMEDATA_DIR, "behaviordata.xml"));
  if (baseBehavior) behaviorXmls.push(baseBehavior);
  const constMap = buildConstMap(behaviorXmls);

  const processVariant = async (
    vc: SummonVariantConfig,
    parentModPaths: string[] | undefined,
  ): Promise<BattlegroundSummonVariant> => {
    let directBlock: string | null = null;
    let unitXmlPath: string | null = null;
    const searchPaths = vc.modPaths ?? parentModPaths ?? cfg.modPaths;

    if (vc.unitXmlRelPath) {
      const absPath = path.join(GAMEDATA_DIR, vc.unitXmlRelPath);
      const src = await readFileSafe(absPath);
      if (src) {
        directBlock = extractUnit(src, vc.unitId);
        if (directBlock) unitXmlPath = sanitizeGamedataUrl(`mods/${vc.unitXmlRelPath}`);
      }
    } else {
      for (const modPath of searchPaths) {
        const xmlPath = path.join(BATTLEGROUND_MODS_DIR, modPath, "base.stormdata/gamedata/unitdata.xml");
        const src = await readFileSafe(xmlPath);
        if (src) {
          directBlock = extractUnit(src, vc.unitId);
          if (directBlock) {
            unitXmlPath = sanitizeGamedataUrl(`mods/heroesmapmods/battlegroundmapmods/${modPath}/base.stormdata/gamedata/unitdata.xml`);
            break;
          }
        }
      }
    }

    if (!directBlock) {
      console.warn(`  WARNING: unit not found: ${vc.unitId}`);
      return { id: vc.unitId, label: vc.label, hp: null, speed: null, armor: null, scalingRows: [], abilities: [], weapons: [], xmlPath: null };
    }

    const chain = unitChain(vc.unitId, unitXmls);
    const blocks = chain.length ? chain : [directBlock];

    const hp = firstNumberAttr(blocks, "LifeMax");
    const speed = firstNumberAttr(blocks, "Speed");

    const abilities: BattlegroundAbility[] = extractAbilities(blocks, abilityIndex);

    const weaponLinks = collectLinks(blocks, "WeaponArray");
    const weapons: BattlegroundWeapon[] = weaponLinks.map(wid => extractWeapon(weaponXmls, effectXmls, wid));

    const scalingIds = collectLinks(blocks, "BehaviorArray").filter(id => /scaling/i.test(id));
    const scalingRows = extractScalingRows(behaviorXmls, scalingIds, constMap);

    const armor = extractArmor(blocks, armorXmls);

    return { id: vc.unitId, label: vc.label, hp, speed, armor, scalingRows, abilities, weapons, xmlPath: unitXmlPath };
  };

  const summons: BattlegroundSummon[] = [];
  for (const sc of cfg.summons) {
    const variants: BattlegroundSummonVariant[] = [];
    for (const vc of sc.variants) variants.push(await processVariant(vc, sc.modPaths));
    summons.push({ label: sc.label, variants });
  }

  const mechanics: BattlegroundMechanic[] = [];
  for (const ms of cfg.mechanics) {
    let codeBlock: BattlegroundCodeBlock | undefined;
    if (ms.codeBlockSpec) {
      const { galaxyFile, matchPattern, contextLines = 8 } = ms.codeBlockSpec;
      const absPath = path.join(GAMEDATA_DIR, galaxyFile);
      const src = await readFileSafe(absPath);
      if (src) {
        const code = extractPatternContext(src, matchPattern, contextLines);
        if (code) {
          codeBlock = { label: ms.title, lang: "galaxy", code };
        } else {
          console.warn(`  WARNING: pattern not found in ${galaxyFile}: ${matchPattern}`);
        }
      } else {
        console.warn(`  WARNING: mechanic source file not found: ${galaxyFile}`);
      }
    }
    mechanics.push({ title: ms.title, body: ms.body, codeBlock });
  }

  const seen = new Set<string>();
  const uniqueXmlFiles = xmlFiles.filter(f => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });

  return {
    slug: cfg.slug,
    name: cfg.name,
    franchise: cfg.franchise,
    summary: cfg.summary,
    mechanics,
    timers,
    codeBlocks,
    summons,
    xmlFiles: uniqueXmlFiles,
  };
}

async function main() {
  console.log("gen-battlegrounds: starting");
  await mkdir(SITE_CONTENT_BATTLEGROUNDS, { recursive: true });
  await mkdir(SITE_DATA_BATTLEGROUNDS, { recursive: true });

  const version = await findLatestVersion(HEROES_DATA_DIR);
  const gsFile = await loadGamestrings<Gamestrings>(version);
  const mapPatches = await loadMapGamestringPatches(version);
  const abilityIndex = buildAbilityIndex(gsFile.items, mapPatches);

  await writeFile(
    path.join(SITE_CONTENT_BATTLEGROUNDS, "_index.md"),
    `+++\ntitle = "Battlegrounds"\ntemplate = "battlegrounds/list.html"\nsort_by = "title"\n+++\n`,
  );

  for (const cfg of BATTLEGROUNDS) {
    const data = await processMap(cfg, abilityIndex);

    await writeFile(
      path.join(SITE_DATA_BATTLEGROUNDS, `${cfg.slug}.json`),
      JSON.stringify(data, null, 2),
    );

    const frontmatter = `+++\ntitle = ${JSON.stringify(cfg.name)}\nslug = ${JSON.stringify(cfg.slug)}\ntemplate = "battlegrounds/single.html"\n\n[extra]\nbattleground_slug = ${JSON.stringify(cfg.slug)}\nfranchise = ${JSON.stringify(cfg.franchise)}\n+++\n`;
    await writeFile(
      path.join(SITE_CONTENT_BATTLEGROUNDS, `${cfg.slug}.md`),
      frontmatter,
    );
  }

  console.log(`gen-battlegrounds: wrote ${BATTLEGROUNDS.length} battlegrounds`);
}

main().catch(console.error);
