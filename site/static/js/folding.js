// Indentation folding: a line owns every following line that is indented
// deeper than it, which matches both the XML dumps and the Galaxy sources.
function indentWidth(text) {
  const lead = /^[ \t]*/.exec(text)[0];
  return lead.replace(/\t/g, "  ").length;
}

export function computeFolds(texts) {
  const indents = texts.map((text) => (text.trim() ? indentWidth(text) : -1));
  const folds = new Map();

  for (let start = 0; start < texts.length; start++) {
    if (indents[start] < 0) continue;
    let end = start;
    for (let i = start + 1; i < texts.length; i++) {
      if (indents[i] >= 0 && indents[i] <= indents[start]) break;
      if (indents[i] >= 0) end = i;
    }
    if (end > start) folds.set(start, end);
  }
  return folds;
}

export function createFolder(lines, folds) {
  const folded = new Set();

  const setHidden = (index, hidden) => {
    const line = lines[index];
    if (line) line.hidden = hidden;
  };

  function fold(start) {
    const end = folds.get(start);
    if (end === undefined || folded.has(start)) return;
    folded.add(start);
    lines[start]?.setAttribute("data-folded", "true");
    for (let i = start + 1; i <= end; i++) setHidden(i, true);
  }

  function unfold(start) {
    const end = folds.get(start);
    if (end === undefined || !folded.has(start)) return;
    folded.delete(start);
    lines[start]?.removeAttribute("data-folded");
    for (let i = start + 1; i <= end; i++) {
      setHidden(i, false);
      // A nested fold that is still closed keeps its own children hidden.
      if (folded.has(i)) i = folds.get(i);
    }
  }

  return {
    folds,
    isFolded: (start) => folded.has(start),
    toggle: (start) => (folded.has(start) ? unfold(start) : fold(start)),
    fold,
    unfold,
    foldAll() {
      for (const start of folds.keys()) {
        folded.add(start);
        lines[start]?.setAttribute("data-folded", "true");
        setHidden(start, false);
      }
      for (const [start, end] of folds) {
        for (let i = start + 1; i <= end; i++) setHidden(i, true);
      }
    },
    unfoldAll() {
      folded.clear();
      for (const line of lines) {
        line.hidden = false;
        line.removeAttribute("data-folded");
      }
    },
  };
}
