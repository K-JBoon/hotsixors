// Shared types for the effect-graph parser.

// A structured XML child of a GraphNode.
export interface Element {
  tag: string;
  attrs: Record<string, string>;
  children: Element[];
}

export interface GraphNode {
  id: string;
  tag: string;
  parentAttr: string | null;
  refs: Record<string, string[]>;
  elements: Element[];
}

export interface EffectGraph {
  nodes: Map<string, GraphNode>;
  consts: Map<string, string>;
}

// "increase" / "decrease" for any signed buff polarity.
export type Polarity = "increase" | "decrease";

export type ArmorDamageKind = "regular" | "physical" | "magical";
export type StatModifier = "attack-speed" | "damage" | "lifesteal";
export type StatDamageKind = "general" | "physical" | "spell";
export type ProtectionKind =
  | "protected"
  | "shield"
  | "evasion"
  | "stagger"
  | "spell-absorb"
  | "other";

export interface MechanicLike {
  slug: string;
  name: string;
  category: string;
  primaryBehavior: string;
  sourceIds: string[];
  // Keeps only apply-effects whose resulting buff modifies armor in this direction.
  armorPolarity?: Polarity;
  // Further splits StormArmor buffs by damage type.
  armorDamageKind?: ArmorDamageKind;
  statModifier?: StatModifier;
  statPolarity?: Polarity;
  statDamageKind?: StatDamageKind;
}

export interface AbilTalentEntry {
  kind: "ability" | "talent";
  nameId: string;
  buttonId?: string;
  heroSlug: string;
  heroName: string;
  name: string;
  icon: string;
  abilityType?: string;
  talentTier?: number;
}

export interface MechanicApplications
  extends Pick<MechanicLike, "slug" | "name" | "category"> {
  entries: AbilTalentEntry[];
}

export interface ReverseRef {
  node: GraphNode;
  field: string;
}

export type AnchorIndex = Record<string, AbilTalentEntry>;
