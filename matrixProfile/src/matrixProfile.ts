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
}

export interface MotifPair {
    a: number;          // start index of one occurrence
    b: number;          // start index of the matching occurrence
    distance: number;
}

export interface Discord {
    index: number;
    distance: number;
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

    return { mp, mpi, length: l };
}

/**
 * Top motif pairs: repeatedly take the globally smallest profile value and its
 * neighbour, then blank out the neighbourhood of both so the next pair is a
 * genuinely different pattern rather than a one-sample shift of this one.
 */
export function findMotifs(
    res: MatrixProfileResult, count: number, exclusion: number
): MotifPair[] {
    const work = Float64Array.from(res.mp);
    const out: MotifPair[] = [];
    for (let k = 0; k < count; k++) {
        let best = Infinity, bi = -1;
        for (let i = 0; i < work.length; i++) {
            if (Number.isFinite(work[i]) && work[i] < best) { best = work[i]; bi = i; }
        }
        if (bi < 0) break;
        const partner = res.mpi[bi];
        out.push({ a: bi, b: partner, distance: best });
        blank(work, bi, exclusion);
        if (partner >= 0) blank(work, partner, exclusion);
    }
    return out;
}

/** Top discords: the same sweep, but taking the largest values. */
export function findDiscords(
    res: MatrixProfileResult, count: number, exclusion: number
): Discord[] {
    const work = Float64Array.from(res.mp);
    const out: Discord[] = [];
    for (let k = 0; k < count; k++) {
        let best = -Infinity, bi = -1;
        for (let i = 0; i < work.length; i++) {
            if (Number.isFinite(work[i]) && work[i] > best) { best = work[i]; bi = i; }
        }
        if (bi < 0) break;
        out.push({ index: bi, distance: best });
        blank(work, bi, exclusion);
    }
    return out;
}

/** Mark a neighbourhood as already-claimed so it can't be picked again. */
function blank(work: Float64Array, centre: number, radius: number): void {
    const lo = Math.max(0, centre - radius);
    const hi = Math.min(work.length - 1, centre + radius);
    for (let i = lo; i <= hi; i++) work[i] = NaN;
}
