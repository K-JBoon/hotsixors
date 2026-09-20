// Resolves which ability/talent owns an apply-behavior effect.

import type {
  EffectGraph,
  GraphNode,
  ReverseRef,
  AbilTalentEntry,
  AnchorIndex,
} from "./types.ts";
import {
  containingEffectRefs,
  isSpawnSetupRef,
  isSpawnInstalledBehavior,
  rootOwners,
  targetBehaviorOf,
} from "./walk.ts";
import {
  gatingTalentIds,
  isDormantEffectWithoutEnabler,
  talentIdsFromBehaviorValidators,
  talentIdsFromValidators,
} from "./gating.ts";

// The id-to-entry lookups below scan every anchor and are asked about the same
// ids over and over, so each one keeps its answers for the index it was asked
// about. An index is built once per run and never mutated.
const idLookupCaches = new WeakMap<AnchorIndex, Map<string, Map<string, unknown>>>();

function cachedById<T>(anchorToEntry: AnchorIndex, lookup: string, id: string, compute: () => T): T {
  let byLookup = idLookupCaches.get(anchorToEntry);
  if (!byLookup) {
    byLookup = new Map();
    idLookupCaches.set(anchorToEntry, byLookup);
  }
  let byId = byLookup.get(lookup);
  if (!byId) {
    byId = new Map();
    byLookup.set(lookup, byId);
  }
  if (byId.has(id)) return byId.get(id) as T;
  const value = compute();
  byId.set(id, value);
  return value;
}

const TOKEN_STOP_WORDS = new Set(["a", "and", "of", "the", "to", "talent", "mastery"]);

function idTokens(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !TOKEN_STOP_WORDS.has(token));
}

export function behaviorNameMatchesTalent(behaviorId: string, talentId: string): boolean {
  const behaviorTokens = new Set(idTokens(behaviorId));
  const talentTokens = [...new Set(idTokens(talentId))];
  return talentTokens.length >= 2 && talentTokens.every((token) => behaviorTokens.has(token));
}

export function hasIdBoundary(id: string, prefix: string): boolean {
  if (!id.startsWith(prefix)) return false;
  const next = id[prefix.length];
  return next === undefined || /[A-Z0-9_]/.test(next);
}

function entryAliases(entry: AbilTalentEntry): string[] {
  const nameAlias = entry.name.replace(/[^A-Za-z0-9]+/g, "");
  return [
    entry.nameId,
    entry.buttonId,
    // Filter out very short names that produce noisy matches.
    nameAlias.length >= 5 ? nameAlias : null,
  ].filter((alias): alias is string => Boolean(alias));
}

// The alias lists each lookup scans. Both cases are kept: hasIdBoundary needs
// the original, the substring test needs the lowered one.
interface AliasRow {
  anchor: string;
  entry: AbilTalentEntry;
  aliases: string[];
  lowered: string[];
}

interface AliasTable {
  traits: AliasRow[];
  talents: AliasRow[];
  nonTraits: AliasRow[];
  all: AliasRow[];
}

const aliasTables = new WeakMap<AnchorIndex, AliasTable>();

function row(anchor: string, entry: AbilTalentEntry, aliases: string[]): AliasRow {
  return { anchor, entry, aliases, lowered: aliases.map((a) => a.toLowerCase()) };
}

function aliasTable(anchorToEntry: AnchorIndex): AliasTable {
  const hit = aliasTables.get(anchorToEntry);
  if (hit) return hit;

  const isAbilityNameId = (s: string): boolean => anchorToEntry[s]?.kind === "ability";
  const table: AliasTable = { traits: [], talents: [], nonTraits: [], all: [] };
  for (const [anchor, entry] of Object.entries(anchorToEntry)) {
    const isTrait = entry.kind === "ability" && entry.abilityType === "Trait";
    table.all.push(row(anchor, entry, entryAliases(entry)));
    if (isTrait) table.traits.push(row(anchor, entry, [anchor, ...entryAliases(entry)]));
    else table.nonTraits.push(row(anchor, entry, entryAliases(entry)));
    if (entry.kind === "talent") {
      // Skip buttonId matches when they point at the unlocked ability itself.
      const aliases = [anchor, entry.nameId, entry.buttonId]
        .filter((a): a is string => Boolean(a))
        .filter((a) => !(a === entry.buttonId && isAbilityNameId(a)));
      table.talents.push(row(anchor, entry, aliases));
    }
  }

  aliasTables.set(anchorToEntry, table);
  return table;
}

