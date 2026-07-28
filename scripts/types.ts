// Keys of AbilityStats that carry numeric stat values (excludes sources).
export type AbilityStatKey =
  | "manaCost"
  | "cooldown"
  | "castIntroTime"
  | "castFinishTime"
  | "scaling"
  | "chargeCountMax"
  | "chargeTimeUse";

export interface AbilityStatSource {
  xmlPath: string; // Zola-relative path (e.g. "mods/.../foodata-xml"), used to build gamedata links
  anchor: string;  // element id within that file
}

export interface AbilityStats {
  manaCost: number | null;
  cooldown: number | null;          // Cooldown.TimeUse, the GCD between charge uses; null when not present
  castIntroTime: number | null;     // seconds before the ability fires
  castFinishTime: number | null;    // seconds of animation lock after firing
  scaling: number | null;           // per-level scaling factor (e.g. 0.04 = 4%)
  chargeCountMax: number | null;    // max charges storable; >1 means a genuine multi-charge ability
  chargeTimeUse: number | null;     // seconds to recharge one charge; use this as the displayed cooldown
  sources: Partial<Record<AbilityStatKey, AbilityStatSource>>;
}

export interface AbilityCharges {
  countMax: number;
  countStart?: number;
  countUse?: number;
  recastCooldown?: number;
  isCountHidden?: boolean;
}

export interface HeroAbility {
  linkId: string;
  abilityId: string;
  buttonId: string;
  icon: string;
  abilityType: string;
  charges?: AbilityCharges;
  toggleCooldown?: number;
}

export interface HeroTalent {
  linkId: string;
  talentId: string;
  buttonId: string;
  abilityId: string;
  icon: string;
  abilityType: string;
  sort: number;
  isQuest?: boolean;
  upgradesAbilityType?: boolean;
  hasHotkey?: boolean;
  tooltipAbilityLinkIds?: string[];
  prerequisiteTalentIds?: string[];
  toggleCooldown?: number;
}

export interface HeroPortraits {
  heroSelect?: string;
  leaderboard?: string;
  loading?: string;
  partyPanel?: string;
  target?: string;
  draftScreen?: string;
  minimap?: string;
  targetInfo?: string;
}

export interface HeroRatings {
  complexity: number;
  damage: number;
  survivability: number;
  utility: number;
}

export interface HeroUnitData {
  abilities?: Record<string, HeroAbility[]>;
  subAbilities?: Record<string, Record<string, HeroAbility[]>>;
  scalingLinkIds?: string[];
  speed?: number;
  sight?: number;
  radius?: number;
  life?: HeroLifeData;
  energy?: HeroResourceData;
  weapons?: HeroWeaponData[];
  portraits?: HeroPortraits;
}

export interface HeroLifeData {
  amount: number;
  scale?: number;
  regenRate: number;
  regenScale?: number;
}

export interface HeroResourceData {
  amount: number;
  regenRate?: number;
}

export interface HeroWeaponData {
  nameId: string;
  range: number;
  period: number;
  damage: number;
  damageScale?: number;
}

export interface HeroData {
  unitId: string;
  hyperlinkId: string;
  attributeId: string;
  franchise: string;
  gender: string;
  releaseDate: string;
  rarity: string;
  isMelee?: boolean;
  attributes?: string[];
  playstyles?: string[];
  portraits: HeroPortraits;
  ratings: HeroRatings;
  abilities: Record<string, HeroAbility[]>;
  subAbilities?: Record<string, Record<string, HeroAbility[]>>;
  talents: Record<string, HeroTalent[]>;
  heroUnits?: Record<string, HeroUnitData>;
  skinIds?: string[];
  variationSkinIds?: string[];
  scalingLinkIds?: string[];
  speed?: number;
  sight?: number;
  radius?: number;
  life?: HeroLifeData;
  energy?: HeroResourceData;
  weapons?: HeroWeaponData[];
}

export interface HeroStatsResource {
  kind: string; // "Mana" | "Energy" | "Fury" | "Brew" | etc.
  amount: number;
  regenRate: number | null;
}

export interface HeroStatsLife {
  amount: number;
  scale: number;
  regenRate: number;
  regenScale: number;
}

export interface HeroStatsWeapon {
  damage: number;
  damageScale: number;
  range: number;
  period: number;
  attackSpeed: number;
}

export interface HeroStats {
  life: HeroStatsLife;
  resource: HeroStatsResource | null;
  weapon: HeroStatsWeapon | null;
  speed: number;
}

export interface HeroUnitStats {
  unitId: string;
  unitName: string;
  stats: HeroStats;
}

export interface GamestringsAbilityText {
  name: Record<string, string>;
  shortText: Record<string, string>;
  fullText: Record<string, string>;
  cooldownText?: Record<string, string>;
  energyText?: Record<string, string>;
  lifeText?: Record<string, string>;
}

