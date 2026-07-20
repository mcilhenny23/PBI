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
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";
import { computeSpectrogram, Spectrogram, WindowName } from "./fft";

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

interface Panel {
    name: string;
    spec: Spectrogram;
    x: number; y: number; w: number; h: number;
}

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: powerbi.extensibility.visual.IVisualHost;
    private tooltipService: ITooltipService;

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

    private margin = { top: 12, right: 14, bottom: 34, left: 52 };

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.formattingSettingsService = new FormattingSettingsService();

        this.root = d3.select(options.element).append("div").classed("spec-root", true);
        this.canvas = this.root.append("canvas").classed("spec-canvas", true);
        this.svg = this.root.append("svg").classed("spec-svg", true);
        this.landing = this.svg.append("g").classed("spec-landing", true);
        this.overlay = this.svg.append("g").classed("spec-overlay", true);
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const F = this.formattingSettings.fftCard;
            const D = this.formattingSettings.displayCard;
            const A = this.formattingSettings.alarmBandsCard;
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
            const bySensor = new Map<string, number[]>();
            for (let i = 0; i < n; i++) {
                const amp = safeNum(vals[aIdx].values[i]);
                if (amp == null) continue;
                const key = sIdx >= 0 && cats![sIdx].values[i] != null ? String(cats![sIdx].values[i]) : "";
                let arr = bySensor.get(key);
                if (!arr) { arr = []; bySensor.set(key, arr); }
                arr.push(amp);
            }
            // If a time index is bound we trust its order as delivered; Power BI
            // sorts categorical rows by the category, which is what we want.
            const sensorNames = Array.from(bySensor.keys()).sort();

            const windowSize = Math.max(2, parseInt(String(F.windowSize.value?.value ?? "256"), 10) || 256);
            const overlap = Math.max(0, Math.min(90, F.overlapPercent.value ?? 50));
            const winName = String(F.windowFunction.value?.value ?? "hann") as WindowName;

            const specs: { name: string; spec: Spectrogram }[] = [];
            let shortest = Infinity;
            for (const name of sensorNames) {
                const arr = bySensor.get(name)!;
                shortest = Math.min(shortest, arr.length);
                const spec = computeSpectrogram(Float64Array.from(arr), windowSize, overlap, winName);
                if (spec) specs.push({ name, spec });
            }

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
            const plotX = m.left, plotW = Math.max(10, width - m.left - m.right);
            const totalH = Math.max(10, height - m.top - m.bottom);
            const gap = specs.length > 1 ? 18 : 0;
            const panelH = (totalH - gap * (specs.length - 1)) / specs.length;
            if (plotW < 20 || panelH < 16) { this.events.renderingFinished(options); return; }

            // ── Color + magnitude mapping ──────────────────────────
            const lut = buildLut(String(D.colorRamp.value?.value ?? "viridis"));
            const useDb = String(D.magnitudeScale.value?.value ?? "db") === "db";
            const dbMin = D.minMagnitude.value ?? -80;
            const dbMax = D.maxMagnitude.value ?? 0;
            this.logFreq = String(D.frequencyScale.value?.value ?? "linear") === "log";

            ctx.imageSmoothingEnabled = true;

            specs.forEach((s, pi) => {
                const spec = s.spec;
                const py = m.top + pi * (panelH + gap);
                this.panels.push({ name: s.name, spec, x: plotX, y: py, w: plotW, h: panelH });

                // Build the heatmap in an offscreen image at (numWindows × rows),
                // then let drawImage scale it into the panel. Frequency remapping
                // (linear vs log) happens while filling the rows.
                const rows = Math.min(MAX_OUTPUT_ROWS, Math.max(2, Math.round(panelH)));
                const off = document.createElement("canvas");
                off.width = spec.numWindows; off.height = rows;
                const octx = off.getContext("2d")!;
                const img = octx.createImageData(spec.numWindows, rows);
                const px = img.data;

                const binMax = spec.numBins - 1;
                const binMin = 1;                        // skip DC for the log mapping
                const peak = spec.maxMagnitude || 1;

                for (let r = 0; r < rows; r++) {
                    // r = 0 is the top of the image = highest frequency.
                    const u = rows > 1 ? (rows - 1 - r) / (rows - 1) : 0;
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
                octx.putImageData(img, 0, 0);
                ctx.drawImage(off, 0, 0, spec.numWindows, rows, plotX, py, plotW, panelH);

                // Panel label for small multiples.
                if (specs.length > 1 && s.name) {
                    this.overlay.append("text")
                        .attr("x", plotX + 6).attr("y", py + fs + 2)
                        .attr("font-size", `${fs}px`).attr("font-weight", 600)
                        .attr("fill", "#fff").attr("stroke", "rgba(0,0,0,0.45)").attr("stroke-width", 2)
                        .attr("paint-order", "stroke")
                        .text(s.name);
                }

                // ── Frequency axis ─────────────────────────────────
                const nyquist = hasRate ? this.sampleRate / 2 : binMax;
                const fLow = hasRate ? this.sampleRate / spec.windowSize : binMin;
                if (X.showFreqAxis.value) {
                    const yScale = this.logFreq
                        ? d3.scaleLog().domain([fLow, nyquist]).range([py + panelH, py])
                        : d3.scaleLinear().domain([0, nyquist]).range([py + panelH, py]);
                    const axis = d3.axisLeft(yScale as d3.ScaleLinear<number, number>)
                        .ticks(Math.max(2, Math.floor(panelH / 34)))
                        .tickSize(3).tickPadding(3);
                    const g = this.overlay.append("g")
                        .attr("transform", `translate(${plotX},0)`)
                        .call(this.logFreq
                            ? (axis as d3.Axis<number>).ticks(4, "~s")
                            : axis);
                    g.select(".domain").attr("stroke", "#999");
                    g.selectAll("text").attr("font-size", `${fs}px`).attr("fill", "#666");
                }

                // ── Alarm band ─────────────────────────────────────
                if (A.showAlarmBands.value) {
                    const lo = Math.min(A.alarmBand1Low.value ?? 0, A.alarmBand1High.value ?? 0);
                    const hi = Math.max(A.alarmBand1Low.value ?? 0, A.alarmBand1High.value ?? 0);
                    const toY = (f: number): number => {
                        if (this.logFreq) {
                            const c = Math.max(f, fLow);
                            return py + panelH - (Math.log(c / fLow) / Math.log(nyquist / fLow)) * panelH;
                        }
                        return py + panelH - (f / nyquist) * panelH;
                    };
                    const y1 = toY(hi), y2 = toY(lo);
                    if (Number.isFinite(y1) && Number.isFinite(y2) && y2 > y1) {
                        this.overlay.append("rect")
                            .attr("x", plotX).attr("y", Math.max(py, y1))
                            .attr("width", plotW)
                            .attr("height", Math.max(1, Math.min(py + panelH, y2) - Math.max(py, y1)))
                            .attr("fill", A.alarmBand1Color.value.value)
                            .attr("fill-opacity", 0.18)
                            .attr("stroke", A.alarmBand1Color.value.value)
                            .attr("stroke-opacity", 0.7)
                            .attr("stroke-width", 1);
                    }
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
                    .text(hasRate ? "Hz" : "bins");
            }

            this.attachTooltip(width, height, hasRate);
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
                    const bin = this.logFreq
                        ? Math.round(1 * Math.pow(binMax / 1, u))
                        : Math.round(u * binMax);
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
                    items.push({
                        displayName: "Frequency",
                        value: hasRate
                            ? `${fmt(b * this.sampleRate / spec.windowSize)} Hz`
                            : `bin ${b}`
                    });
                    items.push({ displayName: "Magnitude", value: `${db.toFixed(1)} dB` });
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
