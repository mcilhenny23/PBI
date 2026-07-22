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

// ── Aggregate flow (Sankey-style) ────────────────────────────────
//
// For scale. Once entities number in the hundreds the per-line view is
// spaghetti; aggregate mode collapses to one thick band per group at each
// time, sized by member count, with ribbons showing the transitions between
// adjacent times. Same input data — the algorithm just counts instead of
// carrying individual paths.

export interface FlowSlice {
    time: string;
    tIdx: number;
    groups: { group: string; count: number; y0: number; y1: number }[];
    total: number;
}

export interface FlowRibbon {
    t: number;
    from: string;
    to: string;
    count: number;
    /** Vertical stripe on the source side. */
    y0Src: number;
    y1Src: number;
    /** Vertical stripe on the target side. */
    y0Tgt: number;
    y1Tgt: number;
}

export interface AggregateLayout {
    times: string[];
    groups: string[];
    slices: FlowSlice[];
    ribbons: FlowRibbon[];
    height: number;
    totalEntities: number;
    /** Entities that appear at some time but disappear at the next — for reporting. */
    droppedTransitions: number;
    /** Entities that appear for the first time at a non-first time step — reported. */
    enteredTransitions: number;
}

interface Trans {
    from: string;
    to: string;
    count: number;
    /** Sub-band top on the source side, filled during layout. */
    y0Src: number;
    y1Src: number;
    y0Tgt: number;
    y1Tgt: number;
}

/**
 * Build an aggregate flow layout.
 *
 * At each time t: groups stack vertically in a stable order, with band height
 * proportional to count. Between t and t+1: for each (source, target) pair
 * that has entities, a ribbon connects a stripe of the source band to a
 * stripe of the target band.
 *
 * Within each source band the outgoing transitions are ordered by their
 * *target group's* vertical position at t+1, and within each target band the
 * incoming transitions are ordered by their *source group's* position at t.
 * That's the standard Sankey stacking; it minimises ribbon crossings without
 * needing a full optimiser.
 */
export function aggregateStoryline(
    rows: StorylineRow[],
    opts: { unitHeight: number; groupGap: number }
): AggregateLayout | null {
    if (!rows.length) return null;

    const timeSet = new Set<string>();
    const groupSet = new Set<string>();
    const entityGroupByTime = new Map<string, Map<string, string>>();   // t → entity → group

    for (const r of rows) {
        timeSet.add(r.time);
        groupSet.add(r.group);
        let e = entityGroupByTime.get(r.time);
        if (!e) { e = new Map(); entityGroupByTime.set(r.time, e); }
        e.set(r.entity, r.group);
    }
    const times = Array.from(timeSet).sort(naturalCompare);
    const groups = Array.from(groupSet).sort(naturalCompare);
    const groupIdx = new Map<string, number>();
    groups.forEach((g, i) => groupIdx.set(g, i));

    // ── Per-time counts ────────────────────────────────────────
    const counts: Map<string, number>[] = times.map(() => new Map());
    const entities = new Set<string>();
    for (let ti = 0; ti < times.length; ti++) {
        const em = entityGroupByTime.get(times[ti]);
        if (!em) continue;
        for (const [ent, g] of em) {
            entities.add(ent);
            counts[ti].set(g, (counts[ti].get(g) || 0) + 1);
        }
    }
    const unitH = Math.max(0.5, opts.unitHeight);
    const gap = Math.max(0, opts.groupGap);

    // Slice geometry: groups stacked top-to-bottom in group order.
    let maxHeight = 0;
    const slices: FlowSlice[] = times.map((tName, ti) => {
        let y = 0;
        const gs: FlowSlice["groups"] = [];
        for (const g of groups) {
            const c = counts[ti].get(g) || 0;
            if (c === 0) continue;
            const h = c * unitH;
            gs.push({ group: g, count: c, y0: y, y1: y + h });
            y += h + gap;
        }
        const total = y > 0 ? y - gap : 0;
        if (total > maxHeight) maxHeight = total;
        return { time: tName, tIdx: ti, groups: gs, total };
    });

    // Centre each slice vertically so growth reads as expansion from the middle
    // rather than a shove downwards. Applied by shifting every band by
    // (maxHeight - total)/2.
    for (const s of slices) {
        const shift = (maxHeight - s.total) / 2;
        for (const g of s.groups) { g.y0 += shift; g.y1 += shift; }
    }

    // ── Adjacent-time transitions ─────────────────────────────
    // For each (t, t+1): every entity present in both contributes one
    // transition. Absent-then-present or present-then-absent are counted
    // separately and reported; they're not drawn (nothing to connect to).
    const ribbons: FlowRibbon[] = [];
    let dropped = 0, entered = 0;

    for (let t = 0; t < times.length - 1; t++) {
        const at = entityGroupByTime.get(times[t]) || new Map();
        const bt = entityGroupByTime.get(times[t + 1]) || new Map();
        const trans = new Map<string, Trans>();
        for (const [e, from] of at) {
            const to = bt.get(e);
            if (to == null) { dropped++; continue; }
            const k = from + "\x00" + to;
            let tr = trans.get(k);
            if (!tr) { tr = { from, to, count: 0, y0Src: 0, y1Src: 0, y0Tgt: 0, y1Tgt: 0 }; trans.set(k, tr); }
            tr.count++;
        }
        // Entered = present at t+1 but not at t.
        for (const e of bt.keys()) if (!at.has(e)) entered++;

        // Left-side stacking: within each source group's band, allocate
        // sub-stripes to outgoing transitions ordered by their target's
        // vertical position at t+1. Target index is (groups[].indexOf(to)),
        // and the destination slice ordering is stable (group order).
        const bySource = new Map<string, Trans[]>();
        for (const tr of trans.values()) {
            let arr = bySource.get(tr.from); if (!arr) { arr = []; bySource.set(tr.from, arr); }
            arr.push(tr);
        }
        const sliceA = slices[t];
        const sliceB = slices[t + 1];
        for (const [src, arr] of bySource) {
            arr.sort((a, b) => groupIdx.get(a.to)! - groupIdx.get(b.to)!);
            const band = sliceA.groups.find(g => g.group === src);
            if (!band) continue;
            let y = band.y0;
            for (const tr of arr) {
                const h = tr.count * unitH;
                tr.y0Src = y; tr.y1Src = y + h;
                y += h;
            }
        }
        // Right-side stacking: within each target group, order by source.
        const byTarget = new Map<string, Trans[]>();
        for (const tr of trans.values()) {
            let arr = byTarget.get(tr.to); if (!arr) { arr = []; byTarget.set(tr.to, arr); }
            arr.push(tr);
        }
        for (const [tgt, arr] of byTarget) {
            arr.sort((a, b) => groupIdx.get(a.from)! - groupIdx.get(b.from)!);
            const band = sliceB.groups.find(g => g.group === tgt);
            if (!band) continue;
            let y = band.y0;
            for (const tr of arr) {
                const h = tr.count * unitH;
                tr.y0Tgt = y; tr.y1Tgt = y + h;
                y += h;
            }
        }

        for (const tr of trans.values()) {
            ribbons.push({ t, from: tr.from, to: tr.to, count: tr.count,
                y0Src: tr.y0Src, y1Src: tr.y1Src, y0Tgt: tr.y0Tgt, y1Tgt: tr.y1Tgt });
        }
    }

    return {
        times, groups, slices, ribbons,
        height: maxHeight, totalEntities: entities.size,
        droppedTransitions: dropped, enteredTransitions: entered
    };
}

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
