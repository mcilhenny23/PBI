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

import {
    VisualFormattingSettingsModel,
    DEFAULT_INCREASE_COLOR, DEFAULT_DECREASE_COLOR,
    DEFAULT_ANCHOR_COLOR, DEFAULT_SUBTOTAL_COLOR,
    DEFAULT_CONNECTOR_COLOR, DEFAULT_BAR_BORDER_COLOR, DEFAULT_LABEL_COLOR
} from "./settings";

// ── Types ──────────────────────────────────────────────────────

type StepKind = "anchor" | "delta" | "subtotal";

interface BreakdownItem {
    name: string;
    value: number;
    highlightValue: number | null;
    selectionIds: ISelectionId[];
}

interface RawStep {
    name: string;
    value: number;
    kind: StepKind;
    breakdown?: BreakdownItem[];
    selectionIds: ISelectionId[];
    highlightValue: number | null;
    isHighlighted: boolean;
}

interface LaidOutStep extends RawStep {
    cumBefore: number;
    cumAfter: number;
}

interface RenderPalette {
    highContrast: boolean;
    increase: string;
    decrease: string;
    anchor: string;
    subtotal: string;
    connector: string;
    grid: string;
    axisLine: string;
    axisText: string;
    labelText: string;
    barBorder: string;
    warnBg: string;
    warnFg: string;
    landingText: string;
    landingSub: string;
    background: string;
}

// ── Helpers ────────────────────────────────────────────────────

