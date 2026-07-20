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
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";

// ── Types ──────────────────────────────────────────────────────

interface Die {
    x: number;              // raw die column index
    y: number;              // raw die row index
    bin: string | null;
    value: number | null;
    wafer: string;
}

/** Where one wafer got drawn — kept so the mouse can be mapped back to a die. */
interface WaferLayout {
    name: string;
    originX: number;        // pixel of grid cell (0,0)
    originY: number;
    cell: number;
    dieMap: Map<string, Die>;
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
    private host: powerbi.extensibility.visual.IVisualHost;
    private colorPalette: ISandboxExtendedColorPalette;
    private tooltipService: ITooltipService;

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
        this.formattingSettingsService = new FormattingSettingsService();

        // Canvas draws the dies (thousands of them); SVG sits on top for
        // vector chrome — outline, zones, notch, labels and hit-testing.
        this.root = d3.select(options.element).append("div").classed("wafer-map", true);
        this.canvas = this.root.append("canvas").classed("wafer-canvas", true);
        this.svg = this.root.append("svg").classed("wafer-svg", true);
        this.landing = this.svg.append("g").classed("wafer-landing", true);
        this.overlay = this.svg.append("g").classed("wafer-overlay", true);
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
            const dies: Die[] = [];
            for (let i = 0; i < n; i++) {
                const dx = safeNum(cats[xIdx].values[i]);
                const dy = safeNum(cats[yIdx].values[i]);
                if (dx == null || dy == null) continue;          // non-numeric coords → skip
                dies.push({
                    x: Math.round(dx), y: Math.round(dy),
                    bin: binIdx >= 0 ? String(cats[binIdx].values[i]) : null,
                    value: valIdx >= 0 ? safeNum(vals[valIdx].values[i]) : null,
                    wafer: waferIdx >= 0 ? String(cats[waferIdx].values[i]) : ""
                });
            }
            if (dies.length === 0) {
                this.renderLandingPage(width, height, true, true);
                this.events.renderingFinished(options);
                return;
            }

            // Shared grid extent so small multiples stay comparable.
            const minX = d3.min(dies, d => d.x)!, maxX = d3.max(dies, d => d.x)!;
            const minY = d3.min(dies, d => d.y)!, maxY = d3.max(dies, d => d.y)!;
            const gridCols = maxX - minX + 1, gridRows = maxY - minY + 1;

            // ── Color ──────────────────────────────────────────────
            const continuous = String(die.colorMode.value?.value ?? "categorical") === "continuous"
                && valIdx >= 0;
            const bins = Array.from(new Set(dies.map(d => d.bin).filter((b): b is string => b != null))).sort();
            const binColor = new Map<string, string>();
            for (const b of bins) binColor.set(b, this.colorPalette.getColor(b).value);

            let valueScale: d3.ScaleLinear<string, string> | null = null;
            let valueDomain: [number, number] = [0, 1];
            if (continuous) {
                const vs = dies.map(d => d.value).filter((v): v is number => v != null);
                if (vs.length) {
                    let lo = d3.min(vs)!, hi = d3.max(vs)!;
                    if (lo === hi) { lo -= 1; hi += 1; }
                    valueDomain = [lo, hi];
                    valueScale = d3.scaleLinear<string>()
                        .domain([lo, (lo + hi) / 2, hi])
                        .range([cs.colorScaleLow.value.value, cs.colorScaleMid.value.value, cs.colorScaleHigh.value.value])
                        .interpolate(d3.interpolateRgb);
                }
            }
            const DEFAULT_DIE = "#b8b8b8";
            const colorFor = (d: Die): string => {
                if (continuous && valueScale && d.value != null) return valueScale(d.value);
                if (!continuous && d.bin != null) return binColor.get(d.bin) || DEFAULT_DIE;
                return DEFAULT_DIE;
            };

            // ── Layout ─────────────────────────────────────────────
            const wafers = waferIdx >= 0
                ? Array.from(new Set(dies.map(d => d.wafer))).sort()
                : [""];
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

                const dieMap = new Map<string, Die>();
                const waferDies = waferIdx >= 0 ? dies.filter(d => d.wafer === wname) : dies;

                // Dies on canvas.
                ctx.lineWidth = borderW;
                ctx.strokeStyle = die.dieBorderColor.value.value;
                for (const d of waferDies) {
                    const gx = d.x - minX, gy = d.y - minY;
                    if (shape === "circle") {
                        const dist = Math.hypot(gx + 0.5 - gcx, gy + 0.5 - gcy);
                        if (dist > effRadius) continue;               // outside wafer / edge-excluded
                    } else if (edgeExcl > 0) {
                        if (gx < edgeExcl || gy < edgeExcl ||
                            gx >= gridCols - edgeExcl || gy >= gridRows - edgeExcl) continue;
                    }
                    dieMap.set(`${gx},${gy}`, d);
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
                            .attr("stroke", zn.zoneLineColor.value.value)
                            .attr("stroke-opacity", op)
                            .attr("stroke-width", 1)
                            .attr("stroke-dasharray", "3 3");
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
                    this.renderContinuousLegend(lx, this.margin.top + 14, Math.min(plotH - 28, 160),
                        valueDomain, valueScale, vals[valIdx].source.displayName || "Value");
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
                    const d = L.dieMap.get(`${gx},${gy}`);
                    if (!d) continue;
                    const items: VisualTooltipDataItem[] = [];
                    if (hasWafer && d.wafer) items.push({ displayName: "Wafer", value: d.wafer });
                    items.push({ displayName: xTitle, value: String(d.x) });
                    items.push({ displayName: yTitle, value: String(d.y) });
                    if (binTitle && d.bin != null) items.push({ displayName: binTitle, value: d.bin });
                    if (valTitle && d.value != null) items.push({ displayName: valTitle, value: numFmt(d.value) });
                    this.tooltipService.show({
                        dataItems: items, identities: [],
                        coordinates: [mx, my], isTouchEvent: false
                    });
                    return;
                }
                this.tooltipService.hide({ immediately: false, isTouchEvent: false });
            })
            .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));
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
        scale: d3.ScaleLinear<string, string>, title: string
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
        const f = d3.format(",.3~s");
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
