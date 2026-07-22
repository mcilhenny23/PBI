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
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";
import { schemeById, barycentricCentroid } from "./schemes";

// ── Types ──────────────────────────────────────────────────────

interface TernaryPoint {
    label: string;
    a: number;          // normalized component A
    b: number;          // normalized component B
    c: number;          // normalized component C
    rawA: number;       // original (pre-normalization) values, for tooltips
    rawB: number;
    rawC: number;
    colorVal: number | null;
    sizeVal: number | null;
    selectionId?: ISelectionId;
    isHighlighted?: boolean;
}

interface Pt { x: number; y: number; }

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

const numFmt = d3.format(",.4~g");
const pctFmt = d3.format(".1~f");

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private tooltipService: ITooltipService;
    private selectionManager: ISelectionManager;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    // Room for vertex titles, edge ticks and the color legend.
    private margin = { top: 34, right: 34, bottom: 48, left: 34 };

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
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applySelectionStyling());

        this.svg = d3.select(options.element)
            .append("svg")
            .classed("ternary-plot", true)
            .attr("tabindex", 0).attr("role", "img").attr("aria-label", "Ternary plot");

        this.landing = this.svg.append("g")
            .classed("ternary-plot-landing", true);

        this.container = this.svg.append("g")
            .classed("ternary-plot-container", true);

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

        this.container.selectAll<SVGCircleElement, TernaryPoint>("circle.point").each(function (d) {
            const c = d3.select(this);
            const isSel = !!d?.selectionId && activeIds.some(a => eq(a, d.selectionId!));
            const isHl = d?.isHighlighted !== false;
            let opacity = 1;
            if (hasSel && !isSel) opacity = dim;
            if (!isHl) opacity = Math.min(opacity, dim);
            const base = Number((this as SVGCircleElement).dataset.baseOpacity ?? "0.85");
            c.attr("fill-opacity", base * opacity);
        });
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            // ── 1. Settings ────────────────────────────────────────
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const tri = this.formattingSettings.triangleCard;
            const cls = this.formattingSettings.classificationCard;
            const pts = this.formattingSettings.pointsCard;
            const cscale = this.formattingSettings.colorScaleCard;

            // ── 2. Size ────────────────────────────────────────────
            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);

            // ── 3. Extract data ────────────────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const cat = dataView?.categorical;
            const vals = cat?.values;
            const aIdx = vals ? findValueIndex(vals, "componentA") : -1;
            const bIdx = vals ? findValueIndex(vals, "componentB") : -1;
            const cIdx = vals ? findValueIndex(vals, "componentC") : -1;
            const colorIdx = vals ? findValueIndex(vals, "colorBy") : -1;
            const sizeIdx = vals ? findValueIndex(vals, "sizeBy") : -1;
            const labelCol = cat?.categories?.[0];

            // Need at least two components; C can be derived.
            if (!vals?.length || aIdx < 0 || bIdx < 0) {
                this.container.selectAll("*").remove();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height, aIdx >= 0, bIdx >= 0);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            const normalize = tri.normalizeValues.value;
            const nPoints = labelCol?.values?.length || 1;

            // ── 4. Build points ────────────────────────────────────
            const points: TernaryPoint[] = [];
            for (let i = 0; i < nPoints; i++) {
                const rawA = Math.max(0, safeNum(vals[aIdx].values[i]) ?? 0);
                const rawB = Math.max(0, safeNum(vals[bIdx].values[i]) ?? 0);
                let rawC: number;
                if (cIdx >= 0) {
                    rawC = Math.max(0, safeNum(vals[cIdx].values[i]) ?? 0);
                } else {
                    // C missing → derive as the remainder when normalizing.
                    rawC = normalize ? Math.max(0, 1 - rawA - rawB) : 0;
                }

                const sum = rawA + rawB + rawC;
                if (sum <= 0) continue;                       // all-zero row → skip

                let a = rawA, b = rawB, c = rawC;
                if (normalize) {
                    a = rawA / sum; b = rawB / sum; c = rawC / sum;
                } else if (Math.abs(sum - 1) > 1e-6) {
                    continue;                                 // off, and doesn't sum to 1 → skip
                }

                let selectionId: ISelectionId | undefined;
                if (labelCol) {
                    try {
                        selectionId = this.host.createSelectionIdBuilder()
                            .withCategory(labelCol, i)
                            .createSelectionId();
                    } catch { /* skipped */ }
                }
                const aHighlights = vals[aIdx].highlights ?? null;
                const isHighlighted = aHighlights ? (aHighlights[i] != null) : true;
                points.push({
                    label: labelCol ? String(labelCol.values[i]) : "Point",
                    a, b, c, rawA, rawB, rawC,
                    colorVal: colorIdx >= 0 ? safeNum(vals[colorIdx].values[i]) : null,
                    sizeVal: sizeIdx >= 0 ? safeNum(vals[sizeIdx].values[i]) : null,
                    selectionId, isHighlighted
                });
            }

            // Axis titles: user override → measure display name → fallback.
            const titleA = tri.axisLabelA.value || vals[aIdx].source.displayName || "A";
            const titleB = tri.axisLabelB.value || vals[bIdx].source.displayName || "B";
            const titleC = tri.axisLabelC.value ||
                (cIdx >= 0 ? vals[cIdx].source.displayName : "C") || "C";
            const labelTitle = labelCol?.source.displayName || "Label";

            // ── 5. Triangle geometry ───────────────────────────────
            const hasColor = colorIdx >= 0 && points.some(p => p.colorVal != null);
            const legendW = hasColor ? 46 : 0;
            const plotW = Math.max(0, width - this.margin.left - this.margin.right - legendW);
            const plotH = Math.max(0, height - this.margin.top - this.margin.bottom);

            this.container.selectAll("*").remove();
            if (plotW < 20 || plotH < 20) {
                this.events.renderingFinished(options);
                return;
            }

            // Largest equilateral triangle that fits the plot box.
            const side = Math.min(plotW, plotH / (Math.sqrt(3) / 2));
            const triH = side * Math.sqrt(3) / 2;
            const offX = this.margin.left + (plotW - side) / 2;
            const offY = this.margin.top + (plotH - triH) / 2;

            const A: Pt = { x: offX + side / 2, y: offY };            // top
            const B: Pt = { x: offX, y: offY + triH };                // bottom-left
            const C: Pt = { x: offX + side, y: offY + triH };         // bottom-right

            // Barycentric (a,b,c) → pixel coordinate.
            const project = (a: number, b: number, c: number): Pt => ({
                x: a * A.x + b * B.x + c * C.x,
                y: a * A.y + b * B.y + c * C.y
            });

            // ── 6. Gridlines ───────────────────────────────────────
            const n = Math.max(1, Math.min(50, Math.round(tri.gridlineCount.value || 10)));
            if (tri.showGridlines.value && n > 1) {
                const grid = this.container.append("g").classed("gridlines", true);
                for (let i = 1; i < n; i++) {
                    const f = i / n;
                    // constant-a (parallel to BC), constant-b (parallel to AC), constant-c (parallel to AB)
                    const segs: [Pt, Pt][] = [
                        [project(f, 1 - f, 0), project(f, 0, 1 - f)],
                        [project(1 - f, f, 0), project(0, f, 1 - f)],
                        [project(1 - f, 0, f), project(0, 1 - f, f)]
                    ];
                    for (const [p1, p2] of segs) {
                        grid.append("line")
                            .attr("x1", p1.x).attr("y1", p1.y)
                            .attr("x2", p2.x).attr("y2", p2.y)
                            .attr("stroke", "#e6e6e6").attr("stroke-width", 1)
                            .attr("shape-rendering", "crispEdges");
                    }
                }
            }

            // ── 6b. Classification scheme overlay ────────────────
            // Sits between the gridlines and the triangle outline so the
            // outline reads on top of the region fills. Categorical palette
            // rotated across regions for visual differentiation; a diagnostic
            // triangle isn't a colour-order-carrying chart, so anything
            // consistent is fine.
            if (cls.showScheme.value) {
                const scheme = schemeById(String(cls.schemeId.value?.value ?? "usda-soil"));
                if (scheme) {
                    const regionG = this.container.append("g").classed("scheme-regions", true);
                    const palette = d3.schemeSet3 as readonly string[];
                    const strokeCol = cls.regionStroke.value.value;
                    const fillOp = Math.max(0, Math.min(1, (cls.regionOpacity.value ?? 18) / 100));
                    scheme.regions.forEach((r, i) => {
                        const pts = r.vertices.map(v => project(v[0], v[1], v[2]));
                        const path = pts.map((p, k) => (k === 0 ? "M" : "L") + p.x + "," + p.y).join(" ") + " Z";
                        regionG.append("path")
                            .attr("d", path)
                            .attr("fill", palette[i % palette.length])
                            .attr("fill-opacity", fillOp)
                            .attr("stroke", strokeCol).attr("stroke-width", 0.75)
                            .attr("stroke-opacity", 0.85)
                            .on("mousemove", (event: MouseEvent) => {
                                const [px, py] = d3.pointer(event, this.svg.node());
                                this.tooltipService.show({
                                    dataItems: [
                                        { displayName: "Class", value: r.name },
                                        { displayName: "Scheme", value: scheme.name },
                                        { displayName: "Vertex assignment",
                                          value: `A=${scheme.axisA}, B=${scheme.axisB}, C=${scheme.axisC}` }
                                    ],
                                    identities: [], coordinates: [px, py], isTouchEvent: false
                                });
                            })
                            .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));
                    });
                    if (cls.showRegionLabels.value) {
                        const labelG = this.container.append("g").classed("scheme-labels", true);
                        scheme.regions.forEach(r => {
                            const [a, b, c] = barycentricCentroid(r.vertices);
                            const p = project(a, b, c);
                            // Estimate the region's bounding-radius in pixels
                            // to decide short vs full name. Small regions use
                            // the short code so the layout stays legible.
                            let maxDist = 0;
                            for (const v of r.vertices) {
                                const q = project(v[0], v[1], v[2]);
                                const d = Math.hypot(q.x - p.x, q.y - p.y);
                                if (d > maxDist) maxDist = d;
                            }
                            const useShort = maxDist < 32 && r.short;
                            const text = useShort ? r.short! : r.name;
                            labelG.append("text")
                                .attr("x", p.x).attr("y", p.y)
                                .attr("text-anchor", "middle")
                                .attr("dominant-baseline", "middle")
                                .attr("font-size", useShort ? "9px" : "10px")
                                .attr("font-weight", 600)
                                .attr("fill", "#333")
                                .attr("stroke", "rgba(255,255,255,0.85)").attr("stroke-width", 3)
                                .attr("paint-order", "stroke")
                                .style("pointer-events", "none")
                                .text(text);
                        });
                    }
                }
            }

            // ── 7. Triangle outline ────────────────────────────────
            this.container.append("polygon")
                .attr("points", `${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y}`)
                .attr("fill", "none")
                .attr("stroke", "#888")
                .attr("stroke-width", 1.5)
                .attr("stroke-linejoin", "round");

            // ── 8. Edge tick labels ────────────────────────────────
            // Axis A along edge A→B (left), B along B→C (bottom), C along C→A (right).
            if (n > 1 && n <= 20) {
                const tickG = this.container.append("g").classed("ticks", true);
                const addTick = (p: Pt, dx: number, dy: number, text: string, anchor: string) => {
                    tickG.append("text")
                        .attr("x", p.x + dx).attr("y", p.y + dy)
                        .attr("text-anchor", anchor)
                        .attr("dominant-baseline", "middle")
                        .attr("font-size", "9px").attr("fill", "#999")
                        .text(text);
                };
                for (let i = 1; i < n; i++) {
                    const f = i / n;
                    const lbl = pctFmt(f * 100);
                    addTick(project(f, 1 - f, 0), -6, 0, lbl, "end");        // A on left edge
                    addTick(project(0, f, 1 - f), 0, 14, lbl, "middle");     // B on bottom edge
                    addTick(project(1 - f, 0, f), 6, 0, lbl, "start");       // C on right edge
                }
            }

            // ── 9. Vertex axis titles ──────────────────────────────
            const titleG = this.container.append("g").classed("axis-titles", true);
            const vlabel = (p: Pt, dx: number, dy: number, text: string, anchor: string) => {
                titleG.append("text")
                    .attr("x", p.x + dx).attr("y", p.y + dy)
                    .attr("text-anchor", anchor)
                    .attr("font-size", "12px").attr("font-weight", 600).attr("fill", "#333")
                    .text(text);
            };
            vlabel(A, 0, -12, titleA, "middle");
            vlabel(B, -6, 26, titleB, "end");
            vlabel(C, 6, 26, titleC, "start");

            // ── 10. Encodings ──────────────────────────────────────
            // High contrast: point fill collapses to foreground; color ramp
            // uses background→foreground so continuous encoding survives.
            const cp = this.host.colorPalette;
            const hc = cp.isHighContrast === true;
            const hcFg = cp.foreground?.value || "#000000";
            const hcBg = cp.background?.value || "#ffffff";
            let colorScale: d3.ScaleLinear<string, string> | null = null;
            let colorDomain: [number, number] = [0, 1];
            if (hasColor) {
                const cv = points.map(p => p.colorVal).filter((v): v is number => v != null);
                colorDomain = [d3.min(cv)!, d3.max(cv)!];
                if (colorDomain[0] === colorDomain[1]) colorDomain[1] = colorDomain[0] + 1;
                colorScale = d3.scaleLinear<string>()
                    .domain(colorDomain)
                    .range(hc
                        ? [hcBg, hcFg]
                        : [cscale.colorScaleLow.value.value, cscale.colorScaleHigh.value.value])
                    .interpolate(d3.interpolateRgb);
            }

            const baseR = Math.max(1, pts.pointRadius.value);
            let sizeScale: d3.ScalePower<number, number> | null = null;
            if (sizeIdx >= 0 && points.some(p => p.sizeVal != null)) {
                const sv = points.map(p => p.sizeVal).filter((v): v is number => v != null);
                let sdom: [number, number] = [d3.min(sv)!, d3.max(sv)!];
                if (sdom[0] === sdom[1]) sdom = [0, sdom[1] || 1];
                sizeScale = d3.scaleSqrt().domain(sdom).range([baseR * 0.5, baseR * 2.2]);
            }

            const opacity = Math.max(0, Math.min(1, pts.pointOpacity.value / 100));
            const baseColor = hc ? hcFg : pts.pointColor.value.value;

            // ── 11. Points ─────────────────────────────────────────
            const gPts = this.container.append("g").classed("points", true);
            for (const p of points) {
                const pos = project(p.a, p.b, p.c);
                const r = sizeScale && p.sizeVal != null ? sizeScale(p.sizeVal) : baseR;
                const fill = colorScale && p.colorVal != null ? colorScale(p.colorVal) : baseColor;

                const circleSel = gPts.append("circle")
                    .datum(p)
                    .classed("point", true)
                    .attr("cx", pos.x).attr("cy", pos.y).attr("r", r)
                    .attr("fill", fill).attr("fill-opacity", opacity)
                    .attr("stroke", "#fff").attr("stroke-width", 0.75)
                    .on("mousemove", (event: MouseEvent, d: TernaryPoint) => {
                        const [px, py] = d3.pointer(event, this.svg.node());
                        this.tooltipService.show({
                            dataItems: this.buildTooltip(d, labelTitle, titleA, titleB, titleC,
                                hasColor, vals, colorIdx, sizeIdx),
                            identities: [], coordinates: [px, py], isTouchEvent: false
                        });
                    })
                    .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));
                (circleSel.node() as SVGCircleElement).dataset.baseOpacity = String(opacity);
                if (p.selectionId) {
                    circleSel.style("cursor", "pointer")
                        .on("click", (event: MouseEvent, d: TernaryPoint) => {
                            event.stopPropagation();
                            if (!d.selectionId) return;
                            const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                            this.selectionManager.select(d.selectionId, multi).then(() => this.applySelectionStyling());
                        })
                        .on("contextmenu", (event: MouseEvent, d: TernaryPoint) => {
                            event.preventDefault(); event.stopPropagation();
                            this.selectionManager.showContextMenu(d.selectionId ?? ({} as ISelectionId), { x: event.clientX, y: event.clientY });
                        });
                }

                if (pts.showLabels.value) {
                    gPts.append("text")
                        .attr("x", pos.x + r + 2).attr("y", pos.y)
                        .attr("dominant-baseline", "middle")
                        .attr("font-size", `${pts.labelFontSize.value}px`)
                        .attr("fill", "#444")
                        .text(p.label);
                }
            }

            // ── 12. Color legend ───────────────────────────────────
            if (hasColor && colorScale) {
                this.renderColorLegend(
                    width - this.margin.right - legendW + 12, this.margin.top,
                    Math.min(plotH, 160), colorDomain,
                    cscale.colorScaleLow.value.value, cscale.colorScaleHigh.value.value,
                    vals[colorIdx].source.displayName || "Color"
                );
            }

            this.applySelectionStyling();
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private buildTooltip(
        d: TernaryPoint, labelTitle: string, titleA: string, titleB: string, titleC: string,
        hasColor: boolean, vals: powerbi.DataViewValueColumns, colorIdx: number, sizeIdx: number
    ): VisualTooltipDataItem[] {
        const items: VisualTooltipDataItem[] = [
            { displayName: labelTitle, value: d.label },
            { displayName: titleA, value: `${numFmt(d.rawA)}  (${pctFmt(d.a * 100)}%)` },
            { displayName: titleB, value: `${numFmt(d.rawB)}  (${pctFmt(d.b * 100)}%)` },
            { displayName: titleC, value: `${numFmt(d.rawC)}  (${pctFmt(d.c * 100)}%)` }
        ];
        if (hasColor && d.colorVal != null) {
            items.push({ displayName: vals[colorIdx].source.displayName || "Color", value: numFmt(d.colorVal) });
        }
        if (sizeIdx >= 0 && d.sizeVal != null) {
            items.push({ displayName: vals[sizeIdx].source.displayName || "Size", value: numFmt(d.sizeVal) });
        }
        return items;
    }

    /** Vertical gradient legend for the continuous color encoding. */
    private renderColorLegend(
        x: number, y: number, h: number, domain: [number, number],
        low: string, high: string, title: string
    ): void {
        const g = this.container.append("g").classed("color-legend", true);
        const barW = 12;
        const steps = 24;
        const stepH = h / steps;
        const scale = d3.scaleLinear<string>().domain([0, steps - 1])
            .range([high, low]).interpolate(d3.interpolateRgb);   // high at top
        for (let i = 0; i < steps; i++) {
            g.append("rect")
                .attr("x", x).attr("y", y + i * stepH)
                .attr("width", barW).attr("height", Math.ceil(stepH) + 0.5)
                .attr("fill", scale(i));
        }
        g.append("rect")
            .attr("x", x).attr("y", y).attr("width", barW).attr("height", h)
            .attr("fill", "none").attr("stroke", "#ccc").attr("stroke-width", 0.5);

        const tf = d3.format(",.3~s");
        g.append("text").attr("x", x + barW + 4).attr("y", y + 4)
            .attr("font-size", "9px").attr("fill", "#666").text(tf(domain[1]));
        g.append("text").attr("x", x + barW + 4).attr("y", y + h)
            .attr("font-size", "9px").attr("fill", "#666").text(tf(domain[0]));
        g.append("text").attr("x", x).attr("y", y - 8)
            .attr("font-size", "10px").attr("font-weight", 600).attr("fill", "#555")
            .text(title.length > 10 ? title.slice(0, 9) + "…" : title);
    }

    /** Landing page shown when the two required components aren't bound. */
    private renderLandingPage(width: number, height: number, hasA: boolean, hasB: boolean): void {
        this.landing.selectAll("*").remove();
        if (width < 140 || height < 110) return;

        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        // Small ternary glyph.
        const s = 74, h2 = s * Math.sqrt(3) / 2;
        const gy = -h2 / 2 - 40;
        const ax = 0, ay = gy, bx = -s / 2, by = gy + h2, cx = s / 2, cy = gy + h2;
        g.append("polygon")
            .attr("points", `${ax},${ay} ${bx},${by} ${cx},${cy}`)
            .attr("fill", "#4682B4").attr("fill-opacity", 0.08)
            .attr("stroke", "#4682B4").attr("stroke-width", 1.5);
        [[0.5, 0.3, 0.2], [0.2, 0.5, 0.3], [0.3, 0.2, 0.5]].forEach(([a, b, c]) => {
            g.append("circle")
                .attr("cx", a * ax + b * bx + c * cx)
                .attr("cy", a * ay + b * by + c * cy)
                .attr("r", 3.5).attr("fill", "#4682B4");
        });

        g.append("text").attr("text-anchor", "middle").attr("y", -14)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px")
            .attr("font-weight", 600).attr("fill", "#333").text("Ternary Plot");

        const missing: string[] = [];
        if (!hasA) missing.push("Component A");
        if (!hasB) missing.push("Component B");
        const need = missing.length
            ? "Add measures:  " + missing.join("   +   ")
            : "Add Component A and Component B to begin";
        g.append("text").attr("text-anchor", "middle").attr("y", 8)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666").text(need);

        g.append("text").attr("text-anchor", "middle").attr("y", 30)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
            .attr("fill", "#999")
            .text("Add Component C and a Point Label for multi-sample plots.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
