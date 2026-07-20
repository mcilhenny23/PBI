"use strict";

/**
 * Event-sequence bundling — the EventFlow idiom.
 *
 * Where a directly-follows graph collapses every case into one map (and loses
 * *when* things happened), this keeps temporal order: sequences are aligned on
 * an anchor, then merged into a **prefix tree**. Cases that begin the same way
 * share a branch and only split where their paths actually diverge, so the
 * picture reads as a flow — thick trunks where everyone agrees, fraying where
 * behaviour scatters.
 *
 * Three steps:
 *   1. **Build** — insert each aligned sequence into a trie, incrementing a
 *      case count at every node it passes through.
 *   2. **Prune** — drop branches carrying fewer than `minSupport` cases. Rare
 *      one-off paths are the majority of distinct behaviour and would fray the
 *      diagram into noise; the dropped cases are counted, not hidden.
 *   3. **Lay out** — depth becomes the column, case count becomes the height.
 *      Sibling subtrees stay contiguous (DFS order), which is what makes the
 *      connecting ribbons non-crossing by construction.
 */

export interface TrieNode {
    event: string;          // "" for the synthetic root
    depth: number;          // 0 = root, 1 = first event after the anchor
    count: number;          // cases passing through this node
    children: TrieNode[];
    parent: TrieNode | null;

    // Layout, filled in by layoutTrie()
    y0: number;
    y1: number;
    /** Slice of the parent's trailing edge this node's ribbon leaves from. */
    srcY0: number;
    srcY1: number;
}

export interface LayoutOptions {
    height: number;         // pixels available for the whole flow
    gap: number;            // vertical gap between adjacent blocks in a column
    minBandHeight: number;  // floor so a thin bundle stays visible
}

export interface TrieStats {
    /** Cases removed by the support threshold. */
    prunedCases: number;
    /** Deepest column retained. */
    maxDepth: number;
    /** Nodes per depth, index 1..maxDepth. */
    levels: TrieNode[][];
    scale: number;          // pixels per case
}

function newNode(event: string, depth: number, parent: TrieNode | null): TrieNode {
    return { event, depth, count: 0, children: [], parent, y0: 0, y1: 0, srcY0: 0, srcY1: 0 };
}

/** Insert aligned sequences into a prefix tree, truncated at `maxDepth`. */
export function buildTrie(sequences: string[][], maxDepth: number): TrieNode {
    const root = newNode("", 0, null);
    for (const seq of sequences) {
        root.count++;
        let node = root;
        const limit = Math.min(seq.length, Math.max(1, maxDepth));
        for (let i = 0; i < limit; i++) {
            const ev = seq[i];
            let child = node.children.find(c => c.event === ev);
            if (!child) {
                child = newNode(ev, node.depth + 1, node);
                node.children.push(child);
            }
            child.count++;
            node = child;
        }
    }
    return root;
}

/**
 * Remove branches below the support threshold.
 * Returns how many cases were dropped, so the caller can report it.
 */
export function pruneTrie(root: TrieNode, minSupport: number): number {
    let pruned = 0;
    const visit = (node: TrieNode): void => {
        const keep: TrieNode[] = [];
        for (const c of node.children) {
            if (c.count < minSupport) {
                pruned += c.count;     // these cases simply end here
                continue;
            }
            keep.push(c);
            visit(c);
        }
        node.children = keep;
    };
    visit(root);
    return pruned;
}

/**
 * Assign columns and vertical extents.
 *
 * Children are ordered by descending count so the dominant path forms a stable
 * trunk along the top, and a depth-first walk keeps each subtree contiguous —
 * that contiguity is what guarantees the ribbons between columns never cross.
 */
export function layoutTrie(root: TrieNode, opts: LayoutOptions): TrieStats {
    // Order children heaviest-first, everywhere.
    const sortRec = (n: TrieNode): void => {
        n.children.sort((a, b) => (b.count - a.count) || a.event.localeCompare(b.event));
        n.children.forEach(sortRec);
    };
    sortRec(root);

    // Collect nodes per depth in DFS pre-order.
    const levels: TrieNode[][] = [];
    let maxDepth = 0;
    const dfs = (n: TrieNode): void => {
        if (n.depth > 0) {
            if (!levels[n.depth]) levels[n.depth] = [];
            levels[n.depth].push(n);
            if (n.depth > maxDepth) maxDepth = n.depth;
        }
        n.children.forEach(dfs);
    };
    dfs(root);

    // Reserve gap space for the busiest column before converting cases → pixels.
    let maxNodesInLevel = 1;
    for (let d = 1; d <= maxDepth; d++) {
        const n = levels[d] ? levels[d].length : 0;
        if (n > maxNodesInLevel) maxNodesInLevel = n;
    }
    const gapTotal = Math.max(0, (maxNodesInLevel - 1) * opts.gap);
    const usable = Math.max(1, opts.height - gapTotal);
    const scale = root.count > 0 ? usable / root.count : 1;

    for (let d = 1; d <= maxDepth; d++) {
        const nodes = levels[d] || [];
        let cursor = 0;
        for (const n of nodes) {
            const h = Math.max(opts.minBandHeight, n.count * scale);
            n.y0 = cursor;
            n.y1 = cursor + h;
            cursor = n.y1 + opts.gap;
        }
    }

    // Ribbon source slices: children leave the parent's trailing edge in order,
    // stacked to match their own heights.
    const assignSources = (n: TrieNode): void => {
        let cursor = n.depth === 0 ? 0 : n.y0;
        for (const c of n.children) {
            const h = c.y1 - c.y0;
            c.srcY0 = cursor;
            c.srcY1 = cursor + h;
            cursor = c.srcY1;
            assignSources(c);
        }
    };
    assignSources(root);

    return { prunedCases: 0, maxDepth, levels, scale };
}

// ── Alignment ──────────────────────────────────────────────────

export type Anchor = "first-event" | "last-event" | "selected";

export interface AlignedSequences {
    /** Events at and after the anchor, in order. */
    forward: string[][];
    /** Events before the anchor, reversed (nearest the anchor first). */
    backward: string[][];
    /** Cases that had no anchor event and were excluded. */
    excluded: number;
}

/**
 * Align sequences on the chosen anchor.
 *
 * "first-event" and "last-event" are one-sided. Aligning on a *named* event is
 * the interesting case: it splits every case in two, so the diagram can grow
 * left (what led up to it) and right (what followed) from a shared column.
 */
export function alignSequences(
    sequences: string[][], anchor: Anchor, anchorEvent: string
): AlignedSequences {
    if (anchor === "last-event") {
        // Reverse everything; the caller renders this tree right-to-left.
        return { forward: sequences.map(s => s.slice().reverse()), backward: [], excluded: 0 };
    }
    if (anchor === "selected" && anchorEvent) {
        const forward: string[][] = [];
        const backward: string[][] = [];
        let excluded = 0;
        for (const s of sequences) {
            const i = s.indexOf(anchorEvent);
            if (i < 0) { excluded++; continue; }
            forward.push(s.slice(i));
            backward.push(s.slice(0, i).reverse());
        }
        return { forward, backward, excluded };
    }
    return { forward: sequences.map(s => s.slice()), backward: [], excluded: 0 };
}
