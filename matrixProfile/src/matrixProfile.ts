"use strict";

/**
 * Matrix profile (UCR) via STOMP, in pure TypeScript.
 *
 * ── What a matrix profile is ─────────────────────────────────────
 * Slide a window of length m over the series. For every position i, find the
 * *nearest* other subsequence (its "nearest neighbour") under z-normalized
 * Euclidean distance, and record that distance in MP[i] and the neighbour's
 * position in MPI[i].
 *
 *   - A **low** MP[i] means "this shape happens again somewhere else" → the
 *     lowest values are **motifs** (repeated patterns).
 *   - A **high** MP[i] means "nothing else in the series looks like this" →
 *     the highest values are **discords** (anomalies).
 *
 * That's the appeal: anomaly *discovery* with one parameter (m), no training,
 * no thresholds.
 *
 * ── Why STOMP ────────────────────────────────────────────────────
 * The naive approach compares every pair of subsequences element-by-element:
 * O(n²m), far too slow. STOMP exploits the fact that the dot product of two
 * subsequences one step to the right can be updated from the previous one in
 * O(1):
 *
 *   QT[i][j] = QT[i-1][j-1] - T[i-1]·T[j-1] + T[i+m-1]·T[j+m-1]
 *
 * so the whole profile costs O(n²) with O(n) memory — the m disappears.
 *
 * With running means and standard deviations precomputed, the z-normalized
 * Euclidean distance follows in closed form from the dot product:
 *
 *   d(i,j) = sqrt( 2m ( 1 - (QT[i][j] - m·μi·μj) / (m·σi·σj) ) )
 *
 * ── A note on the FFT ────────────────────────────────────────────
 * The reference design suggests sharing the Spectrogram's FFT to compute the
 * first dot-product row via MASS. We compute that row directly instead: it is
 * O(n·m) once (a few hundred thousand operations), which is negligible beside
 * the O(n²) update loop that follows. Pulling in the FFT would add code to
 * audit without measurably changing the runtime.
 */

export interface MatrixProfileResult {
    /** Distance to the nearest neighbour of each subsequence. */
    mp: Float64Array;
    /** Index of that nearest neighbour. */
    mpi: Int32Array;
    /** Number of subsequences = n - m + 1. */
    length: number;
    /** Per-window standard deviation, retained for the low-variance guard. */
    sig: Float64Array;
    /**
     * True where the window is so flat that z-normalization would amplify pure
     * noise into a spurious "anomaly" (see the guard note in stomp()). These
     * positions are excluded from discord candidacy.
     */
    lowVariance: boolean[];
    lowVarianceCount: number;
    /** Median of the finite profile values — the "typical distance" baseline. */
    median: number;
    /**
     * Robust spread of the profile (1.4826·MAD ≈ σ for normal data). MAD is used
     * rather than the standard deviation because a single strong anomaly would
     * inflate σ and mask itself.
     */
    spread: number;
}

/** Extra candidates pulled beyond those displayed, so the last one still has a successor to compare against. */
const SALIENCE_TAIL = 4;

export interface MotifPair {
    a: number;          // start index of one occurrence
    b: number;          // start index of the matching occurrence
    distance: number;
    /** How far *below* the profile bulk this pair sits, in robust σ. */
    salience: number;
}

export interface Discord {
    index: number;
    distance: number;
    /** How far *above* the profile bulk this point sits, in robust σ. */
    salience: number;
}

/** Median of an array (does not mutate the input). */
function medianOf(values: number[]): number {
    if (values.length === 0) return 0;
    const s = values.slice().sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Rolling mean and (population) standard deviation for every window. */
function movingStats(T: Float64Array, m: number): { mu: Float64Array; sig: Float64Array } {
    const n = T.length;
    const l = n - m + 1;
    // Prefix sums make each window O(1). Sums of squares give the variance.
    const cs = new Float64Array(n + 1);
    const cs2 = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
        cs[i + 1] = cs[i] + T[i];
        cs2[i + 1] = cs2[i] + T[i] * T[i];
    }
    const mu = new Float64Array(l);
    const sig = new Float64Array(l);
    for (let i = 0; i < l; i++) {
        const sum = cs[i + m] - cs[i];
        const sum2 = cs2[i + m] - cs2[i];
        const mean = sum / m;
        mu[i] = mean;
        const variance = Math.max(0, sum2 / m - mean * mean);
        sig[i] = Math.sqrt(variance);
    }
    return { mu, sig };
}

