interface TimerConfig {
  label: string;
  /** Galaxy header constant name. Omit when using `seconds` directly. */
  galaxyConst?: string;
  /** Hardcoded seconds value used when the galaxy value is not a const. */
  seconds?: number;
  /** Optional annotation shown alongside the timer value. */
  note?: string;
}

export interface SummonVariantConfig {
  unitId: string;
  /** Column header shown for this variant. */
  label: string;
  /** stormmod dirs relative to battlegroundmapmods/ that contain this unit. */
  modPaths?: string[];
  /** XML path relative to GAMEDATA_DIR root; overrides the mod path lookup. */
  unitXmlRelPath?: string;
}

interface SummonConfig {
  /** Card title shown above the variant columns. */
  label: string;
  /** stormmod dirs used as defaults for variants that do not override. */
  modPaths?: string[];
  /** Variants to render side-by-side. */
  variants: SummonVariantConfig[];
}

interface MechanicCodeBlockSpec {
  /** Path relative to GAMEDATA_DIR root. */
  galaxyFile: string;
  /** Substring to search for. Matching lines plus context are extracted. */
  matchPattern: string;
  contextLines?: number;
}

interface MechanicSpec {
  title: string;
  body: string;
  codeBlockSpec?: MechanicCodeBlockSpec;
}

export interface BattlegroundConfig {
  slug: string;
  name: string;
  franchise: string;
  /** Short overview shown at the top of the page. */
  summary: string[];
  /** .stormmod dirs relative to battlegroundmapmods/ to scan. */
  modPaths: string[];
  timers: TimerConfig[];
  summons: SummonConfig[];
  mechanics: MechanicSpec[];
}

const BOE = "heroesmapmods/battlegroundmapmods/battlefieldofeternity.stormmod/base.stormdata/libmlbd.galaxy";
const BBAY = "heroesmapmods/battlegroundmapmods/blackheartsbay.stormmod/base.stormdata/libbbay.galaxy";
const MAPM = "heroesdata.stormmod/base.stormdata/triggerlibs/mapmechanicslib.galaxy";
const GRDN = "heroesmapmods/battlegroundmapmods/gardenofterror.stormmod/base.stormdata/libgrdn.galaxy";
const MHTM = "heroesmapmods/battlegroundmapmods/hauntedmines.stormmod/base.stormdata/libmhtm.galaxy";
const MSHE = "heroesmapmods/battlegroundmapmods/infernalshrines.stormmod/base.stormdata/libmshe.galaxy";
const MLCP = "heroesmapmods/battlegroundmapmods/skytemple.stormmod/base.stormdata/libmlcp.galaxy";
const MSOC = "heroesmapmods/battlegroundmapmods/tombofthespiderqueen.stormmod/base.stormdata/libmsoc.galaxy";
const MSOC_H = "heroesmapmods/battlegroundmapmods/tombofthespiderqueen.stormmod/base.stormdata/libmsoc_h.galaxy";
const MTOD = "heroesmapmods/battlegroundmapmods/towersofdoom.stormmod/base.stormdata/libmtod.galaxy";
const VLSK = "heroesmapmods/battlegroundmapmods/volskayamechanics.stormmod/base.stormdata/libvlsk.galaxy";
const MSC2 = "heroesmapmods/battlegroundmapmods/warheadjunction.stormmod/base.stormdata/libmsc2.galaxy";
const MMAP = "heroesmapmods/battlegroundmapmods/alteracpass.stormmod/base.stormdata/libmmap.galaxy";
const MHMU = "heroesmapmods/battlegroundmapmods/hanamura.stormmod/base.stormdata/libmhmu.galaxy";
const NPLD = "heroesmapmods/battlegroundmapmods/hanamura.stormmod/base.stormdata/libnpld.galaxy";

