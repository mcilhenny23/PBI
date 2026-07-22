"use strict";

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ITooltipService = powerbi.extensibility.ITooltipService;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";
import { computeSpectrogram, Spectrogram, WindowName } from "./fft";
import { Fingerprint, ComputeCache } from "./computeCache";

/** Vertical resolution of the rendered heatmap before it's scaled to the plot. */
const MAX_OUTPUT_ROWS = 512;

// ── Helpers ────────────────────────────────────────────────────

function findCategoryIndex(cats: powerbi.DataViewCategoryColumn[], roleName: string): number {
    for (let i = 0; i < cats.length; i++) {
        if (cats[i].source.roles && cats[i].source.roles[roleName]) return i;
    }
    return -1;
}

function findValueIndex(values: powerbi.DataViewValueColumns, roleName: string): number {
    for (let i = 0; i < values.length; i++) {
        if (values[i].source.roles && values[i].source.roles[roleName]) return i;
    }
    return -1;
}

function safeNum(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function rampFor(name: string): (t: number) => string {
    switch (name) {
        case "inferno": return d3.interpolateInferno;
        case "magma": return d3.interpolateMagma;
        case "plasma": return d3.interpolatePlasma;
        case "turbo": return d3.interpolateTurbo;
        default: return d3.interpolateViridis;
    }
}

/** 256-entry RGB lookup so the per-pixel loop never parses a color string. */
function buildLut(name: string): Uint8ClampedArray {
    const interp = rampFor(name);
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
        const c = d3.color(interp(i / 255));
        const rgb = c ? c.rgb() : { r: 0, g: 0, b: 0 };
        lut[i * 3] = rgb.r; lut[i * 3 + 1] = rgb.g; lut[i * 3 + 2] = rgb.b;
    }
    return lut;
}

/** HC ramp: linear background → foreground so magnitude reads without color. */
function buildLutHC(fg: string, bg: string): Uint8ClampedArray {
    const interp = d3.interpolateRgb(bg, fg);
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
        const c = d3.color(interp(i / 255));
        const rgb = c ? c.rgb() : { r: 0, g: 0, b: 0 };
        lut[i * 3] = rgb.r; lut[i * 3 + 1] = rgb.g; lut[i * 3 + 2] = rgb.b;
    }
    return lut;
}

interface Panel {
    name: string;
    spec: Spectrogram;
    /** Per-frame mean RPM, aligned to spec.numWindows; null if RPM not bound. */
    rpm: Float64Array | null;
    x: number; y: number; w: number; h: number;
}

/**
 * Mean RPM over each FFT frame. Only used when order tracking is on.
 *
 * Slow-varying RPM (relative to windowSize/sampleRate) is the case where
 * computed order tracking is valid; if RPM changes materially inside a single
 * frame, the frame itself smears in the frequency domain and no post-hoc
 * warp can undo that. Averaging inside the frame at least keeps the caller
 * from picking an arbitrary edge value.
 */
function framedMeanRpm(rpm: Float64Array, windowSize: number, hopSize: number, numWindows: number): Float64Array {
    const out = new Float64Array(numWindows);
    for (let w = 0; w < numWindows; w++) {
        const start = w * hopSize, end = Math.min(rpm.length, start + windowSize);
        // Two counts so a straddle frame (some zero, some running) reports the
        // running mean instead of a wrong halved value: mean over positive-only
        // samples when any exist, or 0 when every sample was truly zero
        // (shaft-at-rest), or NaN when no finite samples at all (no sensor).
        let sumPos = 0, countPos = 0, countZero = 0;
        for (let i = start; i < end; i++) {
            const v = rpm[i];
            if (!Number.isFinite(v) || v < 0) continue;
            if (v === 0) countZero++;
            else { sumPos += v; countPos++; }
        }
        if (countPos > 0) out[w] = sumPos / countPos;
        else if (countZero > 0) out[w] = 0;
        else out[w] = NaN;
    }
    return out;
}

