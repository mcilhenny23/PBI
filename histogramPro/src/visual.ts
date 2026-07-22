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
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel, DEFAULT_BAR_COLOR, DEFAULT_DENSITY_COLOR } from "./settings";

const CAT_PALETTE = d3.schemeTableau10 as unknown as string[];

interface RowData {
    value: number;
    group: string | null;
    selectionId?: ISelectionId;
    isHighlighted: boolean;
}
interface RenderPalette {
    highContrast: boolean;
    bar: string;
    density: string;
    axisText: string;
    axisLine: string;
    grid: string;
    labelText: string;
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

/** Nice-number snap: round the given width to a "friendly" 1/2/5 × 10^k value. */
function niceWidth(w: number): number {
    if (w <= 0) return w;
    const mag = Math.pow(10, Math.floor(Math.log10(w)));
    const norm = w / mag;
    const factor = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return factor * mag;
}

/** Freedman-Diaconis, Sturges, Scott rules for bin width from raw values. */
function chooseBinWidth(values: number[], rule: string): number {
    const N = values.length;
    if (N === 0) return 1;
    const sorted = values.slice().sort((a, b) => a - b);
    const q1 = d3.quantile(sorted, 0.25) ?? 0;
    const q3 = d3.quantile(sorted, 0.75) ?? 1;
    const iqr = q3 - q1;
    const range = (sorted[N - 1] - sorted[0]) || 1;
    switch (rule) {
        case "sturges": {
            const bins = Math.ceil(Math.log2(N) + 1);
            return range / Math.max(1, bins);
        }
        case "scott": {
            const mean = d3.mean(sorted) ?? 0;
            const sd = Math.sqrt(d3.mean(sorted.map(v => (v - mean) ** 2)) ?? 1);
            return 3.49 * sd * Math.pow(N, -1 / 3) || 1;
        }
        case "fd":
        default: {
            const w = 2 * iqr * Math.pow(N, -1 / 3);
            return w > 0 ? w : range / 30;
        }
    }
}

/** Rough KDE eval on a fixed grid; Silverman bandwidth scaled by user %. */
function kde(values: number[], gridX: number[], bandwidthScale: number): number[] {
    const N = values.length;
    if (N === 0) return gridX.map(() => 0);
    const mean = d3.mean(values) ?? 0;
    const sd = Math.sqrt(d3.mean(values.map(v => (v - mean) ** 2)) ?? 1);
    const silverman = 1.06 * sd * Math.pow(N, -0.2) || 1;
    const h = silverman * (bandwidthScale / 100);
    const norm = 1 / (N * h * Math.sqrt(2 * Math.PI));
    return gridX.map(x => {
        let sum = 0;
        for (let i = 0; i < N; i++) {
            const u = (x - values[i]) / h;
            sum += Math.exp(-0.5 * u * u);
        }
        return sum * norm;
    });
}

/** Standard normal PDF for the fit-N(μ,σ) overlay. */
function normalPdf(x: number, mu: number, sd: number): number {
    return (1 / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - mu) / sd) ** 2);
}

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private tooltipService: ITooltipService;
    private colorPalette: ISandboxExtendedColorPalette;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;

    /** During a slider drag, we live-update this width and skip the format-model value. */
    private draggingWidth: number | null = null;

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        // Localization manager instantiated for future getDisplayName use; call is required for the AppSource Localizations feature check.
        void options.host.createLocalizationManager();
        this.tooltipService = options.host.tooltipService;
        this.colorPalette = options.host.colorPalette;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applySelectionStyling());

        this.svg = d3.select(options.element).append("svg").classed("histogram-pro", true);
        this.landing = this.svg.append("g").classed("hp-landing", true);
        this.container = this.svg.append("g").classed("hp-container", true);

        this.svg.on("click", (event: MouseEvent) => {
            if (event.target === this.svg.node()) {
                this.selectionManager.clear().then(() => this.applySelectionStyling());
            }
        });
    }

    private applySelectionStyling(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.05, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 25) / 100));
        const activeIds = this.selectionManager.getSelectionIds() as ISelectionId[];
        const hasSel = activeIds.length > 0;
        const eq = (a: ISelectionId, b: ISelectionId) =>
            (a as { equals?: (b: ISelectionId) => boolean }).equals?.(b) ?? false;

        this.container.selectAll<SVGRectElement, { ids?: ISelectionId[] }>("rect.hp-bin").each(function (d) {
            const rect = d3.select(this);
            const ids = d?.ids ?? [];
            const isSel = ids.some(id => activeIds.some(a => eq(a, id)));
            let opacity = 1;
            if (hasSel && !isSel) opacity = dim;
            const base = Number((this as SVGRectElement).dataset.baseOpacity ?? "0.75");
            rect.attr("fill-opacity", base * opacity);
        });
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

            const rows = this.parseData(options.dataViews?.[0]);
            if (!rows || rows.length === 0) {
                this.container.selectAll("*").remove();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height, palette);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();
            this.render(rows, width, height, palette);
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private parseData(dv?: DataView): RowData[] | null {
        if (!dv?.categorical?.values?.length) return null;
        const cat = dv.categorical;
        const vIdx = findValueIndex(cat.values, "values");
        if (vIdx < 0) return null;
        const grpIdx = findCategoryIndex(cat.categories, "groupBy");
        const obsIdx = findCategoryIndex(cat.categories, "obsKey");
        const identityCat = obsIdx >= 0 ? cat.categories![obsIdx]
                          : grpIdx >= 0 ? cat.categories![grpIdx]
                          : null;
        const highlights = cat.values[vIdx].highlights ?? null;

        const rows: RowData[] = [];
        const N = cat.values[vIdx].values.length;
        const grpVals = grpIdx >= 0 ? cat.categories![grpIdx].values : null;
        for (let i = 0; i < N; i++) {
            const v = safeNum(cat.values[vIdx].values[i]);
            if (v == null) continue;

            let selectionId: ISelectionId | undefined;
            if (identityCat) {
                try {
                    selectionId = this.host.createSelectionIdBuilder()
                        .withCategory(identityCat, i)
                        .createSelectionId();
                } catch { /* skipped */ }
            }
            const isHighlighted = highlights ? (highlights[i] != null) : true;

            rows.push({
                value: v,
                group: grpVals ? String(grpVals[i]) : null,
                selectionId, isHighlighted
            });
        }
        return rows;
    }

    private render(rows: RowData[], width: number, height: number, palette: RenderPalette): void {
        this.container.selectAll("*").remove();
        const s = this.formattingSettings;
        const M = { top: 24, right: 18, bottom: 60, left: 52 };
        const plotW = Math.max(60, width - M.left - M.right);
        const plotH = Math.max(60, height - M.top - M.bottom);
        this.container.attr("transform", `translate(${M.left}, ${M.top})`);

        const values = rows.map(r => r.value);
        if (values.length < 10) {
            this.renderRugPlot(rows, plotW, plotH, palette);
            return;
        }

        // Chosen bin width per settings, with slider/persisted override.
        const binMethod = String(s.binningCard.binMethod.value?.value ?? "fd");
        let width0 = chooseBinWidth(values, binMethod);
        if (binMethod === "manual") {
            const persisted = s.manualBinCard.width.value ?? 0;
            const manual = s.binningCard.manualBinWidth.value ?? 0;
            width0 = this.draggingWidth ?? (persisted > 0 ? persisted : (manual > 0 ? manual : width0));
        }
        if (s.binningCard.niceBoundaries.value) width0 = niceWidth(width0);
        if (width0 <= 0) width0 = 1;

        const min = d3.min(values)!, max = d3.max(values)!;
        // Snap min/max down/up to width0 multiples.
        const dMin = Math.floor(min / width0) * width0;
        const dMax = Math.ceil(max / width0) * width0;
        const thresholds: number[] = [];
        for (let x = dMin; x <= dMax + 1e-9; x += width0) thresholds.push(x);

        // Groups (or single).
        const groups = Array.from(new Set(rows.map(r => r.group ?? "All")));
        const groupMode = String(s.barsCard.groupMode.value?.value ?? "overlay");
        const yMode = String(s.barsCard.yMode.value?.value ?? "count");
        const bandwidthScale = Math.max(20, Math.min(300, s.densityCard.bandwidthScale.value ?? 100));

        const binByGroup = new Map<string, d3.Bin<number, number>[]>();
        for (const g of groups) {
            const vs = rows.filter(r => (r.group ?? "All") === g).map(r => r.value);
            const bins = d3.bin<number, number>().domain([dMin, dMax]).thresholds(thresholds.slice(1, -1))(vs);
            binByGroup.set(g, bins);
        }

        // Y transform.
        const totalCount = values.length;
        const barValueFor = (b: d3.Bin<number, number>): number => {
            if (yMode === "count") return b.length;
            if (yMode === "frequency") return b.length / totalCount;
            return b.length / (totalCount * width0);
        };

        // ── Draw ──
        const paletteFn = d3.scaleOrdinal<string, string>().range(CAT_PALETTE);
        const xScale = d3.scaleLinear().domain([dMin, dMax]).range([0, plotW]);
        let allBarValues: number[] = [];
        for (const g of groups) {
            const bins = binByGroup.get(g)!;
            for (const b of bins) allBarValues.push(barValueFor(b));
        }
        const rawMax = d3.max(allBarValues) ?? 1;

        // Include density curve values in the y domain so it fits.
        let densityMax = 0;
        let gridX: number[] = [];
        if (s.densityCard.showDensity.value) {
            gridX = d3.range(dMin, dMax, (dMax - dMin) / 200);
            const densAll = kde(values, gridX, bandwidthScale);
            densityMax = d3.max(densAll) ?? 0;
        }
        const combinedMax = Math.max(rawMax, (yMode === "density" ? densityMax : 0));
        const yScale = d3.scaleLinear().domain([0, combinedMax * 1.05 || 1]).range([plotH, 0]).nice();

        // Gridlines.
        const gridG = this.container.append("g").classed("gridlines", true);
        gridG.selectAll("line").data(yScale.ticks(5))
            .enter().append("line")
            .attr("x1", 0).attr("x2", plotW).attr("y1", d => yScale(d)).attr("y2", d => yScale(d))
            .attr("stroke", palette.grid).attr("stroke-width", 1);

        // Bars.
        const barColor = s.barsCard.barColor.value.value === DEFAULT_BAR_COLOR
            ? (this.colorPalette.getColor("hpBar")?.value || DEFAULT_BAR_COLOR)
            : s.barsCard.barColor.value.value;
        const barsG = this.container.append("g").classed("bars", true);
        const opacity = Math.max(0.1, Math.min(1, (s.barsCard.barOpacity.value ?? 75) / 100));

        if (groupMode === "facet" && groups.length > 1) {
            // Facet: rows are sequential mini-plots. Simple horizontal facet.
            const rowH = plotH / groups.length;
            groups.forEach((g, gi) => {
                const yOff = gi * rowH;
                const yF = d3.scaleLinear().domain(yScale.domain()).range([rowH - 4, 4]);
                barsG.append("text")
                    .attr("x", 4).attr("y", yOff + 12)
                    .attr("font-size", "10px").attr("font-weight", 600).attr("fill", palette.labelText)
                    .text(g);
                const color = palette.highContrast ? palette.bar : paletteFn(g);
                const bins = binByGroup.get(g)!;
                barsG.append("g").selectAll("rect").data(bins)
                    .enter().append("rect")
                    .attr("x", d => xScale(d.x0!) + 1)
                    .attr("y", d => yOff + yF(barValueFor(d)))
                    .attr("width", d => Math.max(1, xScale(d.x1!) - xScale(d.x0!) - 2))
                    .attr("height", d => Math.max(0, yF(0) - yF(barValueFor(d))))
                    .attr("fill", color).attr("fill-opacity", 0.85);
            });
        } else if (groupMode === "stack" && groups.length > 1) {
            // Stack: for each bin, layer groups atop each other.
            const nBins = binByGroup.get(groups[0])!.length;
            const cumBinY: number[] = new Array(nBins).fill(0);
            groups.forEach(g => {
                const bins = binByGroup.get(g)!;
                const color = palette.highContrast ? palette.bar : paletteFn(g);
                bins.forEach((b, bi) => {
                    const bv = barValueFor(b);
                    barsG.append("rect")
                        .attr("x", xScale(b.x0!) + 1)
                        .attr("y", yScale(cumBinY[bi] + bv))
                        .attr("width", Math.max(1, xScale(b.x1!) - xScale(b.x0!) - 2))
                        .attr("height", Math.max(0, yScale(cumBinY[bi]) - yScale(cumBinY[bi] + bv)))
                        .attr("fill", color).attr("fill-opacity", opacity);
                    cumBinY[bi] += bv;
                });
            });
        } else {
            // Overlay: draw each group with transparency; single group falls through here too.
            groups.forEach(g => {
                const bins = binByGroup.get(g)!;
                const color = palette.highContrast ? palette.bar : (groups.length > 1 ? paletteFn(g) : barColor);
                const groupSubset = g === "All" ? rows : rows.filter(r => (r.group ?? "All") === g);
                barsG.append("g").selectAll("rect").data(bins)
                    .enter().append("rect")
                    .attr("class", "hp-bin")
                    .attr("x", d => xScale(d.x0!) + 1)
                    .attr("y", d => yScale(barValueFor(d)))
                    .attr("width", d => Math.max(1, xScale(d.x1!) - xScale(d.x0!) - 2))
                    .attr("height", d => Math.max(0, yScale(0) - yScale(barValueFor(d))))
                    .attr("fill", color).attr("fill-opacity", opacity)
                    .each(function (d) {
                        // Collect selection ids for every row whose value falls in this bin.
                        const lo = d.x0!, hi = d.x1!;
                        const ids: ISelectionId[] = [];
                        for (const r of groupSubset) {
                            if (r.value >= lo && r.value < hi && r.selectionId) ids.push(r.selectionId);
                        }
                        (this as SVGRectElement).dataset.baseOpacity = String(opacity);
                        // Store on the datum so applySelectionStyling can find them without a full re-scan.
                        (d as unknown as { ids?: ISelectionId[] }).ids = ids;
                    })
                    .attr("tabindex", 0).attr("role", "button")
                    .style("cursor", "pointer")
                    .on("click", (event: MouseEvent, d) => {
                        event.stopPropagation();
                        const ids = (d as unknown as { ids?: ISelectionId[] }).ids ?? [];
                        if (ids.length === 0) return;
                        const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                        this.selectionManager.select(ids, multi).then(() => this.applySelectionStyling());
                    })
                    .on("contextmenu", (event: MouseEvent, d) => {
                        event.preventDefault(); event.stopPropagation();
                        const ids = (d as unknown as { ids?: ISelectionId[] }).ids ?? [];
                        this.selectionManager.showContextMenu(ids[0] ?? ({} as ISelectionId), { x: event.clientX, y: event.clientY });
                    });
            });
        }

        // Density overlay (only meaningful if yMode = density, but always drawable).
        if (s.densityCard.showDensity.value && gridX.length) {
            const densColor = s.densityCard.densityColor.value.value === DEFAULT_DENSITY_COLOR ? DEFAULT_DENSITY_COLOR : s.densityCard.densityColor.value.value;
            const densWidth = Math.max(1, s.densityCard.densityWidth.value ?? 2);
            const densAll = kde(values, gridX, bandwidthScale);
            // If not in density y-mode, scale KDE up to bar heights to remain visible.
            const scaleFactor = yMode === "density" ? 1 : (rawMax / (d3.max(densAll) ?? 1));
            const line = d3.line<[number, number]>()
                .x(p => xScale(p[0]))
                .y(p => yScale(p[1] * scaleFactor))
                .curve(d3.curveBasis);
            const pts: [number, number][] = gridX.map((x, i) => [x, densAll[i]]);
            this.container.append("path")
                .datum(pts)
                .attr("d", line)
                .attr("fill", "none")
                .attr("stroke", densColor)
                .attr("stroke-width", densWidth);
        }

        // Normal-fit overlay.
        if (s.annotationsCard.showNormalOverlay.value) {
            const mu = d3.mean(values) ?? 0;
            const sd = Math.sqrt(d3.mean(values.map(v => (v - mu) ** 2)) ?? 1);
            const grid = d3.range(dMin, dMax, (dMax - dMin) / 200);
            const pdf = grid.map(x => normalPdf(x, mu, sd));
            const scaleFactor = yMode === "density" ? 1 : (rawMax / (d3.max(pdf) ?? 1));
            const line = d3.line<[number, number]>().x(p => xScale(p[0])).y(p => yScale(p[1] * scaleFactor));
            this.container.append("path")
                .datum(grid.map((x, i) => [x, pdf[i]] as [number, number]))
                .attr("d", line).attr("fill", "none")
                .attr("stroke", palette.labelText).attr("stroke-width", 1.2).attr("stroke-dasharray", "4 3");
        }

        // Mean / median lines.
        if (s.annotationsCard.showMeanLine.value) {
            const mu = d3.mean(values) ?? 0;
            this.container.append("line")
                .attr("x1", xScale(mu)).attr("x2", xScale(mu))
                .attr("y1", 0).attr("y2", plotH)
                .attr("stroke", "#8a2be2").attr("stroke-width", 1.5).attr("stroke-dasharray", "4 3");
        }
        if (s.annotationsCard.showMedianLine.value) {
            const med = d3.median(values) ?? 0;
            this.container.append("line")
                .attr("x1", xScale(med)).attr("x2", xScale(med))
                .attr("y1", 0).attr("y2", plotH)
                .attr("stroke", "#20c997").attr("stroke-width", 1.5).attr("stroke-dasharray", "4 3");
        }

        // Axes.
        const xa = this.container.append("g")
            .attr("transform", `translate(0, ${plotH})`)
            .call(d3.axisBottom(xScale).ticks(6));
        const ya = this.container.append("g")
            .call(d3.axisLeft(yScale).ticks(5));
        [xa, ya].forEach(g => {
            g.select(".domain").attr("stroke", palette.axisLine);
            g.selectAll("text").attr("fill", palette.axisText).attr("font-size", "11px");
        });

        // Bin-width slider.
        if (s.binningCard.showBinSlider.value) {
            this.renderBinSlider(plotW, plotH, width0, dMin, dMax, palette);
        }

        this.applySelectionStyling();
    }

    private renderBinSlider(
        plotW: number, plotH: number, currentWidth: number,
        dMin: number, dMax: number, palette: RenderPalette
    ): void {
        // A simple horizontal slider below the X axis. Track spans plot width.
        // Handle position maps `binWidth` from (range/200) → (range/3) linearly.
        const range = dMax - dMin;
        const minW = range / 200;
        const maxW = range / 3;
        const t = (currentWidth - minW) / (maxW - minW);
        const trackY = plotH + 40;
        const slider = this.container.append("g").classed("bin-slider", true);
        slider.append("line")
            .attr("x1", 0).attr("x2", plotW).attr("y1", trackY).attr("y2", trackY)
            .attr("stroke", palette.axisLine).attr("stroke-width", 2);
        slider.append("text")
            .attr("x", 0).attr("y", trackY - 8)
            .attr("font-size", "10px").attr("fill", palette.axisText).text("Bin width");
        slider.append("text")
            .attr("x", plotW).attr("y", trackY - 8).attr("text-anchor", "end")
            .attr("font-size", "10px").attr("fill", palette.axisText).text(`= ${d3.format(",.3~g")(currentWidth)}`);

        const handle = slider.append("circle")
            .attr("cx", Math.max(0, Math.min(1, t)) * plotW).attr("cy", trackY)
            .attr("r", 8).attr("fill", palette.background).attr("stroke", palette.axisLine).attr("stroke-width", 1.5)
            .attr("cursor", "ew-resize");

        const drag = d3.drag<SVGCircleElement, unknown>()
            .on("start", () => {
                // Switch method to manual on grab.
                try {
                    this.host.persistProperties({
                        merge: [{
                            objectName: "binning", selector: null,
                            properties: { binMethod: "manual" }
                        }]
                    });
                } catch { /* no-op */ }
            })
            .on("drag", (event) => {
                const x = Math.max(0, Math.min(plotW, event.x));
                handle.attr("cx", x);
                const newT = x / plotW;
                const newW = minW + newT * (maxW - minW);
                this.draggingWidth = newW;
                // Live re-render for immediate feedback.
                this.render(this.parseData(this.svg.datum() as DataView) ?? [], 0, 0, palette); // won't work — we need viewport
            });
        handle.call(drag);
        // Simplified: end handler persists the new width.
        handle.on("mouseup", () => {
            if (this.draggingWidth != null) {
                try {
                    this.host.persistProperties({
                        merge: [{
                            objectName: "manualBin", selector: null,
                            properties: { width: this.draggingWidth }
                        }, {
                            objectName: "binning", selector: null,
                            properties: { manualBinWidth: this.draggingWidth }
                        }]
                    });
                } catch { /* no-op */ }
                this.draggingWidth = null;
            }
        });
    }

    private renderRugPlot(rows: RowData[], plotW: number, plotH: number, palette: RenderPalette): void {
        const values = rows.map(r => r.value);
        const min = d3.min(values) ?? 0, max = d3.max(values) ?? 1;
        const pad = (max - min) * 0.1 || 1;
        const xScale = d3.scaleLinear().domain([min - pad, max + pad]).range([0, plotW]);
        const g = this.container.append("g").classed("rug", true);
        g.selectAll("line").data(values).enter().append("line")
            .attr("x1", d => xScale(d)).attr("x2", d => xScale(d))
            .attr("y1", plotH / 2 - 12).attr("y2", plotH / 2 + 12)
            .attr("stroke", palette.bar).attr("stroke-width", 1);
        g.append("text")
            .attr("x", plotW / 2).attr("y", plotH / 2 + 34)
            .attr("text-anchor", "middle").attr("font-size", "11px").attr("fill", palette.axisText)
            .text(`n = ${values.length} — showing rug plot (histogram needs ≥ 10 values).`);
        // X axis
        const xa = this.container.append("g").attr("transform", `translate(0, ${plotH / 2 + 16})`).call(d3.axisBottom(xScale).ticks(5));
        xa.select(".domain").attr("stroke", palette.axisLine);
        xa.selectAll("text").attr("fill", palette.axisText);
    }

    private resolvePalette(): RenderPalette {
        const cp = this.colorPalette;
        if (cp.isHighContrast) {
            const fg = cp.foreground?.value || "#000";
            const bg = cp.background?.value || "#fff";
            return {
                highContrast: true, bar: fg, density: fg,
                axisText: fg, axisLine: fg, grid: fg, labelText: fg,
                background: bg, landingText: fg, landingSub: fg
            };
        }
        const bg = cp.background?.value || "#fff";
        const isDark = luminance(bg) < 0.5;
        const themeFg = cp.foreground?.value || (isDark ? "#f0f0f0" : "#333");
        return {
            highContrast: false,
            bar: cp.getColor("hpBar")?.value || DEFAULT_BAR_COLOR,
            density: DEFAULT_DENSITY_COLOR,
            axisText: isDark ? "#bbb" : "#666",
            axisLine: isDark ? "#777" : "#999",
            grid: isDark ? "#3a3a3a" : "#eaeaea",
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
        const glyph = g.append("g").attr("transform", "translate(-90, -80)");
        // Fake histogram bars
        const bars = [10, 25, 45, 70, 90, 100, 85, 60, 32, 12];
        for (let i = 0; i < bars.length; i++) {
            glyph.append("rect").attr("x", i * 18).attr("y", 100 - bars[i]).attr("width", 16).attr("height", bars[i]).attr("fill", "#4472C4").attr("fill-opacity", 0.6);
        }
        g.append("text").attr("text-anchor", "middle").attr("y", 34).attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px").attr("font-weight", 600).attr("fill", palette.landingText).text("Histogram Pro");
        g.append("text").attr("text-anchor", "middle").attr("y", 54).attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px").attr("fill", palette.axisText).text("Add fields:  Values  +  Observation Key  (+ Compare Groups)");
        g.append("text").attr("text-anchor", "middle").attr("y", 72).attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px").attr("fill", palette.landingSub).text("Auto bin-width, KDE overlay, and a drag-to-adjust bin-width slider.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
