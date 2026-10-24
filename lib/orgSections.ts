// Client-safe, pure. Sections: cohorts arranged as a tree (Department / Year / Section), plans/b2b-college.md B.2.
// A member sits in one node; work assigned to a node covers everyone in it and below it.

export interface CohortNode {
  id: string;
  name: string;
  parentId: string | null;
  archived?: boolean;
}

/** Department / Year / Section. */
export const MAX_DEPTH = 3;

const byId = (nodes: CohortNode[]) => new Map(nodes.map((n) => [n.id, n]));

/** Names from the top of the tree down to this node (empty if the id is unknown). */
export function pathNames(nodes: CohortNode[], id: string): string[] {
  const map = byId(nodes);
  const out: string[] = [];
  const seen = new Set<string>();
  for (let cur = map.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? map.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    out.unshift(cur.name);
  }
  return out;
}

export const pathLabel = (nodes: CohortNode[], id: string, sep = " / ") => pathNames(nodes, id).join(sep);

/** The node and its ancestors, from the top of the tree down (empty if the id is unknown). */
export function ancestry(nodes: CohortNode[], id: string): CohortNode[] {
  const map = byId(nodes);
  const out: CohortNode[] = [];
  const seen = new Set<string>();
  for (let cur = map.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? map.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    out.unshift(cur);
  }
  return out;
}

/** The node and everything below it. */
export function descendantIds(nodes: CohortNode[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const n of nodes) if (n.parentId === out[i] && !out.includes(n.id)) out.push(n.id);
  return out;
}

/** 1 for a top-level node. */
export const depthOf = (nodes: CohortNode[], id: string) => pathNames(nodes, id).length;

/** Levels in the subtree under (and including) this node: 1 for a leaf. */
function height(nodes: CohortNode[], id: string): number {
  const kids = nodes.filter((n) => n.parentId === id);
  return 1 + (kids.length ? Math.max(...kids.map((k) => height(nodes, k.id))) : 0);
}

/**
 * Why `id` can't be placed under `parentId` (null = top level), or null when it can. `id` is null for
 * a node that doesn't exist yet.
 */
export function checkParent(nodes: CohortNode[], id: string | null, parentId: string | null): string | null {
  if (parentId === null) return null;
  if (!nodes.some((n) => n.id === parentId)) return "That parent section doesn't exist.";
  if (id !== null && descendantIds(nodes, id).includes(parentId)) return "A section can't be placed inside itself.";
  const below = id === null ? 1 : height(nodes, id);
  if (depthOf(nodes, parentId) + below > MAX_DEPTH) return `Sections can be nested ${MAX_DEPTH} levels deep at most.`;
  return null;
}

/** Does work for `target` (null = everyone) apply to a member placed in `memberCohort`? */
export function inScope(nodes: CohortNode[], memberCohort: string | null, target: string | null): boolean {
  if (target === null) return true;
  return memberCohort !== null && descendantIds(nodes, target).includes(memberCohort);
}

/** Nodes in tree order (each parent before its children, siblings in the order given). */
export function treeOrder(nodes: CohortNode[]): CohortNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  const out: CohortNode[] = [];
  const walk = (parent: string | null) => {
    for (const n of nodes) {
      if (n.parentId === parent) {
        out.push(n);
        walk(n.id);
      }
    }
  };
  walk(null);
  // Anything whose parent is missing from the list still shows, as a top-level node.
  for (const n of nodes) if (!out.includes(n) && !(n.parentId && ids.has(n.parentId))) out.push(n, ...treeOrder(nodes.filter((x) => x.parentId === n.id)));
  return out;
}

/** The node at a path like ["CSE", "2027", "A"] (names compared ignoring case), or null. Archived nodes are skipped. */
export function findByPath(nodes: CohortNode[], parts: string[]): CohortNode | null {
  let parent: string | null = null;
  let found: CohortNode | null = null;
  for (const part of parts) {
    found = nodes.find((n) => !n.archived && n.parentId === parent && n.name.toLowerCase() === part.trim().toLowerCase()) ?? null;
    if (!found) return null;
    parent = found.id;
  }
  return found;
}