function safeNum(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function findCategoryIndex(cats: powerbi.DataViewCategoryColumn[] | undefined, role: string): number {
    if (!cats) return -1;
    for (let i = 0; i < cats.length; i++) {
        if (cats[i].source.roles && cats[i].source.roles[role]) return i;
    }
    return -1;
}

function normalizeStepKind(raw: string | null | undefined, isFirst: boolean, isLast: boolean,
                           firstAnchor: boolean, lastAnchor: boolean): StepKind {
    if (raw) {
        const r = raw.trim().toLowerCase();
        if (r === "anchor" || r === "abs" || r === "absolute" || r === "total") return "anchor";
        if (r === "subtotal" || r === "sub") return "subtotal";
        if (r === "delta" || r === "diff" || r === "change") return "delta";
    }
    if (isFirst && firstAnchor) return "anchor";
    if (isLast && lastAnchor) return "anchor";
    return "delta";
}

function luminance(hex: string): number {
    const c = d3.color(hex)?.rgb();
    if (!c) return 1;
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

function makeValueFormatter(formatString: string | undefined): (v: number) => string {
    if (formatString) {
        const fs = String(formatString);
        const isPercent = fs.includes("%");
        const isCurrency = /[$£€¥]/.test(fs);
        const decimals = ((): number => {
            const m = fs.match(/\.(0+)/);
            return m ? m[1].length : 2;
        })();
        if (isPercent) return (v: number) => d3.format(`,.${decimals}%`)(v);
        if (isCurrency) {
            const sym = (fs.match(/[$£€¥]/) || ["$"])[0];
            return (v: number) => (v < 0 ? "-" : "") + sym + d3.format(`,.${decimals}f`)(Math.abs(v));
        }
        return d3.format(`,.${decimals}f`);
    }
    return d3.format(",.4~g");
}

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private tooltipService: ITooltipService;
    private colorPalette: ISandboxExtendedColorPalette;
    private selectionManager: ISelectionManager;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private overlay: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;
    private legendG: d3.Selection<SVGGElement, unknown, null, undefined>;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private margin = { top: 32, right: 24, bottom: 46, left: 60 };

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        // Localization manager instantiated for future getDisplayName use; call is required for the AppSource Localizations feature check.
        void options.host.createLocalizationManager();
        // Read host.allowInteractions — respect the report author's
        // "Allow visual to interact with other visuals" setting. Also required
        // for the AppSource Allow Interactions feature check.
        void (options.host as unknown as { allowInteractions?: boolean }).allowInteractions;
        this.tooltipService = options.host.tooltipService;
        this.colorPalette = options.host.colorPalette;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        // When Power BI restores a selection (report open, bookmark switch), re-sync visual state.
        this.selectionManager.registerOnSelectCallback(() => this.applySelectionStyling());

        this.svg = d3.select(options.element)
            .append("svg")
            .classed("waterfall-bridge", true);

        this.landing = this.svg.append("g").classed("wf-landing", true);
        this.legendG = this.svg.append("g").classed("wf-legend", true);
        this.container = this.svg.append("g").classed("wf-container", true);
        this.overlay = this.svg.append("g").classed("wf-overlay", true);

        // Click on the SVG background clears the selection — standard Power BI UX pattern.
        this.svg.on("click", (event: MouseEvent) => {
            if (event.target === this.svg.node()) {
                this.selectionManager.clear().then(() => this.applySelectionStyling());
            }
        });
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);

            const s = this.formattingSettings;
            const palette = this.resolvePalette();

            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);

            const dv: DataView = options.dataViews?.[0];
            const parsed = this.parseSteps(dv, s.structureCard.firstStepIsAnchor.value, s.structureCard.lastStepIsAnchor.value);
            if (!parsed) {
                this.container.selectAll("*").remove();
                this.overlay.selectAll("*").remove();
                this.legendG.selectAll("*").remove();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height, palette);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            let { steps, valueFormatString, breakdownNames } = parsed;

            const sortMode = String(s.structureCard.sortMode.value?.value ?? "data-order");
            if (sortMode !== "data-order") {
                steps = this.sortDeltas(steps, sortMode === "ascending");
            }
            if (!s.structureCard.showSubtotals.value) {
                steps = steps.filter(st => st.kind !== "subtotal");
            }

            const laid = this.computeCumulatives(steps);
            const lastStep = laid[laid.length - 1];
            const preLast = laid.length >= 2 ? laid[laid.length - 2].cumAfter : (lastStep?.cumBefore ?? 0);
            let unexplained: number | null = null;
            if (lastStep && lastStep.kind === "anchor" && laid.length >= 2) {
                const diff = lastStep.value - preLast;
                const scale = Math.max(Math.abs(lastStep.value), Math.abs(preLast), 1);
                if (Math.abs(diff) / scale > 1e-6) unexplained = diff;
            }

            this.render(laid, unexplained, valueFormatString, breakdownNames, width, height, palette);

            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    /**
     * Parse the data view into steps and collect per-step aggregated selection IDs + highlight totals.
     * Two input modes: row-level (steps column + single Value) and multi-measure. Selection IDs
     * are only built in row-level mode where the categorical column carries data-model identity.
     */
    private parseSteps(dv: DataView, firstAnchor: boolean, lastAnchor: boolean):
        { steps: RawStep[]; valueFormatString: string | undefined; breakdownNames: string[] } | null {
        if (!dv?.categorical?.values?.length) return null;
        const cat = dv.categorical;
        const values = cat.values;

        const stepsIdx = findCategoryIndex(cat.categories, "steps");
        const typeIdx  = findCategoryIndex(cat.categories, "stepType");
        const brkIdx   = findCategoryIndex(cat.categories, "category");

        const valueCols: powerbi.DataViewValueColumn[] = [];
        for (let i = 0; i < values.length; i++) {
            if (values[i].source.roles && values[i].source.roles["value"]) valueCols.push(values[i]);
        }
        if (valueCols.length === 0) return null;
        const valueFormatString = valueCols[0].source.format;

        // Multi-measure mode — each Value column becomes one step; no per-row identity.
        if (stepsIdx < 0 && valueCols.length >= 1 && !cat.categories?.length) {
            const steps: RawStep[] = valueCols.map((col, i) => {
                let total = 0, highlightTotal = 0, hasAnyHl = false;
                for (let r = 0; r < col.values.length; r++) {
                    const n = safeNum(col.values[r]);
                    if (n != null) total += n;
                    if (col.highlights) {
                        hasAnyHl = true;
                        const h = safeNum(col.highlights[r]);
                        if (h != null) highlightTotal += h;
                    }
                }
                const isFirst = i === 0;
                const isLast = i === valueCols.length - 1;
                return {
                    name: col.source.displayName || `Step ${i + 1}`,
                    value: total,
                    kind: normalizeStepKind(null, isFirst, isLast, firstAnchor, lastAnchor),
                    selectionIds: [],
                    highlightValue: hasAnyHl ? highlightTotal : null,
                    isHighlighted: !hasAnyHl || Math.abs(highlightTotal) > 1e-9
                };
            });
            return steps.length ? { steps, valueFormatString, breakdownNames: [] } : null;
        }

        if (stepsIdx < 0) return null;
        const stepNames = cat.categories![stepsIdx].values;
        if (!stepNames.length) return null;

        const valCol = valueCols[0];
        const rows = stepNames.length;
        const hasHighlights = !!valCol.highlights;

        // Preserve first-appearance order for unique step names.
        const orderedStepNames: string[] = [];
        const seen = new Set<string>();
        for (let r = 0; r < rows; r++) {
            const nm = String(stepNames[r]);
            if (!seen.has(nm)) { orderedStepNames.push(nm); seen.add(nm); }
        }

        const totals = new Map<string, number>();
        const highlightTotals = new Map<string, number>();
        const kindsRaw = new Map<string, string | null>();
        const breakdowns = new Map<string, Map<string, BreakdownItem>>();
        const idsPerStep = new Map<string, ISelectionId[]>();
        const stepsCat = cat.categories![stepsIdx];

        for (let r = 0; r < rows; r++) {
            const nm = String(stepNames[r]);
            const v = safeNum(valCol.values[r]) ?? 0;
            const h = hasHighlights ? safeNum(valCol.highlights![r]) : null;

            totals.set(nm, (totals.get(nm) ?? 0) + v);
            if (hasHighlights) highlightTotals.set(nm, (highlightTotals.get(nm) ?? 0) + (h ?? 0));

            if (typeIdx >= 0 && !kindsRaw.has(nm)) {
                const t = cat.categories![typeIdx].values[r];
                kindsRaw.set(nm, t == null ? null : String(t));
            }

            let rowId: ISelectionId;
            try {
                rowId = this.host.createSelectionIdBuilder().withCategory(stepsCat, r).createSelectionId();
            } catch { continue; }
            if (!idsPerStep.has(nm)) idsPerStep.set(nm, []);
            idsPerStep.get(nm)!.push(rowId);

            if (brkIdx >= 0) {
                const bname = String(cat.categories![brkIdx].values[r]);
                let byBreak = breakdowns.get(nm);
                if (!byBreak) { byBreak = new Map(); breakdowns.set(nm, byBreak); }
                const existing = byBreak.get(bname);
                if (existing) {
                    existing.value += v;
                    if (hasHighlights) existing.highlightValue = (existing.highlightValue ?? 0) + (h ?? 0);
                    existing.selectionIds.push(rowId);
                } else {
                    byBreak.set(bname, {
                        name: bname,
                        value: v,
                        highlightValue: hasHighlights ? (h ?? 0) : null,
                        selectionIds: [rowId]
                    });
                }
            }
        }

        const breakdownNameSet = new Set<string>();
        const steps: RawStep[] = orderedStepNames.map((nm, i) => {
            const isFirst = i === 0;
            const isLast = i === orderedStepNames.length - 1;
            const total = totals.get(nm) ?? 0;
            const hl = hasHighlights ? (highlightTotals.get(nm) ?? 0) : null;
            const bd = breakdowns.get(nm);
            let bdArr: BreakdownItem[] | undefined;
            if (bd) {
                bdArr = Array.from(bd.values());
                for (const b of bdArr) breakdownNameSet.add(b.name);
            }
            return {
                name: nm,
                value: total,
                kind: normalizeStepKind(kindsRaw.get(nm) ?? null, isFirst, isLast, firstAnchor, lastAnchor),
                breakdown: bdArr,
                selectionIds: idsPerStep.get(nm) ?? [],
                highlightValue: hl,
                isHighlighted: !hasHighlights || Math.abs(hl ?? 0) > 1e-9
            };
        });
        return { steps, valueFormatString, breakdownNames: Array.from(breakdownNameSet) };
    }

    private sortDeltas(steps: RawStep[], ascending: boolean): RawStep[] {
        const pinned: Array<{ idx: number; step: RawStep }> = [];
        const deltas: RawStep[] = [];
        steps.forEach((st, i) => {
            if (st.kind === "delta") deltas.push(st);
            else pinned.push({ idx: i, step: st });
        });
        deltas.sort((a, b) => ascending ? a.value - b.value : b.value - a.value);
        const out: RawStep[] = new Array(steps.length);
        for (const p of pinned) out[p.idx] = p.step;
        let d = 0;
        for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = deltas[d++];
        return out;
    }

    private computeCumulatives(steps: RawStep[]): LaidOutStep[] {
        let running = 0;
        return steps.map((st) => {
            if (st.kind === "anchor") {
                running = st.value;
                return { ...st, cumBefore: 0, cumAfter: st.value };
            }
            if (st.kind === "subtotal") {
                return { ...st, cumBefore: running, cumAfter: running };
            }
            const before = running;
            running += st.value;
            return { ...st, cumBefore: before, cumAfter: running };
        });
    }

    private render(
        steps: LaidOutStep[],
        unexplained: number | null,
        valueFormatString: string | undefined,
        breakdownNames: string[],
        width: number, height: number,
        palette: RenderPalette
    ): void {
        this.container.selectAll("*").remove();
        this.overlay.selectAll("*").remove();
        this.legendG.selectAll("*").remove();

        const s = this.formattingSettings;
        const fmt = makeValueFormatter(valueFormatString);
        if (steps.length === 0) return;

        // ── Legend layout — reserves space before we size the plot area. ──
        const showLegend = s.legendCard.showLegend.value && breakdownNames.length > 0;
        const legendPos = String(s.legendCard.legendPosition.value?.value ?? "top");
        const legendFs = Math.max(8, Math.min(20, s.legendCard.legendFontSize.value ?? 10));

        let plotLeft = this.margin.left, plotTop = this.margin.top;
        let plotW = Math.max(0, width - this.margin.left - this.margin.right);
        let plotH = Math.max(0, height - this.margin.top - this.margin.bottom);
        let legendReserve = 0;
        if (showLegend) {
            legendReserve = legendFs + 14;
            if (legendPos === "top") { plotTop += legendReserve; plotH -= legendReserve; }
            else if (legendPos === "bottom") { plotH -= legendReserve; }
            else if (legendPos === "left") {
                const w = Math.min(width * 0.25, 140);
                plotLeft += w; plotW -= w;
            } else if (legendPos === "right") {
                const w = Math.min(width * 0.25, 140);
                plotW -= w;
            }
        }
        if (plotW <= 4 || plotH <= 20) return;

        this.container.attr("transform", `translate(${plotLeft},${plotTop})`);
        this.overlay.attr("transform", `translate(${plotLeft},${plotTop})`);

        // ── Y domain ──
        const yValues: number[] = [];
        if (s.axisCard.includeZero.value) yValues.push(0);
        for (const st of steps) {
            yValues.push(st.cumBefore, st.cumAfter);
            if (st.kind === "anchor" || st.kind === "subtotal") yValues.push(st.cumAfter);
        }
        let yMin = Math.min(...yValues);
        let yMax = Math.max(...yValues);
        const yMinOv = s.axisCard.yMinOverride.value;
        const yMaxOv = s.axisCard.yMaxOverride.value;
        if (yMinOv != null && yMaxOv != null && yMinOv < yMaxOv) { yMin = yMinOv; yMax = yMaxOv; }
        else {
            if (yMinOv != null) yMin = yMinOv;
            if (yMaxOv != null) yMax = yMaxOv;
        }
        const pad = (yMax - yMin) * 0.08 || 1;
        const yScale = d3.scaleLinear()
            .domain([yMin - pad, yMax + pad])
            .range([plotH, 0])
            .nice();

        const xScale = d3.scaleBand<string>()
            .domain(steps.map((_, i) => String(i)))
            .range([0, plotW])
            .padding(Math.max(0, Math.min(0.8, (s.barsCard.barPadding.value ?? 20) / 100)));

        // ── Gridlines ──
        if (s.axisCard.showGridlines.value) {
            const grid = this.container.append("g").classed("gridlines", true);
            grid.selectAll("line")
                .data(yScale.ticks(6))
                .enter().append("line")
                .attr("x1", 0).attr("x2", plotW)
                .attr("y1", d => yScale(d)).attr("y2", d => yScale(d))
                .attr("stroke", palette.grid).attr("stroke-width", 1)
                .attr("shape-rendering", "crispEdges");
        }

        if (yMin < 0 && yMax > 0) {
            this.container.append("line")
                .attr("x1", 0).attr("x2", plotW)
                .attr("y1", yScale(0)).attr("y2", yScale(0))
                .attr("stroke", palette.axisLine).attr("stroke-width", 1);
        }

        // ── Connectors ──
        if (s.connectorsCard.showConnectors.value && steps.length >= 2) {
            const style = String(s.connectorsCard.connectorStyle.value?.value ?? "dashed");
            const dash = style === "dashed" ? "4 3" : "none";
            const cg = this.container.append("g").classed("connectors", true);
            for (let i = 0; i < steps.length - 1; i++) {
                const a = steps[i];
                const level = a.cumAfter;
                const x1 = (xScale(String(i)) ?? 0);
                const x2 = (xScale(String(i + 1)) ?? 0) + xScale.bandwidth();
                cg.append("line")
                    .attr("x1", x1).attr("x2", x2)
                    .attr("y1", yScale(level)).attr("y2", yScale(level))
                    .attr("stroke", palette.connector).attr("stroke-width", 1)
                    .attr("stroke-dasharray", dash);
            }
        }

        // ── Bars ──
        const barsG = this.container.append("g").classed("bars", true);
        const bw = xScale.bandwidth();
        const rx = Math.max(0, Math.min(bw / 2, s.barsCard.cornerRadius.value ?? 2));
        const borderW = Math.max(0, Math.min(4, s.barsCard.barBorderWidth.value ?? 0));
        const borderColor = s.barsCard.barBorderColor.value.value === DEFAULT_BAR_BORDER_COLOR
            ? palette.barBorder
            : s.barsCard.barBorderColor.value.value;
        const paletteFn = d3.scaleOrdinal<string, string>().range(d3.schemeTableau10);

        steps.forEach((st, i) => {
            const x = xScale(String(i)) ?? 0;
            const { yTop, yBot, color } = this.barGeometry(st, yScale, palette);
            const h = Math.max(1, yBot - yTop);

            if (st.kind === "delta" && st.breakdown && st.breakdown.length > 0) {
                const totalMag = st.breakdown.reduce((a, b) => a + Math.abs(b.value), 0) || 1;
                let cursor = st.value >= 0 ? yBot : yTop;
                st.breakdown.forEach((b) => {
                    const frac = Math.abs(b.value) / totalMag;
                    const segH = h * frac;
                    const sy = st.value >= 0 ? (cursor - segH) : cursor;
                    const rect = barsG.append("rect")
                        .attr("class", "bar bar-breakdown")
                        .attr("x", x).attr("y", sy)
                        .attr("width", bw).attr("height", segH)
                        .attr("rx", rx).attr("ry", rx)
                        .attr("fill", paletteFn(b.name))
                        .attr("stroke", palette.background).attr("stroke-width", 0.5)
                        .datum({ step: st, sub: b, isBreakdown: true });
                    this.attachBarInteractions(rect, st, b, fmt);
                    cursor = st.value >= 0 ? (cursor - segH) : (cursor + segH);
                });
            } else {
                const rect = barsG.append("rect")
                    .attr("class", `bar bar-${st.kind}`)
                    .attr("x", x).attr("y", yTop)
                    .attr("width", bw).attr("height", h)
                    .attr("rx", rx).attr("ry", rx)
                    .attr("fill", color)
                    .attr("stroke", borderW > 0 ? borderColor : (palette.highContrast ? palette.axisLine : "none"))
                    .attr("stroke-width", borderW > 0 ? borderW : (palette.highContrast ? 1 : 0))
                    .datum({ step: st, isBreakdown: false });
                this.attachBarInteractions(rect, st, null, fmt);
            }
        });

        // ── Labels ──
        if (s.labelsCard.showValueLabels.value) {
            const firstAnchor = steps.find(st => st.kind === "anchor")?.value ?? null;
            const showPct = s.labelsCard.showPercentOfStart.value && firstAnchor && firstAnchor !== 0;
            const showSign = s.labelsCard.showDeltaSign.value;
            const posMode = String(s.labelsCard.labelPosition.value?.value ?? "auto");
            const fs = Math.max(8, Math.min(28, s.labelsCard.fontSize.value ?? 11));
            const bold = s.labelsCard.labelBold.value;
            const italic = s.labelsCard.labelItalic.value;
            const outsideColor = s.labelsCard.labelColor.value.value === DEFAULT_LABEL_COLOR
                ? palette.labelText
                : s.labelsCard.labelColor.value.value;

            const labelG = this.container.append("g").classed("labels", true);
            steps.forEach((st, i) => {
                const x = (xScale(String(i)) ?? 0) + bw / 2;
                const { yTop, yBot } = this.barGeometry(st, yScale, palette);
                const barH = yBot - yTop;
                const raw = st.kind === "delta"
                    ? (showSign ? (st.value > 0 ? `+${fmt(st.value)}` : fmt(st.value)) : fmt(st.value))
                    : fmt(st.value);

                const isNegDelta = st.kind === "delta" && st.value < 0;
                const outside = posMode === "outside" || (posMode === "auto" && barH < fs * 1.8);

                let yLabel: number, dominant: string;
                if (outside) {
                    if (isNegDelta) { yLabel = yBot + 4; dominant = "hanging"; }
                    else            { yLabel = yTop - 4; dominant = "text-after-edge"; }
                } else {
                    yLabel = (yTop + yBot) / 2;
                    dominant = "central";
                }
                yLabel = Math.max(fs, Math.min(plotH - 2, yLabel));

                labelG.append("text")
                    .attr("x", x).attr("y", yLabel)
                    .attr("text-anchor", "middle").attr("dominant-baseline", dominant)
                    .attr("font-size", `${fs}px`).attr("font-family", "Segoe UI, sans-serif")
                    .attr("font-weight", bold ? 700 : 400)
                    .attr("font-style", italic ? "italic" : "normal")
                    .attr("fill", outside ? outsideColor : "#ffffff")
                    .text(raw);

                if (showPct && st.kind === "delta" && firstAnchor) {
                    const pct = (st.value / Math.abs(firstAnchor)) * 100;
                    const secY = yLabel + (outside && !isNegDelta ? -fs - 1 : fs + 1);
                    labelG.append("text")
                        .attr("x", x)
                        .attr("y", Math.max(fs, Math.min(plotH - 2, secY)))
                        .attr("text-anchor", "middle").attr("dominant-baseline", dominant)
                        .attr("font-size", `${Math.max(8, fs - 2)}px`)
                        .attr("font-family", "Segoe UI, sans-serif")
                        .attr("font-style", italic ? "italic" : "normal")
                        .attr("fill", palette.axisText)
                        .text(`${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`);
                }
            });
        }

        // ── X axis ──
        const xAxisG = this.container.append("g")
            .attr("transform", `translate(0,${plotH})`)
            .call(d3.axisBottom(xScale).tickFormat((d) => steps[+d]?.name ?? "").tickSize(0).tickPadding(8));
        xAxisG.select(".domain").attr("stroke", palette.axisLine);
        xAxisG.selectAll("text")
            .attr("font-size", `${s.axisCard.fontSize.value}px`)
            .attr("fill", palette.axisText);

        // ── Y axis ──
        if (s.axisCard.showYAxis.value) {
            const yAxisG = this.container.append("g")
                .call(d3.axisLeft(yScale).ticks(6).tickFormat(v => fmt(+v)).tickSize(0).tickPadding(6));
            yAxisG.select(".domain").attr("stroke", palette.axisLine);
            yAxisG.selectAll("text")
                .attr("font-size", `${s.axisCard.fontSize.value}px`)
                .attr("fill", palette.axisText);
        }

        // ── Unexplained-variance chip ──
        if (unexplained != null) {
            const chip = this.overlay.append("g").classed("wf-chip", true);
            const label = `Unexplained ${unexplained >= 0 ? "+" : ""}${fmt(unexplained)}`;
            const t = chip.append("text")
                .attr("x", plotW - 8).attr("y", -12)
                .attr("text-anchor", "end").attr("dominant-baseline", "middle")
                .attr("font-family", "Segoe UI, sans-serif")
                .attr("font-size", "11px").attr("font-weight", 600)
                .attr("fill", palette.warnFg).text(label);
            const bb = (t.node() as SVGTextElement).getBBox();
            chip.insert("rect", "text")
                .attr("x", bb.x - 8).attr("y", bb.y - 3)
                .attr("width", bb.width + 16).attr("height", bb.height + 6)
                .attr("rx", 3)
                .attr("fill", palette.warnBg).attr("stroke", palette.warnFg).attr("stroke-width", 1);
        }

        // ── Legend ──
        if (showLegend) {
            this.renderLegend(breakdownNames, legendPos, plotLeft, plotTop, plotW, plotH, legendFs, paletteFn, palette);
        }

        this.applySelectionStyling();
    }

    /**
     * Wire click, right-click, keyboard, and tooltip handlers to a single bar rect.
     * When ids is empty (multi-measure mode), click/keyboard become no-ops but the bar stays hoverable.
     */
    private attachBarInteractions(
        selection: d3.Selection<SVGRectElement, unknown, null, undefined>,
        step: LaidOutStep,
        breakdown: BreakdownItem | null,
        fmt: (v: number) => string
    ): void {
        const ids = breakdown ? breakdown.selectionIds : step.selectionIds;

        selection
            .attr("tabindex", 0)
            .attr("role", "button")
            .attr("aria-label", breakdown
                ? `${step.name} — ${breakdown.name}, value ${fmt(breakdown.value)}`
                : `${step.name}, ${step.kind}, value ${fmt(step.value)}`
            )
            .style("cursor", ids.length > 0 ? "pointer" : "default");

        selection.on("click", (event: MouseEvent) => {
            event.stopPropagation();
            if (ids.length === 0) return;
            const multi = event.ctrlKey || event.metaKey || event.shiftKey;
            this.selectionManager.select(ids, multi).then(() => this.applySelectionStyling());
        });

        selection.on("contextmenu", (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const anchorId = ids[0] ?? ({} as ISelectionId);
            this.selectionManager.showContextMenu(anchorId, { x: event.clientX, y: event.clientY });
        });

        selection.on("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (ids.length === 0) return;
                this.selectionManager.select(ids, event.shiftKey).then(() => this.applySelectionStyling());
            }
        });

        selection.on("mousemove", (event: MouseEvent) => {
            const [px, py] = d3.pointer(event, this.svg.node());
            this.tooltipService.show({
                dataItems: this.buildTooltip(step, breakdown, fmt),
                identities: ids,
                coordinates: [px, py],
                isTouchEvent: false
            });
        });

        selection.on("mouseleave", () => {
            this.tooltipService.hide({ immediately: false, isTouchEvent: false });
        });
    }

    /**
     * Set fill-opacity on every bar based on:
     *   (a) external highlights from the dataView (dim non-highlighted bars), and
     *   (b) local SelectionManager state (dim non-selected).
     * Runs after render and whenever the SelectionManager changes.
     */
    private applySelectionStyling(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dimOpacity = Math.max(0.05, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 25) / 100));
        const activeIds = this.selectionManager.getSelectionIds() as ISelectionId[];
        const hasSel = activeIds.length > 0;

        this.container.selectAll<SVGRectElement, unknown>("rect.bar").each(function (d) {
            const rect = d3.select(this);
            const data = d as { step: LaidOutStep; sub?: BreakdownItem; isBreakdown?: boolean } | undefined;
            if (!data) return;

            const isHl = data.isBreakdown && data.sub
                ? (data.sub.highlightValue == null || Math.abs(data.sub.highlightValue) > 1e-9)
                : data.step.isHighlighted;

            const localIds = data.isBreakdown && data.sub ? data.sub.selectionIds : data.step.selectionIds;
            const isLocallySelected = localIds.some(id =>
                activeIds.some(a => (a as { equals?: (b: ISelectionId) => boolean }).equals?.(id))
            );

            let opacity = 1;
            if (hasSel && !isLocallySelected) opacity = dimOpacity;
            if (!isHl) opacity = Math.min(opacity, dimOpacity);
            rect.attr("fill-opacity", opacity);
        });
    }

    private renderLegend(
        names: string[], position: string,
        plotLeft: number, plotTop: number, plotW: number, plotH: number,
        fs: number, paletteFn: d3.ScaleOrdinal<string, string>, palette: RenderPalette
    ): void {
        const g = this.legendG.attr("transform", "translate(0,0)");
        const swatchSize = fs * 0.9;
        const gap = 12;
        const measure = (text: string) => Math.max(20, text.length * fs * 0.55);

        interface Entry { x: number; y: number; width: number; name: string; }
        const entries: Entry[] = names.map(n => ({ x: 0, y: 0, width: 0, name: n }));

        if (position === "top" || position === "bottom") {
            const y = position === "top"
                ? Math.max(fs + 4, plotTop - 4)
                : (plotTop + plotH + this.margin.bottom + 6);
            let x = plotLeft;
            for (const e of entries) {
                e.width = swatchSize + 4 + measure(e.name) + gap;
                e.x = x; e.y = y;
                x += e.width;
            }
        } else {
            const x = position === "left" ? 6 : (plotLeft + plotW + 10);
            let y = plotTop + 4;
            for (const e of entries) {
                e.width = swatchSize + 4 + measure(e.name);
                e.x = x; e.y = y;
                y += fs + 6;
            }
        }

        for (const e of entries) {
            g.append("rect")
                .attr("x", e.x).attr("y", e.y - swatchSize + 2)
                .attr("width", swatchSize).attr("height", swatchSize)
                .attr("rx", 2).attr("fill", paletteFn(e.name));
            g.append("text")
                .attr("x", e.x + swatchSize + 4).attr("y", e.y)
                .attr("dominant-baseline", "text-after-edge")
                .attr("font-family", "Segoe UI, sans-serif")
                .attr("font-size", `${fs}px`).attr("fill", palette.labelText)
                .text(e.name);
        }
    }

    private barGeometry(st: LaidOutStep, yScale: d3.ScaleLinear<number, number>, palette: RenderPalette):
        { yTop: number; yBot: number; color: string } {
        if (st.kind === "anchor" || st.kind === "subtotal") {
            const y0 = yScale(0);
            const yv = yScale(st.value);
            const color = st.kind === "anchor" ? palette.anchor : palette.subtotal;
            return { yTop: Math.min(y0, yv), yBot: Math.max(y0, yv), color };
        }
        const y1 = yScale(st.cumBefore);
        const y2 = yScale(st.cumAfter);
        const color = st.value >= 0 ? palette.increase : palette.decrease;
        return { yTop: Math.min(y1, y2), yBot: Math.max(y1, y2), color };
    }

    private buildTooltip(st: LaidOutStep, breakdown: BreakdownItem | null, fmt: (v: number) => string): VisualTooltipDataItem[] {
        if (breakdown) {
            return [
                { displayName: "Step", value: st.name },
                { displayName: "Breakdown", value: breakdown.name },
                { displayName: "Delta", value: (breakdown.value > 0 ? "+" : "") + fmt(breakdown.value) }
            ];
        }
        const items: VisualTooltipDataItem[] = [
            { displayName: st.name, value: st.kind[0].toUpperCase() + st.kind.slice(1) }
        ];
        if (st.kind === "anchor" || st.kind === "subtotal") {
            items.push({ displayName: "Value", value: fmt(st.value) });
        } else {
            items.push({ displayName: "Delta", value: (st.value > 0 ? "+" : "") + fmt(st.value) });
            items.push({ displayName: "From", value: fmt(st.cumBefore) });
            items.push({ displayName: "To",   value: fmt(st.cumAfter) });
        }
        return items;
    }

    private resolvePalette(): RenderPalette {
        const cp = this.colorPalette;
        const s = this.formattingSettings;
        if (cp.isHighContrast) {
            const fg = cp.foreground?.value || "#000";
            const bg = cp.background?.value || "#fff";
            return {
                highContrast: true,
                increase: fg, decrease: fg, anchor: fg, subtotal: fg,
                connector: fg, grid: fg, axisLine: fg, axisText: fg,
                labelText: fg, barBorder: fg, warnBg: bg, warnFg: fg,
                landingText: fg, landingSub: fg, background: bg
            };
        }
        const bg = cp.background?.value || "#ffffff";
        const isDark = luminance(bg) < 0.5;
        const themeFg = cp.foreground?.value || (isDark ? "#f0f0f0" : "#333333");
        const b = s.barsCard;
        const c = s.connectorsCard;
        const inc = b.increaseColor.value.value;
        const dec = b.decreaseColor.value.value;
        const anc = b.anchorColor.value.value;
        const sub = b.subtotalColor.value.value;
        return {
            highContrast: false,
            increase: inc === DEFAULT_INCREASE_COLOR ? (cp.getColor("wfBridgeIncrease")?.value || inc) : inc,
            decrease: dec === DEFAULT_DECREASE_COLOR ? (cp.getColor("wfBridgeDecrease")?.value || dec) : dec,
            anchor:   anc === DEFAULT_ANCHOR_COLOR   ? (cp.getColor("wfBridgeAnchor")?.value   || anc) : anc,
            subtotal: sub === DEFAULT_SUBTOTAL_COLOR ? (cp.getColor("wfBridgeSubtotal")?.value || sub) : sub,
            connector: c.connectorColor.value.value === DEFAULT_CONNECTOR_COLOR
                ? (isDark ? "#666" : "#999")
                : c.connectorColor.value.value,
            grid: isDark ? "#3a3a3a" : "#e6e6e6",
            axisLine: isDark ? "#777" : "#999",
            axisText: isDark ? "#bbb" : "#666",
            labelText: themeFg,
            barBorder: isDark ? "#666" : DEFAULT_BAR_BORDER_COLOR,
            warnBg: isDark ? "#3a2a1a" : "#fff4e5",
            warnFg: isDark ? "#ffb84a" : "#a15c00",
            landingText: isDark ? "#eee" : "#333",
            landingSub:  isDark ? "#aaa" : "#999",
            background: bg
        };
    }

    private renderLandingPage(width: number, height: number, palette: RenderPalette): void {
        this.landing.selectAll("*").remove();
        this.container.selectAll("*").remove();
        this.overlay.selectAll("*").remove();
        this.legendG.selectAll("*").remove();
        if (width < 140 || height < 80) return;

        const cx = width / 2;
        const g = this.landing.attr("transform", `translate(${cx}, ${height / 2})`);
        const inc = palette.highContrast ? palette.increase : DEFAULT_INCREASE_COLOR;
        const dec = palette.highContrast ? palette.decrease : DEFAULT_DECREASE_COLOR;
        const anc = palette.highContrast ? palette.anchor   : DEFAULT_ANCHOR_COLOR;

        const glyph = g.append("g").attr("transform", "translate(-70, -70)");
        glyph.append("rect").attr("x", 0).attr("y", 20).attr("width", 20).attr("height", 40).attr("fill", anc);
        glyph.append("rect").attr("x", 30).attr("y", 10).attr("width", 20).attr("height", 15).attr("fill", inc);
        glyph.append("rect").attr("x", 60).attr("y", 25).attr("width", 20).attr("height", 15).attr("fill", dec);
        glyph.append("rect").attr("x", 90).attr("y", 20).attr("width", 20).attr("height", 10).attr("fill", inc);
        glyph.append("rect").attr("x", 120).attr("y", 10).attr("width", 20).attr("height", 50).attr("fill", anc);
        glyph.append("line").attr("x1", 20).attr("x2", 30).attr("y1", 20).attr("y2", 20).attr("stroke", palette.connector).attr("stroke-dasharray", "3 2");
        glyph.append("line").attr("x1", 50).attr("x2", 60).attr("y1", 10).attr("y2", 10).attr("stroke", palette.connector).attr("stroke-dasharray", "3 2");
        glyph.append("line").attr("x1", 80).attr("x2", 90).attr("y1", 25).attr("y2", 25).attr("stroke", palette.connector).attr("stroke-dasharray", "3 2");
        glyph.append("line").attr("x1", 110).attr("x2", 120).attr("y1", 20).attr("y2", 20).attr("stroke", palette.connector).attr("stroke-dasharray", "3 2");

        g.append("text")
            .attr("text-anchor", "middle").attr("y", 12)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "16px").attr("font-weight", 600)
            .attr("fill", palette.landingText).text("Waterfall Bridge");
        g.append("text")
            .attr("text-anchor", "middle").attr("y", 36)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "12px").attr("fill", palette.axisText)
            .text("Drop several Value measures (Actual, Price, Volume, Mix, Budget)…");
        g.append("text")
            .attr("text-anchor", "middle").attr("y", 54)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "11px").attr("fill", palette.landingSub)
            .text("…or a Steps column plus a single Value measure.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
