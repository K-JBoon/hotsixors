// Dev-only copy editor. Matches rendered text against the copy registry and
// writes edits back into the template, markdown or config file it came from.
const API = new URL(".", import.meta.url).href.replace(/\/$/, "");
const STATE_KEY = "hotsixors.copy-edit";
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "SVG", "PRE", "CODE", "TEXTAREA", "INPUT"]);

const normalize = (text) => (text ?? "").replace(/\s+/g, " ").trim();

/** Line breaks render as <br>, so they have to read back as newlines. */
function readText(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
  let text = "";
  for (const child of node.childNodes) text += child.nodeName === "BR" ? "\n" : readText(child);
  return text;
}

const index = new Map();
const targets = new Map();
let enabled = false;
let counter = 0;

const ui = document.createElement("div");
ui.id = "copy-edit-ui";
const shadow = ui.attachShadow({ mode: "open" });
shadow.innerHTML = `
<style>
  :host { position: fixed; inset: auto 1rem 1rem auto; z-index: 2147483647; font: 13px/1.45 system-ui, sans-serif; }
  button { font: inherit; cursor: pointer; border-radius: 4px; border: 1px solid #3b4a68; background: #16203a; color: #dde6ff; padding: .35rem .6rem; }
  button:hover { background: #22304f; }
  .pill { display: flex; justify-content: flex-end; }
  .panel { display: none; width: min(34rem, 90vw); margin-top: .5rem; background: #0b1020; color: #dde6ff;
           border: 1px solid #263553; border-radius: 6px; padding: .7rem; box-shadow: 0 8px 30px rgba(0,0,0,.5); }
  .panel[data-open] { display: block; }
  .where { color: #7f93bd; font-size: 12px; margin-bottom: .4rem; word-break: break-all; }
  select, textarea { width: 100%; font: inherit; background: #131c31; color: #dde6ff; border: 1px solid #2c3c5e; border-radius: 4px; padding: .4rem; }
  textarea { min-height: 7rem; resize: vertical; font-family: ui-monospace, monospace; }
  .row { display: flex; gap: .5rem; align-items: center; justify-content: space-between; margin-top: .5rem; }
  .status { color: #7f93bd; font-size: 12px; }
  .status[data-error] { color: #ff9b9b; }
</style>
<div class="pill"><button id="toggle">Edit copy</button></div>
<div class="panel" id="panel">
  <div class="where" id="where"></div>
  <select id="pick" hidden></select>
  <textarea id="text" spellcheck="true"></textarea>
  <div class="row">
    <span class="status" id="status"></span>
    <span><button id="cancel">Cancel</button> <button id="save">Save</button></span>
  </div>
</div>`;

const el = (id) => shadow.getElementById(id);
const style = document.createElement("style");
style.textContent = `
  [data-copy-edit] { outline: 1px dashed rgba(120, 180, 255, .55); outline-offset: 2px; cursor: text; }
  [data-copy-edit]:hover { outline-color: #6fb0ff; background: rgba(111, 176, 255, .08); }
  [data-copy-edit][data-copy-saving] { outline-color: #ffd479; }
`;

function buildIndex(entries) {
  index.clear();
  for (const entry of entries) {
    const key = normalize(entry.text);
    if (key.length < 2) continue;
    const list = index.get(key);
    if (list) list.push(entry);
    else index.set(key, [entry]);
  }
}

function mark(node, entries) {
  const id = `c${counter++}`;
  node.setAttribute("data-copy-edit", id);
  targets.set(id, entries);
}

function markElements() {
  const matched = [];
  for (const node of document.body.querySelectorAll("*")) {
    if (node === ui || SKIP_TAGS.has(node.tagName) || ui.contains(node)) continue;
    const entries = index.get(normalize(readText(node)));
    if (entries) matched.push([node, entries]);
  }
  for (const [node, entries] of matched) {
    if (matched.some(([other]) => other !== node && node.contains(other))) continue;
    mark(node, entries);
  }
}

function markTextNodes() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const pending = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName) || ui.contains(parent)) continue;
    if (parent.closest("[data-copy-edit]")) continue;
    const entries = index.get(normalize(node.nodeValue));
    if (entries) pending.push([node, entries]);
  }
  for (const [node, entries] of pending) {
    const span = document.createElement("span");
    node.after(span);
    span.append(node);
    mark(span, entries);
  }
}

/** Ambiguous text resolves to the file this page already matched most. */
function rankTargets() {
  const weight = new Map();
  for (const entries of targets.values()) {
    if (entries.length !== 1) continue;
    weight.set(entries[0].file, (weight.get(entries[0].file) ?? 0) + 1);
  }
  for (const entries of targets.values()) {
    if (entries.length > 1) entries.sort((a, b) => (weight.get(b.file) ?? 0) - (weight.get(a.file) ?? 0));
  }
}