/**
 * Compute the self-join matrix profile.
 *
 * @param T           the series
 * @param m           window (subsequence) length
 * @param exclusion   trivial-match exclusion radius, in samples. Positions
 *                    within this distance of i are ignored, otherwise every
 *                    subsequence's nearest neighbour would just be itself
 *                    shifted by one sample.
 */
export function stomp(T: Float64Array, m: number, exclusion: number): MatrixProfileResult | null {
    const n = T.length;
    if (m < 4 || n < m * 2) return null;
    const l = n - m + 1;

    const { mu, sig } = movingStats(T, m);
    const TINY = 1e-10;
    const maxDist = Math.sqrt(2 * m);   // distance between unrelated z-normed windows

    // First dot-product row: QT[0][j] for every j. Computed directly — see the
    // note on the FFT above.
    const QT = new Float64Array(l);
    const firstRow = new Float64Array(l);
    for (let j = 0; j < l; j++) {
        let s = 0;
        for (let k = 0; k < m; k++) s += T[k] * T[j + k];
        QT[j] = s;
        firstRow[j] = s;
    }

    const mp = new Float64Array(l).fill(Infinity);
    const mpi = new Int32Array(l).fill(-1);

    /** Convert a dot product into a z-normalized Euclidean distance. */
    const distance = (i: number, j: number, qt: number): number => {
        const si = sig[i], sj = sig[j];
        // Flat (zero-variance) windows have no shape to compare.
        if (si < TINY && sj < TINY) return 0;          // both flat → identical
        if (si < TINY || sj < TINY) return maxDist;    // one flat → maximally different
        const corr = (qt - m * mu[i] * mu[j]) / (m * si * sj);
        const clamped = corr > 1 ? 1 : corr < -1 ? -1 : corr;
        return Math.sqrt(Math.max(0, 2 * m * (1 - clamped)));
    };

    /** Scan one row of the distance matrix, keeping the row minimum. */
    const scanRow = (i: number): void => {
        let best = Infinity, bestIdx = -1;
        const lo = i - exclusion, hi = i + exclusion;
        for (let j = 0; j < l; j++) {
            if (j >= lo && j <= hi) continue;          // trivial-match exclusion zone
            const d = distance(i, j, QT[j]);
            if (d < best) { best = d; bestIdx = j; }
        }
        mp[i] = best;
        mpi[i] = bestIdx;
    };

    scanRow(0);

    for (let i = 1; i < l; i++) {
        // Slide every dot product one step right. Walk backwards so each QT[j]
        // is updated from the not-yet-overwritten QT[j-1].
        const tOut = T[i - 1], tIn = T[i + m - 1];
        for (let j = l - 1; j > 0; j--) {
            QT[j] = QT[j - 1] - tOut * T[j - 1] + tIn * T[j + m - 1];
        }
        // Column 0 can't be slid into; take it from the first row by symmetry
        // (QT[i][0] === QT[0][i]).
        QT[0] = firstRow[i];
        scanRow(i);
    }

    // ── Low-variance guard ──────────────────────────────────────
    // A near-flat window has no real shape: after z-normalization it is almost
    // pure noise, which matches nothing, so its profile distance is spuriously
    // large. Left alone, those windows masquerade as the top discords. Flag any
    // window whose σ is a small fraction of the typical σ so the discord search
    // can skip them. (Motifs are unaffected: flat-matches-flat is a real motif
    // and already scores a *low* distance, not a high one.)
    const sigVals: number[] = [];
    for (let i = 0; i < l; i++) if (Number.isFinite(sig[i])) sigVals.push(sig[i]);
    const medianSig = medianOf(sigVals);
    const varianceFloor = medianSig * 0.05;   // < 5% of typical variability
    const lowVariance = new Array<boolean>(l);
    let lowVarianceCount = 0;
    for (let i = 0; i < l; i++) {
        const low = sig[i] < varianceFloor;
        lowVariance[i] = low;
        if (low) lowVarianceCount++;
    }

    // ── Salience baseline ───────────────────────────────────────
    // Robust centre and spread of the profile distribution, so motif/discord
    // extremes can be scored as "how many σ from the bulk" rather than accepted
    // unconditionally.
    const mpVals: number[] = [];
    for (let i = 0; i < l; i++) if (Number.isFinite(mp[i])) mpVals.push(mp[i]);
    const median = medianOf(mpVals);
    const mad = medianOf(mpVals.map(v => Math.abs(v - median)));
    const spread = Math.max(1.4826 * mad, 1e-9);

    return { mp, mpi, length: l, sig, lowVariance, lowVarianceCount, median, spread };
}

