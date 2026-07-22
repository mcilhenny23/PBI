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

import { VisualFormattingSettingsModel, DEFAULT_BAND_COLOR, DEFAULT_CENTRAL_COLOR, DEFAULT_ACTUALS_COLOR } from "./settings";

// ── Types ──────────────────────────────────────────────────────

interface FanDataPoint {
    category: string;
    index: number;
    central: number | null;
    actuals: number | null;
    upper1: number | null;
    lower1: number | null;
    upper2: number | null;
    lower2: number | null;
    upper3: number | null;
    lower3: number | null;
    selectionId?: ISelectionId;
}

interface BandPair {
    upperRole: keyof FanDataPoint;
    lowerRole: keyof FanDataPoint;
    opacityMultiplier: number;  // 1 = outermost (most transparent), 3 = innermost
    label: string;              // human label for tooltips (e.g. "Inner band")
}

/** Display name for each measure role, used in tooltips */
const ROLE_LABELS: Partial<Record<keyof FanDataPoint, string>> = {
    actuals: "Actuals",
    central: "Central estimate",
    upper1: "Upper 1",
    lower1: "Lower 1",
    upper2: "Upper 2",
    lower2: "Lower 2",
    upper3: "Upper 3",
    lower3: "Lower 3",
};

// ── Helpers ────────────────────────────────────────────────────

/** Find the index of a data role by name in the categorical values array */
function findValueIndex(values: powerbi.DataViewValueColumns, roleName: string): number {
    for (let i = 0; i < values.length; i++) {
        if (values[i].source.roles && values[i].source.roles[roleName]) {
            return i;
        }
    }
    return -1;
}

/** Get the D3 curve factory for a given curve name */
function getCurve(name: string): d3.CurveFactory {
    switch (name) {
        case "step": return d3.curveStepAfter;
        case "basis": return d3.curveBasis;
        case "monotone": return d3.curveMonotoneX;
        default: return d3.curveLinear;
    }
}

