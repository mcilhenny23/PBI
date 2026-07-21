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

interface Group {
    name: string;
    dots: number[];      // quantile values, ascending
    selectionIds?: ISelectionId[];
}

interface PackedDot {
    v: number;           // value
    along: number;       // pixel position along the value axis
    stack: number;       // stack index within its bin
}

// ── Helpers ────────────────────────────────────────────────────

/** Indices of every value column bound to a role (samples can be multi-measure). */
function findRoleIndices(values: powerbi.DataViewValueColumns, roleName: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < values.length; i++) {
        if (values[i].source.roles && values[i].source.roles[roleName]) out.push(i);
    }
    return out;
}

function safeNum(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Reduce a sample pool to `dotCount` quantile values.
 * Fewer samples than dots → each sample becomes a dot (edge case in spec).
 */
function computeDots(pool: number[], dotCount: number): number[] {
    const sorted = pool.slice().sort((a, b) => a - b);
    if (sorted.length === 0) return [];
    if (sorted.length <= dotCount) return sorted;
    const dots: number[] = [];
    for (let k = 0; k < dotCount; k++) {
        dots.push(d3.quantileSorted(sorted, (k + 0.5) / dotCount)!);
    }
    return dots;
}

/**
 * Wilkinson-style dot packing in pixel space. Dots within one diameter of a
 * bin's first dot share the bin; each bin is centered on its mean position and
 * its members stack perpendicular to the value axis.
 */
function packDots(values: number[], toPx: (v: number) => number, dotDiameter: number): PackedDot[] {
    // Sort by pixel position, not value — the value scale may be inverted
    // (e.g. vertical orientation maps larger values to smaller pixels), and the
    // greedy binning below assumes the coordinate increases monotonically.
    const sorted = values.map(v => ({ v, x: toPx(v) })).sort((a, b) => a.x - b.x);
    const bins: { v: number; x: number }[][] = [];
    let cur: { v: number; x: number }[] = [];
    let binStart = -Infinity;
    for (const { v, x } of sorted) {
        if (cur.length === 0) { binStart = x; cur = [{ v, x }]; }
        else if (x - binStart <= dotDiameter) { cur.push({ v, x }); }
        else { bins.push(cur); cur = [{ v, x }]; binStart = x; }
    }
    if (cur.length) bins.push(cur);

    const out: PackedDot[] = [];
    for (const bin of bins) {
        const cx = bin.reduce((s, d) => s + d.x, 0) / bin.length;
        bin.forEach((d, i) => out.push({ v: d.v, along: cx, stack: i }));
    }
    return out;
}

const numFmt = d3.format(",.4~g");

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private colorPalette: ISandboxExtendedColorPalette;
    private tooltipService: ITooltipService;
    private selectionManager: ISelectionManager;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.colorPalette = options.host.colorPalette;
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applySelectionStyling());

        this.svg = d3.select(options.element)
            .append("svg")
            .classed("quantile-dotplot", true);
        this.landing = this.svg.append("g").classed("qd-landing", true);
        this.container = this.svg.append("g").classed("qd-container", true);

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

        // Groups (each drawn <g>) carry their aggregated selection ids.
        this.container.selectAll<SVGGElement, Group>("g.qd-group").each(function (d) {
            const g = d3.select(this);
            const ids = d?.selectionIds ?? [];
            const isSel = ids.some(id => activeIds.some(a => eq(a, id)));
            let opacity = 1;
            if (hasSel && !isSel) opacity = dim;
            g.attr("opacity", opacity);
        });
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const dp = this.formattingSettings.dotplotCard;
            const th = this.formattingSettings.thresholdCard;
            const ax = this.formattingSettings.axisCard;

            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);

            // ── Data ───────────────────────────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const cat = dataView?.categorical;
            const vals = cat?.values;
            const sampleIdx = vals ? findRoleIndices(vals, "samples") : [];
            if (!vals?.length || sampleIdx.length === 0) {
                this.container.selectAll("*").remove();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            const dotCount = Math.max(2, Math.min(200, Math.round(dp.dotCount.value || 20)));
            const nRows = cat?.categories?.[0]?.values?.length || vals[sampleIdx[0]].values.length;

            // One group per bound "samples" measure; each pools its per-row values.
            const obsKeyCat = cat?.categories?.find(c => c.source.roles && c.source.roles["category"])
                          ?? cat?.categories?.[0]
                          ?? null;
            const groups: Group[] = [];
            for (const idx of sampleIdx) {
                const pool: number[] = [];
                const ids: ISelectionId[] = [];
                for (let i = 0; i < nRows; i++) {
                    const n = safeNum(vals[idx].values[i]);
                    if (n != null) pool.push(n);
                    if (obsKeyCat) {
                        try {
                            ids.push(this.host.createSelectionIdBuilder().withCategory(obsKeyCat, i).createSelectionId());
                        } catch { /* skipped */ }
                    }
                }
                groups.push({
                    name: vals[idx].source.displayName || "Samples",
                    dots: computeDots(pool, dotCount),
                    selectionIds: ids
                });
            }
            const activeGroups = groups.filter(g => g.dots.length > 0);
            if (activeGroups.length === 0) {
                this.container.selectAll("*").remove();
                this.events.renderingFinished(options);
                return;
            }
            const G = activeGroups.length;

            // ── Shared value domain ────────────────────────────────
            const allVals: number[] = [];
            for (const g of activeGroups) allVals.push(...g.dots);
            const showTh = th.showThreshold.value;
            const thVal = th.thresholdValue.value;
            if (showTh) allVals.push(thVal);
            let vmin = d3.min(allVals)!, vmax = d3.max(allVals)!;
            if (vmin === vmax) { vmin -= 1; vmax += 1; }
            const pad = (vmax - vmin) * 0.05;
            vmin -= pad; vmax += pad;

            // ── Layout ─────────────────────────────────────────────
            const horizontal = String(dp.orientation.value?.value ?? "horizontal") === "horizontal";
            const fs = ax.fontSize.value;
            const labelSpace = fs + 6;
            const margin = horizontal
                ? { top: 14, right: 18, bottom: (ax.showAxis.value ? 34 : 14), left: 14 }
                : { top: 14, right: 14, bottom: labelSpace + 8, left: (ax.showAxis.value ? 48 : 14) };
            const plotL = margin.left, plotR = width - margin.right;
            const plotT = margin.top, plotB = height - margin.bottom;
            const plotW = plotR - plotL, plotH = plotB - plotT;

            this.container.selectAll("*").remove();
            if (plotW < 20 || plotH < 20) { this.events.renderingFinished(options); return; }

            const valueScale = horizontal
                ? d3.scaleLinear().domain([vmin, vmax]).range([plotL, plotR])
                : d3.scaleLinear().domain([vmin, vmax]).range([plotB, plotT]);

            const nominalR = Math.max(1, dp.dotRadius.value);
            const dotDiameter = nominalR * 2 + 1;

            // Pack every group, then find the tallest stack to size the dots to fit.
            const packed = activeGroups.map(g => packDots(g.dots, v => valueScale(v), dotDiameter));
            const maxStack = d3.max(packed, p => d3.max(p, d => d.stack) ?? 0)! + 1;

            const bandExtent = horizontal ? plotH / G : plotW / G;
            const availPerp = bandExtent - labelSpace - 4;
            let perpStep = dotDiameter;
            let r = nominalR;
            if (maxStack * perpStep > availPerp && availPerp > 0) {
                const factor = availPerp / (maxStack * perpStep);
                perpStep *= factor;
                r = Math.max(0.75, nominalR * factor);
            }

            const opacity = Math.max(0, Math.min(1, dp.dotOpacity.value / 100));
            const baseColor = dp.dotColor.value.value;
            const thColor = th.thresholdColor.value.value;

            // ── Draw each group ────────────────────────────────────
            activeGroups.forEach((g, gi) => {
                const gg = this.container.append("g").classed("group qd-group", true).datum(g);
                if (g.selectionIds && g.selectionIds.length > 0) {
                    gg.style("cursor", "pointer")
                        .attr("tabindex", 0).attr("role", "button")
                        .attr("aria-label", `${g.name} — click to filter`)
                        .on("click", (event: MouseEvent) => {
                            event.stopPropagation();
                            const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                            this.selectionManager.select(g.selectionIds!, multi).then(() => this.applySelectionStyling());
                        })
                        .on("contextmenu", (event: MouseEvent) => {
                            event.preventDefault(); event.stopPropagation();
                            this.selectionManager.showContextMenu(g.selectionIds![0] ?? ({} as ISelectionId), { x: event.clientX, y: event.clientY });
                        });
                }
                const groupColor = (G > 1 && !showTh)
                    ? this.colorPalette.getColor(g.name).value
                    : baseColor;

                // Band / column geometry and baseline.
                let baseline: number, labelX: number, labelY: number, labelAnchor = "start";
                if (horizontal) {
                    const bandTop = plotT + gi * bandExtent;
                    baseline = bandTop + bandExtent - 2;
                    labelX = plotL; labelY = bandTop + fs;
                } else {
                    const colLeft = plotL + gi * bandExtent;
                    baseline = colLeft + 2;
                    labelX = colLeft + bandExtent / 2; labelY = plotB + fs + 4; labelAnchor = "middle";
                }

                // Dots.
                for (const d of packed[gi]) {
                    const below = showTh && d.v < thVal;
                    const cx = horizontal ? d.along : baseline + (d.stack + 0.5) * perpStep;
                    const cy = horizontal ? baseline - (d.stack + 0.5) * perpStep : d.along;
                    gg.append("circle")
                        .datum(d)
                        .classed("dot", true)
                        .attr("cx", cx).attr("cy", cy).attr("r", r)
                        .attr("fill", below ? thColor : groupColor)
                        .attr("fill-opacity", opacity)
                        .attr("stroke", "#fff").attr("stroke-width", Math.min(1, r * 0.2))
                        .on("mousemove", (event: MouseEvent, dd: PackedDot) => {
                            const [px, py] = d3.pointer(event, this.svg.node());
                            const items: VisualTooltipDataItem[] = [];
                            if (G > 1) items.push({ displayName: "Group", value: g.name });
                            items.push({ displayName: g.name, value: numFmt(dd.v) });
                            if (showTh) items.push({ displayName: "Threshold", value: `${numFmt(thVal)} — ${dd.v < thVal ? "below" : "at/above"}` });
                            this.tooltipService.show({ dataItems: items, identities: [], coordinates: [px, py], isTouchEvent: false });
                        })
                        .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));
                }

                // Group label (only meaningful with >1 group).
                if (G > 1) {
                    gg.append("text")
                        .attr("x", labelX).attr("y", labelY)
                        .attr("text-anchor", labelAnchor)
                        .attr("font-size", `${fs}px`).attr("font-weight", 600).attr("fill", "#555")
                        .text(g.name);
                }

                // Threshold count annotation per group.
                if (showTh && th.showCountAnnotation.value) {
                    const belowCount = g.dots.filter(v => v < thVal).length;
                    const annos = `${belowCount} of ${g.dots.length} below ${numFmt(thVal)}`;
                    gg.append("text")
                        .attr("x", horizontal ? plotR : (labelX))
                        .attr("y", horizontal ? (plotT + gi * bandExtent + fs) : (plotT + fs))
                        .attr("text-anchor", horizontal ? "end" : "middle")
                        .attr("font-size", `${Math.max(9, fs - 1)}px`).attr("fill", thColor)
                        .text(annos);
                }
            });

            // ── Threshold line ─────────────────────────────────────
            if (showTh) {
                if (horizontal) {
                    const x = valueScale(thVal);
                    this.container.append("line")
                        .attr("x1", x).attr("x2", x).attr("y1", plotT).attr("y2", plotB)
                        .attr("stroke", thColor).attr("stroke-width", 1.5).attr("stroke-dasharray", "4 3");
                } else {
                    const y = valueScale(thVal);
                    this.container.append("line")
                        .attr("x1", plotL).attr("x2", plotR).attr("y1", y).attr("y2", y)
                        .attr("stroke", thColor).attr("stroke-width", 1.5).attr("stroke-dasharray", "4 3");
                }
            }

            // ── Value axis ─────────────────────────────────────────
            if (ax.showAxis.value) {
                if (horizontal) {
                    const g = this.container.append("g")
                        .attr("transform", `translate(0,${plotB})`)
                        .call(d3.axisBottom(valueScale as d3.ScaleLinear<number, number>).ticks(6).tickSize(4).tickPadding(4));
                    g.select(".domain").attr("stroke", "#999");
                    g.selectAll("text").attr("font-size", `${fs}px`).attr("fill", "#666");
                } else {
                    const g = this.container.append("g")
                        .attr("transform", `translate(${plotL},0)`)
                        .call(d3.axisLeft(valueScale as d3.ScaleLinear<number, number>).ticks(6).tickSize(4).tickPadding(4));
                    g.select(".domain").attr("stroke", "#999");
                    g.selectAll("text").attr("font-size", `${fs}px`).attr("fill", "#666");
                }
            }

            this.applySelectionStyling();
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    /** Landing page shown when no Sample Values are bound. */
    private renderLandingPage(width: number, height: number): void {
        this.landing.selectAll("*").remove();
        if (width < 140 || height < 110) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        // Mini dot-stack glyph (a small bell-ish pile).
        const heights = [1, 2, 3, 4, 3, 2, 1];
        const r = 5, step = 12, baseY = -46, x0 = -(heights.length - 1) * step / 2;
        heights.forEach((h, c) => {
            for (let s = 0; s < h; s++) {
                this.landing.append("circle")
                    .attr("cx", width / 2 + x0 + c * step)
                    .attr("cy", height / 2 + baseY - s * (r * 2 + 1))
                    .attr("r", r).attr("fill", "#4682B4").attr("fill-opacity", 0.85);
            }
        });

        g.append("text").attr("text-anchor", "middle").attr("y", 6)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px")
            .attr("font-weight", 600).attr("fill", "#333").text("Quantile Dotplot");
        g.append("text").attr("text-anchor", "middle").attr("y", 28)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666").text("Add Sample Values (a measure) to begin.");
        g.append("text").attr("text-anchor", "middle").attr("y", 50)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
            .attr("fill", "#999").text("Add an Observation Key so each row feeds the distribution.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
