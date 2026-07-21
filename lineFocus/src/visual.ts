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
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel, DEFAULT_CONTEXT_COLOR, DEFAULT_FOCUS_COLOR } from "./settings";

// ── Types ──────────────────────────────────────────────────────

interface PointRow {
    axis: string;
    axisIdx: number;
    y: number;
    seriesName: string;
    seriesIdx: number;
}

interface SeriesData {
    name: string;
    idx: number;
    points: Array<{ axis: string; axisIdx: number; y: number }>;
    lastValue: number;
    focusFlag: boolean;
}

interface RenderPalette {
    highContrast: boolean;
    context: string;
    focus: string;
    axisText: string;
    axisLine: string;
    labelText: string;
    grid: string;
    background: string;
    landingText: string;
    landingSub: string;
}

// ── Helpers ────────────────────────────────────────────────────

function safeNum(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function getCurve(name: string): d3.CurveFactory {
    switch (name) {
        case "step": return d3.curveStepAfter;
        case "basis": return d3.curveBasis;
        case "monotone": return d3.curveMonotoneX;
        default: return d3.curveLinear;
    }
}

function luminance(hex: string): number {
    const c = d3.color(hex)?.rgb();
    if (!c) return 1;
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private tooltipService: ITooltipService;
    private colorPalette: ISandboxExtendedColorPalette;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;
    private plot: d3.Selection<SVGGElement, unknown, null, undefined>;
    private focusLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
    private overlay: d3.Selection<SVGGElement, unknown, null, undefined>;

    private pinned = new Set<string>();
    private hoverSeriesName: string | null = null;

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.colorPalette = options.host.colorPalette;
        this.formattingSettingsService = new FormattingSettingsService();

        this.svg = d3.select(options.element).append("svg").classed("line-focus", true);
        this.landing = this.svg.append("g").classed("lf-landing", true);
        this.plot = this.svg.append("g").classed("lf-plot", true);
        this.focusLayer = this.svg.append("g").classed("lf-focus", true);
        this.overlay = this.svg.append("g").classed("lf-overlay", true);
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);
        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const palette = this.resolvePalette();

            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);

            const dv: DataView = options.dataViews?.[0];
            const parsed = this.parseData(dv);
            if (!parsed || parsed.categories.length === 0 || parsed.series.length === 0) {
                this.plot.selectAll("*").remove();
                this.focusLayer.selectAll("*").remove();
                this.overlay.selectAll("*").remove();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height, palette);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            // Load pinned set from persisted state.
            const persisted = String(this.formattingSettings.pinnedCard.pinned.value ?? "").trim();
            if (persisted) this.pinned = new Set(persisted.split(",").map(s => s.trim()).filter(Boolean));

            const s = this.formattingSettings;
            const trellisThresh = Math.max(0, s.fallbackCard.smallMultiplesThreshold.value ?? 0);
            if (trellisThresh > 0 && parsed.series.length > trellisThresh) {
                this.renderTrellis(parsed, width, height, palette);
            } else {
                this.render(parsed, width, height, palette);
            }
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private parseData(dv: DataView): { categories: string[]; series: SeriesData[]; axisTitle: string; valueTitle: string } | null {
        const cat = dv?.categorical;
        if (!cat?.categories?.length || !cat?.values?.length) return null;
        const axisCat = cat.categories[0];
        const categories = axisCat.values.map(v => v == null ? "" : String(v));

        // The categorical mapping groups values by the Series field. Each grouping
        // contains one or two value columns (value, optional focusFlag).
        const grouped = cat.values.grouped ? cat.values.grouped() : [{ name: cat.values[0].source.groupName ?? "", values: cat.values as unknown as powerbi.DataViewValueColumn[] }];

        const series: SeriesData[] = [];
        grouped.forEach((g, gi) => {
            const name = g.name == null ? `Series ${gi + 1}` : String(g.name);
            const valCol = (g.values as powerbi.DataViewValueColumn[]).find(v => v.source.roles && v.source.roles["value"]);
            const flagCol = (g.values as powerbi.DataViewValueColumn[]).find(v => v.source.roles && v.source.roles["focusFlag"]);
            if (!valCol) return;
            const pts: Array<{ axis: string; axisIdx: number; y: number }> = [];
            let last: number | null = null;
            for (let i = 0; i < categories.length; i++) {
                const y = safeNum(valCol.values[i]);
                if (y == null) continue;
                pts.push({ axis: categories[i], axisIdx: i, y });
                last = y;
            }
            const flag = flagCol
                ? flagCol.values.some(v => { const n = safeNum(v); return n != null && n > 0; })
                : false;
            if (pts.length) {
                series.push({
                    name, idx: gi, points: pts,
                    lastValue: last ?? 0, focusFlag: flag
                });
            }
        });
        if (series.length === 0) return null;
        return {
            categories,
            series,
            axisTitle: axisCat.source.displayName || "Axis",
            valueTitle: cat.values[0].source.displayName || "Value"
        };
    }

    private render(
        parsed: { categories: string[]; series: SeriesData[]; axisTitle: string; valueTitle: string },
        width: number, height: number, palette: RenderPalette
    ): void {
        this.plot.selectAll("*").remove();
        this.focusLayer.selectAll("*").remove();
        this.overlay.selectAll("*").remove();

        const s = this.formattingSettings;
        const M = { top: 20, right: 130, bottom: 40, left: 52 };
        const plotW = Math.max(60, width - M.left - M.right);
        const plotH = Math.max(60, height - M.top - M.bottom);
        this.plot.attr("transform", `translate(${M.left},${M.top})`);
        this.focusLayer.attr("transform", `translate(${M.left},${M.top})`);
        this.overlay.attr("transform", `translate(${M.left},${M.top})`);

        const xScale = d3.scalePoint<string>()
            .domain(parsed.categories)
            .range([0, plotW]).padding(0.1);

        const allY: number[] = [];
        for (const ser of parsed.series) for (const p of ser.points) allY.push(p.y);
        const yMin = d3.min(allY) ?? 0;
        const yMax = d3.max(allY) ?? 1;
        const yPad = (yMax - yMin) * 0.05 || 1;
        const yScale = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).range([plotH, 0]).nice();

        // ── Gridlines ──
        if (s.axesCard.showGridlines.value) {
            const grid = this.plot.append("g").classed("gridlines", true);
            grid.selectAll("line").data(yScale.ticks(6)).enter().append("line")
                .attr("x1", 0).attr("x2", plotW)
                .attr("y1", d => yScale(d)).attr("y2", d => yScale(d))
                .attr("stroke", palette.grid).attr("stroke-width", 1)
                .attr("shape-rendering", "crispEdges");
        }

        // ── Determine focused set ──
        const focusMode = String(s.focusCard.focusMode.value?.value ?? "hover");
        const topN = Math.max(1, Math.min(parsed.series.length, s.focusCard.topN.value ?? 3));
        let focusedNames = new Set<string>();
        if (focusMode === "top-n") {
            const ranked = parsed.series.slice().sort((a, b) => b.lastValue - a.lastValue);
            for (let i = 0; i < topN; i++) focusedNames.add(ranked[i].name);
        } else if (focusMode === "flag-measure") {
            for (const ser of parsed.series) if (ser.focusFlag) focusedNames.add(ser.name);
        } else if (focusMode === "click-pin") {
            focusedNames = new Set(this.pinned);
        }
        // hover mode has no persistent focus set

        // ── Curve factory ──
        const curveName = String(s.fallbackCard.curveType.value?.value ?? "monotone");
        const curve = getCurve(curveName);
        const line = d3.line<{ axis: string; axisIdx: number; y: number }>()
            .defined(d => d.y != null)
            .x(d => xScale(d.axis)!)
            .y(d => yScale(d.y))
            .curve(curve);

        // ── Context layer (all series in gray) ──
        const contextColor = s.focusCard.contextColor.value.value === DEFAULT_CONTEXT_COLOR
            ? (palette.highContrast ? palette.context : DEFAULT_CONTEXT_COLOR)
            : s.focusCard.contextColor.value.value;
        const contextOpacity = Math.max(0.05, Math.min(1, (s.focusCard.contextOpacity.value ?? 60) / 100));
        const contextWidth = Math.max(0.5, s.focusCard.contextWidth.value ?? 1);

        const contextG = this.plot.append("g").classed("context", true);
        contextG.selectAll("path.series")
            .data(parsed.series)
            .enter().append("path")
            .attr("class", "series")
            .attr("d", d => line(d.points))
            .attr("fill", "none")
            .attr("stroke", contextColor)
            .attr("stroke-opacity", contextOpacity)
            .attr("stroke-width", contextWidth);

        // ── Focus layer (paletted series drawn on top) ──
        const paletteFn = d3.scaleOrdinal<string, string>().range(d3.schemeTableau10 as unknown as string[]);
        const focusColorMode = String(s.focusCard.focusColorMode.value?.value ?? "palette");
        const singleFocusColor = s.focusCard.focusColor.value.value === DEFAULT_FOCUS_COLOR
            ? (palette.highContrast ? palette.focus : DEFAULT_FOCUS_COLOR)
            : s.focusCard.focusColor.value.value;
        const focusWidth = Math.max(0.5, s.focusCard.focusWidth.value ?? 2.5);

        const seriesColorFor = (ser: SeriesData): string => {
            if (palette.highContrast) return palette.focus;
            if (focusColorMode === "single") return singleFocusColor;
            return paletteFn(ser.name);
        };

        const drawFocused = (names: Set<string>): void => {
            this.focusLayer.selectAll("*").remove();
            const focused = parsed.series.filter(ser => names.has(ser.name));
            const focusG = this.focusLayer.append("g").classed("focused", true);
            focusG.selectAll("path.series-focus")
                .data(focused)
                .enter().append("path")
                .attr("class", "series-focus")
                .attr("d", d => line(d.points))
                .attr("fill", "none")
                .attr("stroke", d => seriesColorFor(d))
                .attr("stroke-width", focusWidth)
                .attr("stroke-linejoin", "round");

            // Direct end labels for focused series.
            if (s.labelsCard.showEndLabels.value && focused.length > 0) {
                const fs = Math.max(8, Math.min(24, s.labelsCard.fontSize.value ?? 11));
                const includeVal = s.labelsCard.labelValue.value;
                const labels = focused
                    .map(ser => {
                        const last = ser.points[ser.points.length - 1];
                        if (!last) return null;
                        return {
                            ser, x: xScale(last.axis)!, y: yScale(last.y),
                            text: includeVal ? `${ser.name} (${d3.format(",.4~g")(last.y)})` : ser.name,
                            color: seriesColorFor(ser)
                        };
                    })
                    .filter(Boolean) as Array<{ ser: SeriesData; x: number; y: number; text: string; color: string }>;

                // Greedy vertical de-collision by nudging labels.
                labels.sort((a, b) => a.y - b.y);
                const minGap = fs + 2;
                for (let i = 1; i < labels.length; i++) {
                    if (labels[i].y - labels[i - 1].y < minGap) {
                        labels[i].y = labels[i - 1].y + minGap;
                    }
                }
                const labelG = this.focusLayer.append("g").classed("end-labels", true);
                for (const l of labels) {
                    if (Math.abs(l.y - yScale(l.ser.points[l.ser.points.length - 1].y)) > 8) {
                        labelG.append("line")
                            .attr("x1", l.x + 2).attr("x2", l.x + 6)
                            .attr("y1", yScale(l.ser.points[l.ser.points.length - 1].y))
                            .attr("y2", l.y)
                            .attr("stroke", l.color).attr("stroke-width", 0.75);
                    }
                    labelG.append("text")
                        .attr("x", l.x + 8).attr("y", l.y)
                        .attr("dominant-baseline", "central")
                        .attr("font-family", "Segoe UI, sans-serif")
                        .attr("font-size", `${fs}px`)
                        .attr("font-weight", 600)
                        .attr("fill", l.color)
                        .text(l.text);
                }
            }
        };

        drawFocused(focusedNames);

        // ── Axes ──
        if (s.axesCard.showAxes.value) {
            const axFs = s.axesCard.fontSize.value ?? 11;
            const xa = this.plot.append("g").attr("transform", `translate(0,${plotH})`).call(d3.axisBottom(xScale).tickSize(0).tickPadding(8));
            const ya = this.plot.append("g").call(d3.axisLeft(yScale).ticks(6).tickSize(0).tickPadding(6));
            [xa, ya].forEach(g => {
                g.select(".domain").attr("stroke", palette.axisLine);
                g.selectAll("text").attr("fill", palette.axisText).attr("font-size", `${axFs}px`);
            });
        }

        // ── Quadtree hover (all points across all series) ──
        const allPts: PointRow[] = [];
        for (const ser of parsed.series) {
            for (const p of ser.points) {
                allPts.push({ axis: p.axis, axisIdx: p.axisIdx, y: p.y, seriesName: ser.name, seriesIdx: ser.idx });
            }
        }
        const qt = d3.quadtree<PointRow>()
            .x(d => xScale(d.axis)!)
            .y(d => yScale(d.y))
            .addAll(allPts);

        const hoverGuide = this.overlay.append("line")
            .attr("y1", 0).attr("y2", plotH)
            .attr("stroke", palette.axisLine).attr("stroke-width", 1)
            .attr("stroke-dasharray", "3 3").attr("opacity", 0).attr("pointer-events", "none");
        const hoverDot = this.overlay.append("circle")
            .attr("r", 4).attr("fill", palette.focus).attr("stroke", palette.background)
            .attr("stroke-width", 1.5).attr("opacity", 0).attr("pointer-events", "none");

        const hit = this.overlay.append("rect")
            .attr("x", 0).attr("y", 0).attr("width", plotW).attr("height", plotH)
            .attr("fill", "transparent");

        hit.on("mousemove", (event: MouseEvent) => {
            const [mx, my] = d3.pointer(event, this.svg.node());
            const p = qt.find(mx - M.left, my - M.top, 40);
            if (!p) { hoverGuide.attr("opacity", 0); hoverDot.attr("opacity", 0); this.tooltipService.hide({ immediately: false, isTouchEvent: false }); return; }
            const x = xScale(p.axis)!;
            hoverGuide.attr("x1", x).attr("x2", x).attr("opacity", 1);
            hoverDot.attr("cx", x).attr("cy", yScale(p.y)).attr("opacity", 1).attr("fill", paletteFn(p.seriesName));

            // Hover-mode focus: highlight this one series without persisting.
            if (focusMode === "hover" && p.seriesName !== this.hoverSeriesName) {
                this.hoverSeriesName = p.seriesName;
                drawFocused(new Set([p.seriesName]));
            }

            this.tooltipService.show({
                dataItems: [
                    { displayName: parsed.axisTitle, value: p.axis },
                    { displayName: p.seriesName, value: d3.format(",.4~g")(p.y) }
                ],
                identities: [], coordinates: [event.clientX, event.clientY], isTouchEvent: false
            });
        });

        hit.on("mouseleave", () => {
            hoverGuide.attr("opacity", 0);
            hoverDot.attr("opacity", 0);
            if (focusMode === "hover") {
                this.hoverSeriesName = null;
                drawFocused(focusedNames); // back to no focus (empty set for hover mode)
            }
            this.tooltipService.hide({ immediately: false, isTouchEvent: false });
        });

        // Click-pin: toggle nearest series into the pinned set.
        if (focusMode === "click-pin") {
            hit.on("click", (event: MouseEvent) => {
                const [mx, my] = d3.pointer(event, this.svg.node());
                const p = qt.find(mx - M.left, my - M.top, 40);
                if (!p) return;
                if (this.pinned.has(p.seriesName)) this.pinned.delete(p.seriesName);
                else this.pinned.add(p.seriesName);
                this.persistPinned();
                drawFocused(new Set(this.pinned));
            });
        }
    }

    /**
     * Trellis fallback: one mini-panel per series when the total exceeds the threshold.
     * Reuses the panel-render pattern shared with the trellis visual.
     */
    private renderTrellis(
        parsed: { categories: string[]; series: SeriesData[]; axisTitle: string; valueTitle: string },
        width: number, height: number, palette: RenderPalette
    ): void {
        this.plot.selectAll("*").remove();
        this.focusLayer.selectAll("*").remove();
        this.overlay.selectAll("*").remove();

        const s = this.formattingSettings;
        const cols = Math.max(1, Math.ceil(Math.sqrt(parsed.series.length)));
        const rows = Math.ceil(parsed.series.length / cols);
        const pad = 8;
        const pw = Math.max(60, Math.floor((width - pad * (cols + 1)) / cols));
        const ph = Math.max(50, Math.floor((height - pad * (rows + 1)) / rows));

        // Shared Y scale across all panels (honest cross-panel comparison).
        const allY: number[] = [];
        for (const ser of parsed.series) for (const p of ser.points) allY.push(p.y);
        const yMin = d3.min(allY) ?? 0;
        const yMax = d3.max(allY) ?? 1;
        const yPad = (yMax - yMin) * 0.05 || 1;
        const yScale = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).range([ph - 18, 4]).nice();
        const xScale = d3.scalePoint<string>().domain(parsed.categories).range([0, pw]).padding(0.05);
        const curveName = String(s.fallbackCard.curveType.value?.value ?? "monotone");
        const curve = getCurve(curveName);
        const line = d3.line<{ axis: string; axisIdx: number; y: number }>()
            .defined(d => d.y != null)
            .x(d => xScale(d.axis)!)
            .y(d => yScale(d.y))
            .curve(curve);
        const paletteFn = d3.scaleOrdinal<string, string>().range(d3.schemeTableau10 as unknown as string[]);

        const trellis = this.plot.attr("transform", `translate(0,0)`);
        parsed.series.forEach((ser, i) => {
            const cx = i % cols, cy = Math.floor(i / cols);
            const ox = pad + cx * (pw + pad);
            const oy = pad + cy * (ph + pad);
            const g = trellis.append("g").attr("transform", `translate(${ox},${oy})`);
            g.append("rect").attr("x", 0).attr("y", 0).attr("width", pw).attr("height", ph)
                .attr("fill", "none").attr("stroke", palette.grid);
            // Faint context: the other series in gray, plus this one on top in color.
            g.append("g").selectAll("path").data(parsed.series.filter(o => o.name !== ser.name))
                .enter().append("path")
                .attr("d", d => line(d.points))
                .attr("fill", "none").attr("stroke", palette.context)
                .attr("stroke-opacity", 0.35).attr("stroke-width", 0.75);
            g.append("path").attr("d", line(ser.points))
                .attr("fill", "none")
                .attr("stroke", palette.highContrast ? palette.focus : paletteFn(ser.name))
                .attr("stroke-width", 1.5);
            g.append("text").attr("x", 4).attr("y", 12)
                .attr("font-family", "Segoe UI, sans-serif")
                .attr("font-size", "10px").attr("font-weight", 600)
                .attr("fill", palette.labelText).text(ser.name);
        });
    }

    private persistPinned(): void {
        try {
            this.host.persistProperties({
                merge: [{
                    objectName: "pinnedSeries",
                    selector: null,
                    properties: { pinned: Array.from(this.pinned).join(",") }
                }]
            });
        } catch { /* persistProperties can throw during initial-load races; ignore silently */ }
    }

    private resolvePalette(): RenderPalette {
        const cp = this.colorPalette;
        if (cp.isHighContrast) {
            const fg = cp.foreground?.value || "#000";
            const bg = cp.background?.value || "#fff";
            return {
                highContrast: true, context: fg, focus: fg,
                axisText: fg, axisLine: fg, labelText: fg, grid: fg, background: bg,
                landingText: fg, landingSub: fg
            };
        }
        const bg = cp.background?.value || "#ffffff";
        const isDark = luminance(bg) < 0.5;
        const themeFg = cp.foreground?.value || (isDark ? "#f0f0f0" : "#333");
        return {
            highContrast: false,
            context: isDark ? "#555" : DEFAULT_CONTEXT_COLOR,
            focus: cp.getColor("lineFocus")?.value || DEFAULT_FOCUS_COLOR,
            axisText: isDark ? "#bbb" : "#666",
            axisLine: isDark ? "#777" : "#999",
            labelText: themeFg,
            grid: isDark ? "#3a3a3a" : "#eaeaea",
            background: bg,
            landingText: isDark ? "#eee" : "#333",
            landingSub:  isDark ? "#aaa" : "#999"
        };
    }

    private renderLandingPage(width: number, height: number, palette: RenderPalette): void {
        this.landing.selectAll("*").remove();
        this.plot.selectAll("*").remove();
        this.focusLayer.selectAll("*").remove();
        this.overlay.selectAll("*").remove();
        if (width < 160 || height < 100) return;

        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);
        const glyph = g.append("g").attr("transform", "translate(-100, -80)");
        // A field of gray lines with one highlighted
        for (let i = 0; i < 12; i++) {
            const y0 = 60 - Math.abs(i - 6) * 3;
            glyph.append("path")
                .attr("d", `M 0 ${y0 + Math.sin(i) * 10} Q 100 ${y0 - 5 + i * 2} 200 ${y0 - Math.sin(i * 2) * 8}`)
                .attr("fill", "none").attr("stroke", "#ccc").attr("stroke-width", 1);
        }
        glyph.append("path")
            .attr("d", `M 0 70 Q 100 20 200 5`)
            .attr("fill", "none").attr("stroke", "#4472C4").attr("stroke-width", 2.5);

        g.append("text")
            .attr("text-anchor", "middle").attr("y", 30)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "16px").attr("font-weight", 600)
            .attr("fill", palette.landingText).text("Line Focus");
        g.append("text")
            .attr("text-anchor", "middle").attr("y", 52)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "12px").attr("fill", palette.axisText)
            .text("Add fields:  Axis  +  Series  +  Value");
        g.append("text")
            .attr("text-anchor", "middle").attr("y", 70)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "11px").attr("fill", palette.landingSub)
            .text("Hover to spotlight · click-pin for multi · Top-N or DAX flag for report control.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
