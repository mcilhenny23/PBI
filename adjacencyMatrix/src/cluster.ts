"use strict";

/**
 * Hierarchical clustering used for matrix seriation.
 *
 * The goal is *ordering*, not classification: if densely-connected nodes end up
 * adjacent in the row/column order, the matrix shows block-diagonal structure —
 * the whole reason to prefer a matrix over a node-link hairball.
 *
 * Method: agglomerative clustering with **average linkage** over the adjacency
 * row vectors, then the dendrogram's leaf order (a simple DFS) becomes the
 * matrix order. Cluster distances are updated with the Lance-Williams formula
 * for average linkage:
 *
 *     d(k, i∪j) = (|i|·d(k,i) + |j|·d(k,j)) / (|i| + |j|)
 *
 * Complexity is O(n³) worst case (n−1 merges, each scanning the active pair
 * matrix). That's fine for the n < ~400 the caller allows; above that it falls
 * back to degree ordering. Everything here is pure TypeScript — no libraries,
 * nothing to audit beyond this file.
 */

export interface ClusterNode {
    /** Leaf indices in this subtree, already in dendrogram (DFS) order. */
    members: number[];
    left?: ClusterNode;
    right?: ClusterNode;
    /** Distance at which this node's two children merged (0 for leaves). */
    height: number;
}

/** Pairwise Euclidean distance between the rows of a matrix. */
export function euclideanDistances(rows: number[][]): number[][] {
    const n = rows.length;
    const d: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            let sum = 0;
            const ri = rows[i], rj = rows[j];
            for (let k = 0; k < ri.length; k++) {
                const diff = ri[k] - rj[k];
                sum += diff * diff;
            }
            const dist = Math.sqrt(sum);
            d[i][j] = dist;
            d[j][i] = dist;
        }
    }
    return d;
}

/**
 * Agglomerative average-linkage clustering.
 * Returns the dendrogram root, or null for an empty input.
 */
export function agglomerative(dist: number[][]): ClusterNode | null {
    const n = dist.length;
    if (n === 0) return null;
    if (n === 1) return { members: [0], height: 0 };

    // Working copy — merges mutate the active row/column in place.
    const d: number[][] = dist.map(row => row.slice());
    const nodes: (ClusterNode | null)[] = Array.from({ length: n }, (_, i) => ({ members: [i], height: 0 }));
    const sizes = new Array<number>(n).fill(1);
    const active = new Array<boolean>(n).fill(true);
    let remaining = n;

    while (remaining > 1) {
        // Find the closest pair of active clusters.
        let bestA = -1, bestB = -1, bestD = Infinity;
        for (let i = 0; i < n; i++) {
            if (!active[i]) continue;
            for (let j = i + 1; j < n; j++) {
                if (!active[j]) continue;
                if (d[i][j] < bestD) { bestD = d[i][j]; bestA = i; bestB = j; }
            }
        }
        if (bestA < 0) break;   // defensive: nothing left to merge

        // Merge B into A. Concatenating members left-then-right is what makes
        // root.members the dendrogram leaf order.
        const a = nodes[bestA]!, b = nodes[bestB]!;
        nodes[bestA] = {
            members: a.members.concat(b.members),
            left: a, right: b,
            height: bestD
        };
        nodes[bestB] = null;
        active[bestB] = false;

        // Lance-Williams update for average linkage.
        const sA = sizes[bestA], sB = sizes[bestB];
        for (let k = 0; k < n; k++) {
            if (!active[k] || k === bestA) continue;
            const nd = (sA * d[bestA][k] + sB * d[bestB][k]) / (sA + sB);
            d[bestA][k] = nd;
            d[k][bestA] = nd;
        }
        sizes[bestA] = sA + sB;
        remaining--;
    }

    const rootIdx = active.findIndex(Boolean);
    return rootIdx >= 0 ? nodes[rootIdx] : null;
}

/**
 * Cut the dendrogram into (at most) `k` groups by severing the k−1 tallest
 * merges. Returns groups of leaf indices, in leaf order, so group boundaries
 * line up with the matrix ordering.
 */
export function cutIntoGroups(root: ClusterNode | null, k: number): number[][] {
    if (!root) return [];
    if (k <= 1 || !root.left) return [root.members];

    // Collect internal nodes, tallest merges first.
    const internals: ClusterNode[] = [];
    const collect = (nd: ClusterNode) => {
        if (!nd.left || !nd.right) return;
        internals.push(nd);
        collect(nd.left);
        collect(nd.right);
    };
    collect(root);
    internals.sort((x, y) => y.height - x.height);

    const splits = new Set<ClusterNode>(internals.slice(0, Math.max(0, k - 1)));

    // Walk down: descend through split nodes, emit everything else as a group.
    const groups: number[][] = [];
    const walk = (nd: ClusterNode) => {
        if (splits.has(nd) && nd.left && nd.right) {
            walk(nd.left);
            walk(nd.right);
        } else {
            groups.push(nd.members);
        }
    };
    walk(root);
    return groups;
}