/**
 * ── How salience is measured, and why ───────────────────────────
 *
 * Every series has a smallest and a largest profile value, so "top-N" always
 * returns something. The question is whether those extremes are *findings* or
 * just the ends of a continuum. Three candidate measures were tested against
 * datasets with known ground truth (a planted motif in aperiodic data; a planted
 * anomaly in periodic data):
 *
 *   A. distance from the profile median, in robust σ
 *   B. distance past the P95/P05 tail
 *   C. **gap to the runner-up candidates**
 *
 * A and B both fail: on tightly-clustered periodic data the profile's spread is
 * so small that a *trivial* motif (two adjacent identical heartbeats) scores
 * 2.93σ from the median — higher than a *genuine* planted motif at 2.78σ in
 * noisier data. No cutoff separates them.
 *
 * C separates cleanly, because it asks the right question: **is there a cliff
 * right after this candidate?** A real, isolated finding is followed by a sharp
 * drop to ordinary values; the maximum of a noisy continuum has near-identical
 * runners-up right behind it. On the same ground truth, real findings scored
 * 1.43 and 88.05 while artifacts scored 0.60 and 0.72 — no overlap.
 *
 * (Comparing against a deeper rank instead of the immediate runner-up was also
 * tried and *loses* the separation: a gentle slope accumulates over several
 * ranks until a trivial finding looks significant.)
 *
 * One wrinkle: two genuinely equal findings would have no gap between them and
 * would suppress each other. Salience is therefore made monotone with a
 * backward pass — a candidate inherits the salience of the one behind it if that
 * is larger — so a tied pair is judged by the cliff *after the pair*.
 */

/** Pull ranked candidates with the trivial-match exclusion applied. */
function extractCandidates(
    mp: Float64Array, mpi: Int32Array, skip: boolean[] | null,
    wanted: number, exclusion: number, largest: boolean
): { index: number; partner: number; distance: number }[] {
    const work = Float64Array.from(mp);
    if (skip) for (let i = 0; i < work.length; i++) if (skip[i]) work[i] = NaN;

    const out: { index: number; partner: number; distance: number }[] = [];
    for (let k = 0; k < wanted; k++) {
        let best = largest ? -Infinity : Infinity, bi = -1;
        for (let i = 0; i < work.length; i++) {
            if (!Number.isFinite(work[i])) continue;
            if (largest ? work[i] > best : work[i] < best) { best = work[i]; bi = i; }
        }
        if (bi < 0) break;
        const partner = mpi[bi];
        out.push({ index: bi, partner, distance: best });
        blank(work, bi, exclusion);
        // For motifs the partner is part of the same finding — claim it too.
        if (!largest && partner >= 0) blank(work, partner, exclusion);
    }
    return out;
}

/**
 * Top motif pairs — the smallest profile values and their matching partners.
 *
 * @param minSalience  require each pair to stand at least this many robust σ
 *                     apart from the ordinary level. 0 keeps the raw top-N
 *                     (explicit "Motifs" mode); a positive value gates out
 *                     non-findings (used by "Auto").
 */
export function findMotifs(
    res: MatrixProfileResult, count: number, exclusion: number, minSalience = 0
): MotifPair[] {
    const cands = extractCandidates(res.mp, res.mpi, null, count + SALIENCE_TAIL, exclusion, false);
    if (cands.length === 0) return [];
    const sal = gapSalience(cands.map(c => c.distance), res.spread, false);

    const out: MotifPair[] = [];
    for (let k = 0; k < Math.min(count, cands.length); k++) {
        if (sal[k] < minSalience) break;
        const c = cands[k];
        out.push({ a: c.index, b: c.partner, distance: c.distance, salience: sal[k] });
    }
    return out;
}

