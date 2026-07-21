"use strict";

/**
 * Compute-cache fingerprinting.
 *
 * ── The problem ──────────────────────────────────────────────────
 * Power BI calls `update()` for *everything* — resize, theme change, and every
 * nudge of a colour picker or font size in the format pane. Visuals that do
 * heavy work (an O(n²) matrix profile, a sliding-window FFT, agglomerative
 * clustering, a dagre layout) redo all of it on each call, so changing a colour
 * can stall the report for seconds even though the computation's inputs never
 * moved.
 *
 * ── The fix ──────────────────────────────────────────────────────
 * Split *compute* from *render*. Fingerprint only the inputs the computation
 * actually depends on — the data plus the parameters that shape it, never the
 * styling — and recompute only when that fingerprint changes. Styling changes
 * then re-render from the cached model and feel instant.
 *
 * ── Why a full pass, not a sample ────────────────────────────────
 * The fingerprint walks every value: O(n). That is negligible beside the O(n²)
 * (or FFT-sweep) work it guards — roughly a thousandth of the cost at n = 10k —
 * and sampling would risk a *false cache hit*, i.e. silently rendering stale
 * results. Slow is a nuisance; wrong is a bug, so this pays O(n) to be sure.
 *
 * FNV-1a is used for mixing: fast, no dependencies, and more than strong enough
 * to detect "did this data change?".
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Accumulates a 32-bit fingerprint over numbers and strings. */
export class Fingerprint {
    private h = FNV_OFFSET;
    // Reused scratch buffer so hashing a float never allocates.
    private static readonly f64 = new Float64Array(1);
    private static readonly i32 = new Int32Array(Fingerprint.f64.buffer);

    private mix(x: number): void {
        this.h = Math.imul(this.h ^ (x >>> 0), FNV_PRIME) >>> 0;
    }

    /** Mix in a number by its exact bit pattern, so 1 and 1.0000001 differ. */
    num(v: number | null | undefined): this {
        if (v == null || !Number.isFinite(v)) { this.mix(0x7ff80000); return this; }
        Fingerprint.f64[0] = v;
        this.mix(Fingerprint.i32[0]);
        this.mix(Fingerprint.i32[1]);
        return this;
    }

    str(s: string | null | undefined): this {
        if (s == null) { this.mix(0xdeadbeef); return this; }
        for (let i = 0; i < s.length; i++) this.mix(s.charCodeAt(i));
        this.mix(s.length);
        return this;
    }

    bool(b: boolean): this { this.mix(b ? 1 : 2); return this; }

    /** Mix a whole numeric series. */
    nums(values: ArrayLike<number>): this {
        this.mix(values.length);
        for (let i = 0; i < values.length; i++) this.num(values[i]);
        return this;
    }

    /** Mix a whole string series. */
    strs(values: ArrayLike<string>): this {
        this.mix(values.length);
        for (let i = 0; i < values.length; i++) this.str(values[i]);
        return this;
    }

    done(): string {
        return (this.h >>> 0).toString(36);
    }
}

/**
 * Memoises one computation against a fingerprint.
 *
 * Null results are cached too — "this input produces nothing" is an answer
 * worth remembering, otherwise a too-short series would recompute forever.
 */
export class ComputeCache<T> {
    private key: string | null = null;
    private value: T | null = null;

    /** Return the cached value when the key matches, otherwise recompute. */
    get(key: string, compute: () => T | null): T | null {
        if (key !== this.key) {
            this.value = compute();
            this.key = key;
        }
        return this.value;
    }

    /** Drop the cache — used when the visual is torn down. */
    clear(): void {
        this.key = null;
        this.value = null;
    }
}