export const BATTLEGROUNDS: BattlegroundConfig[] = [
  {
    slug: "battlefield-of-eternity",
    name: "Battlefield of Eternity",
    franchise: "Diablo",
    summary: [
      "An Angelic and Demonic Immortal spawn in the center arena and fight each other.",
      "Heroes damage the enemy Immortal while defending their own. Immortals use Cleave and Explosions, telegraphed by ground indicators.",
      "The winning Immortal gains a Shield equal to its remaining Health and pushes whichever enemy lane has the least Structure damage.",
      "A new duel begins 105 seconds later.",
    ],
    modPaths: ["battlefieldofeternity.stormmod", "heavenhell.stormmod"],
    timers: [
      { label: "First Immortal Spawn", galaxyConst: "libMLBD_gv_mMBossDuelInitialDelay_C" },
      { label: "Immortal Respawn", galaxyConst: "libMLBD_gv_mMBossDuelEventCooldown_C" },
      { label: "Spawn Warning", galaxyConst: "libMLBD_gv_mMBossDuelWarningDelayLong_C" },
    ],
    summons: [
      {
        label: "Immortal (Heaven)",
        modPaths: ["battlefieldofeternity.stormmod"],
        variants: [
          { unitId: "BossDuelLanerHeaven", label: "Laner" },
          { unitId: "BossDuelBossHeaven", label: "Objective" },
        ],
      },
      {
        label: "Immortal (Hell)",
        modPaths: ["battlefieldofeternity.stormmod"],
        variants: [
          { unitId: "BossDuelLanerHell", label: "Laner" },
          { unitId: "BossDuelBossHell", label: "Objective" },
        ],
      },
    ],
    mechanics: [
      {
        title: "The Duel",
        body: "An Angelic and a Demonic Immortal spawn in the center arena and fight each other. Heroes can damage the opposing Immortal while protecting their allied one. During the duel, Immortals use Cleave and Explosions, both telegraphed by ground indicators. The first Immortal reduced to 0 Health loses; the survivor wins.",
        codeBlockSpec: {
          galaxyFile: BOE,
          matchPattern: "libMLBD_gv_mMBOEEventWinningTeam = libGame_gf_TeamNumberOfPlayer(UnitGetOwner(lv_winningUnit))",
          contextLines: 10,
        },
      },
      {
        title: "HP → Lane-Push Shield",
        body: "The winning Immortal gains a Shield equal to its remaining Health during the Objective phase, then flies to the enemy lane that has taken the least Structure damage.",
        codeBlockSpec: {
          galaxyFile: BOE,
          matchPattern: "int libMLBD_gf_MMBOEBossPushingLane",
          contextLines: 12,
        },
      },
    ],
  },
  {
    slug: "blackhearts-bay",
    name: "Blackheart's Bay",
    franchise: "Nexus",
    summary: [
      "Collect doubloons from treasure chests, mercenary camps, and slain enemy heroes.",
      "Deliver enough doubloons to Blackheart's ghost ship and he bombards enemy structures with cannon fire.",
      "The delivery cost starts at 8 doubloons and rises by 2 after each bombardment.",
      "Slain heroes drop half their carried doubloons (rounded down) on the ground for anyone to pick up.",
    ],
    modPaths: ["blackheartsbay.stormmod"],
    timers: [
      { label: "First Chest Spawn", galaxyConst: "libBBAY_gv_mMBBCannonballsTreasureChestFirstTimerDur_C" },
      { label: "Chest Respawn", galaxyConst: "libBBAY_gv_mMBBCannonballsTreasureChestTimerMid_C2" },
    ],
    summons: [],
    mechanics: [
      {
        title: "Doubloon Collection",
        body: "Treasure chests drop 5 doubloons each, mercenary camps drop 2, and slain enemy heroes drop half of whatever they were carrying (rounded down) on the ground for anyone to pick up.",
        codeBlockSpec: {
          galaxyFile: BBAY,
          matchPattern: "libBBAY_gv_mMBBDoubloonsDropped[lv_player] += (lv_count / 2)",
          contextLines: 8,
        },
      },
      {
        title: "Turn-In & Escalating Cost",
        body: "Delivering enough doubloons triggers a cannon bombardment. The cost starts at 8 and goes up by 2 after each delivery by that team, so the second turn-in costs 10, the third costs 12, and so on.",
        codeBlockSpec: {
          galaxyFile: BBAY,
          matchPattern: "libBBAY_gv_mMBBCannonballsBallsSubmitMaxCurrent[lp_team] += libBBAY_gv_mMBBCannonballsBallsSubmitMaxInc_C",
          contextLines: 8,
        },
      },
      {
        title: "Cannon Target Selection",
        body: "The ship fires 12 cannonballs at enemy Structures. Forts are hit before Keeps, and the Core only becomes a target once the other eligible Structures are gone.",
        codeBlockSpec: {
          galaxyFile: BBAY,
          matchPattern: "DistanceBetweenPoints(UnitGetPosition(lv_itBuilding), UnitGetPosition(lv_townHall)) > 10.0",
          contextLines: 10,
        },
      },
    ],
  },
  {
    slug: "cursed-hollow",
    name: "Cursed Hollow",
    franchise: "Warcraft",
    summary: [
      "Collect Tributes offered by the Raven Lord. Only one is up at a time.",
      "Collecting 3 Tributes curses the enemy team for 70 seconds. Their Towers, Forts, and Keeps stop attacking, and their lane minions are reduced to 1 Health.",
      "Once a Tribute is collected, the next one spawns 50-90 seconds later.",
      "After a Curse ends, the next Tribute takes longer to appear: 2:00-2:40.",
    ],
    modPaths: ["cursedhollow.stormmod"],
    timers: [
      { label: "First Tribute Spawn", seconds: 180, note: "warning appears 30s earlier" },
      { label: "Tribute Respawn", galaxyConst: "libMapM_gv_mMRavenTributeSpawnTime_C", note: "±20s random variance" },
      { label: "Post-Curse Tribute", seconds: 120, note: "2:00-2:40 after curse ends" },
      { label: "Curse Duration", galaxyConst: "libMapM_gv_mMRavenCurseDuration_C" },
      { label: "Tribute Warning", galaxyConst: "libMapM_gv_mMRavenSpawnWarningTimerTime_C" },
    ],
    summons: [],
    mechanics: [
      {
        title: "Tribute Respawn Variance",
        body: "Tribute spawn timing is randomized. Once a Tribute is collected, the next one shows up 50-90 seconds later. After a Curse ends, the next one takes 2:00-2:40 to appear.",
        codeBlockSpec: {
          galaxyFile: MAPM,
          matchPattern: "mMRavenTributeSpawnTimeVariance * -1",
          contextLines: 8,
        },
      },
      {
        title: "The Curse",
        body: "Three Tributes curse the enemy team for 70 seconds. While cursed, their Towers, Forts, and Keeps stop attacking, and their lane minions drop to 1 Health.",
        codeBlockSpec: {
          galaxyFile: MAPM,
          matchPattern: "UnitBehaviorAdd(lv_structureUnit, \"RavenLordsCurseStructures\"",
          contextLines: 12,
        },
      },
    ],
  },
  {
    slug: "garden-of-terror",
    name: "Garden of Terror",
    franchise: "Nexus",
    summary: [
      "When the objective activates, one Seed appears somewhere on the map.",
      "The first team to collect 3 Seeds summons three Garden Terrors, one per lane, that push at the same time.",
      "Shamblers guard each Seed. Kill or distract them, then channel the Seed.",
      "After a Seed is captured, the next one spawns 50-80 seconds later. After all Garden Terrors die, it's 90-120 seconds.",
    ],
    modPaths: ["gardenofterror.stormmod", "gardenofterrordata.stormmod"],
    timers: [
      { label: "Laning Phase", galaxyConst: "libGRDN_gv_laningTimeAtGameStart_C", note: "warning fires at this time; seeds appear 0:30 later" },
      { label: "Objective Warning Lead", galaxyConst: "libGRDN_gv_seedSpawnTime_C", note: "time between warning and seed spawn" },
    ],
    summons: [
      {
        label: "Garden Terror",
        variants: [
          {
            unitId: "VehiclePlantHorror",
            label: "Garden Terror",
            unitXmlRelPath: "heroesmapmods/battlegroundmapmods/gardenofterrordata.stormmod/base.stormdata/gamedata/horrordata.xml",
          },
        ],
      },
    ],
    mechanics: [
      {
        title: "Collecting Seeds",
        body: "The first objective activates at 2:30, after a 30-second warning. One Seed is up at a time and appears somewhere on the map. Shamblers guard the Seed; kill or distract them, then a Hero channels for 6 seconds to collect it. The first team to 3 Seeds wins the round and summons three Garden Terrors, one per lane.",
        codeBlockSpec: {
          galaxyFile: GRDN,
          matchPattern: "libGRDN_gv_seedsCollected[lv_team] >= libGRDN_gv_seedsNeeded_C",
          contextLines: 10,
        },
      },
      {
        title: "Seed Respawn Delay",
        body: "After a Seed is captured, the next one spawns 50-80 seconds later (randomized). After all Garden Terrors die, the delay is 90-120 seconds instead.",
        codeBlockSpec: {
          galaxyFile: GRDN,
          matchPattern: "fixed libGRDN_gf_RandomCursedPacingSeedSpawnDelay",
          contextLines: 10,
        },
      },
      {
        title: "Garden Terror Lane Assignment",
        body: "The winning team gets three Garden Terrors, one per lane. They burrow to the front of each lane and push.",
        codeBlockSpec: {
          galaxyFile: GRDN,
          matchPattern: "void libGRDN_gf_SpawnGardenTerrors",
          contextLines: 12,
        },
      },
    ],
  },
  {
    slug: "haunted-mines",
    name: "Haunted Mines",
    franchise: "Nexus",
    summary: [
      "Underground mines open periodically. Both teams descend to fight undead monsters and collect Cursed Skulls.",
      "Risen Miners drop 2 Cursed Skulls each; the underground Grave Golem drops up to 38 skulls across its HP thresholds.",
      "Each team is capped at 55 Cursed Skulls; the mine phase ends when either team reaches that cap.",
      "Both teams spawn a Grave Golem, whose strength scales with the number of skulls collected by its team.",
      "Later mine events begin after both lane Golems have died.",
    ],
    modPaths: ["hauntedmines.stormmod"],
    timers: [
      { label: "First Mine Warning", galaxyConst: "libMHtM_gv_mMUnderworldStartTime_C" },
      { label: "Mine Cooldown", galaxyConst: "libMHtM_gv_mMUnderworldEventCooldown_C" },
      { label: "Prep Phase", galaxyConst: "libMHtM_gv_mMUnderworldPrepDuration_C" },
      { label: "Golem Summon Delay", galaxyConst: "libMHtM_gv_mMUnderworldSummonedBossDuration_C" },
    ],
    summons: [],
    mechanics: [
      {
        title: "Skull Collection",
        body: "Heroes collect Cursed Skulls in the underground mine. Risen Miners drop 2 Cursed Skulls each; the underground Grave Golem drops skulls progressively at 75%, 50%, and 25% Health, then drops the rest on death. Each team is capped at 55 Cursed Skulls, and the mine phase ends as soon as either team reaches that cap.",
        codeBlockSpec: {
          galaxyFile: MHTM,
          matchPattern: "libMHtM_gv_mMUnderworldSkullCollected",
          contextLines: 8,
        },
      },
      {
        title: "Golem Power Scaling",
        body: "Each team's Grave Golem scales with the number of Cursed Skulls that team collected.",
        codeBlockSpec: {
          galaxyFile: MHTM,
          matchPattern: "-0.0054",
          contextLines: 10,
        },
      },
    ],
  },
  {
    slug: "infernal-shrines",
    name: "Infernal Shrines",
    franchise: "Diablo",
    summary: [
      "One of three Shrine locations activates each round; the next Shrine is almost always in a different location from the previous one.",
      "Both teams race to kill 40 Guardians at the active Shrine. First to 40 captures it.",
      "Capturing a Shrine summons an Arcane, Frozen, or Mortar Punisher that pushes the lane closest to that Shrine.",
      "The Punisher type changes every round and cannot repeat back-to-back.",
    ],
    modPaths: ["infernalshrines.stormmod", "infernalshrinesdata.stormmod"],
    timers: [
      { label: "First Shrine Activation", seconds: 180, note: "after a 30s warning" },
      { label: "Shrine Duration", galaxyConst: "libMSHE_gv_mMDiabloShrinesShrineTimerDuration_C" },
      { label: "Shrine Warning", galaxyConst: "libMSHE_gv_mMDiabloShrineWarningTimerLong_C" },
    ],
    summons: [
      {
        label: "Punisher",
        modPaths: ["infernalshrinesdata.stormmod"],
        variants: [{ unitId: "MercPunisherLaner", label: "Punisher" }],
      },
    ],
    mechanics: [
      {
        title: "Shrine Randomisation",
        body: "Each round, one of three Shrine locations becomes active. The next Shrine is almost always in a different spot than the previous one, though same-location repeats can happen rarely. The Punisher type (Arcane, Frozen, or Mortar) never repeats back-to-back.",
        codeBlockSpec: {
          galaxyFile: MSHE,
          matchPattern: "libMSHE_gv_mMISLastShrine",
          contextLines: 12,
        },
      },
      {
        title: "40 Guardians → Punisher",
        body: "Both teams race to kill 40 Guardians, also described as Skeletal Defenders, spawned by the active Shrine. The first team to 40 kills captures it and summons a Punisher.",
        codeBlockSpec: {
          galaxyFile: MSHE,
          matchPattern: "libMSHE_gv_mMDiabloShrineCursedEventTotal_C",
          contextLines: 10,
        },
      },
      {
        title: "Punisher Lane Selection",
        body: "Capturing a Shrine summons a Punisher that pushes the lane closest to that Shrine. Punishers focus on attacking enemy Heroes, but their leap can target enemy Gates as well as Heroes.",
        codeBlockSpec: {
          galaxyFile: MSHE,
          matchPattern: "libMSHE_gv_mMDiabloShrinesPunisherPushLane = AILaneWaypointGetClosestLane",
          contextLines: 8,
        },
      },
    ],
  },
  {
    slug: "sky-temple",
    name: "Sky Temple",
    franchise: "StarCraft",
    summary: [
      "Temples activate in a fixed sequence. Depending on the round, 1 or 2 are active at once.",
      "A controlled Temple fires at enemy Structures while held. After 40 shots, the final 5 fire automatically for the team holding it.",
      "Temple shots hit the closest eligible enemy Structure. Fort-side outer Structures go first, then Keep-side inner ones; the Core only becomes a target after the rest are gone.",
      "Once all active Temples are spent, the next Temple phase starts after a 2-minute cooldown, with a 30-second warning.",
    ],
    modPaths: ["skytemple.stormmod", "skytempledata.stormmod"],
    timers: [
      { label: "First Temple", galaxyConst: "libMLCP_gv_mMSkyTempleFirstTempleStartTime_C" },
      { label: "Temple Firing Stage", galaxyConst: "libMLCP_gv_mMSkyTempleTempleStageDuration_C" },
      { label: "Temple Phase Cooldown", galaxyConst: "libMLCP_gv_mMSkyTempleTempleCooldown_C" },
      { label: "Temple Warning", galaxyConst: "libMLCP_gv_mMSkyTempleTempleBlessWarningTimeLong_C" },
    ],
    summons: [],
    mechanics: [
      {
        title: "Temple Capture",
        body: "Stand within a Temple's capture point to take control. An uncontested Temple fires at enemy Structures; if it's contested or abandoned, it stops firing. After 40 normal shots, the last 5 fire automatically in rapid succession for the team holding it.",
        codeBlockSpec: {
          galaxyFile: MLCP,
          matchPattern: "libGame_gf_CapturePointCreate(UnitLastCreated(), libMLCP_gv_mMSkyTempleTempleCaptureRadius_C",
          contextLines: 8,
        },
      },
      {
        title: "Cannon Target Selection",
        body: "Temple shots hit the closest eligible enemy Structure. Fort-side outer Structures are targeted first, then Keep-side inner ones. The Core is only targeted after everything else is destroyed.",
        codeBlockSpec: {
          galaxyFile: MLCP,
          matchPattern: "lv_townOuterLoop, UnitGetPosition(libMLCP_gv_mMSkyTemples",
          contextLines: 10,
        },
      },
    ],
  },
  {
    slug: "tomb-of-the-spider-queen",
    name: "Tomb of the Spider Queen",
    franchise: "Diablo",
    summary: [
      "Collect Spider Gems dropped by enemy spider minions and Heroes, then turn them in at the Spider Queen's Altars.",
      "Hitting the gem threshold summons three Webweavers, one per lane.",
      "The threshold starts at 50 Gems, goes up by 5 per activation, and caps at 80.",
      "Webweavers spawn 15 seconds after turn-in. They lose Health over time, use Death Wave, and summon Cryptcrawlers.",
    ],
    modPaths: ["tombofthespiderqueen.stormmod"],
    timers: [
      { label: "First Altar Activation", galaxyConst: "libMSOC_gv_mMTombSpiderQueenTreasureChestEventDelay_C" },
      { label: "Altar Reactivation", galaxyConst: "libMSOC_gv_mMTombSpiderQueenPostAuraWaitTime_C", note: "after all Webweavers die" },
      { label: "Webweaver Summon Delay", galaxyConst: "libMSOC_gv_mMTombSpiderQueenSoulEaterSummonTime" },
    ],
    summons: [
      {
        label: "Webweaver",
        modPaths: ["tombofthespiderqueen.stormmod"],
        variants: [{ unitId: "SoulEater", label: "Webweaver" }],
      },
      {
        label: "Cryptcrawler",
        modPaths: ["tombofthespiderqueen.stormmod"],
        variants: [{ unitId: "SoulEaterMinion", label: "Cryptcrawler" }],
      },
    ],
    mechanics: [
      {
        title: "Gem Turn-In and Escalating Cost",
        body: "Each team has its own Gem counter. Heroes turn in Gems at the Spider Queen's Altars. The threshold starts at 50 Gems, goes up by 5 after each Webweaver wave, and caps at 80.",
        codeBlockSpec: {
          galaxyFile: MSOC_H,
          matchPattern: "libMSOC_gv_mMTombSpiderQueenActivationAmountStart_C = 50",
          contextLines: 8,
        },
      },
      {
        title: "Webweaver Wave",
        body: "When a team turns in enough Gems, three Webweavers spawn 15 seconds later, one per lane. They lose Health over time, use Death Wave, and periodically summon Cryptcrawlers.",
        codeBlockSpec: {
          galaxyFile: MSOC,
          matchPattern: "libNtve_gf_CreateUnitsWithDefaultFacing(1, \"SoulEater\", c_unitCreateIgnorePlacement",
          contextLines: 10,
        },
      },
    ],
  },
  {
    slug: "towers-of-doom",
    name: "Towers of Doom",
    franchise: "Warcraft",
    summary: [
      "Neither team can directly attack the enemy Core. Core damage comes from Altars, Sappers, the Headless Horseman, and 6-cap Bell Tower bombardment.",
      "Capturing an Altar deals 1 Core damage, plus 1 more for each Bell Tower your team holds.",
      "Bell Towers start as Forts and become Keeps when the Waygates/Tunnels open, usually at 12:00.",
      "The central Headless Horseman boss camp, when captured, deals 4 damage to the enemy Core.",
    ],
    modPaths: ["towersofdoom.stormmod"],
    timers: [
      { label: "First Altars", galaxyConst: "libMTOD_gv_mMToDScoringEventDelay_C" },
      { label: "Altar Respawn", galaxyConst: "libMTOD_gv_mMToDAltarRespawnDelay_C" },
      { label: "Altar Warning", galaxyConst: "libMTOD_gv_mMToDScoringAltarWarningTime_C" },
      { label: "Phase 2 Activates", galaxyConst: "libMTOD_gv_mMToDPhaseTwoDelay_C" },
    ],
    summons: [],
    mechanics: [
      {
        title: "Altar Captures Deal Core Damage",
        body: "Neither team can directly attack the enemy Core. Capturing an Altar deals 1 Core damage, plus 1 more for each Bell Tower your team holds. Sappers, the Headless Horseman, and 6-cap Bell Tower bombardment can also damage the Core.",
        codeBlockSpec: {
          galaxyFile: MTOD,
          matchPattern: "void libMTOD_gf_MMToDAltarFireCannons",
          contextLines: 14,
        },
      },
      {
        title: "Waygates and Headless Horseman",
        body: "Bell Towers start as Forts and become Keeps when the Waygates/Tunnels open, usually at 12:00. If Altars are active then, opening is delayed until after that objective phase ends. The central Headless Horseman boss camp, when captured, deals 4 damage to the enemy Core.",
        codeBlockSpec: {
          galaxyFile: MTOD,
          matchPattern: "void libMTOD_gf_MMToDBossCampFireCannons",
          contextLines: 10,
        },
      },
    ],
  },
  {
    slug: "volskaya-foundry",
    name: "Volskaya Foundry",
    franchise: "Overwatch",
    summary: [
      "Contest a Capture Point that rotates between three locations to earn the Triglav Protector.",
      "The Triglav Protector is a two-person mech: one Hero pilots, another mans the weapons.",
      "The Triglav Protector has a fixed 150-second timed life once awarded.",
      "The first point activates at 3:00 after a 30-second warning; later points activate 3:00 after the Protector is destroyed.",
    ],
    modPaths: ["volskayamechanics.stormmod", "volskayadata.stormmod"],
    timers: [
      { label: "First Capture Point Cooldown", galaxyConst: "libVLSK_gv_mechanicInitialSpawnTimerDuration_C" },
      { label: "Capture Point Cooldown", galaxyConst: "libVLSK_gv_cooldownTimerDuration_C" },
      { label: "Capture Warning", galaxyConst: "libVLSK_gv_warningTimerDuration" },
      { label: "Protector Timed Life", seconds: 150 },
    ],
    summons: [
      {
        label: "Triglav Protector",
        variants: [
          {
            unitId: "VolskayaVehicle",
            label: "Pilot",
            unitXmlRelPath: "heroesdata.stormmod/base.stormdata/gamedata/maps/protectors.xml",
          },
          {
            unitId: "VolskayaVehicleGunner",
            label: "Gunner",
            unitXmlRelPath: "heroesdata.stormmod/base.stormdata/gamedata/maps/protectors.xml",
          },
        ],
      },
    ],
    mechanics: [
      {
        title: "Capture Point",
        body: "A team must take control of the Capture Point and hold it until capture progress reaches 100% to earn the Triglav Protector. Control progress can decay while the point is empty or being flipped, but capture progress toward 100% does not decay. Enemy Heroes contesting at 99% force overtime and delay the reward.",
        codeBlockSpec: {
          galaxyFile: VLSK,
          matchPattern: "libVLSK_gv_capturePointContestTimeGoal_C = 3.0",
          contextLines: 8,
        },
      },
      {
        title: "Pilot & Gunner Roles",
        body: "The first player to enter the Triglav Protector becomes the pilot, the second becomes the gunner. Players can leave and another Hero can take an open seat, but the pilot and gunner roles can no longer be swapped via a Swap ability.",
        codeBlockSpec: {
          galaxyFile: VLSK,
          matchPattern: "UnitGetType(libGame_gf_UseVehicleVehicleUnit()) == \"VolskayaVehicle\"",
          contextLines: 10,
        },
      },
      {
        title: "Fixed Protector Duration",
        body: "The Triglav Protector's timed life is fixed at 150 seconds. It does not scale up with game time.",
        codeBlockSpec: {
          galaxyFile: VLSK,
          matchPattern: "UnitBehaviorDuration(EventUnit(), \"VehicleDragonTimedLife\")",
          contextLines: 8,
        },
      },
    ],
  },
  {
    slug: "warhead-junction",
    name: "Warhead Junction",
    franchise: "StarCraft",
    summary: [
      "Nuclear warheads spawn across the map. Picking one up takes a 5-second channel.",
      "After pickup, the Nuke is locked out briefly. If a Hero gets crowd-controlled mid-launch, the Nuke goes on a 10-second cooldown.",
      "Warheads deal 1750 base damage to enemy non-Heroes, plus 70 per minute of game time. Enemy Heroes take 30% of their max Health instead.",
      "The Core periodically launches its own Nuke at nearby enemy Heroes. The Slime Boss is a separate Mercenary Camp.",
    ],
    modPaths: ["warheadjunction.stormmod", "warheadjunctiondata.stormmod"],
    timers: [
      { label: "First Warheads", galaxyConst: "libMSC2_gv_mMSC2FirstEventDelay_C" },
      { label: "Pickup Channel", galaxyConst: "libMSC2_gv_mMSC2NukeArmingDuration_C" },
      { label: "Warhead Warning", galaxyConst: "libMSC2_gv_mMSC2EventWarningDelayGasCanister_C" },
      { label: "Dropped Warhead Expiration", galaxyConst: "libMSC2_gv_mMSC2NukeExpireDuration_C" },
      { label: "Interrupted Nuke Cooldown", galaxyConst: "libMSC2_gv_mMSC2NukeInterruptDelay_C" },
      { label: "Damage Scaling Interval", galaxyConst: "libMSC2_gv_mMSC2NukeDamageScalingDelay_C" },
    ],
    summons: [],
    mechanics: [
      {
        title: "Arming & Interruption",
        body: "Picking up a Warhead takes a 5-second channel. After pickup, the Nuke is locked out for 5 seconds. If a Hero gets crowd-controlled mid-launch, the Nuke goes on a 10-second cooldown.",
        codeBlockSpec: {
          galaxyFile: MSC2,
          matchPattern: "NukeCCedCooldownModifyUnit",
          contextLines: 10,
        },
      },
      {
        title: "Damage & Scaling",
        body: "Warheads deal 1750 base damage to enemy non-Heroes, with 70 added per minute of game time at pickup. Enemy Heroes hit by the impact take 30% of their max Health instead. The Core periodically launches its own Nuke at nearby enemy Heroes. The Slime Boss is a separate Mercenary Camp and does not launch Core nukes.",
        codeBlockSpec: {
          galaxyFile: MSC2,
          matchPattern: "NukeDamageScalingOnPickup",
          contextLines: 10,
        },
      },
    ],
  },
  {
    slug: "alterac-pass",
    name: "Alterac Pass",
    franchise: "Warcraft",
    summary: [
      "Capture the enemy Prison Camp to free your Cavalry.",
      "Heroes channel an enemy Prison Camp for 3 seconds to start the breakout, then defend it until the capture timer completes.",
      "The breakout timer starts at 25 seconds and goes up by 10 each objective phase, up to 55 seconds.",
      "The first team to finish its breakout summons one Cavalry unit per lane.",
      "Enemy Heroes can stop the breakout by channeling the Prison Camp; Guards can also retake it for their team.",
    ],
    modPaths: ["alteracpass.stormmod"],
    timers: [
      { label: "Capture Time (Round 1)", galaxyConst: "libMMAP_gv_captureFlagVictoryTimeGoalStart_C" },
      { label: "Capture Time Increment", galaxyConst: "libMMAP_gv_captureFlagVictoryTimeGoalTimeIncrement_C" },
      { label: "Capture Time (Max)", galaxyConst: "libMMAP_gv_captureFlagVictoryTimeGoalMax_C" },
      { label: "Hero Channel", galaxyConst: "libMMAP_gv_heroTimeToCap_C" },
      { label: "Guard Retake Channel", galaxyConst: "libMMAP_gv_minionTimeToCap_C" },
      { label: "Defender Respawn", galaxyConst: "libMMAP_gv_defenderRespawnTime_C" },
    ],
    summons: [
      {
        label: "Cavalry",
        variants: [
          {
            unitId: "AllianceCavalry",
            label: "Alliance",
            unitXmlRelPath: "heroesmapmods/battlegroundmapmods/alteracpass.stormmod/base.stormdata/gamedata/cavalry.xml",
          },
          {
            unitId: "HordeCavalry",
            label: "Horde",
            unitXmlRelPath: "heroesmapmods/battlegroundmapmods/alteracpass.stormmod/base.stormdata/gamedata/cavalry.xml",
          },
        ],
      },
    ],
    mechanics: [
      {
        title: "Capturing the Prison Camp",
        body: "Heroes channel an enemy Prison Camp for 3 seconds to start the breakout, then defend it until the capture timer completes. Enemy Heroes can stop the breakout by channeling the Prison Camp; Guards retake the camp for their team with a longer 10-second channel.",
        codeBlockSpec: {
          galaxyFile: MMAP,
          matchPattern: "lv_victoryProgress -= libMMAP_gv_captureFlagCheckPeriod_C",
          contextLines: 10,
        },
      },
      {
        title: "Escalating Capture Time",
        body: "The Prison Camp timer starts at 25 seconds, goes up by 10 after each objective phase, and caps at 55.",
        codeBlockSpec: {
          galaxyFile: MMAP,
          matchPattern: "captureFlagVictoryTimeGoal < libMMAP_gv_captureFlagVictoryTimeGoalMax_C",
          contextLines: 8,
        },
      },
      {
        title: "Cavalry Reinforcements",
        body: "The winning team gets one Cavalry unit per lane (3 total). Cavalry push all lanes at the same time, attack enemies and Structures, give nearby allied Heroes +10% damage and +30% Movement Speed, and speed up nearby allied Minions.",
        codeBlockSpec: {
          galaxyFile: MMAP,
          matchPattern: "libMMAP_gv_aVMechanics[lp_team].lv_cavalryUnitType",
          contextLines: 10,
        },
      },
    ],
  },
  {
    slug: "dragon-shire",
    name: "Dragon Shire",
    franchise: "Nexus",
    summary: [
      "Hold both the Sun Shrine (top) and the Moon Shrine (bottom) at the same time to unlock the Dragon Altar.",
      "Channel the Dragon Altar for 3 seconds to claim the Dragon Knight. Moving, taking damage, or losing a Shrine mid-channel breaks the attempt.",
      "Once claimed, the Dragon Knight lasts until destroyed or until its timer runs out.",
      "Its duration is 55 seconds plus 2 seconds per full game-minute elapsed.",
    ],
    modPaths: ["dragonshire.stormmod"],
    timers: [
      { label: "Shrine Activation Warning", galaxyConst: "libMapM_gv_mMGardensDragonWarningTime_C" },
      { label: "Shrines Activate", galaxyConst: "libMapM_gv_mMGardensDragonDragonTowerStartTime_C" },
      { label: "Shrine Respawn", galaxyConst: "libMapM_gv_mMGardensDragonDragonTowerRespawnTime_C" },
      { label: "Dragon Knight Duration", galaxyConst: "libMapM_gv_mMGardensDragonDragonKnightStartingTime_C" },
    ],
    summons: [
      {
        label: "Dragon Knight",
        variants: [
          {
            unitId: "VehicleDragon",
            label: "Dragon Knight",
            unitXmlRelPath: "heroesdata.stormmod/base.stormdata/gamedata/unitdata.xml",
          },
        ],
      },
    ],
    mechanics: [
      {
        title: "Holding Both Shrines",
        body: "A team can only channel the Dragon Altar while it holds both the Sun Shrine and the Moon Shrine. Enemy Heroes can retake a Shrine before the 3-second channel finishes to lock the Altar again.",
        codeBlockSpec: {
          galaxyFile: MAPM,
          matchPattern: "lv_chaosTowersOwned == libMapM_gv_mMGardensDragonDragonTowerObeliskCount_C",
          contextLines: 10,
        },
      },
      {
        title: "Dragon Knight Duration Scales With Game Time",
        body: "The Dragon Knight's duration is not fixed. Once claimed, it lasts 55 seconds plus 2 more for each full game-minute elapsed, unless destroyed first.",
        codeBlockSpec: {
          galaxyFile: MAPM,
          matchPattern: "IntToFixed((FixedToInt(libMapM_gv_mMGardensDragonDragonKnightStartingTime_C)+2*FixedToInt(TimerGetElapsed(libGame_gv_gameTimer))/60))",
          contextLines: 8,
        },
      },
    ],
  },
  {
    slug: "hanamura-temple",
    name: "Hanamura Temple",
    franchise: "Overwatch",
    summary: [
      "A single neutral payload spawns in the center. Both teams contest control and escort it toward their own destination.",
      "Up to three allied Heroes near the payload speed it up. Enemy Heroes can contest and halt it.",
      "Each team has its own three-path route, and route progress is tracked independently per team.",
      "On delivery, the payload fires 12 shots at enemy Structures. The Core is only targeted once everything else eligible is gone.",
    ],
    modPaths: ["hanamura.stormmod", "hanamuradata.stormmod"],
    timers: [
      { label: "Payload Cooldown", galaxyConst: "libMHmu_gv_mapMechanic_CooldownTimer_Duration" },
    ],
    summons: [],
    mechanics: [
      {
        title: "Payload Escort",
        body: "Up to three allied Heroes standing near the payload move it forward, with speed scaling by Hero count. A fourth Hero adds nothing. If enemy Heroes are also near the payload it becomes contested, and movement stops until one side clears out.",
        codeBlockSpec: {
          galaxyFile: NPLD,
          matchPattern: "Payload_AllyMonitor_1",
          contextLines: 12,
        },
      },
      {
        title: "Contested Stall",
        body: "When both teams have Heroes near the payload, it becomes contested. While contested, the payload stops moving and neither team makes progress.",
        codeBlockSpec: {
          galaxyFile: NPLD,
          matchPattern: "Payload_ContestedMonitor_Enabled_Func",
          contextLines: 10,
        },
      },
      {
        title: "Delivery: 12-Shot Volley",
        body: "When the payload reaches its destination it fires 12 shots at enemy Structures. Targeting checks the enemy Fort-side town pair first and picks the side with more remaining eligible Structure Health, then does the same for the Keep-side towns. The Core is only targeted once everything else eligible is destroyed.",
        codeBlockSpec: {
          galaxyFile: MHMU,
          matchPattern: "libMHmu_gf_MakePayloadAttack",
          contextLines: 12,
        },
      },
    ],
  },
];
