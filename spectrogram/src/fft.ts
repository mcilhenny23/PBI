"use strict";

/**
 * Pure-TypeScript signal processing for the Spectrogram visual.
 *
 * Deliberately dependency-free: no WASM, no external FFT library. A radix-2
 * Cooley-Tukey FFT is ~40 lines and keeps the certification audit trivial.
 * This module is also intended to be shared with the Matrix Profile visual.
 */

// ── Window functions ───────────────────────────────────────────
// Applied to each frame before the transform to suppress spectral leakage
// caused by the frame's abrupt edges.

export type WindowName = "hann" | "hamming" | "blackman" | "rectangular";

export function windowValue(name: WindowName, i: number, N: number): number {
    if (N <= 1) return 1;
    const x = (2 * Math.PI * i) / (N - 1);
    switch (name) {
        case "hamming": return 0.54 - 0.46 * Math.cos(x);
        case "blackman": return 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
        case "rectangular": return 1;
        case "hann":
        default: return 0.5 * (1 - Math.cos(x));
    }
}

/** Precompute a window of length N so the hot loop does table lookups. */
export function buildWindow(name: WindowName, N: number): Float64Array {
    const w = new Float64Array(N);
    for (let i = 0; i < N; i++) w[i] = windowValue(name, i, N);
    return w;
}

// ── FFT ────────────────────────────────────────────────────────

/**
 * In-place radix-2 decimation-in-time FFT. `re` and `im` must be the same
 * length and that length must be a power of two.
 *
 * Two phases:
 *  1. Bit-reversal permutation — reorders samples so the butterflies below can
 *     run in place.
 *  2. log2(n) butterfly stages — each stage combines pairs of half-size DFTs,
 *     advancing the twiddle factor incrementally (one complex multiply per
 *     step) rather than calling cos/sin inside the inner loop.
 */
export function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    if (n < 2 || (n & (n - 1)) !== 0) return;   // not a power of two → no-op

    // 1. Bit-reversal permutation.
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            const tr = re[i]; re[i] = re[j]; re[j] = tr;
            const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }

    // 2. Butterfly stages.
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len;
        const wRe = Math.cos(ang), wIm = Math.sin(ang);
        const half = len >> 1;
        for (let i = 0; i < n; i += len) {
            let curRe = 1, curIm = 0;
            for (let j = 0; j < half; j++) {
                const a = i + j, b = i + j + half;
                const uRe = re[a], uIm = im[a];
                const vRe = re[b] * curRe - im[b] * curIm;
                const vIm = re[b] * curIm + im[b] * curRe;
                re[a] = uRe + vRe; im[a] = uIm + vIm;
                re[b] = uRe - vRe; im[b] = uIm - vIm;
                const tmpRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = tmpRe;
            }
        }
    }
}

// ── Spectrogram ────────────────────────────────────────────────

export interface Spectrogram {
    /** Magnitudes, row-major: index = windowIndex * numBins + binIndex. */
    data: Float32Array;
    numWindows: number;
    /** windowSize/2 + 1 — the non-redundant half of a real signal's spectrum. */
    numBins: number;
    hopSize: number;
    windowSize: number;
    /** Largest magnitude anywhere, for linear normalization. */
    maxMagnitude: number;
}

/**
 * Sliding-window FFT over a real signal.
 *
 * numWindows = floor((len - windowSize) / hopSize) + 1, where
 * hopSize = windowSize * (1 - overlapPercent/100).
 *
 * Returns null when the signal is shorter than one window — the caller shows
 * an "insufficient data" message rather than rendering an empty heatmap.
 */
export function computeSpectrogram(
    signal: Float64Array,
    windowSize: number,
    overlapPercent: number,
    windowName: WindowName
): Spectrogram | null {
    const len = signal.length;
    if (len < windowSize || windowSize < 2) return null;

    const overlap = Math.max(0, Math.min(90, overlapPercent));
    const hopSize = Math.max(1, Math.round(windowSize * (1 - overlap / 100)));
    const numWindows = Math.floor((len - windowSize) / hopSize) + 1;
    const numBins = (windowSize >> 1) + 1;

    const win = buildWindow(windowName, windowSize);
    const re = new Float64Array(windowSize);
    const im = new Float64Array(windowSize);
    const out = new Float32Array(numWindows * numBins);
    let maxMagnitude = 0;

    for (let w = 0; w < numWindows; w++) {
        const start = w * hopSize;
        for (let i = 0; i < windowSize; i++) {
            re[i] = signal[start + i] * win[i];
            im[i] = 0;
        }
        fft(re, im);
        const base = w * numBins;
        for (let b = 0; b < numBins; b++) {
            const mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
            out[base + b] = mag;
            if (mag > maxMagnitude) maxMagnitude = mag;
        }
    }

    return { data: out, numWindows, numBins, hopSize, windowSize, maxMagnitude };
}