function rowMatches(row: AliasRow, id: string, idLower: string): boolean {
  for (let i = 0; i < row.aliases.length; i++) {
    if (hasIdBoundary(id, row.aliases[i]) || idLower.includes(row.lowered[i])) return true;
  }
  return false;
}

/** The longest-named row whose aliases match, which is the most specific one. */
function longestMatch(rows: AliasRow[], id: string): AliasRow | null {
  const idLower = id.toLowerCase();
  let best: AliasRow | null = null;
  for (const row of rows) {
    if (!rowMatches(row, id, idLower)) continue;
    if (!best || row.anchor.length > best.anchor.length) best = row;
  }
  return best;
}

function sourceAnchorForId(anchorToEntry: AnchorIndex, id: string | null | undefined): string | null {
  if (!id) return null;
  return cachedById(anchorToEntry, "sourceAnchor", id, () => computeSourceAnchorForId(anchorToEntry, id));
}

function computeSourceAnchorForId(anchorToEntry: AnchorIndex, id: string): string | null {
  return longestMatch(aliasTable(anchorToEntry).traits, id)?.anchor ?? null;
}

function talentAnchorForId(anchorToEntry: AnchorIndex, id: string | null | undefined): string | null {
  if (!id) return null;
  return cachedById(anchorToEntry, "talentAnchor", id, () => computeTalentAnchorForId(anchorToEntry, id));
}

function computeTalentAnchorForId(anchorToEntry: AnchorIndex, id: string): string | null {
  return longestMatch(aliasTable(anchorToEntry).talents, id)?.anchor ?? null;
}

function hasNonTraitAlias(anchorToEntry: AnchorIndex, id: string | null | undefined): boolean {
  if (!id) return false;
  return cachedById(anchorToEntry, "nonTraitAlias", id, () => {
    const idLower = id.toLowerCase();
    return aliasTable(anchorToEntry).nonTraits.some((row) => rowMatches(row, id, idLower));
  });
}

export function entryForNamedId(anchorToEntry: AnchorIndex, id: string | null | undefined): AbilTalentEntry | null {
  if (!id) return null;
  return cachedById(anchorToEntry, "entryForNamed", id, () => computeEntryForNamedId(anchorToEntry, id));
}

function computeEntryForNamedId(anchorToEntry: AnchorIndex, id: string): AbilTalentEntry | null {
  return longestMatch(aliasTable(anchorToEntry).all, id)?.entry ?? null;
}

function directSourceEntry(
  graph: EffectGraph,
  anchorToEntry: AnchorIndex,
  effectId: string,
): { anchorId: string; entry: AbilTalentEntry } | null {
  const behaviorId = targetBehaviorOf(graph, effectId);
  const talentAnchorId = [
    talentAnchorForId(anchorToEntry, behaviorId),
    talentAnchorForId(anchorToEntry, effectId),
  ].filter((id): id is string => Boolean(id)).sort((a, b) => b.length - a.length)[0];
  const talentEntry = talentAnchorId ? anchorToEntry[talentAnchorId] : undefined;
  if (talentEntry) return { anchorId: talentAnchorId, entry: talentEntry };
  if (hasNonTraitAlias(anchorToEntry, behaviorId) || hasNonTraitAlias(anchorToEntry, effectId)) return null;
  const anchors = [
    sourceAnchorForId(anchorToEntry, behaviorId),
    sourceAnchorForId(anchorToEntry, effectId),
  ].filter((id): id is string => Boolean(id));
  const anchorId = anchors.sort((a, b) => b.length - a.length)[0];
  const entry = anchorId ? anchorToEntry[anchorId] : undefined;
  return entry ? { anchorId, entry } : null;
}

