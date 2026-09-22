import * as path from "node:path";
import type { AnchorMap } from "./types.ts";
import { SITE_DATA } from "./lib/paths.ts";
import { readJson, writeJson } from "./lib/fs.ts";
import { runScript } from "./lib/script.ts";
import { sanitizeGamedataUrl } from "./lib/galaxy-source.ts";

interface MechanicSource {
  label: string;
  kind: "XML" | "Galaxy";
  path: string;
  anchor?: string;
}

interface MechanicDefinition {
  name: string;
  slug: string;
  category: "Crowd Control" | "Defensive Buffs" | "Offensive Buffs" | "Offensive Debuffs" | "Stealth and Vision";
  description: string;
  summary: string;
  primaryBehavior: string;
  sourceIds: string[];
  sources: MechanicSource[];
  // Armor and armor reduction share the StormArmor behavior; this picks the half whose
  // resulting buff modifies armor in the given direction. Omit for everything else.
  armorPolarity?: "increase" | "decrease";
  // Further split armor buffs/debuffs into all damage, Basic-only, and Ability-only variants.
  armorDamageKind?: "regular" | "physical" | "magical";
  statModifier?: "attack-speed" | "damage" | "lifesteal";
  statPolarity?: "increase" | "decrease";
  statDamageKind?: "general" | "physical" | "spell";
}

interface MechanicLink extends MechanicSource {
  url: string;
  line?: number;
}

interface MechanicEntry extends Omit<MechanicDefinition, "sources"> {
  sources: MechanicLink[];
}

const BEHAVIOR_DATA = "mods/heroesdata.stormmod/base.stormdata/gamedata/behaviordata.xml";
const EFFECT_DATA = "mods/heroesdata.stormmod/base.stormdata/gamedata/effectdata.xml";
const VALIDATOR_DATA = "mods/heroesdata.stormmod/base.stormdata/gamedata/validatordata.xml";
const GAME_LIB = "mods/heroesdata.stormmod/base.stormdata/triggerlibs/gamelib.galaxy";
const GAMEDATA_HELPER_LIB = "mods/heroesdata.stormmod/base.stormdata/triggerlibs/gamedatahelperlib.galaxy";
const ANA_DATA = "mods/heromods/ana.stormmod/base.stormdata/gamedata/anadata.xml";
const ARTHAS_DATA = "mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/arthasdata/arthasdata.xml";
const CHEN_DATA = "mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/chendata/chendata.xml";
const FIREBAT_DATA = "mods/heromods/firebat.stormmod/base.stormdata/gamedata/firebatdata.xml";
const MEPHISTO_DATA = "mods/heromods/mephisto.stormmod/base.stormdata/gamedata/mephistodata.xml";
const MURADIN_DATA = "mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/muradindata/muradindata.xml";
const STITCHES_DATA = "mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/stitchesdata/stitchesdata.xml";
const TRACER_DATA = "mods/heromods/tracer.stormmod/base.stormdata/gamedata/tracerdata.xml";
const TYRANDE_DATA = "mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/tyrandedata/tyrandedata.xml";
const ZULJIN_DATA = "mods/heromods/zuljin.stormmod/base.stormdata/gamedata/zuljindata.xml";

