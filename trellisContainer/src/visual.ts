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
import ISandboxExtendedColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";

// ── Types ──────────────────────────────────────────────────────

interface SeriesPoints { axis: string; y: number; }
interface PanelSeries { name: string; points: SeriesPoints[]; }
interface PanelData {
    name: string;
    total: number;
    seriesList: PanelSeries[];   // one entry when no Series bound
    axisMin: number;
    axisMax: number;
    yMin: number;
    yMax: number;
}

interface RenderPalette {
    highContrast: boolean;
    fg: string;
    axisText: string;
    axisLine: string;
    grid: string;
    ghost: string;
    labelText: string;
    background: string;
    landingText: string;
    landingSub: string;
}

const PALETTE = d3.schemeTableau10 as unknown as string[];

// ── Helpers ────────────────────────────────────────────────────

function safeNum(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function findCategoryIndex(cats: powerbi.DataViewCategoryColumn[] | undefined, role: string): number {
    if (!cats) return -1;
    for (let i = 0; i < cats.length; i++) if (cats[i].source.roles && cats[i].source.roles[role]) return i;
    return -1;
}
function findValueIndex(values: powerbi.DataViewValueColumns, role: string): number {
    for (let i = 0; i < values.length; i++) if (values[i].source.roles && values[i].source.roles[role]) return i;
    return -1;
}
function luminance(hex: string): number {
    const c = d3.color(hex)?.rgb();
    if (!c) return 1;
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}
function getCurve(name: string): d3.CurveFactory {
    switch (name) {
        case "step": return d3.curveStepAfter;
        case "linear": return d3.curveLinear;
        default: return d3.curveMonotoneX;
    }
}

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: powerbi.extensibility.visual.IVisualHost;
    private tooltipService: ITooltipService;
    private colorPalette: ISandboxExtendedColorPalette;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;

    /** For pagination: current page index when panel count exceeds `paginationCap`. */
    private page = 0;
    private paginationCap = 40;

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.colorPalette = options.host.colorPalette;
        this.formattingSettingsService = new FormattingSettingsService();

        this.svg = d3.select(options.element).append("svg").classed("trellis-container", true);
        this.landing = this.svg.append("g").classed("tr-landing", true);
        this.container = this.svg.append("g").classed("tr-container", true);
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
            const panels = this.parsePanels(dv);
            if (!panels || panels.length === 0) {
                this.container.selectAll("*").remove();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height, palette);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();
            this.render(panels, width, height, palette);
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private parsePanels(dv: DataView): PanelData[] | null {
        const cat = dv?.categorical;
        if (!cat?.categories?.length || !cat?.values?.length) return null;
        const panelIdx  = findCategoryIndex(cat.categories, "panel");
        const axisIdx   = findCategoryIndex(cat.categories, "axis");
        const seriesIdx = findCategoryIndex(cat.categories, "series");
        const vIdx      = findValueIndex(cat.values, "value");
        if (panelIdx < 0 || axisIdx < 0 || vIdx < 0) return null;

        const panels = cat.categories[panelIdx].values;
        const axis   = cat.categories[axisIdx].values;
        const series = seriesIdx >= 0 ? cat.categories[seriesIdx].values : null;
        const values = cat.values[vIdx].values;
        const rows = panels.length;

        const byPanel = new Map<string, Map<string, Array<{ axis: string; y: number }>>>();
        for (let i = 0; i < rows; i++) {
            const p = String(panels[i]);
            const a = String(axis[i]);
            const s = series ? String(series[i]) : "value";
            const y = safeNum(values[i]);
            if (y == null) continue;
            if (!byPanel.has(p)) byPanel.set(p, new Map());
            const map = byPanel.get(p)!;
            if (!map.has(s)) map.set(s, []);
            map.get(s)!.push({ axis: a, y });
        }

        const out: PanelData[] = [];
        for (const [p, sMap] of byPanel) {
            const seriesList: PanelSeries[] = [];
            let total = 0;
            let yMin = Infinity, yMax = -Infinity;
            let axisMinIdx = Infinity, axisMaxIdx = -Infinity;
            for (const [sname, pts] of sMap) {
                seriesList.push({ name: sname, points: pts });
                for (const pt of pts) {
                    total += pt.y;
                    if (pt.y < yMin) yMin = pt.y;
                    if (pt.y > yMax) yMax = pt.y;
                }
            }
            // Cheap axis ordering assumption: string sort; users get the natural order for dates/ints.
            const uniqueAxis = Array.from(new Set(seriesList.flatMap(s => s.points.map(p => p.axis)))).sort();
            axisMinIdx = 0;
            axisMaxIdx = uniqueAxis.length - 1;
            out.push({ name: p, total, seriesList, axisMin: axisMinIdx, axisMax: axisMaxIdx, yMin, yMax });
        }
        return out;
    }

    private render(panels: PanelData[], width: number, height: number, palette: RenderPalette): void {
        this.container.selectAll("*").remove();
        const s = this.formattingSettings;

        // ── Panel ordering ──
        const order = String(s.gridCard.panelOrder.value?.value ?? "value-desc");
        const sorted = panels.slice();
        if (order === "value-desc") sorted.sort((a, b) => b.total - a.total);
        else if (order === "value-asc") sorted.sort((a, b) => a.total - b.total);
        else if (order === "alphabetical") sorted.sort((a, b) => a.name.localeCompare(b.name));

        // ── Pagination ──
        const totalPanels = sorted.length;
        const perPage = this.paginationCap;
        const pageCount = Math.ceil(totalPanels / perPage);
        this.page = Math.max(0, Math.min(pageCount - 1, this.page));
        const start = this.page * perPage;
        const end = Math.min(start + perPage, totalPanels);
        const paged = sorted.slice(start, end);

        // ── Grid ──
        let cols = Math.max(1, s.gridCard.columns.value ?? 0);
        if (cols === 0) cols = Math.max(1, Math.ceil(Math.sqrt(paged.length)));
        const rows = Math.ceil(paged.length / cols);
        const pad = Math.max(0, s.gridCard.panelPadding.value ?? 8);
        const showTitles = s.gridCard.showPanelTitles.value;
        const titleFs = Math.max(9, Math.min(22, s.gridCard.titleFontSize.value ?? 11));
        const titleH = showTitles ? (titleFs + 6) : 0;

        // Reserve room for the pagination chip when there are extra pages.
        const chipH = pageCount > 1 ? 22 : 0;
        const availH = Math.max(60, height - chipH);

        const pw = Math.max(50, Math.floor((width - pad * (cols + 1)) / cols));
        const ph = Math.max(40, Math.floor((availH - pad * (rows + 1)) / rows));

        // ── Compute shared / free / row-shared Y domains ──
        const yMode = String(s.scalesCard.yScaleMode.value?.value ?? "shared");
        let sharedY: [number, number] = [Infinity, -Infinity];
        for (const p of paged) {
            if (p.yMin < sharedY[0]) sharedY[0] = p.yMin;
            if (p.yMax > sharedY[1]) sharedY[1] = p.yMax;
        }
        if (!Number.isFinite(sharedY[0])) sharedY = [0, 1];

        const yByRow: Array<[number, number]> = [];
        for (let r = 0; r < rows; r++) {
            const rowPanels = paged.slice(r * cols, (r + 1) * cols);
            let lo = Infinity, hi = -Infinity;
            for (const p of rowPanels) { if (p.yMin < lo) lo = p.yMin; if (p.yMax > hi) hi = p.yMax; }
            if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
            yByRow.push([lo, hi]);
        }

        // Shared axis when configured — the union of every panel's axis categories.
        const xMode = String(s.scalesCard.xScaleMode.value?.value ?? "shared");
        const sharedAxis: string[] = Array.from(new Set(
            paged.flatMap(p => p.seriesList.flatMap(sr => sr.points.map(pt => pt.axis)))
        )).sort();

        // ── Benchmark panel ──
        const benchmarkName = String(s.highlightsCard.benchmarkPanel.value ?? "").trim();
        const benchmark = benchmarkName ? paged.find(p => p.name === benchmarkName) : null;

        // ── Draw panels ──
        const curve = getCurve(String(s.chartCard.curveType.value?.value ?? "monotone"));
        const chartType = String(s.chartCard.chartType.value?.value ?? "line");
        const paletteFn = d3.scaleOrdinal<string, string>().range(PALETTE);
        const yAxisMode = String(s.scalesCard.showYAxisEvery.value?.value ?? "first-column");

        paged.forEach((panel, i) => {
            const cx = i % cols, cy = Math.floor(i / cols);
            const ox = pad + cx * (pw + pad);
            const oy = pad + cy * (ph + pad);
            const g = this.container.append("g").attr("transform", `translate(${ox}, ${oy})`);

            // Frame
            g.append("rect")
                .attr("x", 0).attr("y", 0).attr("width", pw).attr("height", ph)
                .attr("fill", palette.background).attr("stroke", palette.grid);

            const plotL = 30, plotR = 6, plotT = titleH + 4, plotB = 16;
            const plotW = pw - plotL - plotR;
            const plotH = ph - plotT - plotB;
            if (plotW <= 4 || plotH <= 4) return;

            // Y domain
            let yDom: [number, number];
            if (yMode === "shared") yDom = sharedY;
            else if (yMode === "shared-within-row") yDom = yByRow[cy];
            else yDom = [panel.yMin, panel.yMax];
            const yPad = (yDom[1] - yDom[0]) * 0.05 || 1;
            const yScale = d3.scaleLinear().domain([yDom[0] - yPad, yDom[1] + yPad]).range([plotT + plotH, plotT]).nice();

            // X domain
            const panelAxis = Array.from(new Set(panel.seriesList.flatMap(s2 => s2.points.map(p => p.axis)))).sort();
            const xDomain = xMode === "shared" ? sharedAxis : panelAxis;
            const isBar = chartType === "bar";
            const xBand = d3.scaleBand<string>().domain(xDomain).range([plotL, plotL + plotW]).padding(Math.max(0, Math.min(0.8, (s.chartCard.barPadding.value ?? 20) / 100)));
            const xPoint = d3.scalePoint<string>().domain(xDomain).range([plotL, plotL + plotW]).padding(0.5);

            // Title.
            if (showTitles) {
                g.append("text")
                    .attr("x", plotL).attr("y", titleFs + 2)
                    .attr("font-family", "Segoe UI, sans-serif")
                    .attr("font-size", `${titleFs}px`).attr("font-weight", 600).attr("fill", palette.labelText)
                    .text(panel.name);
                g.append("text")
                    .attr("x", pw - plotR).attr("y", titleFs + 2)
                    .attr("text-anchor", "end")
                    .attr("font-family", "Segoe UI, sans-serif")
                    .attr("font-size", `${Math.max(8, titleFs - 2)}px`).attr("fill", palette.axisText)
                    .text(d3.format(",.4~g")(panel.total));
            }

            // Y axis (per showYAxisEvery)
            const showY = yAxisMode === "all-panels" || (yAxisMode === "first-column" && cx === 0);
            if (showY) {
                const ya = g.append("g").attr("transform", `translate(${plotL}, 0)`).call(d3.axisLeft(yScale).ticks(3).tickSize(0).tickPadding(4));
                ya.select(".domain").attr("stroke", palette.axisLine);
                ya.selectAll("text").attr("font-size", "9px").attr("fill", palette.axisText);
            } else {
                // Still draw a spine so panels look grounded.
                g.append("line")
                    .attr("x1", plotL).attr("x2", plotL)
                    .attr("y1", plotT).attr("y2", plotT + plotH)
                    .attr("stroke", palette.grid);
            }

            // Bottom axis: only 2 tick labels (first, last) to save room.
            if (panelAxis.length > 0) {
                g.append("text")
                    .attr("x", plotL).attr("y", ph - 4).attr("text-anchor", "start")
                    .attr("font-size", "9px").attr("fill", palette.axisText).text(panelAxis[0]);
                g.append("text")
                    .attr("x", plotL + plotW).attr("y", ph - 4).attr("text-anchor", "end")
                    .attr("font-size", "9px").attr("fill", palette.axisText).text(panelAxis[panelAxis.length - 1]);
            }

            // ── Benchmark ghost drawn FIRST so real series overlay it. ──
            if (benchmark && benchmark.name !== panel.name) {
                for (const bs of benchmark.seriesList) {
                    if (chartType === "bar") continue;
                    const line = d3.line<{ axis: string; y: number }>()
                        .defined(p => p.y != null)
                        .x(p => xPoint(p.axis) ?? plotL).y(p => yScale(p.y))
                        .curve(curve);
                    g.append("path").attr("d", line(bs.points))
                        .attr("fill", "none")
                        .attr("stroke", palette.ghost)
                        .attr("stroke-width", 1.2)
                        .attr("stroke-dasharray", "2 2")
                        .attr("stroke-opacity", 0.7);
                }
            }

            // ── Series drawing ──
            for (const ser of panel.seriesList) {
                const color = palette.highContrast ? palette.fg : paletteFn(ser.name);
                if (chartType === "bar") {
                    g.append("g").selectAll("rect").data(ser.points)
                        .enter().append("rect")
                        .attr("x", p => xBand(p.axis) ?? 0)
                        .attr("y", p => Math.min(yScale(0), yScale(p.y)))
                        .attr("width", Math.max(1, xBand.bandwidth() / Math.max(1, panel.seriesList.length)))
                        .attr("height", p => Math.abs(yScale(0) - yScale(p.y)))
                        .attr("fill", color);
                } else if (chartType === "area") {
                    const area = d3.area<{ axis: string; y: number }>()
                        .defined(p => p.y != null)
                        .x(p => xPoint(p.axis) ?? plotL)
                        .y0(yScale(Math.max(0, yDom[0])))
                        .y1(p => yScale(p.y))
                        .curve(curve);
                    g.append("path").attr("d", area(ser.points))
                        .attr("fill", color).attr("fill-opacity", 0.35)
                        .attr("stroke", color).attr("stroke-width", 1.2);
                } else if (chartType === "scatter") {
                    g.append("g").selectAll("circle").data(ser.points)
                        .enter().append("circle")
                        .attr("cx", p => xPoint(p.axis) ?? plotL)
                        .attr("cy", p => yScale(p.y))
                        .attr("r", Math.max(1, s.chartCard.pointSize.value ?? 3))
                        .attr("fill", color).attr("fill-opacity", 0.75);
                } else {
                    const line = d3.line<{ axis: string; y: number }>()
                        .defined(p => p.y != null)
                        .x(p => xPoint(p.axis) ?? plotL).y(p => yScale(p.y))
                        .curve(curve);
                    g.append("path").attr("d", line(ser.points))
                        .attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.5);
                }
            }
        });

        // ── Pagination chip ──
        if (pageCount > 1) {
            const cg = this.container.append("g")
                .attr("transform", `translate(0, ${availH})`)
                .attr("class", "tr-pager");
            const label = `Page ${this.page + 1} of ${pageCount}  ·  showing ${start + 1}–${end} of ${totalPanels}`;
            cg.append("text")
                .attr("x", pad).attr("y", 14)
                .attr("font-family", "Segoe UI, sans-serif")
                .attr("font-size", "11px").attr("fill", palette.axisText).text(label);

            const btn = (x: number, txt: string, next: number) => {
                const b = cg.append("g").attr("transform", `translate(${x}, 0)`).attr("cursor", "pointer");
                b.append("rect").attr("x", 0).attr("y", 2).attr("width", 24).attr("height", 16)
                    .attr("rx", 3).attr("fill", palette.background).attr("stroke", palette.grid);
                b.append("text").attr("x", 12).attr("y", 14).attr("text-anchor", "middle")
                    .attr("font-size", "12px").attr("fill", palette.labelText).text(txt);
                b.on("click", () => {
                    this.page = Math.max(0, Math.min(pageCount - 1, next));
                    this.render(panels, width, height, palette);
                });
            };
            btn(width - pad - 54, "‹", this.page - 1);
            btn(width - pad - 26, "›", this.page + 1);
        }
    }

    private resolvePalette(): RenderPalette {
        const cp = this.colorPalette;
        if (cp.isHighContrast) {
            const fg = cp.foreground?.value || "#000";
            const bg = cp.background?.value || "#fff";
            return {
                highContrast: true, fg,
                axisText: fg, axisLine: fg, grid: fg, ghost: fg,
                labelText: fg, background: bg,
                landingText: fg, landingSub: fg
            };
        }
        const bg = cp.background?.value || "#fff";
        const isDark = luminance(bg) < 0.5;
        const themeFg = cp.foreground?.value || (isDark ? "#f0f0f0" : "#333");
        return {
            highContrast: false,
            fg: cp.getColor("trellisFg")?.value || "#4472C4",
            axisText: isDark ? "#bbb" : "#666",
            axisLine: isDark ? "#777" : "#999",
            grid: isDark ? "#3a3a3a" : "#e0e0e0",
            ghost: isDark ? "#888" : "#a0a0a0",
            labelText: themeFg,
            background: bg,
            landingText: isDark ? "#eee" : "#333",
            landingSub: isDark ? "#aaa" : "#999"
        };
    }

    private renderLandingPage(width: number, height: number, palette: RenderPalette): void {
        this.landing.selectAll("*").remove();
        this.container.selectAll("*").remove();
        if (width < 160 || height < 100) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);
        // Small grid of mini-plots
        const glyph = g.append("g").attr("transform", "translate(-70, -70)");
        for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
            const x = c * 50, y = r * 40;
            glyph.append("rect").attr("x", x).attr("y", y).attr("width", 42).attr("height", 30).attr("fill", "#f5f5f5").attr("stroke", "#ccc");
            glyph.append("path").attr("d", `M ${x + 4} ${y + 22} Q ${x + 20} ${y + 4 + Math.random() * 12} ${x + 38} ${y + 8 + Math.random() * 12}`)
                .attr("fill", "none").attr("stroke", "#4472C4").attr("stroke-width", 1.2);
        }
        g.append("text").attr("text-anchor", "middle").attr("y", 34)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px").attr("font-weight", 600)
            .attr("fill", palette.landingText).text("Trellis Container");
        g.append("text").attr("text-anchor", "middle").attr("y", 54)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px").attr("fill", palette.axisText)
            .text("Add fields:  Small Multiple By  +  Axis  +  Value");
        g.append("text").attr("text-anchor", "middle").attr("y", 72)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px").attr("fill", palette.landingSub)
            .text("Toggle shared / free / row-shared Y scale for honest cross-panel reads.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
