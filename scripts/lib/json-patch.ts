// Minimal RFC 6902 JSON Patch applier.

export type JsonPatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "replace"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "move"; path: string; from: string }
  | { op: "copy"; path: string; from: string }
  | { op: "test"; path: string; value: unknown };

type JsonContainer = Record<string, unknown> | unknown[];

function unescapeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON Pointer: ${pointer}`);
  return pointer.slice(1).split("/").map(unescapeToken);
}

function arrayIndex(arr: unknown[], token: string, allowEnd: boolean): number {
  if (allowEnd && token === "-") return arr.length;
  if (!/^(0|[1-9]\d*)$/.test(token)) throw new Error(`Invalid array index: ${token}`);
  const idx = Number(token);
  if (idx > arr.length || (!allowEnd && idx >= arr.length)) {
    throw new Error(`Array index out of bounds: ${token}`);
  }
  return idx;
}

function resolveParent(doc: unknown, tokens: string[]): JsonContainer {
  let current: unknown = doc;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(current)) {
      current = current[arrayIndex(current, token, false)];
    } else if (current !== null && typeof current === "object") {
      current = (current as Record<string, unknown>)[token];
    } else {
      throw new Error(`JSON Pointer path does not exist: /${tokens.join("/")}`);
    }
  }
  if (current === null || typeof current !== "object") {
    throw new Error(`JSON Pointer parent is not a container: /${tokens.join("/")}`);
  }
  return current as JsonContainer;
}

function getValue(doc: unknown, pointer: string): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return doc;
  const parent = resolveParent(doc, tokens);
  const last = tokens[tokens.length - 1];
  return Array.isArray(parent) ? parent[arrayIndex(parent, last, false)] : (parent as Record<string, unknown>)[last];
}

function addValue(doc: unknown, pointer: string, value: unknown): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return value;
  const parent = resolveParent(doc, tokens);
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    parent.splice(arrayIndex(parent, last, true), 0, value);
  } else {
    (parent as Record<string, unknown>)[last] = value;
  }
  return doc;
}

function removeValue(doc: unknown, pointer: string): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) throw new Error("Cannot remove the document root");
  const parent = resolveParent(doc, tokens);
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    parent.splice(arrayIndex(parent, last, false), 1);
  } else {
    delete (parent as Record<string, unknown>)[last];
  }
  return doc;
}

function replaceValue(doc: unknown, pointer: string, value: unknown): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return value;
  const parent = resolveParent(doc, tokens);
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    parent[arrayIndex(parent, last, false)] = value;
  } else {
    (parent as Record<string, unknown>)[last] = value;
  }
  return doc;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== "object") return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  if (aKeys.length !== Object.keys(bo).length) return false;
  return aKeys.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}

export function applyJsonPatch(doc: unknown, patch: JsonPatchOp[]): unknown {
  let result = doc;
  for (const op of patch) {
    switch (op.op) {
      case "add":
        result = addValue(result, op.path, op.value);
        break;
      case "replace":
        result = replaceValue(result, op.path, op.value);
        break;
      case "remove":
        result = removeValue(result, op.path);
        break;
      case "move": {
        const value = getValue(result, op.from);
        result = removeValue(result, op.from);
        result = addValue(result, op.path, value);
        break;
      }
      case "copy": {
        const value = structuredClone(getValue(result, op.from));
        result = addValue(result, op.path, value);
        break;
      }
      case "test":
        if (!deepEqual(getValue(result, op.path), op.value)) {
          throw new Error(`JSON Patch test failed at ${op.path}`);
        }
        break;
      default:
        throw new Error(`Unsupported JSON Patch op: ${JSON.stringify(op)}`);
    }
  }
  return result;
}