/**
 * Gap-to-runner-up salience for a ranked candidate list, made monotone so tied
 * findings don't cancel each other out. The final candidate has no successor to
 * compare against and scores 0.
 */
function gapSalience(distances: number[], spread: number, largest: boolean): number[] {
    const n = distances.length;
    const out = new Array<number>(n).fill(0);
    for (let k = n - 2; k >= 0; k--) {
        const gap = largest
            ? distances[k] - distances[k + 1]        // discords: bigger is better
            : distances[k + 1] - distances[k];       // motifs: smaller is better
        out[k] = Math.max(gap / spread, out[k + 1]);
    }
    return out;
}

/**
 * Top discords — the largest profile values. Low-variance windows are never
 * eligible: they are z-normalization artifacts, not anomalies.
 */
export function findDiscords(
    res: MatrixProfileResult, count: number, exclusion: number, minSalience = 0
): Discord[] {
    const cands = extractCandidates(res.mp, res.mpi, res.lowVariance,
        count + SALIENCE_TAIL, exclusion, true);
    if (cands.length === 0) return [];
    const sal = gapSalience(cands.map(c => c.distance), res.spread, true);

    const out: Discord[] = [];
    for (let k = 0; k < Math.min(count, cands.length); k++) {
        if (sal[k] < minSalience) break;
        const c = cands[k];
        out.push({ index: c.index, distance: c.distance, salience: sal[k] });
    }
    return out;
}

/** Mark a neighbourhood as already-claimed so it can't be picked again. */
function blank(work: Float64Array, centre: number, radius: number): void {
    const lo = Math.max(0, centre - radius);
    const hi = Math.min(work.length - 1, centre + radius);
    for (let i = lo; i <= hi; i++) work[i] = NaN;
}

// ── Pan matrix profile (multi-length) ──────────────────────────

/**
 * ── Why multi-length exists ──────────────────────────────────────
 * The window length m is the matrix profile's only real parameter, and users
 * genuinely don't know what to set it to. Too short and you match noise; too
 * long and the pattern is diluted by its surroundings and vanishes. Guessing is
 * the single biggest barrier to using the technique.
 *
 * A *pan* matrix profile computes the profile across a whole range of m at once,
 * so the answer to "which m?" comes out of the data instead of the user.
 *
 * ── Making lengths comparable ────────────────────────────────────
 * z-normalized Euclidean distance grows with window length — the maximum
 * possible distance is sqrt(2m) — so raw distances at m = 20 and m = 200 cannot
 * be compared. Every value here is divided by sqrt(2m), putting all lengths on a
 * common 0..1 scale where 0 is a perfect match and 1 is maximally unlike.
 *
 * ── Picking the suggested length ─────────────────────────────────
 * This is genuinely hard, and the suggestion is a *hint* — the heatmap is the
 * real answer. Three criteria were measured against series whose true scale was
 * known (a motif planted at m = 60; ECG beats 100 samples apart):
 *
 *   lowest normalized distance   pump 52 ✓   ECG  20 ✗ (5× too short)
 *   contrast in normalized space pump 105    ECG 118 ✓
 *
 * "Lowest distance" fails badly on the pump because an exact planted copy makes
 * *every* sub-window match perfectly too — the minimum sits on a plateau of
 * zeros from m = 15 upward, so the winner is decided by floating-point noise
 * rather than by structure. Contrast has a much better worst case (off by 1.75×
 * rather than 5×), so it is what's used here.
 *
 * Contrast = (median − min) / spread, all measured on the *normalized* values so
 * numerator and denominator are both scale-free. It asks: at which scale does
 * the best match stand out furthest from a typical match at that same scale?
 *
 * The gap-to-runner-up salience used elsewhere in this file is deliberately NOT
 * used here. It is computed against each length's own raw profile distribution,
 * and that distribution degenerates as m grows and few windows remain — it
 * suggested m = 375 for the pump and m = 500 for the ECG, both absurd.
 */

export interface LengthScan {
    m: number;
    result: MatrixProfileResult;
    /** Best (lowest) normalized distance at this length, 0..1. */
    minNorm: number;
    /** Worst (highest) normalized distance at this length, 0..1. */
    maxNorm: number;
    /** Scale-free contrast of the best match against a typical one. */
    motifContrast: number;
    /** Scale-free contrast of the worst match against a typical one. */
    discordContrast: number;
}