const MECHANICS: MechanicDefinition[] = [
  {
    name: "Blinded",
    slug: "blinded",
    category: "Crowd Control",
    description: "Basic Attacks miss, so on-hit effects don't apply either.",
    summary: "Adds a DamageResponse that intercepts incoming basic-attack damage (Kind index Ability=0), routes it through the BlindMissedDummy effect, and sets ModifyFraction=0.",
    primaryBehavior: "StormBlind",
    sourceIds: ["StormBlind", "StormBlindApply", "BlindMissedDummy"],
    sources: [
      { label: "StormBlind behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormBlind" },
      { label: "StormBlindApply effect", kind: "XML", path: EFFECT_DATA, anchor: "StormBlindApply" },
      { label: "Blind missed dummy effect", kind: "XML", path: EFFECT_DATA, anchor: "BlindMissedDummy" },
    ],
  },
  {
    name: "Slowed",
    slug: "slowed",
    category: "Crowd Control",
    description: "Lower Movement Speed. Slows don't stack: only the strongest one applies. Unstoppable removes them.",
    summary: "Parent buff with no speed change of its own. Child buffs set the actual negative MoveSpeedMultiplier. Unstoppable removes it and ImmuneToCrowdControl blocks it, through shared remove validators.",
    primaryBehavior: "StormSlowParent",
    sourceIds: ["StormSlowParent", "StormSlowApply"],
    sources: [
      { label: "StormSlowParent behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormSlowParent" },
      { label: "StormSlowApply effect", kind: "XML", path: EFFECT_DATA, anchor: "StormSlowApply" },
    ],
  },
  {
    name: "Rooted",
    slug: "rooted",
    category: "Crowd Control",
    description: "Can't move, dash or blink. Can still attack and cast other Abilities.",
    summary: "Blocks movement orders through the paired StormRootSuppressMovementApply and StormRootSuppressMovementRemove effects.",
    primaryBehavior: "StormRoot",
    sourceIds: ["StormRoot", "StormRootApply", "StormRootSuppressMovementApply", "StormRootSuppressMovementRemove"],
    sources: [
      { label: "StormRoot behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormRoot" },
      { label: "StormRootApply effect", kind: "XML", path: EFFECT_DATA, anchor: "StormRootApply" },
      { label: "Root movement suppress apply", kind: "XML", path: EFFECT_DATA, anchor: "StormRootSuppressMovementApply" },
      { label: "Root movement suppress remove", kind: "XML", path: EFFECT_DATA, anchor: "StormRootSuppressMovementRemove" },
    ],
  },
  {
    name: "Stunned",
    slug: "stunned",
    category: "Crowd Control",
    description: "Can't move, attack or cast. Interrupts channels.",
    summary: "Sets the OrdersPaused state and the DisableAbils flag, which stop movement, attacks and casts. A short AbilLink/AbilClass allowlist stays usable.",
    primaryBehavior: "StormStun",
    sourceIds: ["StormStun", "libGame_gt_ScoreTrackingTimeCCdEnemyHeroes_Init"],
    sources: [
      { label: "StormStun behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormStun" },
      { label: "CC score tracking hook", kind: "Galaxy", path: GAME_LIB, anchor: "libGame_gt_ScoreTrackingTimeCCdEnemyHeroes_Init" },
    ],
  },
  {
    name: "Silenced",
    slug: "silenced",
    category: "Crowd Control",
    description: "Can't cast Abilities. Can still move and attack. Interrupts channels.",
    summary: "Sets the Silence state, which blocks casts. Movement and Basic Attacks still work. A short AbilLink allowlist stays usable.",
    primaryBehavior: "StormSilence",
    sourceIds: ["StormSilence", "libGDHL_gt_HeroSylvanasWailingArrowSilenceTarget_Func"],
    sources: [
      { label: "StormSilence behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormSilence" },
      { label: "Silence application example", kind: "Galaxy", path: GAMEDATA_HELPER_LIB, anchor: "libGDHL_gt_HeroSylvanasWailingArrowSilenceTarget_Func" },
    ],
  },
  {
    name: "Feared",
    slug: "feared",
    category: "Crowd Control",
    description: "Forced to run away from the source. Can't attack or cast.",
    summary: "Inherits StormForcedActionDebuff (StormSilence plus the Uncommandable state and OrdersUninterruptible flag) and also disables CAbilAttack. The cast trigger issues the flee order.",
    primaryBehavior: "StormFear",
    sourceIds: ["StormFear"],
    sources: [
      { label: "StormFear behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormFear" },
      { label: "Forced action parent", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormForcedActionDebuff" },
    ],
  },
  {
    name: "Polymorphed",
    slug: "polymorphed",
    category: "Crowd Control",
    description: "Can still move, but can't attack or cast. Also dismounts and reveals the target.",
    summary: "Inherits StormSilence and adds the SuppressAttack state, so casts and Basic Attacks are blocked but movement is not. An InitialEffect dismounts and reveals the target.",
    primaryBehavior: "StormPolymorph",
    sourceIds: ["StormPolymorph"],
    sources: [
      { label: "StormPolymorph behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormPolymorph" },
    ],
  },
  {
    name: "Taunted",
    slug: "taunted",
    category: "Crowd Control",
    description: "Forced to walk to the caster and Basic Attack them. Can't cast.",
    summary: "Inherits StormForcedActionDebuff (StormSilence plus the Uncommandable state and OrdersUninterruptible flag), so the player loses control. The caster's trigger issues the move and attack orders.",
    primaryBehavior: "StormTauntParent",
    sourceIds: ["StormTauntParent"],
    sources: [
      { label: "StormTauntParent behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormTauntParent" },
      { label: "Forced action parent", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormForcedActionDebuff" },
    ],
  },
  {
    name: "Time Stop",
    slug: "time-stop",
    category: "Crowd Control",
    description: "Frozen in time. Can't act, take damage or be targeted. Cooldowns, buffs, debuffs and damage over time all pause until it ends.",
    summary: "A 99% time slow: TimeScale 0.01, so animations, cooldowns, durations and projectiles on the unit run at 1% speed. Also sets Invulnerable, Untargetable, Stasis, OrdersPaused, SuppressAttack, SuppressCollision and the SuppressTurning flag.",
    primaryBehavior: "StormTimeStopParent",
    sourceIds: [
      "StormTimeStopParent",
      "HeroGenericTimeStop",
      "HeroGenericTimeStopListener",
      "libGame_gt_CCRecognitionTimeStopOn_Func",
      "libGame_gt_CCRecognitionTimeStopOffResumeCooldowns_Func",
    ],
    sources: [
      { label: "StormTimeStopParent behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormTimeStopParent" },
      { label: "Generic time stop behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "HeroGenericTimeStop" },
      { label: "Time stop listener", kind: "XML", path: BEHAVIOR_DATA, anchor: "HeroGenericTimeStopListener" },
      { label: "Time stop activation hook", kind: "Galaxy", path: GAME_LIB, anchor: "libGame_gt_CCRecognitionTimeStopOn_Func" },
      { label: "Time stop resume hook", kind: "Galaxy", path: GAME_LIB, anchor: "libGame_gt_CCRecognitionTimeStopOffResumeCooldowns_Func" },
    ],
  },
  {
    name: "Sleeping",
    slug: "sleeping",
    category: "Crowd Control",
    description: "Can't act. Damage wakes it up, except damage from minions.",
    summary: "Inherits StormStun (OrdersPaused + DisableAbils) and adds a DamageResponse (Chance=1) that fires StormSleepRemoveBehaviorDelayCP. Any non-minion damage removes the buff shortly after it lands.",
    primaryBehavior: "StormSleep",
    sourceIds: ["StormSleep", "StormSleepRemoveBehaviorDelayCP", "StormSleepRemoveBehavior"],
    sources: [
      { label: "StormSleep behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormSleep" },
      { label: "Sleep remove delay", kind: "XML", path: EFFECT_DATA, anchor: "StormSleepRemoveBehaviorDelayCP" },
      { label: "Sleep remove effect", kind: "XML", path: EFFECT_DATA, anchor: "StormSleepRemoveBehavior" },
    ],
  },
  {
    name: "Protected",
    slug: "protected",
    category: "Defensive Buffs",
    description: "Takes no damage, but can still be crowd controlled.",
    summary: "DamageResponse with Chance=1 and ModifyFraction=0 sets all incoming damage to zero.",
    primaryBehavior: "StormProtect",
    sourceIds: ["StormProtect"],
    sources: [
      { label: "StormProtect behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormProtect" },
    ],
  },
  {
    name: "Shield",
    slug: "shield",
    category: "Defensive Buffs",
    description: "Absorbs damage before health does. Shields from different sources stack.",
    summary: "Inherits StormProtect, clears the Protected category and caps the prevented damage at the shield amount. Shield buffs use DamageResponse ModifyLimit, often based on maximum Life.",
    primaryBehavior: "StormShield",
    sourceIds: ["StormShield"],
    sources: [
      { label: "StormShield behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormShield" },
    ],
  },
  {
    name: "Evasion",
    slug: "evasion",
    category: "Defensive Buffs",
    description: "Basic Attacks against the unit miss, so on-hit effects don't apply either.",
    summary: "Inherits StormProtect, clears the Protected category and limits the DamageResponse to non-Ability damage.",
    primaryBehavior: "StormEvasion",
    sourceIds: ["StormEvasion"],
    sources: [
      { label: "StormEvasion behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormEvasion" },
    ],
  },
  {
    name: "Stagger",
    slug: "stagger",
    category: "Defensive Buffs",
    description: "Chen only. Part of the damage he takes is dealt over time instead of all at once.",
    summary: "StormProtect-derived DamageResponse catches incoming damage. Chen's Stagger effects store it and deal it later instead of removing it.",
    primaryBehavior: "StormProtect",
    sourceIds: ["StormProtect", "ChenStaggerProtectedBuff"],
    sources: [
      { label: "StormProtect behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormProtect" },
      { label: "Chen Stagger protected buff", kind: "XML", path: CHEN_DATA, anchor: "ChenStaggerProtectedBuff" },
    ],
  },
  {
    name: "Spell Absorb",
    slug: "spell-absorb",
    category: "Defensive Buffs",
    description: "Blocks all Ability damage.",
    summary: "StormProtect-derived DamageResponse that ignores basic and splash damage, so only Ability damage is prevented. See Arthas's Anti-Magic Shell.",
    primaryBehavior: "StormProtect",
    sourceIds: ["StormProtect", "ArthasAntiMagicShellCaster"],
    sources: [
      { label: "StormProtect behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormProtect" },
      { label: "Arthas Anti-Magic Shell caster buff", kind: "XML", path: ARTHAS_DATA, anchor: "ArthasAntiMagicShellCaster" },
    ],
  },
  {
    name: "Unstoppable",
    slug: "unstoppable",
    category: "Defensive Buffs",
    description: "Immune to crowd control, including slows. Removes any crowd control already applied.",
    summary: "Sets the Unstoppable state. Most CC checks the shared TargetNotUnstoppable validator, so new CC fails and existing CC is removed.",
    primaryBehavior: "StormUnstoppableParent",
    sourceIds: ["StormUnstoppableParent", "Unstoppable", "TargetNotUnstoppable"],
    sources: [
      { label: "StormUnstoppableParent behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormUnstoppableParent" },
      { label: "Unstoppable behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "Unstoppable" },
      { label: "TargetNotUnstoppable validator", kind: "XML", path: VALIDATOR_DATA, anchor: "TargetNotUnstoppable" },
    ],
  },
  {
    name: "Invulnerable",
    slug: "invulnerable",
    category: "Defensive Buffs",
    description: "Takes no damage and is immune to crowd control.",
    summary: "Inherits StormUnstoppableParent (Unstoppable state) and adds the Invulnerable state and a DamageResponse with Chance=1 and ModifyFraction=0. The InitialEffect HeroGenericCleanseRemoveCCBehaviorCategoriesExpandedTarget removes existing CC.",
    primaryBehavior: "StormInvulnerable",
    sourceIds: ["StormInvulnerable", "PermaInvulnerable"],
    sources: [
      { label: "StormInvulnerable behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormInvulnerable" },
      { label: "Permanent invulnerable behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "PermaInvulnerable" },
    ],
  },
  {
    name: "Stasis",
    slug: "stasis",
    category: "Defensive Buffs",
    description: "Out of the fight. Can't act, deal or take damage, or be targeted.",
    summary: "Inherits StormInvulnerable and adds the Stasis and Benign states plus UnitAttrOnImmuneToAOE, ImmuneToSkillshots and ImmuneToFriendlyAbilities.",
    primaryBehavior: "StormStasis",
    sourceIds: ["StormStasis", "StormStasisIceBlock", "libUIUI_ge_FullscreenOverlayPriorities_Stasis"],
    sources: [
      { label: "StormStasis behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormStasis" },
      { label: "Ice Block stasis variant", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormStasisIceBlock" },
      { label: "Stasis overlay usage", kind: "Galaxy", path: GAMEDATA_HELPER_LIB, anchor: "libGDHL_gt_HeroRexxarFeignDeathOverlayOn_Func" },
    ],
  },
  {
    name: "Armor",
    slug: "armor",
    category: "Defensive Buffs",
    description: "Reduces damage taken from all sources. Each point is worth more than the one before it. Negative Armor increases damage taken.",
    summary: "Positive StormArmor ArmorModification values that cover all or several damage kinds. Physical Armor and Spell Armor have their own rows.",
    primaryBehavior: "StormArmor",
    sourceIds: ["StormArmor", "StormArmorPermanent"],
    sources: [
      { label: "StormArmor behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormArmor" },
      { label: "StormArmorPermanent variant", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormArmorPermanent" },
    ],
    armorPolarity: "increase",
    armorDamageKind: "regular",
  },
  {
    name: "Physical Armor",
    slug: "physical-armor",
    category: "Defensive Buffs",
    description: "Armor against Physical Damage.",
    summary: "Positive StormArmor ArmorModification values on the Basic damage kind only.",
    primaryBehavior: "StormArmor",
    sourceIds: ["StormArmor", "StormArmorPermanent"],
    sources: [
      { label: "StormArmor behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormArmor" },
      { label: "StormArmorPermanent variant", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormArmorPermanent" },
    ],
    armorPolarity: "increase",
    armorDamageKind: "physical",
  },
  {
    name: "Spell Armor",
    slug: "magical-armor",
    category: "Defensive Buffs",
    description: "Armor against Spell Damage.",
    summary: "Positive StormArmor ArmorModification values on the Ability damage kind only.",
    primaryBehavior: "StormArmor",
    sourceIds: ["StormArmor", "StormArmorPermanent"],
    sources: [
      { label: "StormArmor behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormArmor" },
      { label: "StormArmorPermanent variant", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormArmorPermanent" },
    ],
    armorPolarity: "increase",
    armorDamageKind: "magical",
  },
  {
    name: "Healing Increase",
    slug: "healing-increase",
    category: "Defensive Buffs",
    description: "Receives more healing, including regeneration.",
    summary: "No shared parent. Each ability or talent sets HealTakenAdditiveMultiplier and VitalRegenMultiplier on its own buff.",
    primaryBehavior: "TalentBucketAmplifiedHealing",
    sourceIds: ["TalentBucketAmplifiedHealing", "AnaBioticGrenadeAllyBuff", "StitchesPatchworkCreationCarry"],
    sources: [
      { label: "TalentBucketAmplifiedHealing reference buff", kind: "XML", path: BEHAVIOR_DATA, anchor: "TalentBucketAmplifiedHealing" },
      { label: "Ana Biotic Grenade ally buff", kind: "XML", path: ANA_DATA, anchor: "AnaBioticGrenadeAllyBuff" },
      { label: "Stitches Patchwork Creation carry buff", kind: "XML", path: STITCHES_DATA, anchor: "StitchesPatchworkCreationCarry" },
    ],
  },
  {
    name: "Attack Speed Increase",
    slug: "attack-speed-increase",
    category: "Offensive Buffs",
    description: "Attacks faster. Attack speed bonuses add together.",
    summary: "Positive AdditiveAttackSpeedFactor on a buff.",
    primaryBehavior: "",
    sourceIds: [],
    sources: [
      { label: "Varian Twin Blades attack-speed modifier", kind: "XML", path: "mods/heromods/varian.stormmod/base.stormdata/gamedata/variandata.xml", anchor: "VarianTwinBladesOfFuryHeroModifications" },
    ],
    statModifier: "attack-speed",
    statPolarity: "increase",
  },
  {
    name: "Damage Increase",
    slug: "damage-increase",
    category: "Offensive Buffs",
    description: "Basic Attacks and Abilities deal more damage.",
    summary: "DamageDealtFraction, or DamageDealtScaled backed by an accumulator, on both Basic and Ability damage. See Zul'jin's Headhunter.",
    primaryBehavior: "",
    sourceIds: [],
    sources: [
      { label: "Zul'jin Headhunter carry buff", kind: "XML", path: ZULJIN_DATA, anchor: "ZuljinHeadhunterCarry" },
    ],
    statModifier: "damage",
    statPolarity: "increase",
    statDamageKind: "general",
  },
  {
    name: "Physical Damage Increase",
    slug: "physical-damage-increase",
    category: "Offensive Buffs",
    description: "Deals more Physical Damage.",
    summary: "Positive Basic-only DamageDealtFraction or DamageDealtScaled, such as Executioner.",
    primaryBehavior: "",
    sourceIds: [],
    sources: [
      { label: "Executioner damage buff", kind: "XML", path: BEHAVIOR_DATA, anchor: "HeroGenericExecutioner30DamageBuff" },
      { label: "Muradin Give 'em the Axe damage buff", kind: "XML", path: MURADIN_DATA, anchor: "MuradinGiveEmTheAxeExecutioner50DamageBuff" },
    ],
    statModifier: "damage",
    statPolarity: "increase",
    statDamageKind: "physical",
  },
  {
    name: "Spell Power Increase",
    slug: "spell-power-increase",
    category: "Offensive Buffs",
    description: "Abilities deal more damage and heal for more.",
    summary: "Positive Ability-only DamageDealtFraction or DamageDealtScaled.",
    primaryBehavior: "",
    sourceIds: [],
    sources: [
      { label: "StormDamageIncrease reference parent", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormDamageIncrease" },
      { label: "Mephisto Malicious Intent spell-power buff", kind: "XML", path: MEPHISTO_DATA, anchor: "MephistoShadeOfMephistoMaliciousIntentSpellPowerBuff" },
    ],
    statModifier: "damage",
    statPolarity: "increase",
    statDamageKind: "spell",
  },
  {
    name: "Physical Lifesteal",
    slug: "physical-lifesteal",
    category: "Offensive Buffs",
    description: "Heals for a percentage of Basic Attack damage dealt.",
    summary: "Positive Life LeechFraction on damage effects marked as weapon or basic, plus any LeechValidator talent gates.",
    primaryBehavior: "",
    sourceIds: [],
    sources: [
      { label: "Tracer Leeching Rounds weapon damage leech", kind: "XML", path: TRACER_DATA, anchor: "TracerHeroWeaponDamageHero" },
    ],
    statModifier: "lifesteal",
    statDamageKind: "physical",
  },
  {
    name: "Spell Lifesteal",
    slug: "spell-lifesteal",
    category: "Offensive Buffs",
    description: "Heals for a percentage of Ability damage dealt.",
    summary: "Positive Life LeechFraction on damage effects marked as spell or ability, plus any LeechValidator talent gates.",
    primaryBehavior: "",
    sourceIds: [],
    sources: [
      { label: "Mephisto Hateful Mending spell leech", kind: "XML", path: MEPHISTO_DATA, anchor: "MephistoSkullMissileDamage" },
    ],
    statModifier: "lifesteal",
    statDamageKind: "spell",
  },
  {
    name: "Armor Reduction",
    slug: "vulnerable",
    category: "Offensive Debuffs",
    description: "Negative Armor. Takes more damage from all sources.",
    summary: "Negative StormArmor ArmorModification values that cover all or several damage kinds. Physical and Spell Armor reductions have their own rows.",
    primaryBehavior: "StormArmor",
    sourceIds: ["StormArmor", "Vulnerable25"],
    sources: [
      { label: "StormArmor behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormArmor" },
      { label: "Vulnerable25 reference buff", kind: "XML", path: BEHAVIOR_DATA, anchor: "Vulnerable25" },
    ],
    armorPolarity: "decrease",
    armorDamageKind: "regular",
  },
  {
    name: "Physical Armor Reduction",
    slug: "physical-vulnerable",
    category: "Offensive Debuffs",
    description: "Takes more Physical Damage.",
    summary: "Negative StormArmor ArmorModification values on the Basic damage kind only.",
    primaryBehavior: "StormArmor",
    sourceIds: ["StormArmor", "Vulnerable25"],
    sources: [
      { label: "StormArmor behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormArmor" },
      { label: "Vulnerable25 reference buff", kind: "XML", path: BEHAVIOR_DATA, anchor: "Vulnerable25" },
    ],
    armorPolarity: "decrease",
    armorDamageKind: "physical",
  },
  {
    name: "Spell Armor Reduction",
    slug: "magical-vulnerable",
    category: "Offensive Debuffs",
    description: "Takes more Spell Damage.",
    summary: "Negative StormArmor ArmorModification values on the Ability damage kind only.",
    primaryBehavior: "StormArmor",
    sourceIds: ["StormArmor", "Vulnerable25"],
    sources: [
      { label: "StormArmor behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormArmor" },
      { label: "Vulnerable25 reference buff", kind: "XML", path: BEHAVIOR_DATA, anchor: "Vulnerable25" },
    ],
    armorPolarity: "decrease",
    armorDamageKind: "magical",
  },
  {
    name: "Attack Speed Slow",
    slug: "attack-speed-slow",
    category: "Offensive Debuffs",
    description: "Attacks slower.",
    summary: "Negative AdditiveAttackSpeedFactor on a debuff.",
    primaryBehavior: "",
    sourceIds: [],
    sources: [
      { label: "StormDamageReductionAttackSpeedSlow reference parent", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormDamageReductionAttackSpeedSlow" },
      { label: "Firebat Nanomachine Coating attack-speed slow", kind: "XML", path: FIREBAT_DATA, anchor: "FirebatOilSpillNanomachineCoatingAttackSpeedSlowBehavior" },
    ],
    statModifier: "attack-speed",
    statPolarity: "decrease",
  },
  {
    name: "Damage Reduction",
    slug: "damage-reduction",
    category: "Offensive Debuffs",
    description: "Basic Attacks and Abilities deal less damage.",
    summary: "Negative DamageDealtFraction on both Basic and Ability damage.",
    primaryBehavior: "",
    sourceIds: [],
    sources: [
      { label: "StormDamageReduction reference parent", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormDamageReduction" },
      { label: "Tyrande Harsh Moonlight damage reduction", kind: "XML", path: TYRANDE_DATA, anchor: "TyrandeSentinelHarshMoonlightTalentDamageReduction" },
    ],
    statModifier: "damage",
    statPolarity: "decrease",
    statDamageKind: "general",
  },
  {
    name: "Spell Power Reduction",
    slug: "spell-power-reduction",
    category: "Offensive Debuffs",
    description: "Abilities deal less damage and heal for less.",
    summary: "Negative Ability-only DamageDealtFraction or DamageDealtScaled.",
    primaryBehavior: "",
    sourceIds: [],
    sources: [
      { label: "Ana Mind-Numbing Agent spell-power debuff", kind: "XML", path: ANA_DATA, anchor: "AnaMindNumbingAgent" },
    ],
    statModifier: "damage",
    statPolarity: "decrease",
    statDamageKind: "spell",
  },
  {
    name: "Healing Reduction",
    slug: "healing-reduction",
    category: "Offensive Debuffs",
    description: "Receives less healing. Can be cleansed.",
    summary: "Adds the HealReduction and Cleansable categories. Each ability's child buff sets the actual HealTakenAdditiveMultiplier. Prevented healing shows as floating text at the caster.",
    primaryBehavior: "StormHealReduction",
    sourceIds: ["StormHealReduction"],
    sources: [
      { label: "StormHealReduction behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormHealReduction" },
    ],
  },
  {
    name: "Revealed",
    slug: "revealed",
    category: "Stealth and Vision",
    description: "Visible to enemies in fog, bushes and Stealth.",
    summary: "Sets the Reveal and Detected flags and disables ShrubStatusController, so fog, bushes and Cloak no longer hide the unit.",
    primaryBehavior: "StormReveal",
    sourceIds: ["StormReveal", "libGDHL_gt_HeroGenericRevealCloakedOneOffDamageSource_Func"],
    sources: [
      { label: "StormReveal behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormReveal" },
      { label: "Reveal on damage hook", kind: "Galaxy", path: GAMEDATA_HELPER_LIB, anchor: "libGDHL_gt_HeroGenericRevealCloakedOneOffDamageSource_Func" },
    ],
  },
  {
    name: "Stealthed",
    slug: "cloaked",
    category: "Stealth and Vision",
    description: "Hidden from enemies. They can still see a shimmer, unless it is Deep Stealth. Attacking, casting or taking damage breaks most Stealth.",
    summary: "Sets the Cloak state (plus SuppressFidgeting). StormPersistentCloak adds Permanent, EnabledWhileDead and a NoCloakRevealerCombine disable validator. StormUnrevealableCloak also sets Undetectable and SuppressCollision, and sends incoming damage through HeroGenericUnrevealableDummy.",
    primaryBehavior: "StormCloak",
    sourceIds: ["StormCloak", "StormPersistentCloak", "StormUnrevealableCloak"],
    sources: [
      { label: "StormCloak behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormCloak" },
      { label: "Persistent cloak variant", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormPersistentCloak" },
      { label: "Unrevealable cloak variant", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormUnrevealableCloak" },
    ],
  },
];

function sourceUrl(source: MechanicSource, anchorMap: AnchorMap): MechanicLink {
  let line: number | undefined;
  if (source.anchor && anchorMap[source.anchor]) {
    line = anchorMap[source.anchor].line;
  }

  return {
    ...source,
    line,
    url: `/gamedata/${sanitizeGamedataUrl(source.path)}/${source.anchor ? `#${encodeURIComponent(source.anchor)}` : ""}`,
  };
}

async function main(): Promise<void> {
  const anchorMap = await readJson<AnchorMap>(path.join(SITE_DATA, "anchor-map.json"));
  const mechanics: MechanicEntry[] = MECHANICS.map((mechanic) => ({
    ...mechanic,
    sources: mechanic.sources.map((source) => sourceUrl(source, anchorMap)),
  }));

  await writeJson(path.join(SITE_DATA, "mechanics.json"), { mechanics }, 2);
  console.log(`gen-mechanics: wrote mechanics.json with ${mechanics.length} mechanics`);
}

runScript(import.meta.url, main);
