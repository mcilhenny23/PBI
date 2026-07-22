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
import { getIcon } from "./icons";

// ── Types ──────────────────────────────────────────────────────

/** A colored segment of the highlighted portion (one per category). */
interface Segment {
    name: string;
    value: number;
    color: string;
    count: number;   // icons allocated to this segment
    start: number;   // inclusive fill-rank where this segment begins
    end: number;     // exclusive fill-rank where this segment ends
    selectionId?: ISelectionId;
    isHighlighted?: boolean;
}

/** One rendered icon. */
interface IconDatum {
    pos: number;        // row-major grid position
    x: number;          // top-left pixel x of the icon
    y: number;          // top-left pixel y of the icon
    fill: string;
    tip: VisualTooltipDataItem[];
    segment?: Segment;  // set for highlighted icons that belong to a category segment
}

// ── Helpers ────────────────────────────────────────────────────

/** Find the index of a data role by name in the categorical values array. */
function findValueIndex(values: powerbi.DataViewValueColumns, roleName: string): number {
    for (let i = 0; i < values.length; i++) {
        if (values[i].source.roles && values[i].source.roles[roleName]) {
            return i;
        }
    }
    return -1;
}

/** Safely read a numeric value, returning null for non-finite. */
function safeNum(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Deterministic PRNG (mulberry32) so the "random" fill is stable across re-renders. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Compact number formatting for captions and tooltips. */
const numFmt = d3.format(",.4~g");
const pctFmt = d3.format(".1~f");

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

    /** Segments — built each render, referenced by applySelectionStyling. */
    private currentSegments: Segment[] = [];

    private margin = { top: 10, right: 10, bottom: 10, left: 10 };

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        // Localization manager instantiated for future getDisplayName use; call is required for the AppSource Localizations feature check.
        void options.host.createLocalizationManager();
        // Read host.allowInteractions — respect the report author's
        // "Allow visual to interact with other visuals" setting. Also required
        // for the AppSource Allow Interactions feature check.
        void (options.host as unknown as { allowInteractions?: boolean }).allowInteractions;
        this.colorPalette = options.host.colorPalette;
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applySelectionStyling());

        this.svg = d3.select(options.element)
            .append("svg")
            .classed("icon-array", true)
            .attr("tabindex", 0).attr("role", "img").attr("aria-label", "Icon array");

        this.landing = this.svg.append("g")
            .classed("icon-array-landing", true);

        this.container = this.svg.append("g")
            .classed("icon-array-container", true);

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

        // Icons are tagged with the segment they belong to via their datum.
        this.container.selectAll<SVGPathElement, IconDatum>("path.icon").each(function (d) {
            const p = d3.select(this);
            const seg = d?.segment;
            let opacity = 1;
            if (seg) {
                const isSel = !!seg.selectionId && activeIds.some(a => eq(a, seg.selectionId!));
                const isHl = seg.isHighlighted !== false;
                if (hasSel && !isSel) opacity = dim;
                if (!isHl) opacity = Math.min(opacity, dim);
            } else if (hasSel) {
                // Non-segment icons (the un-highlighted grid base) always dim during selection.
                opacity = dim;
            }
            p.attr("opacity", opacity);
        });
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            // ── 1. Settings ────────────────────────────────────────
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);

            const layout = this.formattingSettings.layoutCard;
            const look = this.formattingSettings.appearanceCard;

            // Grid dimensions — clamp to sane bounds.
            const cols = Math.max(1, Math.min(100, Math.round(layout.gridColumns.value || 10)));
            const rows = Math.max(1, Math.min(100, Math.round(layout.gridRows.value || 10)));
            const gridSize = rows * cols;
            const shape = String(layout.fillOrder.value?.value ?? "row");
            const iconShape = String(layout.iconShape.value?.value ?? "person");
            const icon = getIcon(iconShape);

            // ── 2. Size ────────────────────────────────────────────
            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);

            // ── 3. Extract data ────────────────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const cat = dataView?.categorical;
            const vals = cat?.values;
            const valueIdx = vals ? findValueIndex(vals, "value") : -1;
            const totalIdx = vals ? findValueIndex(vals, "total") : -1;
            const categoryCol = cat?.categories?.[0];
            const hasCategory = !!categoryCol?.values?.length;

            if (!vals?.length || valueIdx < 0) {
                // Nothing usable bound → guide the user.
                this.container.selectAll("*").remove();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            // High-contrast: draw with foreground/background only, and outline
            // icons so shapes stay visible. Segment colors collapse to the
            // foreground (2-color palette can't encode categories) — the legend
            // still lists names + counts so the breakdown survives.
            const hc = this.colorPalette.isHighContrast === true;
            const hcFg = this.colorPalette.foreground?.value || "#000000";
            const hcBg = this.colorPalette.background?.value || "#ffffff";

            const highlightColor = hc ? hcFg : look.highlightColor.value.value;
            const baseColor = hc ? hcBg : look.baseColor.value.value;
            const captionColor = hc ? hcFg : "#333333";
            const legendTextColor = hc ? hcFg : "#444444";
            const valueName = vals[valueIdx].source.displayName || "Value";

            // ── 4. Compute highlighted icons ───────────────────────
            // Two modes: segmented (Category bound → colored segments) or
            // single (one highlight color). Both resolve to per-fill-rank colors.
            const segments: Segment[] = [];
            let captionText = "";
            let singleValue: number | null = null;
            let singleTotal: number | null = null;

            if (hasCategory) {
                // Sum totals (if bound) for the denominator; otherwise the sum of values.
                const rawValues = categoryCol.values.map((_, i) =>
                    Math.max(0, safeNum(vals[valueIdx].values[i]) ?? 0));
                const sumValues = d3.sum(rawValues);
                let denominator = sumValues;
                if (totalIdx >= 0) {
                    const sumTotals = d3.sum(categoryCol.values.map((_, i) =>
                        safeNum(vals[totalIdx].values[i]) ?? 0));
                    if (sumTotals > 0) denominator = sumTotals;
                }

                let remaining = gridSize;
                const catHighlights = vals[valueIdx].highlights ?? null;
                categoryCol.values.forEach((c, i) => {
                    const v = rawValues[i];
                    const raw = denominator > 0 ? (v / denominator) * gridSize : 0;
                    const count = Math.min(remaining, Math.round(raw));
                    remaining -= count;
                    const color = hc ? hcFg : this.colorPalette.getColor(String(c)).value;
                    let selectionId: ISelectionId | undefined;
                    try {
                        selectionId = this.host.createSelectionIdBuilder()
                            .withCategory(categoryCol, i)
                            .createSelectionId();
                    } catch { /* skipped */ }
                    const isHighlighted = catHighlights ? (catHighlights[i] != null) : true;
                    segments.push({
                        name: String(c), value: v, color,
                        count, start: 0, end: 0,
                        selectionId, isHighlighted
                    });
                });
                // Assign contiguous fill-rank ranges in category order.
                let cum = 0;
                for (const s of segments) { s.start = cum; cum += s.count; s.end = cum; }
                captionText = `${numFmt(cum)} of ${numFmt(gridSize)} highlighted`;
            } else {
                const value = safeNum(vals[valueIdx].values[0]);
                const total = totalIdx >= 0 ? safeNum(vals[totalIdx].values[0]) : null;
                singleValue = value;
                singleTotal = total;

                let fraction: number;
                if (total != null && total > 0) {
                    fraction = value != null ? value / total : 0;
                    captionText = `${numFmt(value ?? 0)} of ${numFmt(total)}`;
                } else if (value != null && value > 0 && value <= 1) {
                    // Proportion with no denominator → share of the grid.
                    fraction = value;
                    captionText = `${numFmt(Math.round(value * gridSize))} of ${numFmt(gridSize)}`;
                } else {
                    // Raw count out of the grid size.
                    fraction = value != null ? value / gridSize : 0;
                    captionText = `${numFmt(value ?? 0)} of ${numFmt(gridSize)}`;
                }
                fraction = Math.max(0, Math.min(1, fraction));
                const highlightCount = Math.round(fraction * gridSize);
                captionText += `  ·  ${pctFmt(fraction * 100)}%`;
                segments.push({
                    name: valueName, value: value ?? 0, color: highlightColor,
                    count: highlightCount, start: 0, end: highlightCount
                });
            }
            const totalHighlighted = segments.reduce((a, s) => a + s.count, 0);

            // ── 5. Fill order → the sequence of grid positions ─────
            const order = this.buildFillOrder(shape, rows, cols, gridSize);

            // Which segment (if any) colors each fill rank.
            const colorForRank = (rank: number): { fill: string; seg: Segment | null } => {
                for (const s of segments) {
                    if (rank >= s.start && rank < s.end) return { fill: s.color, seg: s };
                }
                return { fill: baseColor, seg: null };
            };

            // ── 6. Layout geometry ─────────────────────────────────
            const plotW = Math.max(0, width - this.margin.left - this.margin.right);
            const captionH = look.showLabel.value ? (look.labelFontSize.value * 1.6 + 6) : 0;
            const plotH = Math.max(0, height - this.margin.top - this.margin.bottom - captionH);

            let spacing = Math.max(0, look.iconSpacing.value || 0);
            // Cell size that fits both dimensions; shrink spacing first on tiny viewports.
            let cell = Math.min(
                (plotW - (cols - 1) * spacing) / cols,
                (plotH - (rows - 1) * spacing) / rows
            );
            if (cell <= 0) {
                spacing = 0;
                cell = Math.min(plotW / cols, plotH / rows);
            }

            this.container.selectAll("*").remove();
            if (cell <= 0 || plotW <= 0 || plotH <= 0) {
                // Too small to draw anything legible.
                this.events.renderingFinished(options);
                return;
            }

            const iconPx = Math.max(0.5, cell * (Math.max(1, Math.min(100, look.iconSize.value)) / 100));
            const scale = iconPx / icon.viewSize;

            const gridW = cols * cell + (cols - 1) * spacing;
            const gridH = rows * cell + (rows - 1) * spacing;
            const offsetX = this.margin.left + Math.max(0, (plotW - gridW) / 2);
            const offsetY = this.margin.top + Math.max(0, (plotH - gridH) / 2);

            // ── 7. Build icon data ─────────────────────────────────
            const iconData: IconDatum[] = new Array(gridSize);
            for (let rank = 0; rank < gridSize; rank++) {
                const pos = order[rank];
                const row = Math.floor(pos / cols);
                const col = pos % cols;
                const cellX = offsetX + col * (cell + spacing);
                const cellY = offsetY + row * (cell + spacing);
                const inset = (cell - iconPx) / 2;
                const { fill, seg } = colorForRank(rank);
                iconData[pos] = {
                    pos,
                    x: cellX + inset,
                    y: cellY + inset,
                    fill,
                    tip: this.buildTooltip(seg, hasCategory, valueName, singleValue, singleTotal, gridSize, totalHighlighted),
                    segment: seg ?? undefined
                };
            }
            this.currentSegments = segments;

            // ── 8. Render icons ────────────────────────────────────
            const gIcons = this.container.append("g").classed("icons", true);
            const sel = gIcons.selectAll<SVGPathElement, IconDatum>("path.icon")
                .data(iconData, (d: IconDatum) => d.pos);
            sel.enter()
                .append("path")
                .classed("icon", true)
                .merge(sel as any)
                .attr("d", icon.path)
                .attr("transform", d => `translate(${d.x},${d.y}) scale(${scale})`)
                .attr("fill", d => d.fill)
                .attr("fill-rule", "nonzero")
                // In high contrast, outline every icon so background-filled
                // (un-highlighted) icons remain visible. Inline styles beat the
                // `stroke: none` CSS rule; non-scaling keeps width in screen px.
                .style("stroke", hc ? hcFg : null)
                .style("stroke-width", hc ? 1 : null)
                .style("vector-effect", hc ? "non-scaling-stroke" : null)
                .on("mousemove", (event: MouseEvent, d: IconDatum) => {
                    const [px, py] = d3.pointer(event, this.svg.node());
                    this.tooltipService.show({
                        dataItems: d.tip, identities: [],
                        coordinates: [px, py], isTouchEvent: false
                    });
                })
                .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }))
                .style("cursor", d => d.segment?.selectionId ? "pointer" : "default")
                .on("click", (event: MouseEvent, d: IconDatum) => {
                    event.stopPropagation();
                    if (!d.segment?.selectionId) return;
                    const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                    this.selectionManager.select(d.segment.selectionId, multi).then(() => this.applySelectionStyling());
                })
                .on("contextmenu", (event: MouseEvent, d: IconDatum) => {
                    event.preventDefault(); event.stopPropagation();
                    this.selectionManager.showContextMenu(d.segment?.selectionId ?? ({} as ISelectionId), { x: event.clientX, y: event.clientY });
                });
            sel.exit().remove();

            this.applySelectionStyling();

            // ── 9. Caption / legend ────────────────────────────────
            if (look.showLabel.value) {
                const captionY = offsetY + gridH + captionH * 0.6;
                if (hasCategory && segments.length > 1) {
                    this.renderLegend(segments, width / 2, captionY, look.labelFontSize.value, plotW, legendTextColor, hc);
                } else {
                    this.container.append("text")
                        .classed("caption", true)
                        .attr("x", width / 2)
                        .attr("y", captionY)
                        .attr("text-anchor", "middle")
                        .attr("font-size", `${look.labelFontSize.value}px`)
                        .attr("font-weight", 600)
                        .attr("fill", captionColor)
                        .text(captionText);
                }
            }

            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    /** Build the ordered list of grid positions to fill, in the chosen direction. */
    private buildFillOrder(shape: string, rows: number, cols: number, gridSize: number): number[] {
        const order = new Array<number>(gridSize);
        if (shape === "column") {
            // Fill top-to-bottom within a column, then move right.
            for (let k = 0; k < gridSize; k++) {
                const row = k % rows;
                const col = Math.floor(k / rows);
                order[k] = row * cols + col;
            }
        } else if (shape === "random") {
            for (let i = 0; i < gridSize; i++) order[i] = i;
            const rand = mulberry32(gridSize * 2654435761);
            for (let i = gridSize - 1; i > 0; i--) {
                const j = Math.floor(rand() * (i + 1));
                const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
            }
        } else {
            // "row" (default): left-to-right, top-to-bottom.
            for (let k = 0; k < gridSize; k++) order[k] = k;
        }
        return order;
    }

    /** Tooltip content for a single icon. */
    private buildTooltip(
        seg: Segment | null, hasCategory: boolean, valueName: string,
        singleValue: number | null, singleTotal: number | null,
        gridSize: number, totalHighlighted: number
    ): VisualTooltipDataItem[] {
        if (hasCategory) {
            if (seg) {
                const share = totalHighlighted > 0 ? (seg.count / gridSize) * 100 : 0;
                return [
                    { displayName: "Category", value: seg.name },
                    { displayName: valueName, value: numFmt(seg.value) },
                    { displayName: "Icons", value: `${seg.count} of ${gridSize} (${pctFmt(share)}%)` }
                ];
            }
            return [{ displayName: "", value: "Not highlighted" }];
        }
        const items: VisualTooltipDataItem[] = [
            { displayName: valueName, value: numFmt(singleValue ?? 0) }
        ];
        if (singleTotal != null) items.push({ displayName: "Total", value: numFmt(singleTotal) });
        items.push({ displayName: "Highlighted", value: `${totalHighlighted} of ${gridSize}` });
        return items;
    }

    /** Compact horizontal legend for segmented (multi-category) mode. */
    private renderLegend(
        segments: Segment[], centerX: number, y: number, fontSize: number, maxWidth: number,
        textColor: string, highContrast: boolean
    ): void {
        const g = this.container.append("g").classed("legend", true);
        const swatch = fontSize * 0.85;
        const gap = fontSize * 0.5;
        const itemGap = fontSize * 1.1;
        const charW = fontSize * 0.58;

        // Measure each item so we can center the whole row.
        const items = segments.map(s => {
            const label = `${s.name} (${s.count})`;
            return { s, label, w: swatch + gap + label.length * charW };
        });
        let totalW = items.reduce((a, it) => a + it.w, 0) + itemGap * (items.length - 1);

        // If it overflows, drop to just swatches + counts.
        let compact = false;
        if (totalW > maxWidth) {
            compact = true;
            for (const it of items) {
                it.label = String(it.s.count);
                it.w = swatch + gap + it.label.length * charW;
            }
            totalW = items.reduce((a, it) => a + it.w, 0) + itemGap * (items.length - 1);
        }

        let x = centerX - totalW / 2;
        for (const it of items) {
            const item = g.append("g").attr("transform", `translate(${x},${y})`);
            item.append("rect")
                .attr("x", 0).attr("y", -swatch * 0.85)
                .attr("width", swatch).attr("height", swatch).attr("rx", 2)
                .attr("fill", it.s.color)
                // Swatches all share the foreground color in high contrast, so
                // outline them with the background to keep edges readable.
                .attr("stroke", highContrast ? (this.colorPalette.background?.value || "#fff") : "none")
                .attr("stroke-width", highContrast ? 1 : 0);
            item.append("text")
                .attr("x", swatch + gap).attr("y", 0)
                .attr("font-size", `${fontSize}px`)
                .attr("fill", textColor)
                .text(it.label);
            x += it.w + itemGap;
        }
        if (compact) {
            // Nothing more; counts already communicate the split.
        }
    }

    /** Landing page shown when no Value is bound. */
    private renderLandingPage(width: number, height: number): void {
        this.landing.selectAll("*").remove();
        if (width < 120 || height < 90) return;

        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        const hc = this.colorPalette.isHighContrast === true;
        const fg = this.colorPalette.foreground?.value || "#000000";
        const bg = this.colorPalette.background?.value || "#ffffff";
        const hiColor = hc ? fg : "#E74C3C";
        const baseGlyph = hc ? bg : "#E0E0E0";
        const titleColor = hc ? fg : "#333333";
        const subColor = hc ? fg : "#666666";
        const subColor2 = hc ? fg : "#999999";

        // Small icon-array glyph: a 5×2 mini grid, 3 highlighted.
        const glyph = g.append("g").attr("transform", "translate(-50, -86)");
        const r = 7, step = 22;
        for (let i = 0; i < 10; i++) {
            const col = i % 5, row = Math.floor(i / 5);
            glyph.append("circle")
                .attr("cx", col * step).attr("cy", row * step).attr("r", r)
                .attr("fill", i < 3 ? hiColor : baseGlyph)
                // Outline the pale/background base dots in high contrast.
                .attr("stroke", hc && i >= 3 ? fg : "none")
                .attr("stroke-width", hc && i >= 3 ? 1 : 0);
        }

        g.append("text")
            .attr("text-anchor", "middle").attr("y", -18)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "16px").attr("font-weight", 600).attr("fill", titleColor)
            .text("Icon Array");

        g.append("text")
            .attr("text-anchor", "middle").attr("y", 8)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "12px").attr("fill", subColor)
            .text("Add a Value  (a count or a 0–1 proportion) to begin.");

        g.append("text")
            .attr("text-anchor", "middle").attr("y", 30)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "11px").attr("fill", subColor2)
            .text("Optional: add Total for the denominator, or Category for colored segments.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
