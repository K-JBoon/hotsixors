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

export interface ObjectiveConfig {
  title: string;
  description: string;
  /** Filename under site/static/images/battlegrounds/objectives/. */
  image: string;
}

export interface BattlegroundConfig {
  slug: string;
  name: string;
  franchise: string;
  /** Official flavor-text description from blizzard.com. */
  description: string;
  /** Official "Map Objectives" cards (image, title, description) from blizzard.com. */
  objectives: ObjectiveConfig[];
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
const VOLV = "heroesmapmods/battlegroundmapmods/volskayadata.stormmod/base.stormdata/libvolv.galaxy";
const MSC2 = "heroesmapmods/battlegroundmapmods/warheadjunction.stormmod/base.stormdata/libmsc2.galaxy";
const MMAP = "heroesmapmods/battlegroundmapmods/alteracpass.stormmod/base.stormdata/libmmap.galaxy";
const MHMU = "heroesmapmods/battlegroundmapmods/hanamura.stormmod/base.stormdata/libmhmu.galaxy";
const NPLD = "heroesmapmods/battlegroundmapmods/hanamura.stormmod/base.stormdata/libnpld.galaxy";
const SCHO = "heroesmapmods/battlegroundmapmods/braxisholdout.stormmod/base.stormdata/libscho.galaxy";

export const BATTLEGROUNDS: BattlegroundConfig[] = [
  {
    slug: "battlefield-of-eternity",
    name: "Battlefield of Eternity",
    franchise: "Diablo",
    description: "Two Immortals are locked in a duel to the death. Help your Immortal prevail, and he’ll devastate your enemy’s forts.",
    objectives: [
      { title: "Battling Immortals", description: "The angel lieutenant Ilarian and the demon lord Beleth are locked in an endless war.", image: "battlefield-of-eternity-1.jpg" },
      { title: "Defeat the Enemy", description: "Aid your immortal ally against his foe to claim victory.", image: "battlefield-of-eternity-2.jpg" },
      { title: "Devastate Forts", description: "Rally to your immortal as he wreaks havoc on the enemy's forts!", image: "battlefield-of-eternity-3.jpg" },
    ],
    summary: [
      "Two Immortals spawn in the middle and fight each other.",
      "Hit the enemy Immortal and keep yours alive. Both Immortals use Cleave and Explosions. Watch the ground markers.",
      "When either Immortal drops to 50% Health, both stop, turn untargetable, and fly to new spots in the arena. The fight starts again a few seconds later.",
      "The winner pushes the enemy lane with the least Structure damage. It gets a Shield based on the % Health it had left in the duel.",
      "The next duel starts 105 seconds after the pushing Immortal dies.",
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
        body: "An Angelic and a Demonic Immortal spawn in the middle and fight each other. Damage the enemy Immortal and protect yours. Both use Cleave and Explosions, and both show a ground marker first. Explosions go for Heroes first, then summons, then minions and mercs, then Structures.\n\nWhen either Immortal drops to 50% Health, both stop, turn invulnerable and untargetable, and fly to a new pair of spots in the arena. The new spots are never the ones they started on. In the first duel of the match they always start north and south, then move east and west.\n\nThe first Immortal to hit 0 Health loses. The winning team gets 2 Regen Globes in the middle, and its Immortal waits 15 seconds before it starts to push.",
        codeBlockSpec: {
          galaxyFile: BOE,
          matchPattern: "libMLBD_gv_mMBOEEventWinningTeam = libGame_gf_TeamNumberOfPlayer(UnitGetOwner(lv_winningUnit))",
          contextLines: 10,
        },
      },
      {
        title: "Leftover Health Becomes a Shield",
        body: "The duel carries over a percentage, not raw Health. The pushing Immortal is a different unit with its own max Health. It spawns with a Shield equal to its max Health times the % Health the winner had left. Its real Health is set to 50, so the Shield is its whole Health pool.",
        codeBlockSpec: {
          galaxyFile: BOE,
          matchPattern: "int libMLBD_gf_MMBOEBossPushingLane",
          contextLines: 12,
        },
      },
      {
        title: "Duel XP",
        body: "The duel is worth 750 XP plus 35 per minute of game time. Winning-team Heroes near the losing Immortal get all of it when it dies. The losing team gets the same total in two parts: Heroes near the winning Immortal get the share of Health it lost in the duel, and the rest comes when they kill the pushing Immortal.",
        codeBlockSpec: {
          galaxyFile: BOE,
          matchPattern: "lv_bossDuelLoserXPBalance = (libMLBD_gv_mMBOEXPValue * (lv_hPPercent / 100.0))",
          contextLines: 4,
        },
      },
    ],
  },
  {
    slug: "blackhearts-bay",
    name: "Blackheart's Bay",
    franchise: "Nexus",
    description: "Collect doubloons and pay the ghost pirate Blackheart to turn his guns on your enemies. If you see a cannonball flying your way… run!",
    objectives: [
      { title: "Collect Doubloons", description: "Attack Treasure Chests and Mercenaries to collect Doubloons.", image: "blackhearts-bay-1.jpg" },
      { title: "Turn in Doubloons", description: "Hand your Doubloons over to Blackheart or you will drop them all when you die!", image: "blackhearts-bay-2.jpg" },
      { title: "Bombard your Enemies", description: "After receiving enough Doubloons from your Team, Blackheart will bombard your Enemy's forts!", image: "blackhearts-bay-3.jpg" },
    ],
    summary: [
      "Get doubloons from chests, skeleton camps, merc camps, and enemy heroes.",
      "Turn in enough at Blackheart's ship and he shoots the enemy's structures.",
      "The first turn-in costs 8 doubloons. Each one after that costs 2 more.",
      "If you die, you drop half your doubloons (rounded down). Anyone can pick them up.",
      "You can turn in part of the cost. Your team keeps what it paid until the next bombardment.",
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
        body: "Chests drop 5 doubloons: some while you hit them, the rest when they break. The big skeleton camp drops 3, small skeleton camps and merc camps drop 2. A dead hero drops half of what they carried (rounded down), and either team can pick it up.",
        codeBlockSpec: {
          galaxyFile: BBAY,
          matchPattern: "libBBAY_gv_mMBBDoubloonsDropped[lv_player] += (lv_count / 2)",
          contextLines: 8,
        },
      },
      {
        title: "Turn-In & Escalating Cost",
        body: "Turn-ins add up. You can pay part of the cost, and your team keeps that progress. You only hand over what your team still needs, so you keep any extra doubloons. When the total hits the cost, the bombardment starts. The ship can't take doubloons while it is firing.\n\nThe cost starts at 8 and goes up by 2 after each of your team's bombardments: 8, 10, 12, and so on.",
        codeBlockSpec: {
          galaxyFile: BBAY,
          matchPattern: "libBBAY_gv_mMBBCannonballsBallsSubmitMaxCurrent[lp_team] += libBBAY_gv_mMBBCannonballsBallsSubmitMaxInc_C",
          contextLines: 8,
        },
      },
      {
        title: "Cannon Target Selection",
        body: "The ship fires 12 cannonballs at enemy Structures. It hits Forts before Keeps. The Core is only a target once nothing else is left to hit.",
        codeBlockSpec: {
          galaxyFile: BBAY,
          matchPattern: "DistanceBetweenPoints(UnitGetPosition(lv_itBuilding), UnitGetPosition(lv_townHall)) > 10.0",
          contextLines: 10,
        },
      },
      {
        title: "Chest Spawns",
        body: "The first round has 1 chest. Rounds 2 to 4 have 2 chests, and every round after that has 3. The next round comes 3:00 after the last chest of the current round breaks. The chest timer pauses while Blackheart is firing.",
        codeBlockSpec: {
          galaxyFile: BBAY,
          matchPattern: "void libBBAY_gf_InitializePatterns ()",
          contextLines: 20,
        },
      },
    ],
  },
  {
    slug: "cursed-hollow",
    name: "Cursed Hollow",
    franchise: "Warcraft",
    description: "It really is a horrible night to have a curse. Gather the Raven Lord’s tribute and make sure it’s the other team and not yours that has to suffer.",
    objectives: [
      { title: "Collect Tributes", description: "The Raven Lord will create Tributes periodically. Gather them for your team!", image: "cursed-hollow-1.jpg" },
      { title: "Curse Your Enemies", description: "Upon capturing three Tributes, the Raven Lord will curse your enemies!", image: "cursed-hollow-2.jpg" },
      { title: "Cursed Forts and Minions", description: "Cursed Forts will not attack, and cursed Minions are reduced to 1 Health.", image: "cursed-hollow-3.jpg" },
    ],
    summary: [
      "The Raven Lord spawns Tributes. Only one is up at a time.",
      "Take 3 Tributes to curse the enemy team for 70 seconds. Their Towers, Forts, and Keeps stop shooting, and their minions drop to 1 Health.",
      "After a Tribute is taken, the next one spawns 50-90 seconds later.",
      "After a Curse ends, the next Tribute takes 2:00-2:40.",
      "Only the cursing team's Tributes reset. The other team keeps its count for the next round.",
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
        title: "Tribute Timing",
        body: "Tribute timers are random. The next Tribute spawns 50-90 seconds after the last one is taken. After a Curse, it takes 2:00-2:40.",
        codeBlockSpec: {
          galaxyFile: MAPM,
          matchPattern: "mMRavenTributeSpawnTimeVariance * -1",
          contextLines: 8,
        },
      },
      {
        title: "Tribute Spawn Location",
        body: "There are 6 Tribute spots in a 2x3 grid: a top and a bottom spot in the Left, Middle, and Right columns. The first Tribute always spawns in the Middle column. After that, a Tribute never spawns on the same spot as the last one. 3 Tributes in a row never all spawn in the same row, and no two Tributes in the same set of 3 share a column.\n\nThe map shows the next Tribute spot 15 seconds after a pickup, or 30 seconds after a Curse ends.",
        codeBlockSpec: {
          galaxyFile: MAPM,
          matchPattern: "point libMapM_gf_MMRavenRandomSpawnPoint ()",
          contextLines: 75,
        },
      },
      {
        title: "The Curse",
        body: "3 Tributes curse the enemy team for 70 seconds. Their Towers, Forts, and Keeps stop attacking, and their lane minions drop to 1 Health. Each Tribute also drops a Regen Globe for the team that took it.\n\nWhen the Curse ends, the team that cursed loses 3 Tributes. The cursed team keeps its count, so a team at 2 only needs 1 more.",
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
    description: "Horror sprouts in the Garden of Terror. Slay the Shamblers, summon Terrors in every lane, and follow your green thumb to victory!",
    objectives: [
      { title: "Seeds Spawn", description: "Queen Nightshade will periodically summon a Seed. Defeat its Shambler Defenders and gather it for your team!", image: "garden-of-terror-1.jpg" },
      { title: "Collect Seeds", description: "Upon gathering three Seeds, Garden Terrors will immediately burrow to each lane.", image: "garden-of-terror-2.jpg" },
      { title: "Garden Terrors", description: "Garden Terrors disable enemy towers and forts, so fight alongside them!", image: "garden-of-terror-3.jpg" },
    ],
    summary: [
      "When the objective starts, one Seed spawns somewhere on the map.",
      "First team to 3 Seeds gets three Garden Terrors, one per lane. They all push at once.",
      "Shamblers guard each Seed. Kill them or pull them away, then channel the Seed.",
      "After a Seed is taken, the next one spawns 50-80 seconds later. After all Terrors die, it takes 90-120 seconds.",
      "Only the winning team's Seeds reset. The other team keeps its count for the next round.",
    ],
    modPaths: ["gardenofterror.stormmod", "gardenofterrordata.stormmod"],
    timers: [
      { label: "Laning Phase", galaxyConst: "libGRDN_gv_laningTimeAtGameStart_C", note: "warning starts here, Seeds spawn 30s later" },
      { label: "Objective Warning Lead", galaxyConst: "libGRDN_gv_seedSpawnTime_C", note: "time from warning to Seed spawn" },
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
        body: "The first objective starts at 2:30, after a 30-second warning. One Seed is up at a time. Shamblers guard it. Kill them or pull them away, then channel for 6 seconds to take the Seed. Taking it kills the Shamblers and drops a Regen Globe. First team to 3 Seeds wins the round and gets three Garden Terrors, one per lane. Only the winners go back to 0 Seeds.",
        codeBlockSpec: {
          galaxyFile: GRDN,
          matchPattern: "libGRDN_gv_seedsCollected[lv_team] >= libGRDN_gv_seedsNeeded_C",
          contextLines: 10,
        },
      },
      {
        title: "Seed Respawn Delay",
        body: "The next Seed spawns a random 50-80 seconds after one is taken. After all Garden Terrors die, it takes 90-120 seconds instead.",
        codeBlockSpec: {
          galaxyFile: GRDN,
          matchPattern: "fixed libGRDN_gf_RandomCursedPacingSeedSpawnDelay",
          contextLines: 10,
        },
      },
      {
        title: "Seed Spawn Location",
        body: "There are 6 Seed spots. A new Seed never uses a recent spot, and it always spawns on the other team's side from the last one. It also never spawns in the same half of the map (top or bottom) three times in a row.",
        codeBlockSpec: {
          galaxyFile: GRDN,
          matchPattern: "int libGRDN_gf_GetNextSeedSpawnLocation ()",
          contextLines: 30,
        },
      },
      {
        title: "Garden Terror Lane Assignment",
        body: "The winning team gets three Garden Terrors, one per lane. Each one burrows to the front of its lane and pushes.",
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
    description: "Engage in necromancy for fun and profit as you collect the skulls of the undead and use them to raise your very own grave golem.",
    objectives: [
      { title: "Venture Underground", description: "The Haunted Mines will periodically open with an Undead Army underneath!", image: "haunted-mines-1.jpg" },
      { title: "Collect the Skulls", description: "Destroy the Undead and collect their Skulls to power your Golems!", image: "haunted-mines-2.jpg" },
      { title: "Unleash the Golems", description: "After the Army has been defeated, the Golems will arise for both teams! The more Skulls your team collects, the stronger your Golem!", image: "haunted-mines-3.jpg" },
    ],
    summary: [
      "The mines open on a timer. Both teams go down to kill undead and collect Cursed Skulls.",
      "Risen Miners drop 2 skulls each. The Grave Golem in the mines drops up to 38 skulls as it loses Health.",
      "Each team caps at 55 skulls. The mines close as soon as either team hits the cap.",
      "Each team gets a Grave Golem. More skulls means a stronger Golem.",
      "Skull counts reset each time the mines open.",
      "The next mines only open after both lane Golems die.",
    ],
    modPaths: ["hauntedmines.stormmod"],
    timers: [
      { label: "First Mine Warning", galaxyConst: "libMHtM_gv_mMUnderworldStartTime_C" },
      { label: "Mine Cooldown", galaxyConst: "libMHtM_gv_mMUnderworldEventCooldown_C", note: "real timer is 12s shorter, then the prep phase starts" },
      { label: "Prep Phase", galaxyConst: "libMHtM_gv_mMUnderworldPrepDuration_C" },
      { label: "Golem Summon Delay", galaxyConst: "libMHtM_gv_mMUnderworldSummonedBossDuration_C" },
    ],
    summons: [],
    mechanics: [
      {
        title: "Skull Collection",
        body: "Collect Cursed Skulls in the mines. Risen Miners drop 2 each. The Grave Golem down there drops skulls at 75%, 50%, and 25% Health, and the rest when it dies. Each team caps at 55 skulls, and the mines close as soon as either team hits the cap.",
        codeBlockSpec: {
          galaxyFile: MHTM,
          matchPattern: "libMHtM_gv_mMUnderworldSkullCollected",
          contextLines: 8,
        },
      },
      {
        title: "Golem Power Scaling",
        body: "Each team's Grave Golem gets stronger with every skull that team collected.",
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
    description: "A dark, destructive force threatens the Gardens of Hope, creatures made of equal parts mayhem and destruction. Harness their devastating might, or perish at the hands of the Punishers.",
    objectives: [
      { title: "Activate the Shrines", description: "The Infernal Shrines periodically gather power.  Activate them and prepare for a fight.", image: "infernal-shrines-1.jpg" },
      { title: "Defeat Guardians", description: "Slay 40 Guardians before the enemy team to bring forth a mighty Punisher.", image: "infernal-shrines-2.jpg" },
      { title: "Beware the Punisher", description: "Punishers have one of three devastating powers. Be careful, they focus on attacking Heroes above all else.", image: "infernal-shrines-3.jpg" },
    ],
    summary: [
      "Each round, one of three Shrines activates. It is almost never the same Shrine as last round.",
      "A Hero activates the Shrine to start it. Then both teams race to kill 40 Guardians. First to 40 wins it.",
      "Winning a Shrine summons an Arcane, Frozen, or Mortar Punisher. It pushes the lane closest to that Shrine.",
      "The Punisher type almost always changes each round too. It is rerolled together with the Shrine.",
    ],
    modPaths: ["infernalshrines.stormmod", "infernalshrinesdata.stormmod"],
    timers: [
      { label: "First Shrine Activation", seconds: 180, note: "after a 30s warning" },
      { label: "Next Shrine Delay", galaxyConst: "libMSHE_gv_mMDiabloShrinesShrineTimerDuration_C", note: "restarts when the Punisher dies" },
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
        title: "Shrine and Punisher Rolls",
        body: "Each round picks one of three Shrines and one of three Punishers (Arcane, Frozen, or Mortar). Both are rolled together. If either one matches last round, the game rolls again, so both usually change. It stops after 15 tries, so a repeat can happen, but it is very rare.",
        codeBlockSpec: {
          galaxyFile: MSHE,
          matchPattern: "libMSHE_gv_mMISLastShrine",
          contextLines: 12,
        },
      },
      {
        title: "40 Guardians → Punisher",
        body: "A Hero channels on the active Shrine to start it. Up to 10 Guardians (also called Skeletal Defenders) are up at once, and the Shrine tops them back up every 5 seconds. Both teams race to 40 kills. The first team there gets a Punisher and 2 Regen Globes.",
        codeBlockSpec: {
          galaxyFile: MSHE,
          matchPattern: "libMSHE_gv_mMDiabloShrineCursedEventTotal_C",
          contextLines: 10,
        },
      },
      {
        title: "Punisher Lane Selection",
        body: "The Punisher pushes the lane closest to its Shrine and goes for enemy Heroes first. It leaps at a Hero and chases them for a while, then goes back to its lane. Its leap targets a point, not a unit. If a Gate is on that point, the leap lands short so the Punisher does not end up on the Gate. The landing still damages Structures in range.",
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
    description: "Capture the ancient temples, defeat their guardians, and use their awesome power to destroy your enemy’s forts.",
    objectives: [
      { title: "Capture the Temples", description: "Temples will periodically activate. Stand within their grounds to capture their power!", image: "sky-temple-1.jpg" },
      { title: "Hold the Temples", description: "Stand firm and the Temple will unleash a blistering onslaught on your enemy's forts!", image: "sky-temple-2.jpg" },
      { title: "Defend the Temples", description: "Guardians will try to wrest control of their Temples from your team. Hold them off to keep the Temple's power for yourselves!", image: "sky-temple-3.jpg" },
    ],
    summary: [
      "Temples activate through the whole game. Each round has 1 or 2 active Temples.",
      "A Temple shoots enemy Structures while your team holds it. After 40 shots, the last 5 fire on their own for the team that holds it.",
      "Guardians wake up in waves to take the Temple back.",
      "When all active Temples are done, the next round starts 2 minutes later, with a 30-second warning.",
    ],
    modPaths: ["skytemple.stormmod", "skytempledata.stormmod"],
    timers: [
      { label: "First Temple", galaxyConst: "libMLCP_gv_mMSkyTempleFirstTempleStartTime_C" },
      { label: "Temple Phase Cooldown", galaxyConst: "libMLCP_gv_mMSkyTempleTempleCooldown_C" },
      { label: "Temple Warning", galaxyConst: "libMLCP_gv_mMSkyTempleTempleBlessWarningTimeLong_C" },
    ],
    summons: [],
    mechanics: [
      {
        title: "Temple Capture",
        body: "Stand on a Temple to take it. It shoots enemy Structures while you hold it uncontested. If the enemy contests it or you leave, it stops. After 40 shots, the last 5 fire fast and on their own for your team.\n\nOnly those last 5 shots fire without you. Before that, the Temple only shoots while your team holds both the Temple and its beacon. Leave early and it stops.\n\nEach Temple has Guardians that wake up to take it back: 1 big Guardian on the first capture, 2 ranged Guardians after 10 shots, and 2 more after 25. They only spawn once per Temple. The big Guardian drops a Regen Globe.",
        codeBlockSpec: {
          galaxyFile: MLCP,
          matchPattern: "libGame_gf_CapturePointCreate(UnitLastCreated(), libMLCP_gv_mMSkyTempleTempleCaptureRadius_C",
          contextLines: 8,
        },
      },
      {
        title: "Cannon Target Selection",
        body: "Each Temple has its own fixed list of enemy towns. It only moves to the next town once the current one is dead. In a town it hits the closest Structure it can: outer buildings first, then the ones around the Fort or Keep, then the Fort or Keep itself. The Core is only a target once every town on the list is gone.",
        codeBlockSpec: {
          galaxyFile: MLCP,
          matchPattern: "lv_townOuterLoop, UnitGetPosition(libMLCP_gv_mMSkyTemples",
          contextLines: 10,
        },
      },
      {
        title: "Temple Activation Order",
        body: "Rounds 1-3 are fixed. Round 1 is Top and Middle, round 2 is Bottom, and round 3 is a random pair (Top+Bottom or Middle+Bottom).\n\nRounds 4-6 balance each other out. Round 4 rolls 1 or 2 Temples, round 5 gets the other count, and round 6 picks the Temples that are behind on activations. From round 7 the count is random, but it can't be the same three rounds in a row. From round 11 on it's fully random and ignores past rounds.",
        codeBlockSpec: {
          galaxyFile: MLCP,
          matchPattern: "void libMLCP_gf_MMSkyTempleNextTemplesLogic ()",
          contextLines: 90,
        },
      },
    ],
  },
  {
    slug: "tomb-of-the-spider-queen",
    name: "Tomb of the Spider Queen",
    franchise: "Diablo",
    description: "Slay your enemies and gather gems of magical power. Bring enough to the Spider Queen’s altar, and her skittering Webweavers will devour your foes.",
    objectives: [
      { title: "Collect Gems", description: "Enemy spider minions and Heroes drop magical Gems upon death. Gather as many as you can.", image: "tomb-of-the-spider-queen-1.jpg" },
      { title: "Turn in Gems", description: "Relinquish your Gems at one of the Spider Queen's Altars or you will drop them all when you die!", image: "tomb-of-the-spider-queen-2.jpg" },
      { title: "Summon Webweavers", description: "Whichever team turns in enough Gems first will unleash the Webweavers to destroy their enemy's defenses.", image: "tomb-of-the-spider-queen-3.jpg" },
    ],
    summary: [
      "Enemy ranged minions drop 1 Gem and enemy Heroes drop 3. Turn them in at the Spider Queen's Altars.",
      "If you die, you drop every Gem you carried. Only your team can pick them back up, and only in the next 6 seconds.",
      "Hit the Gem target to summon three Webweavers, one per lane.",
      "The target starts at 50 Gems, goes up by 5 each time, and caps at 80.",
      "Webweavers spawn 15 seconds after the turn-in. They lose Health over time, cast Death Wave, and summon Cryptcrawlers.",
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
        body: "Enemy ranged minions drop 1 Gem. Enemy Heroes drop 3 (Murky and each Lost Viking drop 1). A Hero can carry up to 100 Gems. If you die, your carried Gems drop for your own team to pick back up. Dropped Gems disappear after 6 seconds.\n\nEach team has its own Gem count. Turn in Gems at the Spider Queen's Altars. The target starts at 50, goes up by 5 after each Webweaver wave, and caps at 80.",
        codeBlockSpec: {
          galaxyFile: MSOC_H,
          matchPattern: "libMSOC_gv_mMTombSpiderQueenActivationAmountStart_C = 50",
          contextLines: 8,
        },
      },
      {
        title: "Webweaver Wave",
        body: "Hit the target and three Webweavers spawn 15 seconds later, one per lane. They lose Health over time, cast Death Wave, and keep summoning Cryptcrawlers, which last 60 seconds. The Altars close while Webweavers are alive and open again 15 seconds after the last one dies.",
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
    description: "Control the Bell Towers, capture the Altars, and break through the enemy Core’s impenetrable shield.",
    objectives: [
      { title: "Protected Cores", description: "Both Cores are protected by a barrier that cannot be attacked by Heroes. To be victorious, you must activate Altars.", image: "towers-of-doom-1.jpg" },
      { title: "Activate Altars", description: "Periodically Altars will rise across the battlefield. Activate them to have your Bell Towers fire upon the enemy's Core.", image: "towers-of-doom-2.jpg" },
      { title: "Claim Bell Towers", description: "Destroy your enemy's Towers to bring them under your team's control. The more Towers you have, the more damage an altar will do.", image: "towers-of-doom-3.jpg" },
    ],
    summary: [
      "You can't attack the enemy Core. It only takes damage from Altars, Sappers, the Headless Horseman, and the Bell Tower barrage when your team holds all 6 Towers.",
      "An Altar capture deals 1 damage to the enemy Core, plus 1 per Bell Tower your team holds.",
      "Destroy an enemy Fort to take its whole town. The town rebuilds on your side.",
      "Bell Towers start as Forts and turn into Keeps when the Waygates open, usually at 12:00.",
      "Capture the Headless Horseman in the middle to deal 4 damage to the enemy Core.",
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
        body: "You can't attack the enemy Core directly. Each Altar capture deals 1 Core damage, plus 1 per Bell Tower your team holds. Sappers and the Headless Horseman also damage the Core.\n\nIf a team holds all 6 Bell Towers, its Core starts shooting the enemy Core. It fires every 6 seconds, then every 3 seconds after the first 6 shots, until the team loses a Tower.",
        codeBlockSpec: {
          galaxyFile: MTOD,
          matchPattern: "void libMTOD_gf_MMToDAltarFireCannons",
          contextLines: 14,
        },
      },
      {
        title: "Waygates and Headless Horseman",
        body: "Bell Towers start as Forts and turn into Keeps when the Waygates open, usually at 12:00. If Altars are up at that time, the Waygates wait until that round ends. Capturing the Headless Horseman in the middle deals 4 damage to the enemy Core.",
        codeBlockSpec: {
          galaxyFile: MTOD,
          matchPattern: "void libMTOD_gf_MMToDBossCampFireCannons",
          contextLines: 10,
        },
      },
      {
        title: "Altar Spawn Patterns",
        body: "Altars spawn in one of these sets: both Top Altars, Middle alone, Bottom alone, Middle+Bottom, or a 3-Altar set (Top pair+Middle or Top pair+Bottom). The two Top Altars always spawn together. The 1st and 5th spawns are always a 3-Altar set, and those are the only 3-Altar spawns in a match. The other spawns from 2 to 10 go through the four smaller sets with no repeats until all four have come up. The pool refills after the 6th spawn. From the 11th spawn on it's fully random, so repeats can happen.",
        codeBlockSpec: {
          galaxyFile: MTOD,
          matchPattern: "void libMTOD_gf_MMToDDefineNextAltarsandCreatePreviews ()",
          contextLines: 65,
        },
      },
    ],
  },
  {
    slug: "volskaya-foundry",
    name: "Volskaya Foundry",
    franchise: "Overwatch",
    description: "Capture control points to unlock a Protector mech controlled by two players at once.",
    objectives: [
      { title: "Capture Points", description: "Control points activate occasionally. Stand within them to capture them. Fully capturing a point grants you control of a giant mech.", image: "volskaya-foundry-1.jpg" },
      { title: "Control the Protector", description: "The Triglav Protector mech is controlled by two players: one pilot and one gunner. Work together!", image: "volskaya-foundry-2.jpg" },
      { title: "Destroy Everything", description: "The Protector's abilities deal incredible damage to structures and Heroes alike. Use it to lay waste to your enemy.", image: "volskaya-foundry-3.jpg" },
    ],
    summary: [
      "Take the Capture Point to get the Triglav Protector. The point moves between three spots.",
      "The Protector is a two-seat mech. One Hero drives, the other shoots.",
      "The Protector lasts 50 seconds, plus 3 seconds per minute of game time.",
      "The first point opens at 3:00, after a 30-second warning. After that, the point opens 3:00 after the Protector dies.",
    ],
    modPaths: ["volskayamechanics.stormmod", "volskayadata.stormmod"],
    timers: [
      { label: "First Capture Point Cooldown", galaxyConst: "libVLSK_gv_mechanicInitialSpawnTimerDuration_C" },
      { label: "Capture Point Cooldown", galaxyConst: "libVLSK_gv_cooldownTimerDuration_C" },
      { label: "Capture Warning", galaxyConst: "libVLSK_gv_warningTimerDuration" },
      { label: "Protector Timed Life (base)", seconds: 50, note: "+3s per minute of game time" },
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
        body: "Take the Capture Point and hold it until capture hits 100% to get the Protector. Control can drain while the point is empty or being flipped, but capture progress never goes down. If enemy Heroes contest at 99%, it goes to overtime and you wait for the Protector.",
        codeBlockSpec: {
          galaxyFile: VLSK,
          matchPattern: "libVLSK_gv_capturePointContestTimeGoal_C = 3.0",
          contextLines: 8,
        },
      },
      {
        title: "Pilot & Gunner Roles",
        body: "The first player in the Protector is the pilot, the second is the gunner. Players can get out and another Hero can take the empty seat, but pilot and gunner can no longer switch with a Swap ability.",
        codeBlockSpec: {
          galaxyFile: VLSK,
          matchPattern: "UnitGetType(libGame_gf_UseVehicleVehicleUnit()) == \"VolskayaVehicle\"",
          contextLines: 10,
        },
      },
      {
        title: "Protector Duration Scales With Game Time",
        body: "The Protector's duration is set when it spawns: 50 seconds plus 3 seconds per minute of game time. At 10:00 that's 80 seconds. The timer runs even when nobody is inside, and the mech dies when it hits 0.",
        codeBlockSpec: {
          galaxyFile: VOLV,
          matchPattern: "UnitBehaviorSetDuration(libMapM_gv_vehicle[lv_pilotIndex].lv_unit_Vehicle, \"VehicleDragonTimedLife\"",
          contextLines: 6,
        },
      },
    ],
  },
  {
    slug: "warhead-junction",
    name: "Warhead Junction",
    franchise: "StarCraft",
    description: "Join the arms race of Warhead Junction, build up your stockpile, and rain hell on your enemies!",
    objectives: [
      { title: "Warhead Deployment", description: "Multiple Warheads spawn periodically across the battleground.", image: "warhead-junction-1.jpg" },
      { title: "Collect Warheads", description: "Pick up a Warhead to activate your Nuke. Use it or you will drop it when you die!", image: "warhead-junction-2.jpg" },
      { title: "Call Down the Thunder", description: "Launch Nukes to devastate the enemy team's fortifications.", image: "warhead-junction-3.jpg" },
    ],
    summary: [
      "Warheads spawn across the map. Picking one up is a 5-second channel.",
      "You can't fire the Nuke right after pickup. If you get CC'd while launching, the Nuke goes on a 5-second cooldown.",
      "Nukes deal 1750 damage to enemy non-Heroes, plus 70 per minute of game time. Enemy Heroes take 30% of their max Health instead.",
      "The Core also nukes enemy Heroes near it on a timer. The Slime Boss is just a merc camp.",
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
        body: "Picking up a Warhead is a 5-second channel. After pickup, the Nuke is locked for 5 seconds. If you get CC'd while launching, it goes on a 5-second cooldown.",
        codeBlockSpec: {
          galaxyFile: MSC2,
          matchPattern: "NukeCCedCooldownModifyUnit",
          contextLines: 10,
        },
      },
      {
        title: "Damage & Scaling",
        body: "Nukes deal 1750 damage to enemy non-Heroes, plus 70 per minute of game time at pickup. Enemy Heroes in the blast take 30% of their max Health instead. The Core also nukes enemy Heroes near it on a timer. The Slime Boss is a separate merc camp and has nothing to do with Core nukes.",
        codeBlockSpec: {
          galaxyFile: MSC2,
          matchPattern: "NukeDamageScalingOnPickup",
          contextLines: 10,
        },
      },
      {
        title: "Warhead Waves",
        body: "Most waves spawn 2 Warheads in 2 different lanes. The empty lane is never the same twice in a row. The 1st and 4th waves are different: one lane gets 2 Warheads. The next wave spawns 3:05 after the last Warhead of the current wave is picked up, with a 30-second warning.\n\nIf you die with a Nuke, you drop it and either team can pick it up. Dropped Warheads disappear after 2 minutes.",
        codeBlockSpec: {
          galaxyFile: MSC2,
          matchPattern: "void libMSC2_gf_MMSC2SpawnNukeCanisters",
          contextLines: 40,
        },
      },
    ],
  },
  {
    slug: "alterac-pass",
    name: "Alterac Pass",
    franchise: "Warcraft",
    description: "Capture Prison Camps and unleash Cavalry to destroy the enemy General.",
    objectives: [
      { title: "Prison Camps", description: "Capture the enemy Prison Camp to summon your Cavalry. Camps can be retaken by Heroes and Minions, so guard them well!", image: "alterac-pass-1.jpg" },
      { title: "Cavalry", description: "Cavalry soldiers charge down each lane when summoned granting increased damage and movement speed to nearby Allied Heroes.", image: "alterac-pass-2.jpg" },
      { title: "Generals", description: "Each team’s Core has been replaced by a General who fights against attacking enemies. Destroying a Keep reduces the General’s Armor.", image: "alterac-pass-3.jpg" },
    ],
    summary: [
      "Capture the enemy Prison Camp to free your Cavalry.",
      "Channel the enemy Prison Camp for 3 seconds to start the breakout, then hold it until the timer runs out.",
      "The breakout timer starts at 25 seconds, goes up by 10 each round, and caps at 55.",
      "First team to finish its breakout gets one Cavalry per lane.",
      "Enemy Heroes can stop the breakout by channeling the camp. Guards can also take it back.",
      "Each camp has 1 Guard in the first round and 1 more each round, up to 4.",
    ],
    modPaths: ["alteracpass.stormmod"],
    timers: [
      { label: "Capture Time (Round 1)", galaxyConst: "libMMAP_gv_captureFlagVictoryTimeGoalStart_C" },
      { label: "Capture Time Increment", galaxyConst: "libMMAP_gv_captureFlagVictoryTimeGoalTimeIncrement_C" },
      { label: "Capture Time (Max)", galaxyConst: "libMMAP_gv_captureFlagVictoryTimeGoalMax_C" },
      { label: "Hero Channel", galaxyConst: "libMMAP_gv_heroTimeToCap_C" },
      { label: "Guard Retake Channel", galaxyConst: "libMMAP_gv_minionTimeToCap_C" },
      { label: "Defender Respawn", galaxyConst: "libMMAP_gv_defenderRespawnTime_C" },
      { label: "Prison Camp Respawn", galaxyConst: "libMMAP_gv_eventRespawnDurationMin_C", note: "110-150s, shrinks as the game goes on" },
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
        body: "Channel an enemy Prison Camp for 3 seconds to start the breakout, then hold it until the timer runs out. Enemy Heroes can stop it by channeling the camp. Guards can take it back too, but their channel is 10 seconds.",
        codeBlockSpec: {
          galaxyFile: MMAP,
          matchPattern: "lv_victoryProgress -= libMMAP_gv_captureFlagCheckPeriod_C",
          contextLines: 10,
        },
      },
      {
        title: "Escalating Capture Time",
        body: "The Prison Camp timer starts at 25 seconds, goes up by 10 each round, and caps at 55. Each camp has 1 Guard in the first round and 1 more each round, up to 4. Guards respawn 5 seconds after they die.\n\nThe next round comes a random 110-150 seconds later, minus 2 seconds per minute of game time (up to 60 seconds less).",
        codeBlockSpec: {
          galaxyFile: MMAP,
          matchPattern: "captureFlagVictoryTimeGoal < libMMAP_gv_captureFlagVictoryTimeGoalMax_C",
          contextLines: 8,
        },
      },
      {
        title: "Cavalry Reinforcements",
        body: "The winning team gets one Cavalry per lane (3 total), 15 seconds after the breakout. They push all lanes at once and attack enemies and Structures. Nearby allied Heroes get +10% damage and +30% Movement Speed, and nearby allied Minions move faster.",
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
    description: "He who controls the shrines controls the dragon; he who controls the dragon punts the other team’s puny heroes.",
    objectives: [
      { title: "Control the Shrines", description: "There are two Shrines your team needs to control to activate the Dragon Knight's statue!", image: "dragon-shire-1.jpg" },
      { title: "Free the Dragon Knight", description: "While activated, bring a Hero to the statue to free him from his prison!", image: "dragon-shire-2.jpg" },
      { title: "Devastate Enemy Forts", description: "Use the Dragon's immense power to level enemy Forts!", image: "dragon-shire-3.jpg" },
    ],
    summary: [
      "Hold the Sun Shrine (top) and the Moon Shrine (bottom) at the same time to unlock the Dragon Altar.",
      "Channel the Altar for 3 seconds to get the Dragon Knight. Moving, taking damage, or losing a Shrine cancels the channel.",
      "Shrines take 4 seconds to capture and stay yours until the enemy takes them.",
      "The Dragon Knight lasts until it dies or its timer runs out. The Shrines come back 90 seconds after that.",
      "It lasts 55 seconds, plus 1 second for every full 30 seconds of game time.",
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
        body: "Shrines take 4 seconds to capture and don't decay when you leave. You can only channel the Dragon Altar while your team holds both Shrines. If the enemy takes a Shrine back before the 3-second channel ends, the Altar locks again.",
        codeBlockSpec: {
          galaxyFile: MAPM,
          matchPattern: "lv_chaosTowersOwned == libMapM_gv_mMGardensDragonDragonTowerObeliskCount_C",
          contextLines: 10,
        },
      },
      {
        title: "Dragon Knight Duration Scales With Game Time",
        body: "The Dragon Knight's duration isn't fixed. It lasts 55 seconds plus 1 second for every full 30 seconds of game time, unless it dies first. That's 2 seconds per minute, but it goes up every half minute: at 10:00 the Knight lasts 75 seconds, at 10:30 it lasts 76.",
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
    description: "On the temple’s grounds, escort the payload to its destination and bombard your enemy!",
    objectives: [
      { title: "Single Payload", description: "At regular intervals, a payload spawns at the center of the battleground that can be contested by both teams.", image: "hanamura-temple-1.jpg" },
      { title: "Escort Payload", description: "Stand next to the payload and move it to its destination. Prevent the enemy from trying to do the same.", image: "hanamura-temple-2.jpg" },
      { title: "Bombard your Enemy", description: "Once a team escorts the payload to its destination, it will fire upon the enemy’s forts!", image: "hanamura-temple-3.jpg" },
    ],
    summary: [
      "One neutral payload spawns in the middle. Both teams fight over it and push it toward their own end.",
      "Up to three allied Heroes near the payload make it move faster. Enemy Heroes can contest it to stop it.",
      "It's a tug-of-war. If the enemy pushed it first, you have to roll it back to the middle before it moves toward your end.",
      "The first payload spawns at 3:00. The next one spawns 3:00 after a delivery, with a 30-second warning.",
      "Once delivered, the payload fires 12 shots at enemy Structures. It only hits the Core once nothing else is left.",
    ],
    modPaths: ["hanamura.stormmod", "hanamuradata.stormmod"],
    timers: [
      { label: "Payload Cooldown", galaxyConst: "libMHmu_gv_mapMechanic_CooldownTimer_Duration", note: "from gates open or the last delivery; includes the 30s warning" },
    ],
    summons: [],
    mechanics: [
      {
        title: "Payload Escort",
        body: "Up to three allied Heroes near the payload push it forward. More Heroes means more speed, but a fourth adds nothing. If enemy Heroes are near it too, it's contested and stops until one side leaves. If nobody is near it, it stops where it is.",
        codeBlockSpec: {
          galaxyFile: NPLD,
          matchPattern: "Payload_AllyMonitor_1",
          contextLines: 12,
        },
      },
      {
        title: "Contested Stall",
        body: "If both teams have Heroes near the payload, it's contested. It stops moving and neither team makes progress.",
        codeBlockSpec: {
          galaxyFile: NPLD,
          matchPattern: "Payload_ContestedMonitor_Enabled_Func",
          contextLines: 10,
        },
      },
      {
        title: "Delivery: 12-Shot Volley",
        body: "When the payload arrives it fires 12 shots at enemy Structures. It checks the two enemy Fort towns first and hits the one with more Structure Health left, then does the same for the Keep towns. It only hits the Core once nothing else is left.\n\nAllied Heroes within 12 range of the payload also get a Regen Globe pickup when it arrives.",
        codeBlockSpec: {
          galaxyFile: MHMU,
          matchPattern: "libMHmu_gf_MakePayloadAttack",
          contextLines: 12,
        },
      },
      {
        title: "Tug-of-War Routes",
        body: "Only one team has progress at a time. If the enemy moved the payload toward their end, your team first pushes it back along their route to the middle, then out along yours.\n\nEach team has 3 routes. A team switches to its next route each time it delivers, and progress resets for both teams after every delivery.",
        codeBlockSpec: {
          galaxyFile: NPLD,
          matchPattern: "void libNPLD_gf_Payload_MoveToTeamDestination",
          contextLines: 40,
        },
      },
      {
        title: "Recon Camps and Core Barrage",
        body: "Taking a recon camp gives your team vision around it. The camp then respawns on your side, so the enemy has to kill your units to take it back.\n\nThe Core has its own barrage on an 8-second cooldown. It shells random spots within 10 range of itself. Each shell deals 5% of max Health and slows by 70% for 1.25 seconds.",
        codeBlockSpec: {
          galaxyFile: MHMU,
          matchPattern: "UnitCreate(1, \"ReconCampVisionUnit\"",
          contextLines: 8,
        },
      },
    ],
  },
  {
    slug: "braxis-holdout",
    name: "Braxis Holdout",
    franchise: "StarCraft",
    description: "Capture the beacons and watch what happens when a flood of weaponized Zerg ravages the battlefield.",
    objectives: [
      { title: "Capture the Beacons", description: "Periodically two beacons will activate. Capture both to fill your Holding Cell with Zerg.", image: "braxis-holdout-1.jpg" },
      { title: "Fill Holding Cells", description: "Once either Holding Cell fills, both open and unleash waves of Zerg at each team\u2019s base.", image: "braxis-holdout-2.jpg" },
      { title: "Zerg Rush", description: "Hold out against the enemy\u2019s Zerg while helping yours. The Zerg will attack Heroes, so engage cautiously.", image: "braxis-holdout-3.jpg" },
    ],
    summary: [
      "The first beacons open at 1:30, after a 30-second warning. After that, beacons open 2:10 after the last Zerg wave dies.",
      "Your Holding Cell only fills while your team holds both beacons. It fills 2% every 0.75 seconds, so 0 to 100% takes 37.5 seconds.",
      "When either cell hits 100%, both open and each team gets the Zerg it banked.",
      "The first Zerg wave picks a random lane. Each wave after that goes to the other lane.",
      "The Core fires 5 missiles at a nearby enemy Hero every 4 seconds. Each missile deals 5% of their max Health.",
    ],
    modPaths: ["braxisholdout.stormmod", "braxisholdoutdata.stormmod"],
    timers: [
      { label: "First Beacons", seconds: 90, note: "a 1:00 timer plus the 30-second warning" },
      { label: "Beacon Cycle", galaxyConst: "libSCHO_gv_mMHO_AttackEventDuration_C", note: "starts when the previous Zerg wave dies; the warning follows" },
      { label: "Beacon Warning", galaxyConst: "libSCHO_gv_mMHO_AttackEventWarningDuration_C" },
      { label: "Beacon Capture", galaxyConst: "libSCHO_gv_mMHO_CapturePointCaptureTime_C", note: "doubled against a beacon the enemy holds" },
      { label: "Drop Pod Cooldown", galaxyConst: "libSCHO_gv_zergDropPodCooldownTime_C", note: "per team, up to 6 pods per wave" },
      { label: "Regeneration Globes", galaxyConst: "libSCHO_gv_mMHO_RegenGlobeCoolupTime_C" },
      { label: "First Boss Spawn", seconds: 300 },
      { label: "Boss Respawn", seconds: 250 },
    ],
    summons: [
      {
        label: "Zerg Wave",
        modPaths: ["braxisholdoutdata.stormmod"],
        variants: [
          { unitId: "ZergZergling", label: "Zergling" },
          { unitId: "ZergBaneling", label: "Baneling" },
          { unitId: "ZergHydralisk", label: "Hydralisk" },
          { unitId: "ZergRoach", label: "Roach" },
          { unitId: "ZergGuardian", label: "Guardian" },
          { unitId: "ZergUltralisk", label: "Ultralisk" },
        ],
      },
    ],
    mechanics: [
      {
        title: "Capture the Beacons",
        body: "Stand in a beacon to capture it. A neutral beacon takes 3 seconds. An enemy beacon takes 6, since the bar has to go back through neutral first. A Holding Cell only fills while its team holds both beacons. If each team holds one, or nobody holds any, both cells stop.",
        codeBlockSpec: {
          galaxyFile: SCHO,
          matchPattern: "int libSCHO_gf_MMHOGetHiveControlBeaconOwners ()",
          contextLines: 12,
        },
      },
      {
        title: "Fill Holding Cells",
        body: "A Holding Cell fills 2% every 0.75 seconds, so 0 to 100% takes 37.5 seconds. Charge doesn't drop when you lose the beacons. When either cell hits 100%, both open and each team gets the Zerg it banked. A team at 40% still gets a wave.",
        codeBlockSpec: {
          galaxyFile: SCHO,
          matchPattern: "libSCHO_gv_mMHO_TeamProgress[libGame_gv_teamOrderIndex_C] += libSCHO_gv_mMHO_ControlBeaconProgressIncrement_C",
          contextLines: 10,
        },
      },
      {
        title: "Zerg Waves",
        body: "The cell's final charge sets one of seven tiers, and each tier has a fixed wave. Low tiers send Zerglings and a couple of Hydralisks. The top tier sends Ultralisks, Guardians, and a lot more Hydralisks. Every tier has Roaches in the second wave. Banelings get added to the cell bit by bit while it charges, so they scale with charge but aren't part of the tiers. Zerg go for Minions and Structures first, but they attack Heroes in their way. While a Guardian or Ultralisk is attacking, its team can call a Drop Pod with 3 Zerglings and a Hydralisk. That's once every 13 seconds, up to 6 per wave.",
        codeBlockSpec: {
          galaxyFile: SCHO,
          matchPattern: "void libSCHO_gf_MMHODetermineSpawnCompositionBasedOnProgress",
          contextLines: 22,
        },
      },
      {
        title: "Wave Lanes",
        body: "The first wave picks a random lane. Every wave after that goes to the other lane.",
        codeBlockSpec: {
          galaxyFile: SCHO,
          matchPattern: "libSCHO_gv_mMHO_AttackLane = (3 - libSCHO_gv_mMHO_AttackLane);",
          contextLines: 6,
        },
      },
      {
        title: "Core Missiles",
        body: "The Core attacks on its own. Every 4 seconds it marks an enemy Hero within 12 range and fires 5 missiles at them. Each missile deals 5% of that Hero's max Health to every Heroic unit it hits.",
      },
    ],
  },
];