/** Safely read a numeric value, returning null for non-finite */
function safeNum(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Compact, locale-aware number formatting for tooltips */
const tooltipFormat = d3.format(",.4~g");

/** Effective colors used for a single render, after theme + high-contrast resolution */
interface RenderPalette {
    highContrast: boolean;
    band: string;
    bandStroke: string | null; // band outline (high-contrast only, else none)
    central: string;
    actuals: string;
    grid: string;
    axisLine: string;
    axisText: string;
    landingText: string;
    landingSub: string;
}

/** Rough perceived luminance of a hex color (0 = black, 1 = white) */
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
    private selectionManager: ISelectionManager;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    // Margin convention
    private margin = { top: 16, right: 24, bottom: 36, left: 52 };

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.colorPalette = options.host.colorPalette;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applySelectionStyling());

        // Create root SVG
        this.svg = d3.select(options.element)
            .append("svg")
            .classed("fan-chart", true);

        // Landing-page layer (instructions when no data is bound)
        this.landing = this.svg.append("g")
            .classed("fan-chart-landing", true);

        this.container = this.svg.append("g")
            .classed("fan-chart-container", true);

        this.svg.on("click.clear", (event: MouseEvent) => {
            if (event.target === this.svg.node()) {
                this.selectionManager.clear().then(() => this.applySelectionStyling());
            }
        });
    }

    private applySelectionStyling(): void {
        // Two states worth distinguishing:
        //   1. Self-select — a horizon in this chart was clicked. Show the
        //      tint on that horizon; do NOT dim the container, or SVG opacity
        //      cascade would multiply the tint alpha to invisibility.
        //   2. External hasSel — a peer visual filtered us with an id we
        //      don't own. Dim the container to signal we're being filtered.
        const s = this.formattingSettings;
        if (!s) return;
        const activeIds = this.selectionManager.getSelectionIds() as ISelectionId[];
        const hasSel = activeIds.length > 0;
        const dim = Math.max(0.1, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 25) / 100));
        let ownsSelection = false;
        this.container.selectAll<SVGRectElement, FanDataPoint>("rect.hit").each(function (d) {
            const rect = d3.select(this);
            const isSel = !!d?.selectionId && activeIds.some(a => a?.equals?.(d.selectionId!));
            if (isSel) ownsSelection = true;
            rect.attr("fill", hasSel && isSel ? "rgba(66, 135, 245, 0.15)" : "transparent");
        });
        this.container.attr("opacity", hasSel && !ownsSelection ? dim : 1);
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            // ── 1. Parse settings ──────────────────────────────────
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);

            const fan = this.formattingSettings.fanSettingsCard;
            const axes = this.formattingSettings.axisSettingsCard;

            // Resolve theme / high-contrast colors once per render.
            const palette = this.resolvePalette(fan);

            // ── 2. Size ────────────────────────────────────────────
            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);

            const plotW = Math.max(0, width - this.margin.left - this.margin.right);
            const plotH = Math.max(0, height - this.margin.top - this.margin.bottom);
            this.container.attr("transform", `translate(${this.margin.left},${this.margin.top})`);

            // ── 3. Extract data ────────────────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const hasAxis = !!dataView?.categorical?.categories?.[0]?.values?.length;
            const hasMeasures = !!dataView?.categorical?.values?.length;
            if (!hasAxis || !hasMeasures) {
                // Nothing (or not enough) is bound → guide the user instead of a blank box.
                this.container.selectAll("*").remove();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height, hasAxis, hasMeasures, palette);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            const cat = dataView.categorical;
            const categories = cat.categories[0].values;
            const vals = cat.values;

            // Map role names → value column indices
            const centralIdx = findValueIndex(vals, "central");
            const actualsIdx = findValueIndex(vals, "actuals");
            const upper1Idx = findValueIndex(vals, "upper1");
            const lower1Idx = findValueIndex(vals, "lower1");
            const upper2Idx = findValueIndex(vals, "upper2");
            const lower2Idx = findValueIndex(vals, "lower2");
            const upper3Idx = findValueIndex(vals, "upper3");
            const lower3Idx = findValueIndex(vals, "lower3");

            const axisCol = cat.categories[0];
            const data: FanDataPoint[] = categories.map((c, i) => {
                let selectionId: ISelectionId | undefined;
                try {
                    selectionId = this.host.createSelectionIdBuilder()
                        .withCategory(axisCol, i)
                        .createSelectionId();
                } catch { /* skipped */ }
                return {
                    category: String(c),
                    index: i,
                    central: centralIdx >= 0 ? safeNum(vals[centralIdx].values[i]) : null,
                    actuals: actualsIdx >= 0 ? safeNum(vals[actualsIdx].values[i]) : null,
                    upper1: upper1Idx >= 0 ? safeNum(vals[upper1Idx].values[i]) : null,
                    lower1: lower1Idx >= 0 ? safeNum(vals[lower1Idx].values[i]) : null,
                    upper2: upper2Idx >= 0 ? safeNum(vals[upper2Idx].values[i]) : null,
                    lower2: lower2Idx >= 0 ? safeNum(vals[lower2Idx].values[i]) : null,
                    upper3: upper3Idx >= 0 ? safeNum(vals[upper3Idx].values[i]) : null,
                    lower3: lower3Idx >= 0 ? safeNum(vals[lower3Idx].values[i]) : null,
                    selectionId
                };
            });

            // ── 4. Determine which band pairs are active ───────────
            const bandPairs: BandPair[] = [];
            if (upper3Idx >= 0 && lower3Idx >= 0) {
                bandPairs.push({ upperRole: "upper3", lowerRole: "lower3", opacityMultiplier: 1, label: "Outer band" });
            }
            if (upper2Idx >= 0 && lower2Idx >= 0) {
                bandPairs.push({ upperRole: "upper2", lowerRole: "lower2", opacityMultiplier: 2, label: "Middle band" });
            }
            if (upper1Idx >= 0 && lower1Idx >= 0) {
                bandPairs.push({ upperRole: "upper1", lowerRole: "lower1", opacityMultiplier: 3, label: "Inner band" });
            }

            // Human-readable names for tooltips: prefer the user's own measure names.
            const displayNames: Partial<Record<keyof FanDataPoint, string>> = {};
            const roleForIdx: Array<[keyof FanDataPoint, number]> = [
                ["actuals", actualsIdx], ["central", centralIdx],
                ["upper1", upper1Idx], ["lower1", lower1Idx],
                ["upper2", upper2Idx], ["lower2", lower2Idx],
                ["upper3", upper3Idx], ["lower3", lower3Idx],
            ];
            for (const [role, idx] of roleForIdx) {
                if (idx >= 0) {
                    displayNames[role] = vals[idx].source.displayName || ROLE_LABELS[role] || String(role);
                }
            }
            const axisTitle = cat.categories[0].source.displayName || "Axis";

            // ── 5. Scales ──────────────────────────────────────────
            const xScale = d3.scalePoint<string>()
                .domain(data.map(d => d.category))
                .range([0, plotW])
                .padding(0.1);

            // Collect all numeric values for the Y domain
            const allValues: number[] = [];
            for (const d of data) {
                for (const key of ["central", "actuals", "upper1", "lower1", "upper2", "lower2", "upper3", "lower3"] as const) {
                    if (d[key] != null) allValues.push(d[key] as number);
                }
            }
            if (allValues.length === 0) {
                this.container.selectAll("*").remove();
                this.events.renderingFinished(options);
                return;
            }

            const yMin = d3.min(allValues)!;
            const yMax = d3.max(allValues)!;
            const yPad = (yMax - yMin) * 0.05 || 1;
            const yScale = d3.scaleLinear()
                .domain([yMin - yPad, yMax + yPad])
                .range([plotH, 0])
                .nice();

            // ── 6. Curve factory ───────────────────────────────────
            const curveValue = String(fan.curveType.value?.value ?? "monotone");
            const curve = getCurve(curveValue);

            // ── 7. Clear & draw ────────────────────────────────────
            this.container.selectAll("*").remove();

            // -- Gridlines --
            if (axes.showGridlines.value) {
                const gridG = this.container.append("g").classed("gridlines", true);
                const ticks = yScale.ticks(6);
                gridG.selectAll("line")
                    .data(ticks)
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

            // -- Bands (outermost first → innermost on top) --
            const bandColor = palette.band;
            const baseOpacity = fan.bandOpacityOuter.value / 100;

            for (const bp of bandPairs) {
                const validPoints = data.filter(d => d[bp.upperRole] != null && d[bp.lowerRole] != null);
                if (validPoints.length < 2) continue;

                const areaGen = d3.area<FanDataPoint>()
                    .defined(d => d[bp.upperRole] != null && d[bp.lowerRole] != null)
                    .x(d => xScale(d.category)!)
                    .y0(d => yScale(d[bp.lowerRole] as number))
                    .y1(d => yScale(d[bp.upperRole] as number))
                    .curve(curve);

                this.container.append("path")
                    .datum(data)
                    .attr("d", areaGen)
                    .attr("fill", bandColor)
                    .attr("fill-opacity", baseOpacity * bp.opacityMultiplier)
                    // In high contrast, outline each band so boundaries stay visible.
                    .attr("stroke", palette.bandStroke ?? "none")
                    .attr("stroke-width", palette.bandStroke ? 1 : 0)
                    .attr("stroke-opacity", palette.bandStroke ? 0.9 : 0);
            }

            // -- Actuals line --
            if (actualsIdx >= 0) {
                const actualsData = data.filter(d => d.actuals != null);
                if (actualsData.length >= 2) {
                    const lineGen = d3.line<FanDataPoint>()
                        .defined(d => d.actuals != null)
                        .x(d => xScale(d.category)!)
                        .y(d => yScale(d.actuals!))
                        .curve(curve);

                    this.container.append("path")
                        .datum(actualsData)
                        .attr("d", lineGen)
                        .attr("fill", "none")
                        .attr("stroke", palette.actuals)
                        .attr("stroke-width", 2.5)
                        .attr("stroke-linejoin", "round");
                }
            }

            // -- Central estimate line --
            if (fan.showCentralLine.value && centralIdx >= 0) {
                const centralData = data.filter(d => d.central != null);
                if (centralData.length >= 2) {
                    const lineGen = d3.line<FanDataPoint>()
                        .defined(d => d.central != null)
                        .x(d => xScale(d.category)!)
                        .y(d => yScale(d.central!))
                        .curve(curve);

                    this.container.append("path")
                        .datum(centralData)
                        .attr("d", lineGen)
                        .attr("fill", "none")
                        .attr("stroke", palette.central)
                        .attr("stroke-width", 2)
                        .attr("stroke-dasharray", "6 3")
                        .attr("stroke-linejoin", "round");
                }
            }

            // -- X axis --
            if (axes.showXAxis.value) {
                const xAxisG = this.container.append("g")
                    .attr("transform", `translate(0,${plotH})`)
                    .call(d3.axisBottom(xScale).tickSize(0).tickPadding(8));

                xAxisG.select(".domain").attr("stroke", palette.axisLine);
                xAxisG.selectAll("text")
                    .attr("font-size", `${axes.fontSize.value}px`)
                    .attr("fill", palette.axisText);
            }

            // -- Y axis --
            if (axes.showYAxis.value) {
                const yAxisG = this.container.append("g")
                    .call(d3.axisLeft(yScale).ticks(6).tickSize(0).tickPadding(6));

                yAxisG.select(".domain").attr("stroke", palette.axisLine);
                yAxisG.selectAll("text")
                    .attr("font-size", `${axes.fontSize.value}px`)
                    .attr("fill", palette.axisText);
            }

            // -- Tooltip hover layer --
            // One transparent, full-height band per category. Hovering shows every
            // bound value at that horizon, so users can read exact numbers.
            const step = data.length > 1 ? plotW / (data.length - 1) : plotW;
            const bandWidth = Math.max(1, step);
            const centralName = displayNames.central;
            const actualsName = displayNames.actuals;

            const hover = this.container.append("g").classed("hover-layer", true);

            // Vertical guideline + focus dot, hidden until hover.
            const guide = hover.append("line")
                .classed("hover-guide", true)
                .attr("y1", 0)
                .attr("y2", plotH)
                .attr("stroke", palette.axisLine)
                .attr("stroke-width", 1)
                .attr("stroke-dasharray", "3 3")
                .attr("opacity", 0)
                .attr("pointer-events", "none");

            const focus = hover.append("circle")
                .classed("hover-focus", true)
                .attr("r", 3.5)
                .attr("fill", palette.central)
                .attr("stroke", palette.highContrast ? (this.colorPalette.background?.value || "#fff") : "#fff")
                .attr("stroke-width", 1.5)
                .attr("opacity", 0)
                .attr("pointer-events", "none");

            const buildTooltip = (d: FanDataPoint): VisualTooltipDataItem[] => {
                const items: VisualTooltipDataItem[] = [
                    { displayName: axisTitle, value: d.category }
                ];
                const pushIf = (role: keyof FanDataPoint, name: string | undefined) => {
                    if (name && d[role] != null) {
                        items.push({ displayName: name, value: tooltipFormat(d[role] as number) });
                    }
                };
                pushIf("actuals", actualsName);
                pushIf("central", centralName);
                for (const bp of bandPairs) {
                    const up = d[bp.upperRole];
                    const lo = d[bp.lowerRole];
                    if (up != null && lo != null) {
                        items.push({
                            displayName: bp.label,
                            value: `${tooltipFormat(lo as number)} – ${tooltipFormat(up as number)}`
                        });
                    }
                }
                return items;
            };

            const showTooltipFor = (d: FanDataPoint, clientX: number, clientY: number) => {
                const cx = xScale(d.category)!;
                guide.attr("x1", cx).attr("x2", cx).attr("opacity", 1);
                const focusY = d.central != null ? yScale(d.central)
                    : d.actuals != null ? yScale(d.actuals) : null;
                if (focusY != null) {
                    focus.attr("cx", cx).attr("cy", focusY).attr("opacity", 1);
                } else {
                    focus.attr("opacity", 0);
                }
                this.tooltipService.show({
                    dataItems: buildTooltip(d),
                    identities: [],
                    coordinates: [clientX, clientY],
                    isTouchEvent: false
                });
            };

            const hideTooltip = () => {
                guide.attr("opacity", 0);
                focus.attr("opacity", 0);
                this.tooltipService.hide({ immediately: false, isTouchEvent: false });
            };

            hover.selectAll("rect.hit")
                .data(data)
                .enter()
                .append("rect")
                .classed("hit", true)
                .attr("x", d => xScale(d.category)! - bandWidth / 2)
                .attr("y", 0)
                .attr("width", bandWidth)
                .attr("height", plotH)
                .attr("fill", "transparent")
                .style("cursor", d => d.selectionId ? "pointer" : "default")
                .attr("tabindex", d => d.selectionId ? 0 : -1).attr("role", "button")
                .attr("aria-label", d => `Horizon ${d.category} — click to filter`)
                .on("mousemove", (event: MouseEvent, d: FanDataPoint) => {
                    // Coordinates are relative to the whole visual element.
                    const [px, py] = d3.pointer(event, this.svg.node());
                    showTooltipFor(d, px, py);
                })
                .on("mouseleave", hideTooltip)
                .on("click", (event: MouseEvent, d: FanDataPoint) => {
                    event.stopPropagation();
                    if (!d.selectionId) return;
                    const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                    this.selectionManager.select(d.selectionId, multi).then(() => this.applySelectionStyling());
                })
                .on("contextmenu", (event: MouseEvent, d: FanDataPoint) => {
                    event.preventDefault(); event.stopPropagation();
                    this.selectionManager.showContextMenu(d.selectionId ?? ({} as ISelectionId), { x: event.clientX, y: event.clientY });
                })
                .on("keydown", (event: KeyboardEvent, d: FanDataPoint) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    if (!d.selectionId) return;
                    this.selectionManager.select(d.selectionId, event.shiftKey).then(() => this.applySelectionStyling());
                });

            this.applySelectionStyling();
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    /**
     * Resolve the colors used for one render.
     *
     * High contrast: Power BI sets colorPalette.isHighContrast and exposes a
     * two-color (foreground/background) palette. Everything is drawn in the
     * foreground color — bands keep their nested opacity so the layering still
     * reads, and each band gets a foreground outline so boundaries stay visible.
     *
     * Normal themes: user-picked colors always win. Where a color is still at
     * its built-in default, we pull from the active report theme instead
     * (getColor for the band, the theme foreground for the lines) so the visual
     * matches the report out of the box. Neutral chrome (gridlines, axes) is
     * derived from the theme background so it stays legible on dark themes.
     */
    private resolvePalette(fan: VisualFormattingSettingsModel["fanSettingsCard"]): RenderPalette {
        const cp = this.colorPalette;

        if (cp.isHighContrast) {
            const fg = cp.foreground?.value || "#000000";
            return {
                highContrast: true,
                band: fg,
                bandStroke: fg,
                central: fg,
                actuals: fg,
                grid: fg,
                axisLine: fg,
                axisText: fg,
                landingText: fg,
                landingSub: fg,
            };
        }

        const bg = cp.background?.value || "#ffffff";
        const isDark = luminance(bg) < 0.5;
        const themeFg = cp.foreground?.value || (isDark ? "#f0f0f0" : "#333333");

        const userBand = fan.bandColor.value.value;
        const userCentral = fan.centralLineColor.value.value;
        const userActuals = fan.actualsLineColor.value.value;

        return {
            highContrast: false,
            // Default band → theme's primary data color; otherwise honor the user.
            band: userBand === DEFAULT_BAND_COLOR
                ? (cp.getColor("fanChartBand")?.value || userBand)
                : userBand,
            bandStroke: null,
            central: userCentral === DEFAULT_CENTRAL_COLOR ? themeFg : userCentral,
            actuals: userActuals === DEFAULT_ACTUALS_COLOR ? themeFg : userActuals,
            grid: isDark ? "#3a3a3a" : "#e0e0e0",
            axisLine: isDark ? "#777777" : "#999999",
            axisText: isDark ? "#bbbbbb" : "#666666",
            landingText: isDark ? "#eeeeee" : "#333333",
            landingSub: isDark ? "#aaaaaa" : "#999999",
        };
    }

    /**
     * Landing page shown when the visual has no usable data bound.
     * Guides the user through which fields to drag so the chart can render —
     * the fastest path to a first successful chart (ease of adoption).
     */
    private renderLandingPage(
        width: number, height: number,
        hasAxis: boolean, hasMeasures: boolean,
        palette: RenderPalette
    ): void {
        this.landing.selectAll("*").remove();
        if (width < 120 || height < 80) return; // too small to be legible

        const cx = width / 2;
        const g = this.landing.attr("transform", `translate(${cx}, ${height / 2})`);
        const glyphColor = palette.highContrast ? palette.central : "#4682B4";

        // Small fan glyph so the empty state still looks like the product.
        const glyph = g.append("g").attr("transform", "translate(0, -78)");
        const band = (w: number, h: number, op: number) => glyph.append("path")
            .attr("d", `M ${-w} 0 Q 0 ${-h} ${w} 0 Q 0 ${h * 0.4} ${-w} 0 Z`)
            .attr("fill", glyphColor)
            .attr("fill-opacity", palette.highContrast ? Math.min(1, op + 0.2) : op)
            .attr("stroke", palette.highContrast ? palette.central : "none")
            .attr("stroke-opacity", palette.highContrast ? 0.9 : 0);
        band(46, 26, 0.18);
        band(34, 18, 0.28);
        band(22, 10, 0.4);
        glyph.append("path")
            .attr("d", "M -46 2 Q 0 -14 46 4")
            .attr("fill", "none")
            .attr("stroke", palette.central)
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "5 3");

        g.append("text")
            .attr("text-anchor", "middle")
            .attr("y", -18)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "16px")
            .attr("font-weight", 600)
            .attr("fill", palette.landingText)
            .text("Fan Chart");

        // Contextual next-step: name exactly the field(s) still missing.
        const steps: string[] = [];
        if (!hasAxis) steps.push("Axis  (time / horizon)");
        if (!hasMeasures) steps.push("Central Estimate  (p50)");
        const need = steps.length
            ? "Add fields:  " + steps.join("   +   ")
            : "Add an Axis and a Central Estimate to begin";

        g.append("text")
            .attr("text-anchor", "middle")
            .attr("y", 6)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "12px")
            .attr("fill", palette.axisText)
            .text(need);

        g.append("text")
            .attr("text-anchor", "middle")
            .attr("y", 28)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "11px")
            .attr("fill", palette.landingSub)
            .text("Then drag quantile pairs (p25/p75, p10/p90, p5/p95) to draw the bands.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
