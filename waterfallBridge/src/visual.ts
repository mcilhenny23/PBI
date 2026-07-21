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

import {
    VisualFormattingSettingsModel,
    DEFAULT_INCREASE_COLOR, DEFAULT_DECREASE_COLOR,
    DEFAULT_ANCHOR_COLOR, DEFAULT_SUBTOTAL_COLOR,
    DEFAULT_CONNECTOR_COLOR
} from "./settings";

// ── Types ──────────────────────────────────────────────────────

type StepKind = "anchor" | "delta" | "subtotal";

interface RawStep {
    name: string;
    value: number;      // delta for deltas; absolute for anchors
    kind: StepKind;
    breakdown?: Array<{ name: string; value: number }>;
}

interface LaidOutStep extends RawStep {
    /** Cumulative running value BEFORE this step is applied (subtotals/anchors: value at that moment). */
    cumBefore: number;
    /** Cumulative running value AFTER this step is applied. */
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

function findValueIndex(values: powerbi.DataViewValueColumns, role: string): number {
    for (let i = 0; i < values.length; i++) {
        if (values[i].source.roles && values[i].source.roles[role]) return i;
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

/**
 * Build a formatter that respects the bound measure's format string when supplied
 * (currency, percent, plain-number), falling back to a compact d3 format.
 * Keep it small so we don't need powerbi-visuals-utils-formattingutils.
 */
function makeValueFormatter(formatString: string | undefined): (v: number) => string {
    if (formatString) {
        const fs = String(formatString);
        const isPercent = fs.includes("%");
        const isCurrency = /[$£€¥]/.test(fs);
        const decimals = ((): number => {
            const m = fs.match(/\.(0+)/);
            return m ? m[1].length : 2;
        })();
        if (isPercent) {
            return (v: number) => d3.format(`,.${decimals}%`)(v);
        }
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
    private host: powerbi.extensibility.visual.IVisualHost;
    private tooltipService: ITooltipService;
    private colorPalette: ISandboxExtendedColorPalette;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private overlay: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private margin = { top: 32, right: 24, bottom: 46, left: 60 };

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.colorPalette = options.host.colorPalette;
        this.formattingSettingsService = new FormattingSettingsService();

        this.svg = d3.select(options.element)
            .append("svg")
            .classed("waterfall-bridge", true);

        this.landing = this.svg.append("g").classed("wf-landing", true);
        this.container = this.svg.append("g").classed("wf-container", true);
        this.overlay = this.svg.append("g").classed("wf-overlay", true);
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

            const plotW = Math.max(0, width - this.margin.left - this.margin.right);
            const plotH = Math.max(0, height - this.margin.top - this.margin.bottom);
            this.container.attr("transform", `translate(${this.margin.left},${this.margin.top})`);
            this.overlay.attr("transform", `translate(${this.margin.left},${this.margin.top})`);

            const dv: DataView = options.dataViews?.[0];
            const parsed = this.parseSteps(dv, s.structureCard.firstStepIsAnchor.value, s.structureCard.lastStepIsAnchor.value);
            if (!parsed) {
                this.container.selectAll("*").remove();
                this.overlay.selectAll("*").remove();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height, palette);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            let { steps, valueFormatString } = parsed;

            // Optional delta sort (anchors/subtotals stay pinned by relative position).
            const sortMode = String(s.structureCard.sortMode.value?.value ?? "data-order");
            if (sortMode !== "data-order") {
                steps = this.sortDeltas(steps, sortMode === "ascending");
            }

            // Optional subtotal insertion (already present if kind==='subtotal'; toggle drops them out).
            if (!s.structureCard.showSubtotals.value) {
                steps = steps.filter(st => st.kind !== "subtotal");
            }

            // Running cumulative pass.
            const laid = this.computeCumulatives(steps);

            // Unexplained-variance check: if last step is an anchor, compare projected pre-anchor cumulative to declared value.
            const lastStep = laid[laid.length - 1];
            const preLast = laid.length >= 2 ? laid[laid.length - 2].cumAfter : (lastStep?.cumBefore ?? 0);
            let unexplained: number | null = null;
            if (lastStep && lastStep.kind === "anchor" && laid.length >= 2) {
                const diff = lastStep.value - preLast;
                const scale = Math.max(Math.abs(lastStep.value), Math.abs(preLast), 1);
                if (Math.abs(diff) / scale > 1e-6) unexplained = diff;
            }

            this.render(laid, unexplained, valueFormatString, plotW, plotH, palette);

            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    /**
     * Parse the data view into steps.
     * Two input modes:
     *   1. Steps column + single Value measure → one row per step.
     *   2. Multiple Value measures + no Steps column → each measure = one step in field order.
     * Optional stepType + breakdown category are honored.
     */
    private parseSteps(dv: DataView, firstAnchor: boolean, lastAnchor: boolean):
        { steps: RawStep[]; valueFormatString: string | undefined } | null {
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

        // Prefer the first bound Value measure's format string (currency/percent/etc).
        const valueFormatString = valueCols[0].source.format;

        // Multi-measure mode: no Steps column bound, ≥2 Value measures.
        if (stepsIdx < 0 && valueCols.length >= 1 && !cat.categories?.length) {
            const steps: RawStep[] = valueCols.map((col, i) => {
                const total = col.values.reduce<number>((acc, v) => {
                    const n = safeNum(v);
                    return acc + (n ?? 0);
                }, 0);
                const isFirst = i === 0;
                const isLast = i === valueCols.length - 1;
                return {
                    name: col.source.displayName || `Step ${i + 1}`,
                    value: total,
                    kind: normalizeStepKind(null, isFirst, isLast, firstAnchor, lastAnchor)
                };
            });
            return steps.length ? { steps, valueFormatString } : null;
        }

        if (stepsIdx < 0) return null;
        const stepNames = cat.categories![stepsIdx].values;
        if (!stepNames.length) return null;

        // Row-level mode: aggregate the Value column per Step name; breakdowns keep row detail.
        const valCol = valueCols[0];
        const rows = stepNames.length;

        // Preserve first-appearance order for unique step names.
        const orderedStepNames: string[] = [];
        const seen = new Set<string>();
        for (let r = 0; r < rows; r++) {
            const nm = String(stepNames[r]);
            if (!seen.has(nm)) { orderedStepNames.push(nm); seen.add(nm); }
        }

        const totals = new Map<string, number>();
        const kindsRaw = new Map<string, string | null>();
        const breakdowns = new Map<string, Array<{ name: string; value: number }>>();
        for (let r = 0; r < rows; r++) {
            const nm = String(stepNames[r]);
            const v = safeNum(valCol.values[r]) ?? 0;
            totals.set(nm, (totals.get(nm) ?? 0) + v);
            if (typeIdx >= 0 && !kindsRaw.has(nm)) {
                const t = cat.categories![typeIdx].values[r];
                kindsRaw.set(nm, t == null ? null : String(t));
            }
            if (brkIdx >= 0) {
                const bname = String(cat.categories![brkIdx].values[r]);
                const list = breakdowns.get(nm) ?? [];
                list.push({ name: bname, value: v });
                breakdowns.set(nm, list);
            }
        }

        const steps: RawStep[] = orderedStepNames.map((nm, i) => {
            const isFirst = i === 0;
            const isLast = i === orderedStepNames.length - 1;
            return {
                name: nm,
                value: totals.get(nm) ?? 0,
                kind: normalizeStepKind(kindsRaw.get(nm) ?? null, isFirst, isLast, firstAnchor, lastAnchor),
                breakdown: breakdowns.get(nm)
            };
        });
        return { steps, valueFormatString };
    }

    /**
     * Reorder delta bars by magnitude while leaving anchors and subtotals pinned
     * to their original positions. This preserves the "runs from anchor to anchor"
     * reading of the chart.
     */
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

    /**
     * Anchor = absolute value (cumBefore = the value the axis reads at this step).
     * Delta  = signed change added to the previous cumulative.
     * Subtotal = a running-total marker; cumBefore = the running total, cumAfter = same.
     */
    private computeCumulatives(steps: RawStep[]): LaidOutStep[] {
        let running = 0;
        return steps.map((st, i) => {
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
        plotW: number, plotH: number,
        palette: RenderPalette
    ): void {
        this.container.selectAll("*").remove();
        this.overlay.selectAll("*").remove();

        const s = this.formattingSettings;
        const fmt = makeValueFormatter(valueFormatString);

        if (steps.length === 0 || plotW <= 4 || plotH <= 20) return;

        // Y domain covers 0, cumulative levels, and every bar's top/bottom.
        const yValues: number[] = [0];
        for (const st of steps) {
            yValues.push(st.cumBefore, st.cumAfter);
            if (st.kind === "anchor" || st.kind === "subtotal") yValues.push(st.cumAfter);
        }
        const yMin = Math.min(...yValues);
        const yMax = Math.max(...yValues);
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
                .enter()
                .append("line")
                .attr("x1", 0)
                .attr("x2", plotW)
                .attr("y1", d => yScale(d))
                .attr("y2", d => yScale(d))
                .attr("stroke", palette.grid)
                .attr("stroke-width", 1)
                .attr("shape-rendering", "crispEdges");
        }

        // Zero line if domain crosses zero — reference for signed deltas.
        if (yMin < 0 && yMax > 0) {
            this.container.append("line")
                .attr("x1", 0).attr("x2", plotW)
                .attr("y1", yScale(0)).attr("y2", yScale(0))
                .attr("stroke", palette.axisLine)
                .attr("stroke-width", 1);
        }

        // ── Connectors (drawn before bars so bars sit on top) ──
        if (s.connectorsCard.showConnectors.value && steps.length >= 2) {
            const style = String(s.connectorsCard.connectorStyle.value?.value ?? "dashed");
            const dash = style === "dashed" ? "4 3" : "none";
            const cg = this.container.append("g").classed("connectors", true);
            for (let i = 0; i < steps.length - 1; i++) {
                const a = steps[i], b = steps[i + 1];
                const level = a.cumAfter;
                const x1 = (xScale(String(i)) ?? 0);
                const x2 = (xScale(String(i + 1)) ?? 0) + xScale.bandwidth();
                cg.append("line")
                    .attr("x1", x1)
                    .attr("x2", x2)
                    .attr("y1", yScale(level))
                    .attr("y2", yScale(level))
                    .attr("stroke", palette.connector)
                    .attr("stroke-width", 1)
                    .attr("stroke-dasharray", dash);
            }
        }

        // ── Bars ──
        const barsG = this.container.append("g").classed("bars", true);
        const bw = xScale.bandwidth();

        steps.forEach((st, i) => {
            const x = xScale(String(i)) ?? 0;
            const { yTop, yBot, color } = this.barGeometry(st, yScale, palette);
            const h = Math.max(1, yBot - yTop);
            if (st.kind === "delta" && st.breakdown && st.breakdown.length > 0) {
                // Stacked mini-bars for the breakdown, same sign direction only for v1.
                const totalMag = st.breakdown.reduce((a, b) => a + Math.abs(b.value), 0) || 1;
                let cursor = st.value >= 0 ? yBot : yTop;
                const paletteFn = d3.scaleOrdinal<string, string>().range(d3.schemeTableau10);
                st.breakdown.forEach((b, bi) => {
                    const frac = Math.abs(b.value) / totalMag;
                    const segH = h * frac;
                    const sy = st.value >= 0 ? (cursor - segH) : cursor;
                    barsG.append("rect")
                        .attr("class", "bar bar-breakdown")
                        .attr("x", x)
                        .attr("y", sy)
                        .attr("width", bw)
                        .attr("height", segH)
                        .attr("fill", paletteFn(b.name))
                        .attr("stroke", palette.background)
                        .attr("stroke-width", 0.5)
                        .datum({ step: st, sub: b, segFmt: fmt(b.value) });
                    cursor = st.value >= 0 ? (cursor - segH) : (cursor + segH);
                });
            } else {
                barsG.append("rect")
                    .attr("class", `bar bar-${st.kind}`)
                    .attr("x", x)
                    .attr("y", yTop)
                    .attr("width", bw)
                    .attr("height", h)
                    .attr("fill", color)
                    .attr("stroke", palette.highContrast ? palette.axisLine : "none")
                    .attr("stroke-width", palette.highContrast ? 1 : 0)
                    .datum({ step: st });
            }
        });

        // ── Value labels ──
        if (s.labelsCard.showValueLabels.value) {
            const firstAnchor = steps.find(st => st.kind === "anchor")?.value ?? null;
            const showPct = s.labelsCard.showPercentOfStart.value && firstAnchor && firstAnchor !== 0;
            const showSign = s.labelsCard.showDeltaSign.value;
            const posMode = String(s.labelsCard.labelPosition.value?.value ?? "auto");
            const fs = Math.max(8, Math.min(28, s.labelsCard.fontSize.value ?? 11));
            const labelG = this.container.append("g").classed("labels", true);

            steps.forEach((st, i) => {
                const x = (xScale(String(i)) ?? 0) + bw / 2;
                const { yTop, yBot } = this.barGeometry(st, yScale, palette);
                const barH = yBot - yTop;
                const raw = st.kind === "delta"
                    ? (showSign ? (st.value > 0 ? `+${fmt(st.value)}` : fmt(st.value)) : fmt(st.value))
                    : fmt(st.value);

                const isNegDelta = st.kind === "delta" && st.value < 0;
                const outside = posMode === "outside"
                    || (posMode === "auto" && barH < fs * 1.8);

                let yLabel: number;
                let dominant: string;
                if (outside) {
                    if (isNegDelta) { yLabel = yBot + 4; dominant = "hanging"; }
                    else            { yLabel = yTop - 4; dominant = "text-after-edge"; }
                } else {
                    yLabel = (yTop + yBot) / 2;
                    dominant = "central";
                }

                // Clamp within plot area.
                yLabel = Math.max(fs, Math.min(plotH - 2, yLabel));

                labelG.append("text")
                    .attr("x", x).attr("y", yLabel)
                    .attr("text-anchor", "middle")
                    .attr("dominant-baseline", dominant)
                    .attr("font-size", `${fs}px`)
                    .attr("font-family", "Segoe UI, sans-serif")
                    .attr("fill", palette.labelText)
                    .text(raw);

                if (showPct && st.kind === "delta" && firstAnchor) {
                    const pct = (st.value / Math.abs(firstAnchor)) * 100;
                    const secY = yLabel + (outside && !isNegDelta ? -fs - 1 : fs + 1);
                    labelG.append("text")
                        .attr("x", x)
                        .attr("y", Math.max(fs, Math.min(plotH - 2, secY)))
                        .attr("text-anchor", "middle")
                        .attr("dominant-baseline", dominant)
                        .attr("font-size", `${Math.max(8, fs - 2)}px`)
                        .attr("font-family", "Segoe UI, sans-serif")
                        .attr("fill", palette.axisText)
                        .text(`${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`);
                }
            });
        }

        // ── X axis (step names) ──
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

        // ── Unexplained variance chip (overlay, top-right) ──
        if (unexplained != null) {
            const chip = this.overlay.append("g").classed("wf-chip", true);
            const label = `Unexplained ${unexplained >= 0 ? "+" : ""}${fmt(unexplained)}`;
            const t = chip.append("text")
                .attr("x", plotW - 8)
                .attr("y", -12)
                .attr("text-anchor", "end")
                .attr("dominant-baseline", "middle")
                .attr("font-family", "Segoe UI, sans-serif")
                .attr("font-size", "11px")
                .attr("font-weight", 600)
                .attr("fill", palette.warnFg)
                .text(label);
            // Backing rect drawn behind the text.
            const bb = (t.node() as SVGTextElement).getBBox();
            chip.insert("rect", "text")
                .attr("x", bb.x - 8)
                .attr("y", bb.y - 3)
                .attr("width", bb.width + 16)
                .attr("height", bb.height + 6)
                .attr("rx", 3)
                .attr("fill", palette.warnBg)
                .attr("stroke", palette.warnFg)
                .attr("stroke-width", 1);
        }

        // ── Tooltip hit rects ──
        const hitG = this.container.append("g").classed("hit-layer", true);
        steps.forEach((st, i) => {
            const x = xScale(String(i)) ?? 0;
            hitG.append("rect")
                .attr("class", "hit")
                .attr("x", x)
                .attr("y", 0)
                .attr("width", bw)
                .attr("height", plotH)
                .attr("fill", "transparent")
                .on("mousemove", (event: MouseEvent) => {
                    const [px, py] = d3.pointer(event, this.svg.node());
                    this.tooltipService.show({
                        dataItems: this.buildTooltip(st, fmt),
                        identities: [],
                        coordinates: [px, py],
                        isTouchEvent: false
                    });
                })
                .on("mouseleave", () => {
                    this.tooltipService.hide({ immediately: false, isTouchEvent: false });
                });
        });
    }

    private barGeometry(st: LaidOutStep, yScale: d3.ScaleLinear<number, number>, palette: RenderPalette):
        { yTop: number; yBot: number; color: string } {
        if (st.kind === "anchor" || st.kind === "subtotal") {
            const y0 = yScale(0);
            const yv = yScale(st.value);
            const color = st.kind === "anchor" ? palette.anchor : palette.subtotal;
            return { yTop: Math.min(y0, yv), yBot: Math.max(y0, yv), color };
        }
        // delta
        const y1 = yScale(st.cumBefore);
        const y2 = yScale(st.cumAfter);
        const color = st.value >= 0 ? palette.increase : palette.decrease;
        return { yTop: Math.min(y1, y2), yBot: Math.max(y1, y2), color };
    }

    private buildTooltip(st: LaidOutStep, fmt: (v: number) => string): VisualTooltipDataItem[] {
        const items: VisualTooltipDataItem[] = [
            { displayName: st.name, value: st.kind[0].toUpperCase() + st.kind.slice(1) }
        ];
        if (st.kind === "anchor" || st.kind === "subtotal") {
            items.push({ displayName: "Value", value: fmt(st.value) });
        } else {
            items.push({ displayName: "Delta", value: (st.value > 0 ? "+" : "") + fmt(st.value) });
            items.push({ displayName: "From", value: fmt(st.cumBefore) });
            items.push({ displayName: "To",   value: fmt(st.cumAfter) });
            if (st.breakdown && st.breakdown.length) {
                for (const b of st.breakdown) {
                    items.push({ displayName: `  ${b.name}`, value: (b.value > 0 ? "+" : "") + fmt(b.value) });
                }
            }
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
                labelText: fg, warnBg: bg, warnFg: fg,
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
        if (width < 140 || height < 80) return;

        const cx = width / 2;
        const g = this.landing.attr("transform", `translate(${cx}, ${height / 2})`);
        const inc = palette.highContrast ? palette.increase : DEFAULT_INCREASE_COLOR;
        const dec = palette.highContrast ? palette.decrease : DEFAULT_DECREASE_COLOR;
        const anc = palette.highContrast ? palette.anchor   : DEFAULT_ANCHOR_COLOR;

        const glyph = g.append("g").attr("transform", "translate(-70, -70)");
        // Anchor
        glyph.append("rect").attr("x", 0).attr("y", 20).attr("width", 20).attr("height", 40).attr("fill", anc);
        // +delta
        glyph.append("rect").attr("x", 30).attr("y", 10).attr("width", 20).attr("height", 15).attr("fill", inc);
        // -delta
        glyph.append("rect").attr("x", 60).attr("y", 25).attr("width", 20).attr("height", 15).attr("fill", dec);
        // +delta
        glyph.append("rect").attr("x", 90).attr("y", 20).attr("width", 20).attr("height", 10).attr("fill", inc);
        // Anchor
        glyph.append("rect").attr("x", 120).attr("y", 10).attr("width", 20).attr("height", 50).attr("fill", anc);
        // Connectors
        glyph.append("line").attr("x1", 20).attr("x2", 30).attr("y1", 20).attr("y2", 20).attr("stroke", palette.connector).attr("stroke-dasharray", "3 2");
        glyph.append("line").attr("x1", 50).attr("x2", 60).attr("y1", 10).attr("y2", 10).attr("stroke", palette.connector).attr("stroke-dasharray", "3 2");
        glyph.append("line").attr("x1", 80).attr("x2", 90).attr("y1", 25).attr("y2", 25).attr("stroke", palette.connector).attr("stroke-dasharray", "3 2");
        glyph.append("line").attr("x1", 110).attr("x2", 120).attr("y1", 20).attr("y2", 20).attr("stroke", palette.connector).attr("stroke-dasharray", "3 2");

        g.append("text")
            .attr("text-anchor", "middle").attr("y", 12)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "16px").attr("font-weight", 600)
            .attr("fill", palette.landingText)
            .text("Waterfall Bridge");

        g.append("text")
            .attr("text-anchor", "middle").attr("y", 36)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "12px")
            .attr("fill", palette.axisText)
            .text("Drop several Value measures (Actual, Price, Volume, Mix, Budget)…");

        g.append("text")
            .attr("text-anchor", "middle").attr("y", 54)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "11px")
            .attr("fill", palette.landingSub)
            .text("…or a Steps column plus a single Value measure.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
