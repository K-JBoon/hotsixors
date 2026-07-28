// Parses raw gamedata XML into a directed graph of element ids and refs.

import { SaxesParser } from "saxes";
import type { EffectGraph, Element, GraphNode } from "./types.ts";

// Forward-ref fields.
export const REF_FIELDS = [
  "Effect",
  "EffectArray",
  "PrepEffect",
  "FinalEffect",
  "InitialEffect",
  "ExpireEffect",
  "PeriodicEffect",
  "PeriodicEffectArray",
  "ImpactEffect",
  "LaunchEffect",
  "CursorEffect",
  "ApplyEffect",
  "RemoveEffect",
  "DefaultEffect",
  "CaseEffect",
  "CaseDefault",
  "ContinuousEffect",
  "CancelEffect",
  "AreaEffect",
  "DamageEffect",
  "LeechValidator",
  "SearchEffect",
  "TimeoutEffect",
  "ResponseEffect",
  "Handled",
  "FilteredEffect",
  "AffectedTarget",
  "FinalEffectArray",
  "SpawnEffect",
  "FinishEffect",
  "Behavior",
  "BehaviorArray",
  "AddBehavior",
  "AbilCmd",
  "ValidatorArray",
  "DisableValidatorArray",
  "CombineArray",
  "Abil",
  "AbilArray",
  "Tech",
  "Entry",
];
const REF_FIELDS_SET = new Set(REF_FIELDS);

// Backref tags point at earlier effects and do not add forward edges.
const BACKREF_TAG_RE = /^(?:Which[A-Z]\w*|Target|ImpactLocation|LaunchLocation)$/;

function isGameplayCatalogTag(tag: string): boolean {
  return /^(?:CEffect|CAbil|CBehavior|CTalent|CValidator|CWeapon|CUnit)/.test(tag);
}

function gameplayTagRank(tag: string): number {
  if (tag.startsWith("CBehavior")) return 3;
  if (tag.startsWith("CAbil")) return 2;
  if (isGameplayCatalogTag(tag)) return 1;
  return 0;
}

function normalizeRefValue(field: string, value: string): string {
  return field === "Abil" || field === "AbilCmd"
    ? value.replace(/^Abil\//, "").split(",")[0]
    : value;
}

// Collect refs from a C-element's attrs plus descendants.
function collectRefsFromTree(
  rootAttrs: Record<string, string>,
  rootElements: Element[],
): Record<string, string[]> {
  const refs: Record<string, Set<string>> = {};
  const add = (field: string, value: string): void => {
    (refs[field] ??= new Set<string>()).add(normalizeRefValue(field, value));
  };

  const visitAttrs = (attrs: Record<string, string>): void => {
    for (const [k, v] of Object.entries(attrs)) {
      if (REF_FIELDS_SET.has(k)) add(k, v);
    }
  };

  const visitElement = (el: Element): void => {
    if (!BACKREF_TAG_RE.test(el.tag)) {
      visitAttrs(el.attrs);
      // <RefField value="X" /> or <RefField Link="X" />
      if (REF_FIELDS_SET.has(el.tag)) {
        const v = el.attrs["value"] ?? el.attrs["Link"];
        if (v !== undefined) add(el.tag, v);
      }
    }
    for (const child of el.children) visitElement(child);
  };

  visitAttrs(rootAttrs);
  for (const el of rootElements) visitElement(el);

  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(refs)) out[k] = [...v];
  return out;
}

interface Frame {
  tag: string;
  attrs: Record<string, string>;
  children: Element[];
  isCElement: boolean;
}

function isCElementTag(tag: string, attrs: Record<string, string>): boolean {
  // ^C[A-Z]… excludes the <Catalog> wrapper and non-C tags.
  return /^C[A-Z]/.test(tag) && attrs["id"] !== undefined;
}

function mergeNode(nodes: Map<string, GraphNode>, fresh: GraphNode): void {
  const existing = nodes.get(fresh.id);
  if (!existing) {
    nodes.set(fresh.id, fresh);
    return;
  }
  // Gameplay nodes win when the same id appears in multiple catalogs.
  if (isGameplayCatalogTag(fresh.tag) && !isGameplayCatalogTag(existing.tag)) {
    nodes.set(fresh.id, fresh);
    return;
  }
  if (!isGameplayCatalogTag(fresh.tag) && isGameplayCatalogTag(existing.tag)) return;
  // Same id declared across files; merge refs and elements.
  for (const [k, v] of Object.entries(fresh.refs)) {
    existing.refs[k] = [...new Set([...(existing.refs[k] ?? []), ...v])];
  }
  // Higher-ranked gameplay tags keep their parent chain.
  if (gameplayTagRank(fresh.tag) > gameplayTagRank(existing.tag)) {
    existing.tag = fresh.tag;
    if (fresh.parentAttr) existing.parentAttr = fresh.parentAttr;
  } else if (!existing.parentAttr && fresh.parentAttr) {
    existing.parentAttr = fresh.parentAttr;
  }
  if (fresh.elements.length) existing.elements.push(...fresh.elements);
}

function parseFile(
  content: string,
  nodes: Map<string, GraphNode>,
  consts: Map<string, string>,
): void {
  const parser = new SaxesParser({ fragment: true });
  const stack: Frame[] = [];

  parser.on("opentag", (tag) => {
    const attrs = { ...(tag.attributes as Record<string, string>) };
    const isCElement = isCElementTag(tag.name, attrs);

    // <const id="X" value="Y"/> declarations.
    if (tag.name === "const" && attrs["id"] && attrs["value"]) {
      consts.set(attrs["id"], attrs["value"]);
    }

    stack.push({
      tag: tag.name,
      attrs,
      children: [],
      isCElement,
    });
  });

  parser.on("closetag", () => {
    const frame = stack.pop();
    if (!frame) return;

    const el: Element = { tag: frame.tag, attrs: frame.attrs, children: frame.children };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(el);

    if (frame.isCElement) {
      const id = frame.attrs["id"];
      const refs = collectRefsFromTree(frame.attrs, frame.children);
      mergeNode(nodes, {
        id,
        tag: frame.tag,
        parentAttr: frame.attrs["parent"] ?? null,
        refs,
        elements: frame.children,
      });
    }
  });

  parser.on("error", () => {
  });

  try {
    parser.write(content).close();
  } catch {
  }
}

export function buildEffectGraph(
  files: { path: string; content: string }[],
): EffectGraph {
  const nodes = new Map<string, GraphNode>();
  const consts = new Map<string, string>();
  for (const { content } of files) parseFile(content, nodes, consts);
  return { nodes, consts };
}
