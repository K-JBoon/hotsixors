// Reading top-level `key = "value"` pairs out of Zola's TOML front matter,
// without paying for a TOML parser the gen scripts otherwise don't need.

export function frontmatterValue(source: string, key: string): string | null {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match ? match[1] : null;
}
