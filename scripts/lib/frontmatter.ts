// Zola's TOML front matter. The gen scripts write a small, fixed shape of it
// and read a few top-level strings back, which needs no TOML parser.

export function frontmatterValue(source: string, key: string): string | null {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match ? match[1] : null;
}

function tomlValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).map(([k, v]) => `${k} = ${tomlValue(v)}`).join(", ")}}`;
  }
  return JSON.stringify(value);
}

function tomlLines(fields: Record<string, unknown>): string[] {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key} = ${tomlValue(value)}`);
}

/** Renders a `+++` block, with `extra` under Zola's `[extra]` table. */
export function frontmatter(fields: Record<string, unknown>, extra?: Record<string, unknown>): string {
  const lines = tomlLines(fields);
  if (extra) lines.push("", "[extra]", ...tomlLines(extra));
  return `+++\n${lines.join("\n")}\n+++\n`;
}