function scanPage() {
  for (const node of document.querySelectorAll("[data-copy-edit]")) node.removeAttribute("data-copy-edit");
  targets.clear();
  markElements();
  markTextNodes();
  rankTargets();
}

let editing = null;

function openPanel(node, entries) {
  const pick = el("pick");
  pick.hidden = entries.length < 2;
  pick.innerHTML = entries.map((entry, i) => `<option value="${i}">${entry.file}:${entry.line} [${entry.label}]</option>`).join("");
  showEntry(node, entries, 0);
  el("panel").setAttribute("data-open", "");
  el("text").focus();
}

function showEntry(node, entries, which) {
  const entry = entries[which];
  editing = { node, entries, entry };
  el("where").textContent = `${entry.file}:${entry.line} · ${entry.label} · ${entry.kind}`;
  el("text").value = entry.raw;
  setStatus(entry.regen ? `saving reruns ${entry.regen}` : "");
}

function closePanel() {
  el("panel").removeAttribute("data-open");
  editing = null;
}

function setStatus(message, isError = false) {
  const status = el("status");
  status.textContent = message;
  if (isError) status.setAttribute("data-error", "");
  else status.removeAttribute("data-error");
}

async function save(entry, text, node) {
  node?.setAttribute("data-copy-saving", "");
  setStatus(entry.regen ? `running ${entry.regen}…` : "saving…");
  try {
    const response = await fetch(`${API}/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: entry.id, expected: entry.raw, text }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? response.statusText);
    entry.raw = body.entry.raw;
    entry.text = body.entry.text;
    setStatus("saved");
    return true;
  } catch (error) {
    setStatus(error.message, true);
    return false;
  } finally {
    node?.removeAttribute("data-copy-saving");
  }
}

function editInline(node, entry) {
  const before = readText(node);
  const beforeHtml = node.innerHTML;
  node.setAttribute("contenteditable", "plaintext-only");
  node.focus();

  const stop = async (commit) => {
    node.removeAttribute("contenteditable");
    node.removeEventListener("keydown", onKey);
    node.removeEventListener("blur", onBlur);
    const next = readText(node);
    if (!commit || next === before) {
      node.innerHTML = beforeHtml;
      return;
    }
    if (!(await save(entry, next, node))) node.innerHTML = beforeHtml;
  };
  const onKey = (event) => {
    if (event.key === "Escape") stop(false);
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      stop(true);
    }
  };
  const onBlur = () => stop(true);
  node.addEventListener("keydown", onKey);
  node.addEventListener("blur", onBlur);
}

function onClick(event) {
  if (!enabled) return;
  const path = event.composedPath();
  if (path.includes(ui)) return;
  const node = event.target.closest?.("[data-copy-edit]");
  if (!node) return;
  event.preventDefault();
  event.stopPropagation();
  const entries = targets.get(node.getAttribute("data-copy-edit"));
  if (!entries) return;
  const rendered = readText(node);
  const plain = entries.length === 1 && normalize(entries[0].raw) === normalize(rendered) && !node.querySelector(":not(br)");
  if (plain) editInline(node, entries[0]);
  else openPanel(node, entries);
}

function setEnabled(next) {
  enabled = next;
  el("toggle").textContent = enabled ? "Stop editing" : "Edit copy";
  document.documentElement.classList.toggle("copy-edit-on", enabled);
  if (!enabled) closePanel();
  if (enabled) scanPage();
  else {
    for (const node of document.querySelectorAll("[data-copy-edit]")) node.removeAttribute("data-copy-edit");
    targets.clear();
  }
  try {
    sessionStorage.setItem(STATE_KEY, String(enabled));
  } catch {}
}

async function init() {
  const response = await fetch(`${API}/registry`);
  buildIndex((await response.json()).entries);

  document.head.append(style);
  document.body.append(ui);
  el("toggle").addEventListener("click", () => setEnabled(!enabled));
  el("cancel").addEventListener("click", closePanel);
  el("pick").addEventListener("change", (event) => showEntry(editing.node, editing.entries, Number(event.target.value)));
  el("save").addEventListener("click", async () => {
    if (editing && (await save(editing.entry, el("text").value, editing.node))) closePanel();
  });
  el("text").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) el("save").click();
    if (event.key === "Escape") closePanel();
  });
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "e") {
      event.preventDefault();
      setEnabled(!enabled);
    }
  });

  let stored = false;
  try {
    stored = sessionStorage.getItem(STATE_KEY) === "true";
  } catch {}
  setEnabled(stored);
}

init().catch((error) => console.warn("copy-edit:", error.message));
