"use strict";

/**
 * Storyline layout — deciding the vertical order of entities at each time step.
 *
 * The hard part of a storyline is not drawing the lines, it's *ordering* them.
 * Between any two adjacent time slices, every pair of entities whose relative
 * order flips produces a crossing. Minimizing total crossings is the layered
 * graph crossing-minimization problem (NP-hard in general), so we use the
 * standard heuristic from Sugiyama-style layered layout:
 *
 *   **Barycentre sweep.** Sweep left to right: within each group, reorder
 *   entities by their vertical position in the *previous* slice. Then sweep
 *   right to left doing the same against the *next* slice. Repeat a few times.
 *   Entities that stay put keep their relative order; entities that switch
 *   groups slot in near where they came from, which is exactly what keeps the
 *   ribbons from tangling.
 *
 * Group order is held stable across time (alphabetical, or by size) so the
 * bands don't jump around; only the entities inside them are reordered.
 */

export interface StorylineRow {
    entity: string;
    time: string;
    group: string;
}

export interface GroupBand {
    group: string;
    t: number;      // time index
    y0: number;     // top of the band
    y1: number;     // bottom
}

export interface LayoutResult {
    times: string[];
    groups: string[];
    entities: string[];
    /** entity → time index → y position (only where the entity exists). */
    positions: Map<string, Map<number, number>>;
    /** entity → time index → group name. */
    entityGroup: Map<string, Map<number, string>>;
    bands: GroupBand[];
    height: number;
}

export type Ordering = "minimize-crossings" | "alphabetical" | "group-size";

/** Natural-ish comparison so "Q2" sorts before "Q10". */
function naturalCompare(a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function layoutStoryline(
    rows: StorylineRow[],
    opts: { slotHeight: number; groupGap: number; ordering: Ordering; passes?: number }
): LayoutResult | null {
    if (!rows.length) return null;

    // ── Index the data ─────────────────────────────────────────
    const timeSet = new Set<string>();
    const groupCount = new Map<string, number>();
    const entitySet = new Set<string>();
    // time → group → entities
    const membership = new Map<string, Map<string, Set<string>>>();

    for (const r of rows) {
        timeSet.add(r.time);
        entitySet.add(r.entity);
        groupCount.set(r.group, (groupCount.get(r.group) || 0) + 1);
        let byGroup = membership.get(r.time);
        if (!byGroup) { byGroup = new Map(); membership.set(r.time, byGroup); }
        let set = byGroup.get(r.group);
        if (!set) { set = new Set(); byGroup.set(r.group, set); }
        set.add(r.entity);
    }

    const times = Array.from(timeSet).sort(naturalCompare);
    const entities = Array.from(entitySet).sort(naturalCompare);
    const groups = Array.from(groupCount.keys()).sort((a, b) =>
        opts.ordering === "group-size"
            ? (groupCount.get(b)! - groupCount.get(a)!) || naturalCompare(a, b)
            : naturalCompare(a, b));

    const T = times.length;
    if (T === 0) return null;

    // order[t] = Map<group, entity[]> — the thing the sweep mutates.
    const order: Map<string, string[]>[] = [];
    const entityGroup = new Map<string, Map<number, string>>();
    for (const e of entities) entityGroup.set(e, new Map());

    for (let t = 0; t < T; t++) {
        const byGroup = membership.get(times[t]) || new Map<string, Set<string>>();
        const m = new Map<string, string[]>();
        for (const g of groups) {
            const set = byGroup.get(g);
            if (!set || set.size === 0) continue;
            const list = Array.from(set).sort(naturalCompare);   // stable starting point
            m.set(g, list);
            for (const e of list) entityGroup.get(e)!.set(t, g);
        }
        order.push(m);
    }

    // ── Position pass: turn an ordering into y coordinates ─────
    const positions = new Map<string, Map<number, number>>();
    for (const e of entities) positions.set(e, new Map());
    const bands: GroupBand[] = [];
    let height = 0;

    const computePositions = (): void => {
        bands.length = 0;
        height = 0;
        for (const e of entities) positions.get(e)!.clear();
        for (let t = 0; t < T; t++) {
            let y = 0;
            let first = true;
            for (const g of groups) {
                const list = order[t].get(g);
                if (!list || !list.length) continue;
                if (!first) y += opts.groupGap;
                first = false;
                const y0 = y;
                for (const e of list) {
                    y += opts.slotHeight;
                    positions.get(e)!.set(t, y - opts.slotHeight / 2);
                }
                bands.push({ group: g, t, y0, y1: y });
            }
            if (y > height) height = y;
        }
    };

    computePositions();

    // ── Barycentre sweep ───────────────────────────────────────
    if (opts.ordering === "minimize-crossings" && T > 1) {
        const passes = opts.passes ?? 3;

        /** Position of `e` at time `ref`, else its nearest known position. */
        const refY = (e: string, ref: number, dir: number): number => {
            const p = positions.get(e)!;
            if (p.has(ref)) return p.get(ref)!;
            // Walk outward in the sweep direction for the nearest known slot,
            // so entities joining mid-timeline land near where they came from.
            for (let k = ref; k >= 0 && k < T; k -= dir) {
                if (p.has(k)) return p.get(k)!;
            }
            return Number.POSITIVE_INFINITY;   // never seen yet → park at the end
        };

        const sweep = (dir: 1 | -1): void => {
            const from = dir === 1 ? 1 : T - 2;
            const to = dir === 1 ? T : -1;
            for (let t = from; dir === 1 ? t < to : t > to; t += dir) {
                const ref = t - dir;
                for (const [g, list] of order[t]) {
                    const keyed = list.map(e => ({ e, k: refY(e, ref, dir) }));
                    keyed.sort((a, b) => (a.k - b.k) || naturalCompare(a.e, b.e));
                    order[t].set(g, keyed.map(x => x.e));
                }
                computePositions();   // downstream slices read these coordinates
            }
        };

        for (let p = 0; p < passes; p++) {
            sweep(1);
            sweep(-1);
        }
        computePositions();
    }

    return { times, groups, entities, positions, entityGroup, bands, height };
}
