import { readFile, writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import type { AnchorMap } from "./types.ts";
import { SITE_DATA } from "./lib/paths.ts";
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
    summary: "Parent category buff with no movement modifier of its own; concrete slow values are applied by child buffs that set a negative MoveSpeedMultiplier. Cleansed by Unstoppable and blocked by ImmuneToCrowdControl via shared remove validators.",
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
    summary: "Suppresses movement orders via the paired StormRootSuppressMovementApply / StormRootSuppressMovementRemove enable/disable effects.",
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
    summary: "Sets the OrdersPaused state flag and the DisableAbils modify-flag, which together halt movement, attacks, and ability casts. A small AbilLink/AbilClass allowlist stays usable.",
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
    summary: "Sets the Silence state flag, which blocks ability casts. Movement and basic attacks are unaffected. A small AbilLink allowlist stays usable.",
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
    summary: "Inherits StormForcedActionDebuff (which extends StormSilence and adds the Uncommandable state and OrdersUninterruptible modify-flag) and additionally disables the CAbilAttack class. The flee movement itself is issued by the casting trigger as an order against the uncommandable unit.",
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
    summary: "Inherits StormSilence (Silence state flag) and adds the SuppressAttack state flag, blocking ability casts and basic attacks while leaving movement intact. An InitialEffect dismounts and reveals the target.",
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
    summary: "Inherits StormForcedActionDebuff (StormSilence + Uncommandable state + OrdersUninterruptible modify-flag), making the unit unresponsive to player input. The caster-side trigger then issues the movement and auto-attack orders against the taunted unit.",
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
    summary: "Mechanically a 99% time slow. TimeScale is set to 0.01, so animations, cooldowns, durations, and projectiles on the unit advance at 1% speed. Also sets Invulnerable, Untargetable, Stasis, OrdersPaused, SuppressAttack, SuppressCollision, and the SuppressTurning modify-flag, so it cannot be hit, targeted, or act for the duration.",
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
    summary: "Inherits StormStun (OrdersPaused + DisableAbils) and adds a DamageResponse with Chance=1 that triggers StormSleepRemoveBehaviorDelayCP, which removes the buff shortly after any non-minion damage lands.",
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
    summary: "Adds a DamageResponse with Chance=1 and ModifyFraction=0, which intercepts incoming damage and zeroes the dealt amount.",
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
    summary: "Inherits StormProtect but clears the Protected category and limits prevention by a shield amount. Shield buffs use DamageResponse ModifyLimit values, often based on maximum Life, instead of zeroing all incoming damage.",
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
    summary: "Prevents basic-attack damage through StormEvasion-style DamageResponse rules. These buffs inherit StormProtect but clear the Protected category and restrict the response to non-ability damage.",
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
    summary: "Intercepts incoming damage with a StormProtect-derived DamageResponse, but stores or replays it through Chen-specific Stagger effects instead of fully deleting it.",
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
    summary: "Prevents ability damage through a StormProtect-derived DamageResponse that disables basic and splash damage handling, as seen on Arthas Anti-Magic Shell.",
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
    summary: "Sets the Unstoppable state flag. The shared TargetNotUnstoppable validator gates most crowd-control effects, so applying CC fails or removes the existing buff while this is active.",
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
    summary: "Inherits StormUnstoppableParent (Unstoppable state) and adds the Invulnerable state flag plus a DamageResponse with Chance=1 and ModifyFraction=0. The InitialEffect HeroGenericCleanseRemoveCCBehaviorCategoriesExpandedTarget removes existing CC categories on application.",
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
    summary: "Inherits StormInvulnerable (Unstoppable + Invulnerable + zeroed DamageResponse + CC cleanse) and additionally sets the Stasis and Benign state flags plus UnitAttrOnImmuneToAOE, ImmuneToSkillshots, and ImmuneToFriendlyAbilities, removing the unit from combat completely while preventing it from acting.",
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
    summary: "Reduces incoming damage by a percentage through positive StormArmor ArmorModification values that apply broadly or to multiple damage kinds. Physical-only and magical-only armor are listed separately.",
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
    summary: "Reduces incoming Basic Attack damage through positive StormArmor ArmorModification values that only target the Basic damage kind.",
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
    name: "Magical Armor",
    slug: "magical-armor",
    category: "Defensive Buffs",
    summary: "Reduces incoming Ability damage through positive StormArmor ArmorModification values that only target the Ability damage kind.",
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
    summary: "Increases the healing the unit receives. Implemented per ability or talent through HealTakenAdditiveMultiplier and VitalRegenMultiplier on a buff (no shared parent behavior).",
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
    summary: "Increases Basic Attack rate through positive AdditiveAttackSpeedFactor values on buffs.",
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
    summary: "Increases both Basic Attack and Ability damage through DamageDealtFraction or accumulator-backed DamageDealtScaled modifiers, as seen on Zul'jin Headhunter.",
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
    summary: "Increases Basic Attack damage through positive Basic-only DamageDealtFraction or DamageDealtScaled modifiers, such as Executioner-style effects.",
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
    summary: "Increases Ability damage through positive Ability-only DamageDealtFraction or DamageDealtScaled modifiers.",
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
    summary: "Heals from Basic Attack damage through positive Life LeechFraction on damage effects classified by weapon/basic effect metadata and any LeechValidator talent gates.",
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
    summary: "Heals from Ability damage through positive Life LeechFraction on damage effects classified by spell/ability effect metadata and any LeechValidator talent gates.",
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
    summary: "Increases incoming damage through negative StormArmor ArmorModification values that apply broadly or to multiple damage kinds. Physical-only and magical-only armor reductions are listed separately.",
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
    summary: "Increases incoming Basic Attack damage through negative StormArmor ArmorModification values that only target the Basic damage kind.",
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
    name: "Magical Armor Reduction",
    slug: "magical-vulnerable",
    category: "Offensive Debuffs",
    summary: "Increases incoming Ability damage through negative StormArmor ArmorModification values that only target the Ability damage kind.",
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
    summary: "Reduces Basic Attack rate through negative AdditiveAttackSpeedFactor values on debuffs.",
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
    summary: "Reduces both Basic Attack and Ability damage through negative DamageDealtFraction modifiers.",
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
    summary: "Reduces Ability damage through negative Ability-only DamageDealtFraction or DamageDealtScaled modifiers.",
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
    summary: "Tags the unit with the HealReduction and Cleansable behavior categories. The actual reduction is applied per ability through child buffs that set HealTakenAdditiveMultiplier (no shared multiplier on the parent), and prevented healing is floated at the caster.",
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
    summary: "Sets the Reveal and Detected modify-flags on the unit, which makes it visible to enemies through fog of war, shrubs, and stealth (Cloak), and disables ShrubStatusController so shrubs no longer hide it.",
    primaryBehavior: "StormReveal",
    sourceIds: ["StormReveal", "libGDHL_gt_HeroGenericRevealCloakedOneOffDamageSource_Func"],
    sources: [
      { label: "StormReveal behavior", kind: "XML", path: BEHAVIOR_DATA, anchor: "StormReveal" },
      { label: "Reveal on damage hook", kind: "Galaxy", path: GAMEDATA_HELPER_LIB, anchor: "libGDHL_gt_HeroGenericRevealCloakedOneOffDamageSource_Func" },
    ],
  },
  {
    name: "Cloaked",
    slug: "cloaked",
    category: "Stealth and Vision",
    summary: "Sets the Cloak state flag (plus SuppressFidgeting), hiding the unit from enemy vision unless revealed. StormPersistentCloak adds Permanent + EnabledWhileDead and a NoCloakRevealerCombine disable validator; StormUnrevealableCloak additionally sets Undetectable, SuppressCollision, and routes incoming damage through HeroGenericUnrevealableDummy.",
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
  const anchorMap = JSON.parse(await readFile(path.join(SITE_DATA, "anchor-map.json"), "utf-8")) as AnchorMap;
  const mechanics: MechanicEntry[] = MECHANICS.map((mechanic) => ({
    ...mechanic,
    sources: mechanic.sources.map((source) => sourceUrl(source, anchorMap)),
  }));

  await mkdir(SITE_DATA, { recursive: true });
  await writeFile(
    path.join(SITE_DATA, "mechanics.json"),
    JSON.stringify({ mechanics }, null, 2),
    "utf-8"
  );

  console.log(`gen-mechanics: wrote mechanics.json with ${mechanics.length} mechanics`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
