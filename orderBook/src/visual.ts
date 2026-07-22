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
    if (v instanceof Date) return v.getTime();
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function rampFor(name: string): (t: number) => string {
    switch (name) {
        case "viridis": return d3.interpolateViridis;
        case "inferno": return d3.interpolateInferno;
        case "greens": return d3.interpolateGreens;
        case "oranges": return d3.interpolateOranges;
        default: return d3.interpolateBlues;
    }
}

/** 256-entry RGB lookup so the per-pixel fill never parses a color string. */
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

/** HC ramp: linear background → foreground so depth reads without color. */
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

const numFmt = d3.format(",.6~g");
const volFmt = d3.format(",.4~s");

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

    // Retained for tooltip hit-testing.
    private hit: {
        x: number; y: number; w: number; h: number;
        times: number[]; prices: number[];
        size: Float64Array; trade: Float64Array;
        timeLabels: string[];
    } | null = null;

    private margin = { top: 12, right: 14, bottom: 30, left: 62 };

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        // Localization manager instantiated for future getDisplayName use; call is required for the AppSource Localizations feature check.
        void options.host.createLocalizationManager();
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applyExternalDim());

        this.root = d3.select(options.element).append("div").classed("ob-root", true);
        this.canvas = this.root.append("canvas").classed("ob-canvas", true);
        this.svg = this.root.append("svg").classed("ob-svg", true)
            .attr("tabindex", 0).attr("role", "img").attr("aria-label", "Order book depth chart");
        this.landing = this.svg.append("g").classed("ob-landing", true);
        this.overlay = this.svg.append("g").classed("ob-overlay", true);

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
        // Overlay carries data (trade prints, reference lines, axes) — dimming
        // the depth canvas alone would leave the trades looking like the
        // filter target.
        this.canvas.style("opacity", hasSel ? String(dim) : "1");
        this.overlay.attr("opacity", hasSel ? dim : 1);
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const H = this.formattingSettings.heatmapCard;
            const TO = this.formattingSettings.tradeOverlayCard;
            const RL = this.formattingSettings.referenceLinesCard;
            const AX = this.formattingSettings.axesCard;

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
            this.hit = null;

            // ── Data ───────────────────────────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const cats = dataView?.categorical?.categories;
            const vals = dataView?.categorical?.values;
            const tIdx = cats ? findCategoryIndex(cats, "time") : -1;
            const pIdx = cats ? findCategoryIndex(cats, "priceLevel") : -1;
            const sIdx = vals ? findValueIndex(vals, "size") : -1;
            const vIdx = vals ? findValueIndex(vals, "trades") : -1;

            if (tIdx < 0 || pIdx < 0 || sIdx < 0 || !cats?.[tIdx]?.values?.length) {
                this.renderLandingPage(width, height, tIdx >= 0, pIdx >= 0, sIdx >= 0);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            // ── Pivot rows into a price × time matrix ──────────────
            // The dataView arrives as one row per (time, price) tuple; the
            // heatmap needs a dense grid, so index both axes and scatter in.
            const n = cats[tIdx].values.length;
            const timeSet = new Map<number, string>();   // numeric key → display label
            const priceSet = new Set<number>();
            const rowT: number[] = new Array(n);
            const rowP: number[] = new Array(n);

            for (let i = 0; i < n; i++) {
                const tv = cats[tIdx].values[i];
                const pv = safeNum(cats[pIdx].values[i]);
                const tn = safeNum(tv);
                if (tn == null || pv == null) { rowT[i] = NaN; rowP[i] = NaN; continue; }
                rowT[i] = tn; rowP[i] = pv;
                if (!timeSet.has(tn)) {
                    timeSet.set(tn, tv instanceof Date ? tv.toLocaleTimeString() : String(tv));
                }
                priceSet.add(pv);
            }

            const times = Array.from(timeSet.keys()).sort((a, b) => a - b);
            const prices = Array.from(priceSet).sort((a, b) => a - b);
            const nT = times.length, nP = prices.length;
            if (nT === 0 || nP === 0) {
                this.renderLandingPage(width, height, true, true, true);
                this.events.renderingFinished(options);
                return;
            }

            const tPos = new Map<number, number>(); times.forEach((t, i) => tPos.set(t, i));
            const pPos = new Map<number, number>(); prices.forEach((p, i) => pPos.set(p, i));

            const size = new Float64Array(nT * nP);      // signed: <0 bid, >0 ask
            const trade = new Float64Array(nT * nP);
            for (let i = 0; i < n; i++) {
                if (Number.isNaN(rowT[i]) || Number.isNaN(rowP[i])) continue;
                const c = tPos.get(rowT[i])!, r = pPos.get(rowP[i])!;
                const sv = safeNum(vals[sIdx].values[i]);
                if (sv != null) size[c * nP + r] += sv;
                if (vIdx >= 0) {
                    const tv2 = safeNum(vals[vIdx].values[i]);
                    if (tv2 != null) trade[c * nP + r] += tv2;
                }
            }

            // ── Intensity mapping ──────────────────────────────────
            let maxAbs = 0, minPos = Infinity;
            for (let i = 0; i < size.length; i++) {
                const a = Math.abs(size[i]);
                if (a > maxAbs) maxAbs = a;
                if (a > 0 && a < minPos) minPos = a;
            }
            if (!Number.isFinite(minPos)) minPos = 1;
            const scaleMode = String(H.intensityScale.value?.value ?? "log");
            const tFor = (a: number): number => {
                if (a <= 0 || maxAbs <= 0) return 0;
                if (scaleMode === "sqrt") return Math.sqrt(a / maxAbs);
                if (scaleMode === "linear") return a / maxAbs;
                if (maxAbs === minPos) return 1;
                return Math.max(0, Math.min(1, Math.log(a / minPos) / Math.log(maxAbs / minPos)));
            };

            // ── Layout ─────────────────────────────────────────────
            const fs = Math.max(6, AX.fontSize.value);
            const m = {
                top: this.margin.top,
                right: this.margin.right,
                bottom: AX.showTimeAxis.value ? this.margin.bottom : 10,
                left: AX.showPriceAxis.value ? this.margin.left : 10
            };
            const plotX = m.left, plotY = m.top;
            const plotW = Math.max(10, width - m.left - m.right);
            const plotH = Math.max(10, height - m.top - m.bottom);
            if (plotW < 20 || plotH < 20) { this.events.renderingFinished(options); return; }

            // ── Heatmap: build at matrix resolution, scale up ──────
            // High contrast: swap the configured ramp for a background→foreground
            // linear ramp so depth density stays visible in the accessibility
            // palette. Overlays (bid/ask lines, trade circles) below route to
            // the foreground.
            const cp = this.host.colorPalette;
            const hc = cp.isHighContrast === true;
            const hcFg = cp.foreground?.value || "#000000";
            const hcBg = cp.background?.value || "#ffffff";
            const lut = hc
                ? buildLutHC(hcFg, hcBg)
                : buildLut(String(H.colorRamp.value?.value ?? "blues"));
            const off = document.createElement("canvas");
            off.width = nT; off.height = nP;
            const octx = off.getContext("2d")!;
            const img = octx.createImageData(nT, nP);
            const px = img.data;
            for (let r = 0; r < nP; r++) {
                // Image row 0 is the top of the plot = highest price.
                const priceRow = nP - 1 - r;
                for (let c = 0; c < nT; c++) {
                    const t = tFor(Math.abs(size[c * nP + priceRow]));
                    const li = (t * 255) | 0;
                    const o = (r * nT + c) * 4;
                    px[o] = lut[li * 3]; px[o + 1] = lut[li * 3 + 1]; px[o + 2] = lut[li * 3 + 2];
                    px[o + 3] = 255;
                }
            }
            octx.putImageData(img, 0, 0);
            ctx.imageSmoothingEnabled = String(H.cellInterpolation.value?.value ?? "nearest") === "bilinear";
            ctx.drawImage(off, 0, 0, nT, nP, plotX, plotY, plotW, plotH);

            // Pixel geometry for overlays: column c and price row r centres.
            const colX = (c: number) => plotX + (c + 0.5) / nT * plotW;
            const rowY = (r: number) => plotY + (nP - 1 - r + 0.5) / nP * plotH;

            // ── Best bid / best ask ────────────────────────────────
            const hasSigned = (() => {
                for (let i = 0; i < size.length; i++) if (size[i] < 0) return true;
                return false;
            })();
            if (hasSigned && (RL.showBestBid.value || RL.showBestAsk.value)) {
                const bidPts: [number, number][] = [];
                const askPts: [number, number][] = [];
                for (let c = 0; c < nT; c++) {
                    let bestBid = -1, bestAsk = -1;
                    // Best bid = highest price with resting bid size.
                    for (let r = nP - 1; r >= 0; r--) {
                        if (size[c * nP + r] < 0) { bestBid = r; break; }
                    }
                    // Best ask = lowest price with resting ask size.
                    for (let r = 0; r < nP; r++) {
                        if (size[c * nP + r] > 0) { bestAsk = r; break; }
                    }
                    if (bestBid >= 0) bidPts.push([colX(c), rowY(bestBid)]);
                    if (bestAsk >= 0) askPts.push([colX(c), rowY(bestAsk)]);
                }
                const lineGen = d3.line<[number, number]>().x(d => d[0]).y(d => d[1]).curve(d3.curveStepAfter);
                if (RL.showBestBid.value && bidPts.length > 1) {
                    this.overlay.append("path").attr("d", lineGen(bidPts))
                        .attr("fill", "none").attr("stroke", RL.bestBidColor.value.value)
                        .attr("stroke-width", 1.4).attr("stroke-opacity", 0.9);
                }
                if (RL.showBestAsk.value && askPts.length > 1) {
                    this.overlay.append("path").attr("d", lineGen(askPts))
                        .attr("fill", "none").attr("stroke", RL.bestAskColor.value.value)
                        .attr("stroke-width", 1.4).attr("stroke-opacity", 0.9);
                }
            }

            // ── Trade overlay ──────────────────────────────────────
            if (TO.showTrades.value && vIdx >= 0) {
                let maxTrade = 0;
                for (let i = 0; i < trade.length; i++) if (trade[i] > maxTrade) maxTrade = trade[i];
                if (maxTrade > 0) {
                    const rMin = Math.max(0.5, TO.tradeMinRadius.value ?? 2);
                    const rMax = Math.max(rMin, TO.tradeMaxRadius.value ?? 12);
                    // Area-proportional sizing: radius on a sqrt scale.
                    const rScale = d3.scaleSqrt().domain([0, maxTrade]).range([rMin, rMax]);
                    const g = this.overlay.append("g").classed("trades", true);
                    for (let c = 0; c < nT; c++) {
                        for (let r = 0; r < nP; r++) {
                            const v = trade[c * nP + r];
                            if (v <= 0) continue;
                            g.append("circle")
                                .attr("cx", colX(c)).attr("cy", rowY(r)).attr("r", rScale(v))
                                .attr("fill", TO.tradeColor.value.value)
                                .attr("fill-opacity", 0.75)
                                .attr("stroke", "rgba(0,0,0,0.35)").attr("stroke-width", 0.6);
                        }
                    }
                }
            }

            // ── Axes ───────────────────────────────────────────────
            const timeLabels = times.map(t => timeSet.get(t) || String(t));
            if (AX.showPriceAxis.value) {
                const yScale = d3.scaleLinear()
                    .domain([prices[0], prices[nP - 1]])
                    .range([plotY + plotH - plotH / (2 * nP), plotY + plotH / (2 * nP)]);
                const g = this.overlay.append("g")
                    .attr("transform", `translate(${plotX},0)`)
                    .call(d3.axisLeft(yScale).ticks(Math.max(2, Math.floor(plotH / 34))).tickSize(3).tickPadding(3));
                g.select(".domain").attr("stroke", "#999");
                g.selectAll("text").attr("font-size", `${fs}px`).attr("fill", "#666");
            }
            if (AX.showTimeAxis.value) {
                const step = Math.max(1, Math.ceil(nT / Math.max(2, Math.floor(plotW / 90))));
                const g = this.overlay.append("g").attr("transform", `translate(0,${plotY + plotH})`);
                g.append("line").attr("x1", plotX).attr("x2", plotX + plotW)
                    .attr("y1", 0).attr("y2", 0).attr("stroke", "#999");
                for (let c = 0; c < nT; c += step) {
                    g.append("line").attr("x1", colX(c)).attr("x2", colX(c))
                        .attr("y1", 0).attr("y2", 4).attr("stroke", "#999");
                    g.append("text").attr("x", colX(c)).attr("y", fs + 6)
                        .attr("text-anchor", "middle").attr("font-size", `${fs}px`).attr("fill", "#666")
                        .text(timeLabels[c]);
                }
            }

            // ── Tooltip ────────────────────────────────────────────
            this.hit = {
                x: plotX, y: plotY, w: plotW, h: plotH,
                times, prices, size, trade, timeLabels
            };
            const priceTitle = cats[pIdx].source.displayName || "Price";
            const timeTitle = cats[tIdx].source.displayName || "Time";
            const sizeTitle = vals[sIdx].source.displayName || "Size";
            const tradeTitle = vIdx >= 0 ? (vals[vIdx].source.displayName || "Trades") : null;

            this.overlay.append("rect")
                .classed("hit", true)
                .attr("x", 0).attr("y", 0).attr("width", width).attr("height", height)
                .attr("fill", "transparent")
                .on("mousemove", (event: MouseEvent) => {
                    const h = this.hit;
                    if (!h) return;
                    const [mx, my] = d3.pointer(event, this.svg.node());
                    if (mx < h.x || mx > h.x + h.w || my < h.y || my > h.y + h.h) {
                        this.tooltipService.hide({ immediately: false, isTouchEvent: false });
                        return;
                    }
                    const c = Math.max(0, Math.min(h.times.length - 1,
                        Math.floor((mx - h.x) / h.w * h.times.length)));
                    const rTop = Math.floor((my - h.y) / h.h * h.prices.length);
                    const r = Math.max(0, Math.min(h.prices.length - 1, h.prices.length - 1 - rTop));
                    const sv = h.size[c * h.prices.length + r];
                    const tv = h.trade[c * h.prices.length + r];
                    const items: VisualTooltipDataItem[] = [
                        { displayName: timeTitle, value: h.timeLabels[c] },
                        { displayName: priceTitle, value: numFmt(h.prices[r]) },
                        {
                            displayName: sizeTitle,
                            value: sv === 0 ? "—" : `${volFmt(Math.abs(sv))}${hasSigned ? (sv < 0 ? "  (bid)" : "  (ask)") : ""}`
                        }
                    ];
                    if (tradeTitle && tv > 0) items.push({ displayName: tradeTitle, value: volFmt(tv) });
                    this.tooltipService.show({
                        dataItems: items, identities: [],
                        coordinates: [mx, my], isTouchEvent: false
                    });
                })
                .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));

            this.applyExternalDim();
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private renderLandingPage(
        width: number, height: number, hasTime: boolean, hasPrice: boolean, hasSize: boolean
    ): void {
        this.landing.selectAll("*").remove();
        this.overlay.selectAll("*").remove();
        if (width < 160 || height < 110) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        // Glyph: a depth heatmap with a spread gap and a couple of prints.
        const glyph = g.append("g").attr("transform", "translate(-84,-92)");
        const ramp = d3.interpolateBlues;
        for (let c = 0; c < 24; c++) {
            for (let r = 0; r < 10; r++) {
                const distFromMid = Math.abs(r - 4.5);
                if (distFromMid < 1.2) continue;                    // the spread
                const t = Math.max(0.06, Math.min(1, (distFromMid - 1) / 4 + 0.15 * Math.sin(c * 0.8 + r)));
                glyph.append("rect")
                    .attr("x", c * 7).attr("y", r * 7).attr("width", 7).attr("height", 7)
                    .attr("fill", ramp(t));
            }
        }
        [[6, 4], [13, 5], [19, 4]].forEach(([c, r]) =>
            glyph.append("circle").attr("cx", c * 7 + 3.5).attr("cy", r * 7 + 3.5).attr("r", 3)
                .attr("fill", "#fff").attr("stroke", "rgba(0,0,0,0.35)").attr("stroke-width", 0.6));

        g.append("text").attr("text-anchor", "middle").attr("y", -4)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px")
            .attr("font-weight", 600).attr("fill", "#333").text("Order Book Heatmap");

        const missing: string[] = [];
        if (!hasTime) missing.push("Time");
        if (!hasPrice) missing.push("Price Level");
        if (!hasSize) missing.push("Size / Liquidity");
        g.append("text").attr("text-anchor", "middle").attr("y", 18)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666")
            .text(missing.length ? "Add fields:  " + missing.join("   +   ") : "Add Time, Price Level and Size to begin");
        g.append("text").attr("text-anchor", "middle").attr("y", 40)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
            .attr("fill", "#999")
            .text("Sign sizes negative for bids to unlock best bid / best ask lines.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
