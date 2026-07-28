
import { matchesSearchEntry } from './search.js';
import { escapeHtml } from './highlight.js';

export function treeNodeContentPath(node) {
  return node.type === "dir"
    ? `content/gamedata/${node.path}/_index.md`
    : `content/gamedata/${node.path}.md`;
}

function renderGameDataTreeNode(node, currentPath) {
  const name = escapeHtml(node.name);
  const nodePath = escapeHtml(node.path);
  const searchText = escapeHtml(`${node.name} ${node.path}`);

  if (node.type === "dir") {
    const nodePrefix = treeNodeContentPath(node);
    const isActive = currentPath === nodePrefix || currentPath.startsWith(`content/gamedata/${node.path}/`);
    const summaryClass = currentPath === nodePrefix ? "tree-dir__name tree-active" : "tree-dir__name";
    const children = (node.children || [])
      .map((child) => `<li>${renderGameDataTreeNode(child, currentPath)}</li>`)
      .join("");

    const viewLink = `<li><a class="tree-dir__view" href="/gamedata/${nodePath}/">↗ ${name}/</a></li>`;
    return `<details class="tree-dir" data-tree-node data-tree-path="${nodePath}" data-tree-search="${searchText}"${isActive ? " open" : ""}>
      <summary class="${summaryClass}">${name}</summary>
      <ul class="tree-children">${viewLink}${children}</ul>
    </details>`;
  }

  const isActive = currentPath === treeNodeContentPath(node);
  const fileClass = isActive ? "tree-file tree-active" : "tree-file";
  return `<a class="${fileClass}" href="/gamedata/${nodePath}/" data-tree-node data-tree-path="${nodePath}" data-tree-search="${searchText}">${name}</a>`;
}

export function renderGameDataTree(tree, currentPath = "") {
  return (tree?.children || [])
    .map((node) => renderGameDataTreeNode(node, currentPath))
    .join("");
}

export function setTreeNodeVisible(node, visible) {
  node.hidden = !visible;
  if (node.parentElement?.tagName === "LI") node.parentElement.hidden = !visible;
}

export function restoreTree(root) {
  for (const node of root.querySelectorAll("[data-tree-node]")) {
    setTreeNodeVisible(node, true);
    if (node.tagName === "DETAILS") node.open = node.dataset.initialOpen === "true";
  }
}

export function filterTreeNode(node, query, aliases) {
  const selfMatches = matchesSearchEntry({
    title: node.dataset.treeSearch || node.textContent || "",
    path: node.dataset.treePath || "",
  }, query, aliases);

  let childMatches = false;
  const children = node.matches("details")
    ? [...node.querySelectorAll(":scope > .tree-children > li > [data-tree-node]")]
    : [];

  for (const child of children) {
    if (filterTreeNode(child, query, aliases)) childMatches = true;
  }

  const visible = selfMatches || childMatches;
  setTreeNodeVisible(node, visible);
  if (node.matches("details")) node.open = visible && childMatches;
  return visible;
}