function parseOrderMarkers(raw: string): number[] {
    if (!raw) return [];
    return raw.split(",").map(s => parseFloat(s.trim())).filter(v => Number.isFinite(v) && v > 0);
}

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private tooltipService: ITooltipService;
    private selectionManager: ISelectionManager;

    private root: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private canvas: d3.Selection<HTMLCanvasElement, unknown, null, undefined>;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private overlay: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private panels: Panel[] = [];
    private sampleRate = 1000;
    private logFreq = false;
    private ordersMode = false;
    private maxOrder = 10;

    private margin = { top: 12, right: 14, bottom: 34, left: 52 };

    /** Caches the sliding-window FFT so display changes don't re-transform. */
    private spectroCache = new ComputeCache<{ name: string; spec: Spectrogram }[]>();

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        // Localization manager instantiated for future getDisplayName use; call is required for the AppSource Localizations feature check.
        void options.host.createLocalizationManager();
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applyExternalDim());

        this.root = d3.select(options.element).append("div").classed("spec-root", true);
        this.canvas = this.root.append("canvas").classed("spec-canvas", true);
        this.svg = this.root.append("svg").classed("spec-svg", true)
            .attr("tabindex", 0).attr("role", "img").attr("aria-label", "Spectrogram");
        this.landing = this.svg.append("g").classed("spec-landing", true);
        this.overlay = this.svg.append("g").classed("spec-overlay", true);

        // Also accept clicks on the tooltip hit rect — it covers the whole
        // visual and would otherwise swallow every background click before the
        // svg-root guard could fire.
        this.svg.on("click.clear", (event: MouseEvent) => {
            const t = event.target as Element | null;
            if (t === this.svg.node() || (t && t.classList?.contains("hit"))) {
                this.selectionManager.clear().then(() => this.applyExternalDim());
            }
        });
    }

    private applyExternalDim(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.1, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 30) / 100));
        const hasSel = this.selectionManager.getSelectionIds().length > 0;
        // Overlay carries data-bearing marks (alarm bands, harmonic cursors,
        // order markers) — dimming the canvas alone would leave them looking
        // like the filter target.
        this.canvas.style("opacity", hasSel ? String(dim) : "1");
        this.overlay.attr("opacity", hasSel ? dim : 1);
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const F = this.formattingSettings.fftCard;
            const O = this.formattingSettings.orderTrackingCard;
            const D = this.formattingSettings.displayCard;
            const A = this.formattingSettings.alarmBandsCard;
            const H = this.formattingSettings.harmonicCursorsCard;
            const PH = this.formattingSettings.peakHoldCard;
            const X = this.formattingSettings.axisCard;

            const width = options.viewport.width;
            const height = options.viewport.height;

            const dpr = window.devicePixelRatio || 1;
            const canvasNode = this.canvas.node()!;
            canvasNode.width = Math.max(1, Math.floor(width * dpr));
            canvasNode.height = Math.max(1, Math.floor(height * dpr));
            this.canvas.style("width", `${width}px`).style("height", `${height}px`);
            this.svg.attr("width", width).attr("height", height);
            const ctx = canvasNode.getContext("2d")!;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, width, height);
            this.overlay.selectAll("*").remove();
            this.panels = [];

            // ── Data ───────────────────────────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const cats = dataView?.categorical?.categories;
            const vals = dataView?.categorical?.values;
            const tIdx = cats ? findCategoryIndex(cats, "timeIndex") : -1;
            const sIdx = cats ? findCategoryIndex(cats, "sensor") : -1;
            const aIdx = vals ? findValueIndex(vals, "amplitude") : -1;
            const rIdx = vals ? findValueIndex(vals, "rpm") : -1;

            if (aIdx < 0 || !vals?.length) {
                this.renderMessage(width, height, "Spectrogram",
                    "Add an Amplitude measure to begin.",
                    "Add a Time / Sample Index (Don't summarize) so every sample arrives as a row.");
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            const n = vals[aIdx].values.length;
            // Group samples by sensor, preserving the incoming (time) order.
            // RPM (if bound) is grouped in lockstep so per-frame mean RPM later
            // matches the amplitude frames one-for-one.
            const bySensor = new Map<string, number[]>();
            const rpmBySensor = new Map<string, number[]>();
            const rpmValues = rIdx >= 0 ? vals[rIdx].values : null;
            for (let i = 0; i < n; i++) {
                const amp = safeNum(vals[aIdx].values[i]);
                if (amp == null) continue;
                const key = sIdx >= 0 && cats![sIdx].values[i] != null ? String(cats![sIdx].values[i]) : "";
                let arr = bySensor.get(key);
                if (!arr) { arr = []; bySensor.set(key, arr); }
                arr.push(amp);
                if (rpmValues) {
                    let rArr = rpmBySensor.get(key);
                    if (!rArr) { rArr = []; rpmBySensor.set(key, rArr); }
                    const r = safeNum(rpmValues[i]);
                    rArr.push(r == null ? NaN : r);
                }
            }
            // If a time index is bound we trust its order as delivered; Power BI
            // sorts categorical rows by the category, which is what we want.
            const sensorNames = Array.from(bySensor.keys()).sort();

            const windowSize = Math.max(2, parseInt(String(F.windowSize.value?.value ?? "256"), 10) || 256);
            const overlap = Math.max(0, Math.min(90, F.overlapPercent.value ?? 50));
            const winName = String(F.windowFunction.value?.value ?? "hann") as WindowName;

            // ── FFT sweep (cached) ─────────────────────────────────
            // Every sensor runs a sliding-window FFT — hundreds of transforms.
            // It depends only on the signal and the three FFT parameters, so the
            // display controls (colour ramp, dB scale, magnitude floor, log
            // frequency) must not trigger it. Those are applied at render time
            // from this cached matrix, which is what makes them feel instant.
            let shortest = Infinity;
            for (const name of sensorNames) {
                shortest = Math.min(shortest, bySensor.get(name)!.length);
            }

            const fp = new Fingerprint().num(windowSize).num(overlap).str(winName);
            for (const name of sensorNames) {
                fp.str(name).nums(bySensor.get(name)!);
            }
            const specs = this.spectroCache.get(fp.done(), () => {
                const out: { name: string; spec: Spectrogram }[] = [];
                for (const name of sensorNames) {
                    const arr = bySensor.get(name)!;
                    const spec = computeSpectrogram(Float64Array.from(arr), windowSize, overlap, winName);
                    if (spec) out.push({ name, spec });
                }
                return out;
            }) ?? [];

            if (specs.length === 0) {
                this.renderMessage(width, height, "Insufficient data",
                    `Need at least ${windowSize} samples for one FFT window.`,
                    Number.isFinite(shortest) ? `Longest series has ${shortest} samples — lower the window size.` : "");
                this.events.renderingFinished(options);
                return;
            }

            // ── Layout ─────────────────────────────────────────────
            this.sampleRate = X.sampleRate.value ?? 0;
            const hasRate = this.sampleRate > 0;
            const fs = Math.max(6, X.fontSize.value);
            const m = {
                top: this.margin.top,
                right: this.margin.right,
                bottom: X.showTimeAxis.value ? this.margin.bottom : 12,
                left: X.showFreqAxis.value ? this.margin.left : 12
            };
            // Reserve a slice on the right of the plot for the peak-hold
            // strip when it's on. Kept as a constant so plotW is stable across
            // renders — the FFT and heatmap don't need to know about it.
            const peakOn = PH.showPeakHold.value;
            const peakW = peakOn ? Math.max(30, Math.min(200, PH.peakStrip.value ?? 80)) : 0;
            const peakGap = peakOn ? 8 : 0;

            const plotX = m.left, plotW = Math.max(10, width - m.left - m.right - peakW - peakGap);
            const peakX = plotX + plotW + peakGap;
            const totalH = Math.max(10, height - m.top - m.bottom);
            const gap = specs.length > 1 ? 18 : 0;
            const panelH = (totalH - gap * (specs.length - 1)) / specs.length;
            if (plotW < 20 || panelH < 16) { this.events.renderingFinished(options); return; }

            // ── Color + magnitude mapping ──────────────────────────
            // High contrast: swap the configured ramp for a background→foreground
            // linear ramp so the heatmap stays readable in the accessibility
            // palette. Overlays (order markers, harmonic cursors, alarm bands)
            // route to the foreground below.
            const cp = this.host.colorPalette;
            const hc = cp.isHighContrast === true;
            const hcFg = cp.foreground?.value || "#000000";
            const hcBg = cp.background?.value || "#ffffff";
            const lut = hc
                ? buildLutHC(hcFg, hcBg)
                : buildLut(String(D.colorRamp.value?.value ?? "viridis"));
            const useDb = String(D.magnitudeScale.value?.value ?? "db") === "db";
            const dbMin = D.minMagnitude.value ?? -80;
            const dbMax = D.maxMagnitude.value ?? 0;
            this.logFreq = String(D.frequencyScale.value?.value ?? "linear") === "log";

            // ── Order tracking ────────────────────────────────────
            // Orders mode requires a sample rate (bins → Hz), an RPM well
            // (Hz → orders per frame) and Linear frequency (a log-order axis is
            // for octaves, not orders). Any missing piece silently falls back
            // to Hz mode rather than showing a wrong image.
            const orderRequested = String(O.axisMode.value?.value ?? "hz") === "orders";
            this.ordersMode = orderRequested && hasRate && rIdx >= 0 && !this.logFreq;
            this.maxOrder = Math.max(1, O.maxOrder.value ?? 10);
            const orderMarkers = this.ordersMode && O.showOrderMarkers.value
                ? parseOrderMarkers(String(O.orderMarkerList.value ?? ""))
                : [];

            // ── Band-power trend layout ───────────────────────────
            // When enabled, take a fixed slice off the bottom of each panel for
            // the trend strip. Kept short (~28 px) because it is a supplementary
            // strip — the spectrogram is still the primary reading.
            // Same unit gate the overlay band uses — a Hz-declared band's Low/High
            // are meaningless in orders mode, so the trend that reads them must
            // also sit out until the axis matches. Otherwise the trend line would
            // silently compute a plausible-looking curve from the wrong bin range.
            const bandUnitsGlobal = String(A.alarmBand1Units.value?.value ?? "hz");
            const unitsMatchGlobal = this.ordersMode ? bandUnitsGlobal === "orders" : bandUnitsGlobal === "hz";
            const trendOn = A.showAlarmBands.value && A.showBandTrend.value && unitsMatchGlobal;
            const trendH = trendOn && panelH >= 60 ? Math.min(36, Math.floor(panelH * 0.28)) : 0;
            const heatH = panelH - trendH;

            ctx.imageSmoothingEnabled = true;

            specs.forEach((s, pi) => {
                const spec = s.spec;
                const py = m.top + pi * (panelH + gap);

                // Per-frame mean RPM for this sensor. Frames whose RPM couldn't
                // be measured (all-NaN or zero) leave the cell dark, so those
                // gaps read as "no order data" instead of a misleading colour.
                let framedRpm: Float64Array | null = null;
                if (this.ordersMode) {
                    const rpmSrc = rpmBySensor.get(s.name);
                    if (rpmSrc) {
                        framedRpm = framedMeanRpm(Float64Array.from(rpmSrc),
                            spec.windowSize, spec.hopSize, spec.numWindows);
                    }
                }
                // Panel hit rect covers only the heatmap. When the trend strip
                // is on, hovering it shouldn't fire spectrogram tooltips whose
                // frequency reading would be nonsense off the axis.
                this.panels.push({ name: s.name, spec, rpm: framedRpm, x: plotX, y: py, w: plotW, h: heatH });

                // Build the heatmap in an offscreen image at (numWindows × rows),
                // then let drawImage scale it into the panel. Frequency remapping
                // (linear Hz, log Hz, or Hz → orders via RPM) happens while
                // filling the rows — the FFT itself is unchanged and stays
                // cached, so any axis switch is instant.
                const rows = Math.min(MAX_OUTPUT_ROWS, Math.max(2, Math.round(heatH)));
                const off = document.createElement("canvas");
                off.width = spec.numWindows; off.height = rows;
                const octx = off.getContext("2d")!;
                const img = octx.createImageData(spec.numWindows, rows);
                const px = img.data;

                const binMax = spec.numBins - 1;
                const binMin = 1;                        // skip DC for the log mapping
                const peak = spec.maxMagnitude || 1;
                const hzPerBin = hasRate ? this.sampleRate / spec.windowSize : 0;
                const paintDark = (o: number): void => {
                    // Palette index 0 = darkest end of the ramp; no "no data"
                    // colour outside the palette is needed.
                    px[o] = lut[0]; px[o + 1] = lut[1]; px[o + 2] = lut[2]; px[o + 3] = 255;
                };

                for (let r = 0; r < rows; r++) {
                    // r = 0 is the top of the image = highest frequency / order.
                    const u = rows > 1 ? (rows - 1 - r) / (rows - 1) : 0;

                    if (this.ordersMode && framedRpm) {
                        // In orders mode the bin depends on the frame's RPM,
                        // so the inner loop must recompute per column.
                        const order = u * this.maxOrder;
                        for (let w = 0; w < spec.numWindows; w++) {
                            const o4 = (r * spec.numWindows + w) * 4;
                            const rpm = framedRpm[w];
                            if (!Number.isFinite(rpm) || rpm <= 0) { paintDark(o4); continue; }
                            const targetHz = order * rpm / 60;
                            const bin = Math.round(targetHz / hzPerBin);
                            if (bin < 0 || bin > binMax) { paintDark(o4); continue; }
                            const mag = spec.data[w * spec.numBins + bin];
                            let t: number;
                            if (useDb) {
                                const db = 20 * Math.log10(Math.max(mag, 1e-12) / peak);
                                t = (db - dbMin) / (dbMax - dbMin || 1);
                            } else {
                                t = mag / peak;
                            }
                            t = t < 0 ? 0 : t > 1 ? 1 : t;
                            const li = (t * 255) | 0;
                            px[o4] = lut[li * 3];
                            px[o4 + 1] = lut[li * 3 + 1];
                            px[o4 + 2] = lut[li * 3 + 2];
                            px[o4 + 3] = 255;
                        }
                    } else {
                        // Hz mode: bin is constant across the row, hoist it out.
                        let bin: number;
                        if (this.logFreq) {
                            bin = Math.round(binMin * Math.pow(binMax / binMin, u));
                        } else {
                            bin = Math.round(u * binMax);
                        }
                        bin = Math.max(0, Math.min(binMax, bin));

                        for (let w = 0; w < spec.numWindows; w++) {
                            const mag = spec.data[w * spec.numBins + bin];
                            let t: number;
                            if (useDb) {
                                const db = 20 * Math.log10(Math.max(mag, 1e-12) / peak);
                                t = (db - dbMin) / (dbMax - dbMin || 1);
                            } else {
                                t = mag / peak;
                            }
                            t = t < 0 ? 0 : t > 1 ? 1 : t;
                            const li = (t * 255) | 0;
                            const o = (r * spec.numWindows + w) * 4;
                            px[o] = lut[li * 3];
                            px[o + 1] = lut[li * 3 + 1];
                            px[o + 2] = lut[li * 3 + 2];
                            px[o + 3] = 255;
                        }
                    }
                }
                octx.putImageData(img, 0, 0);
                ctx.drawImage(off, 0, 0, spec.numWindows, rows, plotX, py, plotW, heatH);

                // ── Peak hold ─────────────────────────────────────
                // Right-side companion strip: per-row peak (max) and mean
                // magnitude across every frame in the panel. Peak surfaces
                // transients the animated map flickers past; mean gives the
                // steady-state baseline for comparison.
                if (peakOn) {
                    const peakArr = new Float32Array(rows);
                    const meanArr = new Float32Array(rows);
                    const cntArr = new Uint32Array(rows);
                    for (let r = 0; r < rows; r++) {
                        const u = rows > 1 ? (rows - 1 - r) / (rows - 1) : 0;
                        if (this.ordersMode && framedRpm) {
                            const order = u * this.maxOrder;
                            let mx = 0, sum = 0, n = 0;
                            for (let w = 0; w < spec.numWindows; w++) {
                                const rpm = framedRpm[w];
                                if (!Number.isFinite(rpm) || rpm <= 0) continue;
                                const bin = Math.round(order * rpm / 60 / hzPerBin);
                                if (bin < 0 || bin > binMax) continue;
                                const mag = spec.data[w * spec.numBins + bin];
                                if (mag > mx) mx = mag;
                                sum += mag; n++;
                            }
                            peakArr[r] = mx;
                            meanArr[r] = n > 0 ? sum / n : 0;
                            cntArr[r] = n;
                        } else {
                            let bin: number;
                            if (this.logFreq) bin = Math.round(binMin * Math.pow(binMax / binMin, u));
                            else bin = Math.round(u * binMax);
                            bin = Math.max(0, Math.min(binMax, bin));
                            let mx = 0, sum = 0;
                            for (let w = 0; w < spec.numWindows; w++) {
                                const mag = spec.data[w * spec.numBins + bin];
                                if (mag > mx) mx = mag;
                                sum += mag;
                            }
                            peakArr[r] = mx;
                            meanArr[r] = spec.numWindows > 0 ? sum / spec.numWindows : 0;
                            cntArr[r] = spec.numWindows;
                        }
                    }

                    // Same magnitude scaling as the heatmap so a peak of the
                    // same colour on the strip means the same dB reading.
                    const toX = (mag: number): number => {
                        let t: number;
                        if (useDb) {
                            const db = 20 * Math.log10(Math.max(mag, 1e-12) / peak);
                            t = (db - dbMin) / (dbMax - dbMin || 1);
                        } else {
                            t = mag / peak;
                        }
                        t = t < 0 ? 0 : t > 1 ? 1 : t;
                        return peakX + t * peakW;
                    };

                    // Background so the strip reads as a distinct panel.
                    this.overlay.append("rect")
                        .attr("x", peakX).attr("y", py)
                        .attr("width", peakW).attr("height", heatH)
                        .attr("fill", "#fafafa").attr("stroke", "#ddd").attr("stroke-width", 0.5);

                    const rowH = heatH / rows;
                    // Peak: filled path traced from left edge along each row.
                    // Drawn as a single path so 500 rows don't turn into 500
                    // DOM nodes.
                    let dPeak = `M ${peakX},${py + heatH}`;
                    let dMean = `M ${peakX},${py + heatH}`;
                    for (let r = rows - 1; r >= 0; r--) {
                        const yy = py + r * rowH;
                        const noData = cntArr[r] === 0;
                        dPeak += ` L ${noData ? peakX : toX(peakArr[r])},${yy}`;
                        dMean += ` L ${noData ? peakX : toX(meanArr[r])},${yy}`;
                    }
                    dPeak += ` L ${peakX},${py}`;
                    this.overlay.append("path")
                        .attr("d", dPeak).attr("fill", PH.peakColor.value.value)
                        .attr("fill-opacity", 0.25)
                        .attr("stroke", PH.peakColor.value.value).attr("stroke-width", 1);

                    if (PH.showMean.value) {
                        this.overlay.append("path")
                            .attr("d", dMean).attr("fill", "none")
                            .attr("stroke", PH.meanColor.value.value).attr("stroke-width", 1)
                            .attr("stroke-dasharray", "3 2").attr("opacity", 0.8);
                    }

                    // Scale hint at the top and bottom of the strip.
                    this.overlay.append("text")
                        .attr("x", peakX).attr("y", py + heatH - 2)
                        .attr("font-size", `${Math.max(8, fs - 3)}px`)
                        .attr("fill", "#888")
                        .text(useDb ? `${dbMin}dB` : "0");
                    this.overlay.append("text")
                        .attr("x", peakX + peakW - 2).attr("y", py + heatH - 2)
                        .attr("text-anchor", "end")
                        .attr("font-size", `${Math.max(8, fs - 3)}px`)
                        .attr("fill", "#888")
                        .text(useDb ? `${dbMax}dB` : "max");
                    this.overlay.append("text")
                        .attr("x", peakX).attr("y", py + fs)
                        .attr("font-size", `${Math.max(8, fs - 3)}px`)
                        .attr("fill", "#555").attr("font-weight", 600)
                        .text("peak hold");
                }

                // Panel label for small multiples.
                if (specs.length > 1 && s.name) {
                    this.overlay.append("text")
                        .attr("x", plotX + 6).attr("y", py + fs + 2)
                        .attr("font-size", `${fs}px`).attr("font-weight", 600)
                        .attr("fill", "#fff").attr("stroke", "rgba(0,0,0,0.45)").attr("stroke-width", 2)
                        .attr("paint-order", "stroke")
                        .text(s.name);
                }

                // ── Frequency / order axis ─────────────────────────
                const nyquist = hasRate ? this.sampleRate / 2 : binMax;
                const fLow = hasRate ? this.sampleRate / spec.windowSize : binMin;
                if (X.showFreqAxis.value) {
                    let yScale: d3.ScaleContinuousNumeric<number, number>;
                    if (this.ordersMode) {
                        yScale = d3.scaleLinear().domain([0, this.maxOrder]).range([py + heatH, py]);
                    } else if (this.logFreq) {
                        yScale = d3.scaleLog().domain([fLow, nyquist]).range([py + heatH, py]);
                    } else {
                        yScale = d3.scaleLinear().domain([0, nyquist]).range([py + heatH, py]);
                    }
                    const axis = d3.axisLeft(yScale as d3.ScaleLinear<number, number>)
                        .ticks(Math.max(2, Math.floor(heatH / 34)))
                        .tickSize(3).tickPadding(3);
                    const g = this.overlay.append("g")
                        .attr("transform", `translate(${plotX},0)`)
                        .call(this.logFreq && !this.ordersMode
                            ? (axis as d3.Axis<number>).ticks(4, "~s")
                            : axis);
                    g.select(".domain").attr("stroke", "#999");
                    g.selectAll("text").attr("font-size", `${fs}px`).attr("fill", "#666");
                }

                // ── Order marker lines ─────────────────────────────
                // A horizontal dashed line at each requested order — the "1×"
                // line is where a plain shaft unbalance would sit, "2×" is a
                // misalignment tell, and so on. Static because orders don't
                // depend on RPM.
                if (this.ordersMode && orderMarkers.length) {
                    for (const om of orderMarkers) {
                        if (om <= 0 || om > this.maxOrder) continue;
                        const yy = py + heatH - (om / this.maxOrder) * heatH;
                        this.overlay.append("line")
                            .attr("x1", plotX).attr("x2", plotX + plotW)
                            .attr("y1", yy).attr("y2", yy)
                            .attr("stroke", "#fff").attr("stroke-width", 1)
                            .attr("stroke-dasharray", "4 3").attr("opacity", 0.75);
                        this.overlay.append("text")
                            .attr("x", plotX + plotW - 4).attr("y", yy - 2)
                            .attr("text-anchor", "end").attr("font-size", `${Math.max(9, fs - 1)}px`)
                            .attr("fill", "#fff").attr("stroke", "rgba(0,0,0,0.5)").attr("stroke-width", 2)
                            .attr("paint-order", "stroke")
                            .text(`${om}×`);
                    }
                }

                // ── Alarm band ─────────────────────────────────────
                // Only render when the band's declared units match the current Y
                // axis. Silently reinterpreting Hz values as orders (or vice versa)
                // on an axis flip would collapse the band to invisibility.
                const bandUnits = String(A.alarmBand1Units.value?.value ?? "hz");
                const unitsMatch = this.ordersMode ? bandUnits === "orders" : bandUnits === "hz";
                if (A.showAlarmBands.value && unitsMatch) {
                    const lo = Math.min(A.alarmBand1Low.value ?? 0, A.alarmBand1High.value ?? 0);
                    const hi = Math.max(A.alarmBand1Low.value ?? 0, A.alarmBand1High.value ?? 0);
                    const toY = (f: number): number => {
                        if (this.ordersMode) {
                            const clamped = Math.max(0, Math.min(this.maxOrder, f));
                            return py + heatH - (clamped / this.maxOrder) * heatH;
                        }
                        if (this.logFreq) {
                            const c = Math.max(f, fLow);
                            return py + heatH - (Math.log(c / fLow) / Math.log(nyquist / fLow)) * heatH;
                        }
                        return py + heatH - (f / nyquist) * heatH;
                    };
                    const y1 = toY(hi), y2 = toY(lo);
                    if (Number.isFinite(y1) && Number.isFinite(y2) && y2 > y1) {
                        this.overlay.append("rect")
                            .attr("x", plotX).attr("y", Math.max(py, y1))
                            .attr("width", plotW)
                            .attr("height", Math.max(1, Math.min(py + heatH, y2) - Math.max(py, y1)))
                            .attr("fill", A.alarmBand1Color.value.value)
                            .attr("fill-opacity", 0.18)
                            .attr("stroke", A.alarmBand1Color.value.value)
                            .attr("stroke-opacity", 0.7)
                            .attr("stroke-width", 1);
                    }
                }

                // ── Harmonic cursors ───────────────────────────────
                // Hz mode only — a fixed-Hz line drawn on an orders axis would
                // migrate across orders every frame (since Hz = order * RPM/60
                // and RPM varies), which is either confusing or wrong depending
                // on what the user thought "harmonics of 60 Hz" meant. Orders
                // mode has its own multiples-of-shaft axis via order markers.
                if (H.showHarmonics.value && !this.ordersMode && hasRate
                        && H.fundamentalHz.value && H.fundamentalHz.value > 0) {
                    const f0 = H.fundamentalHz.value;
                    const nH = Math.max(1, Math.min(50, Math.round(H.harmonicCount.value ?? 5)));
                    const col = H.harmonicColor.value.value;
                    const toY = (f: number): number => {
                        if (this.logFreq) {
                            const c = Math.max(f, fLow);
                            return py + heatH - (Math.log(c / fLow) / Math.log(nyquist / fLow)) * heatH;
                        }
                        return py + heatH - (f / nyquist) * heatH;
                    };
                    for (let k = 1; k <= nH; k++) {
                        const f = f0 * k;
                        if (f > nyquist) break;
                        const yy = toY(f);
                        if (!Number.isFinite(yy)) continue;
                        this.overlay.append("line")
                            .attr("x1", plotX).attr("x2", plotX + plotW)
                            .attr("y1", yy).attr("y2", yy)
                            .attr("stroke", col)
                            .attr("stroke-width", k === 1 ? 1.4 : 1)
                            .attr("stroke-dasharray", k === 1 ? "6 3" : "3 3")
                            .attr("opacity", k === 1 ? 0.95 : 0.75);
                        if (H.showLabels.value) {
                            this.overlay.append("text")
                                .attr("x", plotX + 4).attr("y", yy - 2)
                                .attr("font-size", `${Math.max(9, fs - 1)}px`)
                                .attr("fill", col)
                                .attr("stroke", "rgba(0,0,0,0.6)").attr("stroke-width", 2.5)
                                .attr("paint-order", "stroke")
                                .text(k === 1 ? `1× (${f0.toFixed(1)} Hz)` : `${k}× (${f.toFixed(1)} Hz)`);
                        }
                    }
                }

                // ── Band-power trend strip ─────────────────────────
                // A single scalar per frame — sum, peak or RMS-dB over the bins
                // inside the alarm band. Bins are recomputed per-frame in orders
                // mode because the band's Hz endpoints move with RPM; in Hz mode
                // they're constant and hoisted out of the loop.
                if (trendOn && trendH > 8) {
                    const lo = Math.min(A.alarmBand1Low.value ?? 0, A.alarmBand1High.value ?? 0);
                    const hi = Math.max(A.alarmBand1Low.value ?? 0, A.alarmBand1High.value ?? 0);
                    const stat = String(A.bandStat.value?.value ?? "rmsDb");
                    const bandColor = A.alarmBand1Color.value.value;
                    const trendY0 = py + heatH;
                    const trendY1 = py + panelH;

                    const bandVal = (w: number): number => {
                        let b0: number, b1: number;
                        if (this.ordersMode && framedRpm) {
                            const rpm = framedRpm[w];
                            if (!Number.isFinite(rpm) || rpm <= 0) return NaN;
                            const fShaft = rpm / 60;
                            b0 = Math.max(0, Math.round(lo * fShaft / hzPerBin));
                            b1 = Math.min(binMax, Math.round(hi * fShaft / hzPerBin));
                        } else if (hasRate) {
                            b0 = Math.max(0, Math.round(lo / hzPerBin));
                            b1 = Math.min(binMax, Math.round(hi / hzPerBin));
                        } else {
                            b0 = Math.max(0, Math.round(lo));
                            b1 = Math.min(binMax, Math.round(hi));
                        }
                        if (b1 < b0) return NaN;
                        const base = w * spec.numBins;
                        if (stat === "peak") {
                            let mx = 0;
                            for (let b = b0; b <= b1; b++) if (spec.data[base + b] > mx) mx = spec.data[base + b];
                            return mx;
                        }
                        if (stat === "sum") {
                            let s = 0;
                            for (let b = b0; b <= b1; b++) s += spec.data[base + b];
                            return s;
                        }
                        // rmsDb: 20 log10(sqrt(mean(mag²)) / peakOfEntireSpectrogram)
                        let s2 = 0;
                        for (let b = b0; b <= b1; b++) s2 += spec.data[base + b] * spec.data[base + b];
                        const rms = Math.sqrt(s2 / (b1 - b0 + 1));
                        return 20 * Math.log10(Math.max(rms, 1e-12) / peak);
                    };

                    const values = new Float64Array(spec.numWindows);
                    let vLo = Infinity, vHi = -Infinity;
                    for (let w = 0; w < spec.numWindows; w++) {
                        const v = bandVal(w);
                        values[w] = v;
                        if (Number.isFinite(v)) { if (v < vLo) vLo = v; if (v > vHi) vHi = v; }
                    }
                    if (!Number.isFinite(vLo)) { vLo = 0; vHi = 1; }
                    // Anchor the RMS-dB range to a sensible floor (−80 dB, like
                    // the heatmap default) so a quiet trace doesn't get scaled
                    // to full height and read as louder than it is.
                    if (stat === "rmsDb") {
                        if (vLo > -80) vLo = -80;
                        if (vHi < 0) vHi = 0;
                    } else if (vHi - vLo < 1e-9) {
                        vHi = vLo + 1;
                    }
                    const threshold = A.bandThreshold.value;
                    const hasThreshold = threshold != null && Number.isFinite(threshold);
                    if (hasThreshold) {
                        // Ensure the threshold line is inside the visible range,
                        // otherwise it prints off-strip and looks like a bug.
                        if (threshold < vLo) vLo = threshold;
                        if (threshold > vHi) vHi = threshold;
                    }
                    const toXf = (w: number): number => plotX + (spec.numWindows > 1 ? w / (spec.numWindows - 1) * plotW : plotW / 2);
                    const toYt = (v: number): number => trendY1 - ((v - vLo) / (vHi - vLo || 1)) * (trendY1 - trendY0);

                    // Background so the strip reads as a distinct panel and the
                    // trend line has contrast on whatever heatmap sits above.
                    this.overlay.append("rect")
                        .attr("x", plotX).attr("y", trendY0)
                        .attr("width", plotW).attr("height", trendH)
                        .attr("fill", "#f6f6f6").attr("stroke", "#ddd").attr("stroke-width", 0.5);

                    // Frame highlights: shaded columns where the band-power
                    // crosses the threshold. These are what an alarm would fire
                    // on; drawing them makes the numeric threshold visible on
                    // the heatmap itself, not just the trend line.
                    if (hasThreshold) {
                        const w = plotW / spec.numWindows;
                        for (let i = 0; i < spec.numWindows; i++) {
                            if (values[i] >= (threshold as number)) {
                                this.overlay.append("rect")
                                    .attr("x", toXf(i) - w / 2)
                                    .attr("y", py).attr("width", Math.max(1, w))
                                    .attr("height", heatH)
                                    .attr("fill", bandColor).attr("fill-opacity", 0.18)
                                    .attr("pointer-events", "none");
                            }
                        }
                    }

                    // Trend line as a path.
                    let d = "";
                    let started = false;
                    for (let w = 0; w < spec.numWindows; w++) {
                        const v = values[w];
                        if (!Number.isFinite(v)) { started = false; continue; }
                        d += (started ? "L" : "M") + toXf(w).toFixed(2) + "," + toYt(v).toFixed(2);
                        started = true;
                    }
                    this.overlay.append("path")
                        .attr("d", d).attr("fill", "none")
                        .attr("stroke", bandColor).attr("stroke-width", 1.2);

                    // Threshold line + axis label.
                    if (hasThreshold) {
                        const ty = toYt(threshold as number);
                        this.overlay.append("line")
                            .attr("x1", plotX).attr("x2", plotX + plotW)
                            .attr("y1", ty).attr("y2", ty)
                            .attr("stroke", bandColor).attr("stroke-dasharray", "4 3")
                            .attr("stroke-width", 1).attr("opacity", 0.8);
                    }

                    // Left-side label so the strip is legible without a legend.
                    const statLabel = stat === "peak" ? "band peak"
                        : stat === "sum" ? "band Σmag"
                        : "band RMS (dB)";
                    this.overlay.append("text")
                        .attr("x", plotX + 4).attr("y", trendY0 + fs)
                        .attr("font-size", `${Math.max(9, fs - 2)}px`)
                        .attr("fill", "#555")
                        .text(statLabel);
                    this.overlay.append("text")
                        .attr("x", plotX + plotW - 4).attr("y", trendY0 + fs)
                        .attr("text-anchor", "end")
                        .attr("font-size", `${Math.max(9, fs - 2)}px`)
                        .attr("fill", "#888")
                        .text(this.ordersMode
                            ? `${lo.toFixed(1)}–${hi.toFixed(1)}×`
                            : hasRate ? `${lo.toFixed(0)}–${hi.toFixed(0)} Hz` : `bins ${lo.toFixed(0)}–${hi.toFixed(0)}`);
                }
            });

            // ── Time axis (shared, under the last panel) ───────────
            if (X.showTimeAxis.value) {
                const spec0 = specs[0].spec;
                const lastY = m.top + (specs.length - 1) * (panelH + gap) + panelH;
                const span = hasRate
                    ? (spec0.numWindows - 1) * spec0.hopSize / this.sampleRate
                    : spec0.numWindows - 1;
                const tScale = d3.scaleLinear().domain([0, Math.max(span, 1e-9)]).range([plotX, plotX + plotW]);
                const g = this.overlay.append("g")
                    .attr("transform", `translate(0,${lastY})`)
                    .call(d3.axisBottom(tScale).ticks(Math.max(2, Math.floor(plotW / 90))).tickSize(4).tickPadding(3));
                g.select(".domain").attr("stroke", "#999");
                g.selectAll("text").attr("font-size", `${fs}px`).attr("fill", "#666");
                this.overlay.append("text")
                    .attr("x", plotX + plotW).attr("y", lastY + fs + 16)
                    .attr("text-anchor", "end").attr("font-size", `${fs}px`).attr("fill", "#888")
                    .text(hasRate ? "seconds" : "frames");
            }
            if (X.showFreqAxis.value) {
                this.overlay.append("text")
                    .attr("transform", `translate(${12},${m.top + 4}) rotate(-90)`)
                    .attr("text-anchor", "end").attr("font-size", `${fs}px`).attr("fill", "#888")
                    .text(this.ordersMode ? "orders (× shaft)" : hasRate ? "Hz" : "bins");
            }

            this.attachTooltip(width, height, hasRate);
            this.applyExternalDim();
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private attachTooltip(width: number, height: number, hasRate: boolean): void {
        const fmt = d3.format(",.4~g");
        this.overlay.append("rect")
            .classed("hit", true)
            .attr("x", 0).attr("y", 0).attr("width", width).attr("height", height)
            .attr("fill", "transparent")
            .on("mousemove", (event: MouseEvent) => {
                const [px, py] = d3.pointer(event, this.svg.node());
                for (const p of this.panels) {
                    if (px < p.x || px > p.x + p.w || py < p.y || py > p.y + p.h) continue;
                    const spec = p.spec;
                    const w = Math.max(0, Math.min(spec.numWindows - 1,
                        Math.floor((px - p.x) / p.w * spec.numWindows)));
                    const u = 1 - (py - p.y) / p.h;              // 0 at bottom, 1 at top
                    const binMax = spec.numBins - 1;

                    // Default to bin 0 so the ordersMode + invalid-RPM branch below,
                    // which sets only magKnown=false, can't leave `bin` undefined
                    // and propagate NaN through spec.data / log10 if a future edit
                    // reads b without checking magKnown.
                    let bin = 0;
                    let orderAt: number | null = null;
                    let rpmAt: number | null = null;
                    // magKnown gates the Magnitude readout: in orders mode without a
                    // valid RPM there is no way to know which bin corresponds to the
                    // hovered order, so we must not print a magnitude — reading the
                    // DC bin and labelling it 'Order N.NN×' would be actively wrong.
                    let magKnown = true;
                    if (this.ordersMode && p.rpm) {
                        orderAt = u * this.maxOrder;
                        const rpm = p.rpm[w];
                        if (Number.isFinite(rpm) && rpm > 0) {
                            rpmAt = rpm;
                            const hzPerBin = this.sampleRate / spec.windowSize;
                            bin = Math.round(orderAt * rpm / 60 / hzPerBin);
                        } else {
                            magKnown = false;
                        }
                    } else if (this.logFreq) {
                        bin = Math.round(1 * Math.pow(binMax / 1, u));
                    } else {
                        bin = Math.round(u * binMax);
                    }
                    const b = Math.max(0, Math.min(binMax, bin));
                    const mag = spec.data[w * spec.numBins + b];
                    const db = 20 * Math.log10(Math.max(mag, 1e-12) / (spec.maxMagnitude || 1));

                    const items: VisualTooltipDataItem[] = [];
                    if (p.name) items.push({ displayName: "Sensor", value: p.name });
                    items.push({
                        displayName: "Time",
                        value: hasRate
                            ? `${(w * spec.hopSize / this.sampleRate).toFixed(3)} s`
                            : `frame ${w}`
                    });
                    if (orderAt != null) {
                        items.push({ displayName: "Order", value: `${orderAt.toFixed(2)}×` });
                        // Distinguish 'shaft at rest' (RPM=0) from 'no RPM data' (NaN).
                        const rpmRaw = p.rpm ? p.rpm[w] : NaN;
                        if (rpmAt != null) {
                            items.push({ displayName: "RPM", value: `${fmt(rpmAt)}` });
                        } else if (Number.isFinite(rpmRaw) && rpmRaw === 0) {
                            items.push({ displayName: "RPM", value: "0 (shaft at rest)" });
                        }
                        items.push({
                            displayName: "Frequency",
                            value: rpmAt != null ? `${fmt(orderAt * rpmAt / 60)} Hz` : "—"
                        });
                    } else {
                        items.push({
                            displayName: "Frequency",
                            value: hasRate
                                ? `${fmt(b * this.sampleRate / spec.windowSize)} Hz`
                                : `bin ${b}`
                        });
                    }
                    items.push({ displayName: "Magnitude", value: magKnown ? `${db.toFixed(1)} dB` : "—" });

                    // If harmonic cursors are on and this cell sits within ±one
                    // bin of a multiple of the fundamental, tell the user which
                    // multiple — the whole point of the cursors is to answer
                    // "is that peak a harmonic of the one I anchored on?"
                    const H2 = this.formattingSettings.harmonicCursorsCard;
                    if (H2.showHarmonics.value && !this.ordersMode && hasRate
                            && H2.fundamentalHz.value && H2.fundamentalHz.value > 0) {
                        const hoveredHz = b * this.sampleRate / spec.windowSize;
                        const f0 = H2.fundamentalHz.value;
                        const k = Math.round(hoveredHz / f0);
                        if (k >= 1 && k <= 50) {
                            const hzPerBin = this.sampleRate / spec.windowSize;
                            if (Math.abs(hoveredHz - k * f0) <= hzPerBin) {
                                items.push({ displayName: "Harmonic", value: `${k}× fundamental` });
                            }
                        }
                    }

                    this.tooltipService.show({
                        dataItems: items, identities: [],
                        coordinates: [px, py], isTouchEvent: false
                    });
                    return;
                }
                this.tooltipService.hide({ immediately: false, isTouchEvent: false });
            })
            .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));
    }

    /** Landing page / insufficient-data message. */
    private renderMessage(width: number, height: number, title: string, line1: string, line2: string): void {
        this.landing.selectAll("*").remove();
        this.overlay.selectAll("*").remove();
        if (width < 150 || height < 110) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        // Mini spectrogram glyph: a few frequency bands over time.
        const glyph = g.append("g").attr("transform", "translate(-70,-84)");
        const ramp = d3.interpolateViridis;
        for (let c = 0; c < 28; c++) {
            for (let r = 0; r < 7; r++) {
                const band = r === 4 ? 0.92 : r === 2 ? 0.55 : 0.12;
                const t = Math.max(0, Math.min(1, band + (Math.sin(c * 0.7 + r) * 0.08)));
                glyph.append("rect")
                    .attr("x", c * 5).attr("y", r * 7).attr("width", 5).attr("height", 7)
                    .attr("fill", ramp(t));
            }
        }

        g.append("text").attr("text-anchor", "middle").attr("y", -6)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px")
            .attr("font-weight", 600).attr("fill", "#333").text(title);
        g.append("text").attr("text-anchor", "middle").attr("y", 16)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666").text(line1);
        if (line2) {
            g.append("text").attr("text-anchor", "middle").attr("y", 38)
                .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
                .attr("fill", "#999").text(line2);
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
