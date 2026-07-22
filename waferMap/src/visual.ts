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
import ISandboxExtendedColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";

// ── Types ──────────────────────────────────────────────────────

interface Die {
    x: number;              // raw die column index
    y: number;              // raw die row index
    bin: string | null;
    value: number | null;
    wafer: string;
    /** Stacked mode: how many wafers contributed a die at this position. */
    stackN?: number;
    /** Stacked mode: how many of those failed. */
    stackFail?: number;
    selectionId?: ISelectionId;
}

/** Where one wafer got drawn — kept so the mouse can be mapped back to a die. */
interface WaferLayout {
    name: string;
    originX: number;        // pixel of grid cell (0,0)
    originY: number;
    cell: number;
    // A single grid cell may hold more than one die when data has repeat rows
    // for one location (e.g. rework tests with per-bin rows). Keep them all so
    // a click aggregates their identities instead of dropping every die but the
    // last-written.
    dieMap: Map<string, Die[]>;
}

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

const numFmt = d3.format(",.4~g");

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private colorPalette: ISandboxExtendedColorPalette;
    private tooltipService: ITooltipService;
    private selectionManager: ISelectionManager;

    private root: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private canvas: d3.Selection<HTMLCanvasElement, unknown, null, undefined>;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private overlay: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private layouts: WaferLayout[] = [];
    private margin = { top: 14, right: 14, bottom: 14, left: 14 };

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.colorPalette = options.host.colorPalette;
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applyExternalDim());

        // Canvas draws the dies (thousands of them); SVG sits on top for
        // vector chrome — outline, zones, notch, labels and hit-testing.
        this.root = d3.select(options.element).append("div").classed("wafer-map", true);
        this.canvas = this.root.append("canvas").classed("wafer-canvas", true);
        this.svg = this.root.append("svg").classed("wafer-svg", true)
            .attr("tabindex", 0).attr("role", "img").attr("aria-label", "Wafer map");
        this.landing = this.svg.append("g").classed("wafer-landing", true);
        this.overlay = this.svg.append("g").classed("wafer-overlay", true);
    }

    /**
     * Wafer map dies are painted on Canvas — no DOM to fill-opacity. Dim the
     * whole canvas layer when another visual filters this chart; users still
     * see the wafer outline and zones on the SVG chrome layer.
     */
    private applyExternalDim(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.1, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 25) / 100));
        const hasSel = this.selectionManager.getSelectionIds().length > 0;
        this.canvas.style("opacity", hasSel ? String(dim) : "1");
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const wf = this.formattingSettings.waferCard;
            const die = this.formattingSettings.dieAppearanceCard;
            const cs = this.formattingSettings.colorScaleCard;
            const zn = this.formattingSettings.zonesCard;
            const rt = this.formattingSettings.reticleCard;

            const width = options.viewport.width;
            const height = options.viewport.height;

            // Size canvas for the device pixel ratio so dies stay crisp.
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
            this.layouts = [];

            // ── Data ───────────────────────────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const cats = dataView?.categorical?.categories;
            const vals = dataView?.categorical?.values;
            const xIdx = cats ? findCategoryIndex(cats, "dieX") : -1;
            const yIdx = cats ? findCategoryIndex(cats, "dieY") : -1;
            const binIdx = cats ? findCategoryIndex(cats, "binCode") : -1;
            const waferIdx = cats ? findCategoryIndex(cats, "waferID") : -1;
            const valIdx = vals ? findValueIndex(vals, "value") : -1;

            if (xIdx < 0 || yIdx < 0 || !cats?.[xIdx]?.values?.length) {
                this.renderLandingPage(width, height, xIdx >= 0, yIdx >= 0);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            // ── Build dies ─────────────────────────────────────────
            const n = cats[xIdx].values.length;
            // Selection identity: chain every bound Grouping column so dies that
            // differ only in Y (or wafer/bin) get distinct identities. Using X
            // alone collapsed all dies at the same X onto one selection id.
            const identityCats = [xIdx, yIdx, waferIdx, binIdx].filter(k => k >= 0).map(k => cats[k]);
            let dies: Die[] = [];
            for (let i = 0; i < n; i++) {
                const dx = safeNum(cats[xIdx].values[i]);
                const dy = safeNum(cats[yIdx].values[i]);
                if (dx == null || dy == null) continue;          // non-numeric coords → skip
                let selectionId: ISelectionId | undefined;
                try {
                    let builder = this.host.createSelectionIdBuilder();
                    for (const c of identityCats) builder = builder.withCategory(c, i);
                    selectionId = builder.createSelectionId();
                } catch { /* skipped */ }
                dies.push({
                    x: Math.round(dx), y: Math.round(dy),
                    bin: binIdx >= 0 ? String(cats[binIdx].values[i]) : null,
                    value: valIdx >= 0 ? safeNum(vals[valIdx].values[i]) : null,
                    wafer: waferIdx >= 0 ? String(cats[waferIdx].values[i]) : "",
                    selectionId
                });
            }
            if (dies.length === 0) {
                this.renderLandingPage(width, height, true, true);
                this.events.renderingFinished(options);
                return;
            }

            // ── Stacked (composite) mode ───────────────────────────
            // Overlay every wafer into one map. A defect that lands in the same
            // place on many wafers is systematic (a process or tooling problem);
            // one that moves around is random. Small multiples make you spot
            // that by eye across N pictures — stacking makes it a single map.
            const allWafers = waferIdx >= 0
                ? Array.from(new Set(dies.map(d => d.wafer))).sort()
                : [""];
            const stacked = String(wf.multiWaferMode.value?.value ?? "small-multiples") === "stacked"
                && allWafers.length > 1;

            // Passing bin: an explicit setting wins, else the most common bin
            // in the log. Lifted out of the stacked block because the reticle
            // overlay needs it too — and we want one bin counting as "good"
            // everywhere in the visual, never two.
            let autoPassBin = (wf.passBin.value || "").trim();
            if (!autoPassBin) {
                const tally = new Map<string, number>();
                for (const d of dies) if (d.bin != null) tally.set(d.bin, (tally.get(d.bin) || 0) + 1);
                let best = -1;
                tally.forEach((count, b) => { if (count > best) { best = count; autoPassBin = b; } });
            }

            let composite: Die[] = [];
            let stackedDomain: [number, number] = [0, 1];
            let stackedIsRate = true;
            if (stacked) {
                const passBin = autoPassBin;
                stackedIsRate = String(wf.stackedMetric.value?.value ?? "fail-rate") === "fail-rate";

                const agg = new Map<string, { x: number; y: number; n: number; fail: number; sum: number; sumN: number }>();
                for (const d of dies) {
                    const k = `${d.x},${d.y}`;
                    let a = agg.get(k);
                    if (!a) { a = { x: d.x, y: d.y, n: 0, fail: 0, sum: 0, sumN: 0 }; agg.set(k, a); }
                    a.n++;
                    if (d.bin != null && d.bin !== passBin) a.fail++;
                    if (d.value != null) { a.sum += d.value; a.sumN++; }
                }

                composite = Array.from(agg.values()).map(a => ({
                    x: a.x, y: a.y,
                    bin: null,
                    value: stackedIsRate
                        ? (a.n > 0 ? a.fail / a.n : 0)
                        : (a.sumN > 0 ? a.sum / a.sumN : null),
                    wafer: "",
                    stackN: a.n,
                    stackFail: a.fail
                }));

                if (stackedIsRate) {
                    stackedDomain = [0, 1];
                } else {
                    const vs = composite.map(d => d.value).filter((v): v is number => v != null);
                    let lo = vs.length ? d3.min(vs)! : 0, hi = vs.length ? d3.max(vs)! : 1;
                    if (lo === hi) { lo -= 1; hi += 1; }
                    stackedDomain = [lo, hi];
                }
                dies = composite;
            }

            // Shared grid extent so small multiples stay comparable.
            const minX = d3.min(dies, d => d.x)!, maxX = d3.max(dies, d => d.x)!;
            const minY = d3.min(dies, d => d.y)!, maxY = d3.max(dies, d => d.y)!;
            const gridCols = maxX - minX + 1, gridRows = maxY - minY + 1;

            // ── Color ──────────────────────────────────────────────
            // Stacked mode is inherently continuous — it paints an aggregate,
            // so the categorical bin ramp doesn't apply.
            const continuous = stacked
                || (String(die.colorMode.value?.value ?? "categorical") === "continuous" && valIdx >= 0);
            // High contrast: categorical bins collapse to foreground; the
            // continuous ramp goes background→foreground so yield still reads
            // as darker-vs-lighter dies.
            const hc = this.colorPalette.isHighContrast === true;
            const hcFg = this.colorPalette.foreground?.value || "#000000";
            const hcBg = this.colorPalette.background?.value || "#ffffff";
            const bins = Array.from(new Set(dies.map(d => d.bin).filter((b): b is string => b != null))).sort();
            const binColor = new Map<string, string>();
            for (const b of bins) binColor.set(b, hc ? hcFg : this.colorPalette.getColor(b).value);

            let valueScale: d3.ScaleLinear<string, string> | null = null;
            let valueDomain: [number, number] = [0, 1];
            if (continuous) {
                let lo: number, hi: number;
                if (stacked) {
                    [lo, hi] = stackedDomain;
                } else {
                    const vs = dies.map(d => d.value).filter((v): v is number => v != null);
                    if (!vs.length) { lo = 0; hi = 1; } else { lo = d3.min(vs)!; hi = d3.max(vs)!; }
                    if (lo === hi) { lo -= 1; hi += 1; }
                }
                valueDomain = [lo, hi];
                // Fail rate reads "high = bad", so the ramp is reversed against
                // the value ramp, where high is normally good yield.
                const ramp = hc
                    ? [hcBg, d3.interpolateRgb(hcBg, hcFg)(0.5), hcFg]
                    : ((stacked && stackedIsRate)
                        ? [cs.colorScaleHigh.value.value, cs.colorScaleMid.value.value, cs.colorScaleLow.value.value]
                        : [cs.colorScaleLow.value.value, cs.colorScaleMid.value.value, cs.colorScaleHigh.value.value]);
                valueScale = d3.scaleLinear<string>()
                    .domain([lo, (lo + hi) / 2, hi])
                    .range(ramp)
                    .interpolate(d3.interpolateRgb);
            }
            const DEFAULT_DIE = "#b8b8b8";
            const colorFor = (d: Die): string => {
                if (continuous && valueScale && d.value != null) return valueScale(d.value);
                if (!continuous && d.bin != null) return binColor.get(d.bin) || DEFAULT_DIE;
                return DEFAULT_DIE;
            };

            // ── Layout ─────────────────────────────────────────────
            // Stacking collapses every wafer into a single composite map.
            const wafers = stacked ? [""] : allWafers;
            const showLegend = width >= 320 && (continuous || bins.length > 0);
            const legendW = showLegend ? 96 : 0;

            const plotX = this.margin.left;
            const plotY = this.margin.top;
            const plotW = Math.max(0, width - this.margin.left - this.margin.right - legendW);
            const plotH = Math.max(0, height - this.margin.top - this.margin.bottom);
            if (plotW < 20 || plotH < 20) { this.events.renderingFinished(options); return; }

            const multi = wafers.length > 1;
            const mCols = multi ? Math.ceil(Math.sqrt(wafers.length)) : 1;
            const mRows = multi ? Math.ceil(wafers.length / mCols) : 1;
            const labelH = multi ? 16 : 0;
            const areaW = plotW / mCols, areaH = plotH / mRows;

            const shape = String(wf.waferShape.value?.value ?? "circle");
            const edgeExcl = Math.max(0, wf.edgeExclusion.value || 0);
            const gap = Math.max(0, die.dieGap.value || 0);
            const borderW = Math.max(0, die.dieBorderWidth.value || 0);

            // Effective wafer radius, in grid units.
            const radiusGrid = Math.min(gridCols, gridRows) / 2;
            const effRadius = Math.max(0.5, radiusGrid - edgeExcl);
            const gcx = gridCols / 2, gcy = gridRows / 2;

            // ── Draw each wafer ────────────────────────────────────
            wafers.forEach((wname, wi) => {
                const ax = plotX + (wi % mCols) * areaW;
                const ay = plotY + Math.floor(wi / mCols) * areaH;
                const availH = areaH - labelH;
                const cell = Math.max(0.5, Math.min((areaW - 6) / gridCols, (availH - 6) / gridRows));
                const gw = gridCols * cell, gh = gridRows * cell;
                const originX = ax + (areaW - gw) / 2;
                const originY = ay + labelH + (availH - gh) / 2;

                const dieMap = new Map<string, Die[]>();
                const waferDies = waferIdx >= 0 ? dies.filter(d => d.wafer === wname) : dies;

                // Dies on canvas.
                ctx.lineWidth = borderW;
                ctx.strokeStyle = hc ? hcFg : die.dieBorderColor.value.value;
                for (const d of waferDies) {
                    const gx = d.x - minX, gy = d.y - minY;
                    if (shape === "circle") {
                        const dist = Math.hypot(gx + 0.5 - gcx, gy + 0.5 - gcy);
                        if (dist > effRadius) continue;               // outside wafer / edge-excluded
                    } else if (edgeExcl > 0) {
                        if (gx < edgeExcl || gy < edgeExcl ||
                            gx >= gridCols - edgeExcl || gy >= gridRows - edgeExcl) continue;
                    }
                    const cellKey = `${gx},${gy}`;
                    const bucket = dieMap.get(cellKey);
                    if (bucket) bucket.push(d); else dieMap.set(cellKey, [d]);
                    const px = originX + gx * cell + gap / 2;
                    const py = originY + gy * cell + gap / 2;
                    const sz = Math.max(0.5, cell - gap);
                    ctx.fillStyle = colorFor(d);
                    ctx.fillRect(px, py, sz, sz);
                    if (borderW > 0) ctx.strokeRect(px, py, sz, sz);
                }

                this.layouts.push({ name: wname, originX, originY, cell, dieMap });

                // Vector chrome on the SVG overlay.
                const cx = originX + gcx * cell, cy = originY + gcy * cell;
                const rPx = effRadius * cell;

                if (shape === "circle") {
                    this.overlay.append("circle")
                        .attr("cx", cx).attr("cy", cy).attr("r", rPx)
                        .attr("fill", "none").attr("stroke", "#666").attr("stroke-width", 1);
                } else {
                    this.overlay.append("rect")
                        .attr("x", originX + (edgeExcl * cell)).attr("y", originY + (edgeExcl * cell))
                        .attr("width", Math.max(0, gw - 2 * edgeExcl * cell))
                        .attr("height", Math.max(0, gh - 2 * edgeExcl * cell))
                        .attr("fill", "none").attr("stroke", "#666").attr("stroke-width", 1);
                }

                if (zn.showZones.value && shape === "circle") {
                    const zc = Math.max(1, Math.min(10, Math.round(zn.zoneCount.value || 3)));
                    const op = Math.max(0, Math.min(1, zn.zoneLineOpacity.value / 100));
                    for (let z = 1; z < zc; z++) {
                        this.overlay.append("circle")
                            .attr("cx", cx).attr("cy", cy).attr("r", rPx * (z / zc))
                            .attr("fill", "none")
                            .attr("stroke", hc ? hcFg : zn.zoneLineColor.value.value)
                            .attr("stroke-opacity", op)
                            .attr("stroke-width", 1)
                            .attr("stroke-dasharray", "3 3");
                    }

                    // Per-zone yield: bin each die by its normalized radius,
                    // count pass vs total per zone. Skips composite (stacked)
                    // dies since bin is null there — stacked mode's coloured
                    // die already encodes yield, so a separate number would
                    // be double-counting.
                    if (zn.showZoneStats.value && waferDies.length && !stacked) {
                        const buckets = new Array(zc).fill(0).map(() => ({ total: 0, pass: 0 }));
                        for (const d of waferDies) {
                            if (d.bin == null) continue;
                            const dx = (d.x - minX) + 0.5 - gcx;
                            const dy = (d.y - minY) + 0.5 - gcy;
                            const dist = Math.hypot(dx, dy);
                            if (dist > effRadius) continue;
                            const norm = dist / effRadius;   // 0 = centre, 1 = edge
                            let z = Math.floor(norm * zc);
                            if (z >= zc) z = zc - 1;
                            buckets[z].total++;
                            if (d.bin === autoPassBin) buckets[z].pass++;
                        }
                        const statFmt = String(zn.zoneStatFormat.value?.value ?? "yield");
                        const statColor = hc ? hcFg : zn.zoneStatColor.value.value;
                        const fsZone = Math.max(9, Math.min(14, rPx * 0.06));
                        // Label at the top of each ring, sitting just outside
                        // the inner radius so it reads inside the ring segment
                        // rather than on the boundary.
                        for (let z = 0; z < zc; z++) {
                            const b = buckets[z];
                            if (b.total === 0) continue;
                            const yield_ = b.pass / b.total;
                            let text: string;
                            if (statFmt === "fail") text = `${((1 - yield_) * 100).toFixed(1)}%`;
                            else if (statFmt === "count") text = `${b.pass}/${b.total}`;
                            else text = `${(yield_ * 100).toFixed(1)}%`;
                            // Ring midpoint radius; text sits above the centre
                            // by that amount so it lands at the top of the ring.
                            const rMid = rPx * (z + 0.5) / zc;
                            this.overlay.append("text")
                                .attr("x", cx).attr("y", cy - rMid)
                                .attr("text-anchor", "middle")
                                .attr("dominant-baseline", "middle")
                                .attr("font-size", `${fsZone}px`).attr("font-weight", 600)
                                .attr("fill", statColor)
                                .attr("stroke", "rgba(255,255,255,0.85)").attr("stroke-width", 3)
                                .attr("paint-order", "stroke")
                                .style("pointer-events", "none")
                                .text(text);
                        }
                    }
                }

                // ── Reticle overlay ────────────────────────────────
                // Grid lines aligned to reticle-shot boundaries. Optionally
                // computes a per-shot fail rate and tints shots whose rate
                // exceeds a threshold multiple of the wafer average — the
                // repeating-defect signature of a bad reticle.
                if (rt.showReticle.value) {
                    const rSizeX = Math.max(1, Math.round(rt.reticleSizeX.value || 2));
                    const rSizeY = Math.max(1, Math.round(rt.reticleSizeY.value || 2));
                    const rOffX = ((Math.round(rt.reticleOffsetX.value || 0) % rSizeX) + rSizeX) % rSizeX;
                    const rOffY = ((Math.round(rt.reticleOffsetY.value || 0) % rSizeY) + rSizeY) % rSizeY;
                    const rColor = hc ? hcFg : rt.reticleColor.value.value;
                    const rOp = Math.max(0, Math.min(1, (rt.reticleLineOpacity.value ?? 70) / 100));
                    const rLw = Math.max(0.2, rt.reticleLineWidth.value ?? 1.5);

                    // Highlight math. Uses the same auto-passBin logic as the
                    // stacked composite mode so a bin never counts as good in
                    // one place and bad in another.
                    const passOverride = String(rt.passBinReticle.value ?? "").trim()
                        || String(wf.passBin.value ?? "").trim();
                    const passBin = passOverride || autoPassBin;
                    const isFail = (d: Die): boolean => d.bin != null && d.bin !== passBin;
                    let wAvg = 0;
                    if (rt.highlightBadReticles.value) {
                        let n = 0, f = 0;
                        for (const d of waferDies) { if (d.bin == null) continue; n++; if (isFail(d)) f++; }
                        wAvg = n > 0 ? f / n : 0;
                    }
                    const threshold = Math.max(1, rt.reticleFailThreshold.value ?? 1.5);

                    // Build shot buckets. Only shots that contain at least one
                    // die inside the wafer are drawn; empty shots at the corner
                    // of a circular wafer would clutter the grid.
                    interface Shot { rx: number; ry: number; gx0: number; gy0: number; gxN: number; gyN: number; n: number; f: number; }
                    const shots = new Map<string, Shot>();
                    const shotIdx = (gx: number, gy: number): [number, number] => [
                        Math.floor((gx - rOffX) / rSizeX),
                        Math.floor((gy - rOffY) / rSizeY)
                    ];
                    // Enumerate die-grid cells the drawn dies actually occupy.
                    for (const [key, arr] of dieMap) {
                        const [gxStr, gyStr] = key.split(",");
                        const gx = +gxStr, gy = +gyStr;
                        const [rx, ry] = shotIdx(gx, gy);
                        const k = `${rx},${ry}`;
                        let s = shots.get(k);
                        if (!s) {
                            const gx0 = rx * rSizeX + rOffX;
                            const gy0 = ry * rSizeY + rOffY;
                            s = { rx, ry, gx0, gy0, gxN: gx0 + rSizeX, gyN: gy0 + rSizeY, n: 0, f: 0 };
                            shots.set(k, s);
                        }
                        // A cell may hold multiple die records (rework rows) —
                        // count them all rather than the last-written one, to
                        // match how the tooltip aggregates a cell.
                        for (const d of arr) {
                            if (d.bin == null) continue;
                            s.n++; if (isFail(d)) s.f++;
                        }
                    }

                    // Highlight fills go under the grid lines.
                    if (rt.highlightBadReticles.value && wAvg > 0) {
                        const badFill = "#d62728";
                        for (const s of shots.values()) {
                            if (s.n === 0) continue;
                            const rate = s.f / s.n;
                            if (rate < wAvg * threshold) continue;
                            const x0 = originX + s.gx0 * cell;
                            const y0 = originY + s.gy0 * cell;
                            const w = rSizeX * cell, h = rSizeY * cell;
                            // Fill strength grows with how much worse than avg — capped so
                            // even the worst shot stays translucent enough to see the dies.
                            const intensity = Math.min(1, (rate / wAvg - 1) / 2);
                            this.overlay.append("rect")
                                .attr("x", x0).attr("y", y0)
                                .attr("width", w).attr("height", h)
                                .attr("fill", badFill)
                                .attr("fill-opacity", 0.15 + 0.25 * intensity)
                                .attr("pointer-events", "none");
                        }
                    }

                    // Grid lines: every rSizeX columns, every rSizeY rows.
                    // Extend through the whole die grid — the circle boundary
                    // clips visually because the dies outside it aren't drawn.
                    const gridStartX = originX + rOffX * cell;
                    const gridEndX = originX + gridCols * cell;
                    const gridStartY = originY + rOffY * cell;
                    const gridEndY = originY + gridRows * cell;
                    for (let gx = rOffX; gx <= gridCols; gx += rSizeX) {
                        const px = originX + gx * cell;
                        this.overlay.append("line")
                            .attr("x1", px).attr("x2", px)
                            .attr("y1", gridStartY).attr("y2", gridEndY)
                            .attr("stroke", rColor).attr("stroke-opacity", rOp)
                            .attr("stroke-width", rLw)
                            .attr("shape-rendering", "crispEdges")
                            .attr("pointer-events", "none");
                    }
                    for (let gy = rOffY; gy <= gridRows; gy += rSizeY) {
                        const py = originY + gy * cell;
                        this.overlay.append("line")
                            .attr("x1", gridStartX).attr("x2", gridEndX)
                            .attr("y1", py).attr("y2", py)
                            .attr("stroke", rColor).attr("stroke-opacity", rOp)
                            .attr("stroke-width", rLw)
                            .attr("shape-rendering", "crispEdges")
                            .attr("pointer-events", "none");
                    }
                }

                if (wf.showNotch.value && shape === "circle" && rPx > 6) {
                    const s = Math.max(4, rPx * 0.09);
                    const pos = String(wf.notchPosition.value?.value ?? "bottom");
                    let path: string;
                    if (pos === "top") path = `M ${cx - s} ${cy - rPx} L ${cx + s} ${cy - rPx} L ${cx} ${cy - rPx + s * 1.3} Z`;
                    else if (pos === "left") path = `M ${cx - rPx} ${cy - s} L ${cx - rPx} ${cy + s} L ${cx - rPx + s * 1.3} ${cy} Z`;
                    else if (pos === "right") path = `M ${cx + rPx} ${cy - s} L ${cx + rPx} ${cy + s} L ${cx + rPx - s * 1.3} ${cy} Z`;
                    else path = `M ${cx - s} ${cy + rPx} L ${cx + s} ${cy + rPx} L ${cx} ${cy + rPx - s * 1.3} Z`;
                    this.overlay.append("path").attr("d", path)
                        .attr("fill", "#fff").attr("stroke", "#666").attr("stroke-width", 1);
                }

                if (multi) {
                    this.overlay.append("text")
                        .attr("x", ax + areaW / 2).attr("y", ay + 12)
                        .attr("text-anchor", "middle")
                        .attr("font-size", "11px").attr("font-weight", 600).attr("fill", "#555")
                        .text(wname);
                }
            });

            // ── Legend ─────────────────────────────────────────────
            if (showLegend) {
                const lx = width - this.margin.right - legendW + 10;
                if (continuous && valueScale) {
                    const legendTitle = stacked
                        ? (stackedIsRate ? "Fail rate" : "Mean value")
                        : (valIdx >= 0 ? (vals[valIdx].source.displayName || "Value") : "Value");
                    this.renderContinuousLegend(lx, this.margin.top + 14, Math.min(plotH - 28, 160),
                        valueDomain, valueScale, legendTitle, stacked && stackedIsRate);
                } else {
                    this.renderCategoricalLegend(lx, this.margin.top + 14, bins, binColor,
                        cats[binIdx]?.source.displayName || "Bin", plotH);
                }
            }

            // ── Tooltip hit layer ──────────────────────────────────
            this.attachHitLayer(width, height, minX, minY,
                cats[xIdx].source.displayName || "Die X",
                cats[yIdx].source.displayName || "Die Y",
                binIdx >= 0 ? (cats[binIdx].source.displayName || "Bin") : null,
                valIdx >= 0 ? (vals[valIdx].source.displayName || "Value") : null,
                waferIdx >= 0);

            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    /** Transparent full-size rect that maps pointer position back to a die. */
    private attachHitLayer(
        width: number, height: number, minX: number, minY: number,
        xTitle: string, yTitle: string, binTitle: string | null,
        valTitle: string | null, hasWafer: boolean
    ): void {
        this.overlay.append("rect")
            .classed("hit", true)
            .attr("x", 0).attr("y", 0).attr("width", width).attr("height", height)
            .attr("fill", "transparent")
            .on("mousemove", (event: MouseEvent) => {
                const [mx, my] = d3.pointer(event, this.svg.node());
                for (const L of this.layouts) {
                    const gx = Math.floor((mx - L.originX) / L.cell);
                    const gy = Math.floor((my - L.originY) / L.cell);
                    const bucket = L.dieMap.get(`${gx},${gy}`);
                    if (!bucket?.length) continue;
                    // Canvas paint is last-write-wins (bucket entries are pushed
                    // and painted in the same order), so the die visible in the
                    // cell is the LAST one in the bucket. Reading bucket[0] would
                    // label a red cell with the PASS row's details.
                    const d = bucket[bucket.length - 1];
                    const items: VisualTooltipDataItem[] = [];
                    if (hasWafer && d.wafer) items.push({ displayName: "Wafer", value: d.wafer });
                    items.push({ displayName: xTitle, value: String(d.x) });
                    items.push({ displayName: yTitle, value: String(d.y) });
                    if (d.stackN != null) {
                        // Composite die: report the evidence behind the rate, so a
                        // 100% built from 2 wafers isn't read like one from 25.
                        const fail = d.stackFail ?? 0;
                        items.push({ displayName: "Wafers here", value: String(d.stackN) });
                        items.push({
                            displayName: "Failed",
                            value: `${fail} of ${d.stackN}  (${(fail / Math.max(1, d.stackN) * 100).toFixed(0)}%)`
                        });
                        if (d.value != null && (d.stackFail == null || d.stackN === 0 || !Number.isFinite(fail))) {
                            items.push({ displayName: "Mean value", value: numFmt(d.value) });
                        }
                    } else {
                        if (binTitle && d.bin != null) items.push({ displayName: binTitle, value: d.bin });
                        if (valTitle && d.value != null) items.push({ displayName: valTitle, value: numFmt(d.value) });
                    }
                    if (bucket.length > 1) {
                        items.push({ displayName: "Rows here", value: String(bucket.length) });
                    }
                    this.tooltipService.show({
                        dataItems: items, identities: [],
                        coordinates: [mx, my], isTouchEvent: false
                    });
                    return;
                }
                this.tooltipService.hide({ immediately: false, isTouchEvent: false });
            })
            .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }))
            .on("click", (event: MouseEvent) => {
                const [mx, my] = d3.pointer(event, this.svg.node());
                for (const L of this.layouts) {
                    const gx = Math.floor((mx - L.originX) / L.cell);
                    const gy = Math.floor((my - L.originY) / L.cell);
                    const bucket = L.dieMap.get(`${gx},${gy}`);
                    if (!bucket?.length) continue;
                    // Multiple dies can share one grid cell (e.g. per-bin repeat
                    // rows). Select every id at that cell so no die is unreachable.
                    const ids: ISelectionId[] = [];
                    for (const d of bucket) if (d.selectionId) ids.push(d.selectionId);
                    if (!ids.length) continue;
                    event.stopPropagation();
                    const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                    this.selectionManager.select(ids, multi).then(() => this.applyExternalDim());
                    return;
                }
                // Empty area click → clear.
                this.selectionManager.clear().then(() => this.applyExternalDim());
            })
            .on("contextmenu", (event: MouseEvent) => {
                event.preventDefault();
                const [mx, my] = d3.pointer(event, this.svg.node());
                for (const L of this.layouts) {
                    const gx = Math.floor((mx - L.originX) / L.cell);
                    const gy = Math.floor((my - L.originY) / L.cell);
                    const bucket = L.dieMap.get(`${gx},${gy}`);
                    if (!bucket?.length) continue;
                    // Same last-wins rule as the tooltip — the context menu
                    // should anchor to the die the user actually SEES.
                    let id: ISelectionId | undefined;
                    for (let i = bucket.length - 1; i >= 0; i--) {
                        if (bucket[i].selectionId) { id = bucket[i].selectionId; break; }
                    }
                    if (!id) continue;
                    this.selectionManager.showContextMenu(id, { x: event.clientX, y: event.clientY });
                    return;
                }
            });
    }

    private renderCategoricalLegend(
        x: number, y: number, bins: string[], colors: Map<string, string>,
        title: string, maxH: number
    ): void {
        const g = this.overlay.append("g").classed("legend", true);
        g.append("text").attr("x", x).attr("y", y - 4)
            .attr("font-size", "10px").attr("font-weight", 600).attr("fill", "#555")
            .text(title.length > 12 ? title.slice(0, 11) + "…" : title);
        const rowH = 16;
        const max = Math.max(1, Math.floor((maxH - 24) / rowH));
        bins.slice(0, max).forEach((b, i) => {
            const yy = y + 10 + i * rowH;
            g.append("rect").attr("x", x).attr("y", yy - 8)
                .attr("width", 11).attr("height", 11).attr("rx", 2)
                .attr("fill", colors.get(b) || "#b8b8b8");
            g.append("text").attr("x", x + 16).attr("y", yy + 1)
                .attr("font-size", "10px").attr("fill", "#444")
                .text(b.length > 11 ? b.slice(0, 10) + "…" : b);
        });
        if (bins.length > max) {
            g.append("text").attr("x", x).attr("y", y + 10 + max * rowH + 1)
                .attr("font-size", "10px").attr("fill", "#999")
                .text(`+${bins.length - max} more`);
        }
    }

    private renderContinuousLegend(
        x: number, y: number, h: number, domain: [number, number],
        scale: d3.ScaleLinear<string, string>, title: string, asPercent = false
    ): void {
        const g = this.overlay.append("g").classed("legend", true);
        g.append("text").attr("x", x).attr("y", y - 6)
            .attr("font-size", "10px").attr("font-weight", 600).attr("fill", "#555")
            .text(title.length > 12 ? title.slice(0, 11) + "…" : title);
        const steps = 24, barW = 12, stepH = h / steps;
        for (let i = 0; i < steps; i++) {
            const t = 1 - i / (steps - 1);
            g.append("rect")
                .attr("x", x).attr("y", y + i * stepH)
                .attr("width", barW).attr("height", Math.ceil(stepH) + 0.5)
                .attr("fill", scale(domain[0] + t * (domain[1] - domain[0])));
        }
        g.append("rect").attr("x", x).attr("y", y).attr("width", barW).attr("height", h)
            .attr("fill", "none").attr("stroke", "#ccc").attr("stroke-width", 0.5);
        const f = asPercent
            ? (v: number) => `${Math.round(v * 100)}%`
            : d3.format(",.3~s");
        g.append("text").attr("x", x + barW + 4).attr("y", y + 8)
            .attr("font-size", "9px").attr("fill", "#666").text(f(domain[1]));
        g.append("text").attr("x", x + barW + 4).attr("y", y + h)
            .attr("font-size", "9px").attr("fill", "#666").text(f(domain[0]));
    }

    private renderLandingPage(width: number, height: number, hasX: boolean, hasY: boolean): void {
        this.landing.selectAll("*").remove();
        this.overlay.selectAll("*").remove();
        if (width < 150 || height < 110) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        // Mini wafer glyph: a disc of dies with a notch.
        const glyph = g.append("g").attr("transform", "translate(0,-74)");
        const R = 5, cellN = 9, c = (cellN - 1) / 2;
        for (let gy = 0; gy < cellN; gy++) {
            for (let gx = 0; gx < cellN; gx++) {
                if (Math.hypot(gx - c, gy - c) > c + 0.2) continue;
                glyph.append("rect")
                    .attr("x", (gx - c) * (R + 1) - R / 2).attr("y", (gy - c) * (R + 1) - R / 2)
                    .attr("width", R).attr("height", R)
                    .attr("fill", (gx + gy) % 5 === 0 ? "#d73027" : "#1a9850")
                    .attr("fill-opacity", 0.85);
            }
        }

        g.append("text").attr("text-anchor", "middle").attr("y", -14)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px")
            .attr("font-weight", 600).attr("fill", "#333").text("Wafer Map");

        const missing: string[] = [];
        if (!hasX) missing.push("Die X");
        if (!hasY) missing.push("Die Y");
        g.append("text").attr("text-anchor", "middle").attr("y", 8)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666")
            .text(missing.length ? "Add fields:  " + missing.join("   +   ") : "Add Die X and Die Y to begin");
        g.append("text").attr("text-anchor", "middle").attr("y", 30)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
            .attr("fill", "#999")
            .text("Then add Bin / Status for pass-fail colors, or a Value for a gradient.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
