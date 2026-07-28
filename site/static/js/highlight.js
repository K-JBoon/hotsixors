
export function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

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

function highlightXmlAttributes(value) {
  const pattern = /([A-Za-z_:$][\w:.$-]*)(\s*=\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s"'=<>`]+)?/g;
  let html = "";
  let index = 0;
  let match;

  while ((match = pattern.exec(value)) !== null) {
    html += escapeHtml(value.slice(index, match.index));
    html += `<span class="syntax-attr">${escapeHtml(match[1])}</span>`;
    html += escapeHtml(match[2]);
    if (match[3]) html += `<span class="syntax-string">${escapeHtml(match[3])}</span>`;
    index = pattern.lastIndex;
  }

  return html + escapeHtml(value.slice(index));
}

function highlightXmlTag(value) {
  const close = value.endsWith("?>") ? "?>" : value.endsWith("/>") ? "/>" : ">";
  const body = value.slice(0, -close.length);
  const match = body.match(/^(<\/?|<\?)([A-Za-z_:$][\w:.$-]*)([\s\S]*)$/);

  if (!match) return escapeHtml(value);

  return [
    `<span class="syntax-tag">${escapeHtml(match[1] + match[2])}</span>`,
    highlightXmlAttributes(match[3]),
    `<span class="syntax-punctuation">${escapeHtml(close)}</span>`,
  ].join("");
}

function highlightXmlLine(value) {
  const text = String(value || "");
  let html = "";
  let index = 0;

  while (index < text.length) {
    const tagStart = text.indexOf("<", index);
    if (tagStart === -1) {
      html += escapeHtml(text.slice(index));
      break;
    }

    html += escapeHtml(text.slice(index, tagStart));

    if (text.startsWith("<!--", tagStart)) {
      const commentEnd = text.indexOf("-->", tagStart + 4);
      const end = commentEnd === -1 ? text.length : commentEnd + 3;
      html += `<span class="syntax-comment">${escapeHtml(text.slice(tagStart, end))}</span>`;
      index = end;
      continue;
    }

    const tagEnd = text.indexOf(">", tagStart + 1);
    if (tagEnd === -1) {
      html += escapeHtml(text.slice(tagStart));
      break;
    }

    html += highlightXmlTag(text.slice(tagStart, tagEnd + 1));
    index = tagEnd + 1;
  }

  return html;
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

export function highlightGameDataLine(value, lang) {
  if (lang === "xml") return highlightXmlLine(value);
  if (lang === "galaxy") return highlightGalaxyCode(value);
  return escapeHtml(value);
}
