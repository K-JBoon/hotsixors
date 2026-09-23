import { escapeHtml } from "./escape.js";

const GALAXY_KEYWORDS = new Set([
  "break",
  "case",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "for",
  "if",
  "include",
  "return",
  "static",
  "switch",
  "while",
]);

const GALAXY_TYPES = new Set([
  "abilcmd",
  "actor",
  "bool",
  "button",
  "camerainfo",
  "color",
  "fixed",
  "int",
  "order",
  "playergroup",
  "point",
  "region",
  "sound",
  "string",
  "text",
  "timer",
  "trigger",
  "unit",
  "unitgroup",
  "void",
  "wave",
]);

function highlightXmlAttributes(value, linkFor) {
  const pattern = /([A-Za-z_:$][\w:.$-]*)(\s*=\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s"'=<>`]+)?/g;
  let html = "";
  let index = 0;
  let match;

  while ((match = pattern.exec(value)) !== null) {
    html += escapeHtml(value.slice(index, match.index));
    html += `<span class="syntax-attr">${escapeHtml(match[1])}</span>`;
    html += escapeHtml(match[2]);
    if (match[3]) html += highlightAttrValue(match[3], linkFor);
    index = pattern.lastIndex;
  }

  return html + escapeHtml(value.slice(index));
}

function highlightAttrValue(raw, linkFor) {
  const quoted = /^["']/.test(raw) && raw.length > 1;
  const inner = quoted ? raw.slice(1, -1) : raw;
  const link = linkFor ? linkFor(inner) : null;
  if (!link) return `<span class="syntax-string">${escapeHtml(raw)}</span>`;

  const quote = quoted ? raw[0] : "";
  const anchor = `<a class="xref-link" href="${escapeHtml(link.href)}" data-xref-id="${escapeHtml(link.id)}">${escapeHtml(inner)}</a>`;
  return `<span class="syntax-string">${escapeHtml(quote)}${anchor}${escapeHtml(quote)}</span>`;
}

function highlightXmlTag(value, linkFor, opening = true) {
  const close = value.endsWith("?>") ? "?>" : value.endsWith("/>") ? "/>" : value.endsWith(">") ? ">" : "";
  const body = close ? value.slice(0, -close.length) : value;
  const closeHtml = close ? `<span class="syntax-punctuation">${escapeHtml(close)}</span>` : "";

  if (!opening) return highlightXmlAttributes(body, linkFor) + closeHtml;

  const match = body.match(/^(<\/?|<\?)([A-Za-z_:$][\w:.$-]*)([\s\S]*)$/);
  if (!match) return escapeHtml(value);

  return [
    `<span class="syntax-tag">${escapeHtml(match[1] + match[2])}</span>`,
    highlightXmlAttributes(match[3], linkFor),
    closeHtml,
  ].join("");
}

export function highlightGalaxyCode(value) {
  const text = String(value || "");
  const tokenPattern = /(\/\/.*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  let html = "";
  let index = 0;
  let match;

  while ((match = tokenPattern.exec(text)) !== null) {
    const token = match[0];
    html += escapeHtml(text.slice(index, match.index));

    if (token.startsWith("//")) {
      html += `<span class="syntax-comment">${escapeHtml(token)}</span>`;
    } else if (token.startsWith('"') || token.startsWith("'")) {
      html += `<span class="syntax-string">${escapeHtml(token)}</span>`;
    } else if (/^\d/.test(token)) {
      html += `<span class="syntax-number">${escapeHtml(token)}</span>`;
    } else if (GALAXY_KEYWORDS.has(token)) {
      html += `<span class="syntax-keyword">${escapeHtml(token)}</span>`;
    } else if (GALAXY_TYPES.has(token)) {
      html += `<span class="syntax-type">${escapeHtml(token)}</span>`;
    } else {
      html += escapeHtml(token);
    }

    index = tokenPattern.lastIndex;
  }

  return html + escapeHtml(text.slice(index));
}

// Stateful XML highlighting: comments and tags may span several lines, and
// each line is rendered into its own element.
export function createXmlHighlighter() {
  let mode = "text";

  const consumeComment = (text, start) => {
    const end = text.indexOf("-->", start);
    const stop = end === -1 ? text.length : end + 3;
    mode = end === -1 ? "comment" : "text";
    return { html: `<span class="syntax-comment">${escapeHtml(text.slice(start, stop))}</span>`, next: stop };
  };

  // A tag fragment: the opening line carries the tag name, later lines only attributes.
  const consumeTag = (text, start, linkFor, opening) => {
    let index = start;
    let quote = "";
    while (index < text.length) {
      const char = text[index];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        index += 1;
        mode = "text";
        return { html: highlightXmlTag(text.slice(start, index), linkFor, opening), next: index };
      }
      index += 1;
    }
    mode = "tag";
    return { html: highlightXmlTag(text.slice(start), linkFor, opening), next: text.length };
  };

  return function highlightLine(value, linkFor) {
    const text = String(value ?? "");
    let html = "";
    let index = 0;

    if (mode === "comment") {
      const { html: commentHtml, next } = consumeComment(text, 0);
      html += commentHtml;
      index = next;
    } else if (mode === "tag") {
      const { html: tagHtml, next } = consumeTag(text, 0, linkFor, false);
      html += tagHtml;
      index = next;
    }

    while (index < text.length) {
      const tagStart = text.indexOf("<", index);
      if (tagStart === -1) {
        html += escapeHtml(text.slice(index));
        break;
      }

      html += escapeHtml(text.slice(index, tagStart));

      if (text.startsWith("<!--", tagStart)) {
        const { html: commentHtml, next } = consumeComment(text, tagStart);
        html += commentHtml;
        index = next;
        continue;
      }

      const { html: tagHtml, next } = consumeTag(text, tagStart, linkFor, true);
      html += tagHtml;
      index = next;
    }

    return html;
  };
}

export function highlightGameDataLine(value, lang, linkFor) {
  if (lang === "xml") return createXmlHighlighter()(value, linkFor);
  if (lang === "galaxy") return highlightGalaxyCode(value);
  return escapeHtml(value);
}

export function highlightCode(text, lang) {
  const highlightLine = lang === "xml" ? createXmlHighlighter() : (line) => highlightGameDataLine(line, lang);
  return String(text ?? "").split("\n").map((line) => highlightLine(line)).join("\n");
}