export interface PanProfile {
    lengths: number[];
    scans: LengthScan[];
    /**
     * Normalized distances, row-major `[lengthIndex * n + position]`, in 0..1.
     * NaN where a window of that length has no value at that position (the tail
     * shrinks as m grows).
     */
    grid: Float32Array;
    n: number;
    /** Window length whose motif stands out most clearly. */
    suggestedMotifLength: number;
    /** Window length whose discord stands out most clearly. */
    suggestedDiscordLength: number;
}

/**
 * Geometrically spaced candidate window lengths.
 *
 * Geometric rather than linear because scale perception is multiplicative — the
 * step from 10 to 20 matters as much as 100 to 200, and linear spacing would
 * waste most of the budget on large, near-identical windows.
 */
export function candidateLengths(
    n: number, steps: number, minM?: number | null, maxM?: number | null
): number[] {
    // stomp() only needs n >= 2m, but a profile built from a handful of windows
    // is statistically meaningless — its spread collapses and every score built
    // on it becomes noise. Requiring ~10 windows keeps the comparison honest.
    const hardMax = Math.max(4, Math.floor(n / 10));
    const lo = Math.max(4, Math.min(hardMax, Math.round(minM ?? Math.max(8, n * 0.01))));
    const hi = Math.max(lo + 1, Math.min(hardMax, Math.round(maxM ?? hardMax)));
    const k = Math.max(2, Math.min(40, Math.round(steps)));

    const out: number[] = [];
    const ratio = Math.pow(hi / lo, 1 / (k - 1));
    for (let i = 0; i < k; i++) {
        const m = Math.round(lo * Math.pow(ratio, i));
        if (out.length === 0 || m > out[out.length - 1]) out.push(m);
    }
    return out;
}

/**
 * Compute the profile at every candidate length.
 *
 * Cost is O(lengths · n²) — the caller is responsible for keeping the product
 * sane (see the point cap in the visual) and for caching the result.
 */
export function panMatrixProfile(
    T: Float64Array, lengths: number[], exclusionPercent: number
): PanProfile | null {
    const n = T.length;
    if (!lengths.length || n < 8) return null;

    const scans: LengthScan[] = [];
    for (const m of lengths) {
        // Need enough windows for the distribution to mean anything.
        if (n < m * 3) continue;
        const exclusion = Math.max(1, Math.round(m * exclusionPercent / 100));
        const result = stomp(T, m, exclusion);
        if (!result) continue;

        // Everything below is measured on NORMALIZED distances so lengths are
        // directly comparable.
        const norm = Math.sqrt(2 * m);          // maximum possible distance at this m
        const vals: number[] = [];
        for (let i = 0; i < result.length; i++) {
            const v = result.mp[i];
            if (Number.isFinite(v)) vals.push(Math.min(1, v / norm));
        }
        if (!vals.length) continue;

        const med = medianOf(vals);
        const mad = medianOf(vals.map(v => Math.abs(v - med)));
        const spread = Math.max(1.4826 * mad, 1e-9);
        let minNorm = Infinity, maxNorm = -Infinity;
        for (const v of vals) { if (v < minNorm) minNorm = v; if (v > maxNorm) maxNorm = v; }

        scans.push({
            m, result, minNorm, maxNorm,
            motifContrast: (med - minNorm) / spread,
            discordContrast: (maxNorm - med) / spread
        });
    }
    if (!scans.length) return null;

    // Normalized grid for the heatmap.
    const grid = new Float32Array(scans.length * n).fill(NaN);
    scans.forEach((scan, r) => {
        const norm = Math.sqrt(2 * scan.m);
        const base = r * n;
        for (let i = 0; i < scan.result.length; i++) {
            const v = scan.result.mp[i];
            grid[base + i] = Number.isFinite(v) ? Math.min(1, v / norm) : NaN;
        }
    });

    let bestMotif = scans[0], bestDiscord = scans[0];
    for (const s of scans) {
        if (s.motifContrast > bestMotif.motifContrast) bestMotif = s;
        if (s.discordContrast > bestDiscord.discordContrast) bestDiscord = s;
    }

    return {
        lengths: scans.map(s => s.m),
        scans,
        grid,
        n,
        suggestedMotifLength: bestMotif.m,
        suggestedDiscordLength: bestDiscord.m
    };
}