export interface Gamestrings {
  ability: GamestringsAbilityText;
  talent: GamestringsAbilityText;
  hero: {
    name: Record<string, string>;
    title?: Record<string, string>;
    infoText: Record<string, string>;
    description?: Record<string, string>;
    expandedRole?: Record<string, string>;
    roles?: Record<string, string[]>;
  };
  unit: { name: Record<string, string> };
  skin: { infoText: Record<string, string> };
}

export interface GamestringsFile {
  meta: Record<string, unknown>;
  items: Gamestrings;
}

export interface AnchorEntry {
  xmlPath: string;
  line: number;
}

export interface AnchorMap {
  [elementId: string]: AnchorEntry;
}

export interface ShortcodeEntry {
  name: string;
  buttonId: string;
  icon: string;
  heroSlug: string;
  heroName: string;
  abilityType: string;
  shortDesc: string;
  manaCost: number | null;
  cooldown: number | null;          // displayed cooldown: chargeTimeUse if present, else cooldown
  xmlPath: string;
  anchor: string;
  type: "ability" | "talent";
}

export interface ShortcodeData {
  [nameId: string]: ShortcodeEntry;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileTreeNode[];
  lang?: string;
}

export interface BattlegroundTimer {
  label: string;
  seconds: number;
  display: string; // e.g. "2:30"
  min?: number;
  max?: number;
  displayMin?: string;
  displayMax?: string;
  galaxyConst?: string; // source constant name
  note?: string;        // clarifying annotation
}

export interface BattlegroundWeapon {
  id: string;
  damage: number | null;
  period: number | null;
  range: number | null;
}

export interface BattlegroundAbility {
  id: string;
  name: string | null;
  fullDesc: string | null;
  slot: string | null;
}

export interface BattlegroundSummonVariant {
  id: string;
  label: string;
  hp: number | null;
  speed: number | null;
  armor: string | null;
  scalingRows: ScalingSummaryRow[];
  abilities: BattlegroundAbility[];
  weapons: BattlegroundWeapon[];
  xmlPath: string | null;
}

export interface BattlegroundSummon {
  label: string;
  variants: BattlegroundSummonVariant[];
}

export interface BattlegroundXmlFile {
  label: string;
  path: string; // Zola gamedata path (e.g. "mods/heroesmapmods/...")
}

export interface BattlegroundCodeBlock {
  label: string;  // e.g. "libmlbd_h.galaxy, constants" or "libmlbd.galaxy, timer start"
  lang: "galaxy" | "xml";
  code: string;
}

export interface BattlegroundMechanic {
  title: string;
  body: string;
  codeBlock?: BattlegroundCodeBlock;
}

export interface BattlegroundData {
  slug: string;
  name: string;
  franchise: string;
  summary: string[];
  mechanics: BattlegroundMechanic[];
  timers: BattlegroundTimer[];
  codeBlocks: BattlegroundCodeBlock[];
  summons: BattlegroundSummon[];
  xmlFiles: BattlegroundXmlFile[];
}

export interface MinionMercWeapon {
  id: string;
  damage: number | null;
  period: number | null;
  range: number | null;
}

export interface ScalingSummaryRow {
  label: string;
  summary: string;
}

export interface MinionMercStats {
  id: string;
  name: string;
  role: string;
  context: string;
  hp: number | null;
  speed: number | null;
  killXp: number | null;
  xpScaling: string | null;
  xpScalingSummary: string | null;
  scaling: string | null;
  scalingRows: ScalingSummaryRow[];
  armor: string | null;
  weapons: MinionMercWeapon[];
}

export interface MinionMercGroup {
  id: string;
  title: string;
  units: MinionMercStats[];
}

export interface MinionMercsData {
  groups: MinionMercGroup[];
}

export interface StructureWeapon {
  id: string;
  damage: number | null;
  period: number | null;
  range: number | null;
}

export interface StructureStats {
  id: string;
  name: string;
  role: string;
  hp: number | null;
  shields: number | null;
  killXp: number | null;
  scaling: string | null;
  scalingRows: ScalingSummaryRow[];
  armor: string | null;
  weapons: StructureWeapon[];
}

export interface StructureGroup {
  id: string;
  title: string;
  units: StructureStats[];
}

export interface StructuresData {
  groups: StructureGroup[];
}

export interface ExperienceLevel {
  level: number;
  xpForLevel: number;
  cumulativeXp: number;
  xpSincePreviousTalentTier?: number;
  previousTalentTierLevel?: number;
}

export interface UnderdogTableRow {
  levelGap: number;
  truncMod: number;
  moduloMod: number;
}

export interface ExperienceData {
  maxLevel: number;
  levels: ExperienceLevel[];
  killXpFormula: { base: number; levelOffset: number };
  underdogTable: UnderdogTableRow[];
  clamp: { min: number; max: number };
}

export type DraftHero = {
  id: string;
  slug: string;
  name: string;
  role: string;
  portrait: string;
  franchise: string;
};

export type DraftBattleground = {
  slug: string;
  name: string;
  background?: string;
};

export type DraftDataFile = {
  heroes: DraftHero[];
  battlegrounds: DraftBattleground[];
};