function talentOwnersReferencingNode(
  reverseRefs: Map<string, ReverseRef[]>,
  anchorToEntry: AnchorIndex,
  nodeId: string,
): string[] {
  return (reverseRefs.get(nodeId) ?? [])
    .filter((ref) =>
      ref.node.tag === "CTalent"
      && anchorToEntry[ref.node.id]?.kind === "talent"
      && (ref.field === "Abil" || ref.field === "AbilArray" || ref.field === "BehaviorArray")
    )
    .map((ref) => ref.node.id);
}

interface ResolveOptions {
  ignoreSpawnSetupRefs?: boolean;
  bucketEnablers?: Map<string, string[]>;
}

interface GatedHit {
  anchorId: string;
  talentIds: string[];
}

interface WalkItem {
  node: GraphNode;
  pathGates: Set<string>;
  ownerGates: Set<string>;
}

// Walk upward from an apply-behavior effect and credit the owning ability/talent.
export function resolveEffectOwners(
  graph: EffectGraph,
  reverseRefs: Map<string, ReverseRef[]>,
  anchorToEntry: AnchorIndex,
  chanceEnablers: Map<string, string[]>,
  effectId: string,
  options: ResolveOptions = {},
): AbilTalentEntry[] {
  const ungated = new Map<string, { id: string; entry: AbilTalentEntry }>();
  const gatedHits: GatedHit[] = [];
  const fallbackGatedTalentIds = new Set<string>();
  // Owner gates from explicit validators.
  const ownerGateTalentIdsSeen = new Set<string>();

  const seedNode = graph.nodes.get(effectId);
  if (seedNode && isDormantEffectWithoutEnabler(graph, seedNode, chanceEnablers)) return [];

  const targetBehaviorId = targetBehaviorOf(graph, effectId);
  const initialGates = [
    ...new Set([
      ...(seedNode ? gatingTalentIds(graph, anchorToEntry, seedNode, chanceEnablers) : []),
      ...(targetBehaviorId ? talentIdsFromBehaviorValidators(graph, anchorToEntry, targetBehaviorId) : []),
    ]),
  ];
  // Explicit validator gates identify the owner directly.
  const initialOwnerGates = [
    ...new Set([
      ...(seedNode ? talentIdsFromValidators(graph, anchorToEntry, seedNode) : []),
      ...(targetBehaviorId ? talentIdsFromBehaviorValidators(graph, anchorToEntry, targetBehaviorId) : []),
    ]),
  ];
  for (const t of initialOwnerGates) ownerGateTalentIdsSeen.add(t);
  // Initial gates on the buff are the most specific signal.
  const localMechanicGates = new Set(initialGates);

  const seen = new Set<string>();
  const containingRefs = containingEffectRefs(reverseRefs, effectId)
    .filter((ref) => !options.ignoreSpawnSetupRefs || !isSpawnSetupRef(ref));
  // If the effect name encodes its source anchor, short-circuit to it.
  const namedSource = containingRefs.length > 0 ? directSourceEntry(graph, anchorToEntry, effectId) : null;
  if (namedSource && (initialGates.length === 0 || initialGates.includes(namedSource.anchorId))) {
    return [namedSource.entry];
  }

  const queue: WalkItem[] = containingRefs.map(({ node }) => ({
    node,
    pathGates: new Set(initialGates),
    ownerGates: new Set(initialOwnerGates),
  }));

  while (queue.length) {
    const { node, pathGates, ownerGates } = queue.shift()!;
    if (isDormantEffectWithoutEnabler(graph, node, chanceEnablers)) continue;

    const nextGates = new Set(pathGates);
    const nextOwnerGates = new Set(ownerGates);
    for (const t of gatingTalentIds(graph, anchorToEntry, node, chanceEnablers)) {
      nextGates.add(t);
      fallbackGatedTalentIds.add(t);
    }
    // Only adopt new owner gates while none have been claimed yet.
    if (nextOwnerGates.size === 0) {
      for (const t of talentIdsFromValidators(graph, anchorToEntry, node)) {
        nextOwnerGates.add(t);
        ownerGateTalentIdsSeen.add(t);
      }
    }
    const key = `${node.id} ${[...nextGates].sort().join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const entry = anchorToEntry[node.id];
    if (entry) {
      if (nextGates.size === 0) {
        const existing = ungated.get(entry.nameId);
        if (!existing || node.id.length > existing.id.length) ungated.set(entry.nameId, { id: node.id, entry });
      } else {
        // Fall through by specificity.
        const talentIds = localMechanicGates.size > 0
          ? [...localMechanicGates]
          : nextOwnerGates.size > 0
          ? [...nextOwnerGates]
          : [...nextGates];
        gatedHits.push({ anchorId: node.id, talentIds });
      }
      continue;
    }
    if (node.tag.startsWith("CAbil") || node.tag.startsWith("CBehavior")) {
      for (const talentId of talentOwnersReferencingNode(reverseRefs, anchorToEntry, node.id)) {
        // A plain reference only counts when no owner gate has been claimed.
        if (nextOwnerGates.size === 0) {
          gatedHits.push({ anchorId: node.id, talentIds: [talentId] });
        }
      }
      // TalentBucket* behaviors are dormant until a talent enables them.
      const bucketTalents = options.bucketEnablers?.get(node.id);
      if (bucketTalents && nextOwnerGates.size === 0) {
        for (const talentId of bucketTalents) {
          gatedHits.push({ anchorId: node.id, talentIds: [talentId] });
        }
      }
    }
    const owningRoots = rootOwners(reverseRefs, anchorToEntry, node.id);
    if (owningRoots.length > 0) {
      for (const parent of owningRoots) {
        queue.push({ node: parent, pathGates: nextGates, ownerGates: nextOwnerGates });
      }
      continue;
    }
    for (const ref of containingEffectRefs(reverseRefs, node.id)) {
      if (options.ignoreSpawnSetupRefs && isSpawnSetupRef(ref)) continue;
      // Don't follow PeriodicEffect edges from ungated behaviors.
      if (
        ref.field === "PeriodicEffect"
        && ref.node.tag.startsWith("CBehavior")
        && (ref.node.refs["DisableValidatorArray"] ?? []).length === 0
        && (ref.node.refs["ValidatorArray"] ?? []).length === 0
        && !isSpawnInstalledBehavior(reverseRefs, ref.node.id)
        && !(reverseRefs.get(ref.node.id) ?? []).some((r) => r.node.tag === "CEffectApplyBehavior")
      ) continue;
      queue.push({ node: ref.node, pathGates: nextGates, ownerGates: nextOwnerGates });
    }
  }

  const owners = new Map<string, { id: string; entry: AbilTalentEntry }>();
  for (const [nameId, v] of ungated) owners.set(nameId, v);
  for (const hit of gatedHits) {
    const anchorEntry = anchorToEntry[hit.anchorId];
    // Skip redundant gated re-applications.
    if (anchorEntry && ungated.has(anchorEntry.nameId)) continue;
    for (const talentId of hit.talentIds) {
      const tEntry = anchorToEntry[talentId];
      if (tEntry?.kind === "talent" && !owners.has(tEntry.nameId)) {
        owners.set(tEntry.nameId, { id: talentId, entry: tEntry });
      }
    }
  }
  if (owners.size === 0) {
    // Credit any owner gates that anchor to a hero-specific talent entry.
    const fallbackPool = ownerGateTalentIdsSeen.size > 0 ? ownerGateTalentIdsSeen : fallbackGatedTalentIds;
    for (const talentId of fallbackPool) {
      const tEntry = anchorToEntry[talentId];
      if (tEntry?.kind === "talent") owners.set(tEntry.nameId, { id: talentId, entry: tEntry });
    }
  }
  return [...owners.values()].sort((a, b) => b.id.length - a.id.length).map((v) => v.entry);
}
