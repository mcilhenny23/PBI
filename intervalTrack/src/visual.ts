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

interface Interval {
    track: string;
    start: number;
    end: number | null;      // null → point event
    label: string | null;
    category: string | null;
    value: number | null;
    lane: number;
    selectionId?: ISelectionId;
}

interface TrackLayout {
    name: string;
    laneCount: number;
    y: number;               // top pixel of the track
    height: number;
}

interface RenderedRect {
    x: number; y: number; w: number; h: number; d: Interval;
}

// ── Helpers ────────────────────────────────────────────────────

function safeNum(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    if (v instanceof Date) return v.getTime();
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Rounded rectangle path — ctx.roundRect isn't guaranteed in every host. */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
}

const numFmt = d3.format(",.4~g");

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private colorPalette: ISandboxExtendedColorPalette;
    private tooltipService: ITooltipService;
    private selectionManager: ISelectionManager;

    private root: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private canvas: d3.Selection<HTMLCanvasElement, unknown, null, undefined>;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private overlay: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    // ── State shared between update() and the zoom-driven draw() ──
    private intervals: Interval[] = [];
    private tracks: TrackLayout[] = [];
    private baseX: d3.ScaleTime<number, number> | d3.ScaleLinear<number, number> | null = null;
    private transform: d3.ZoomTransform = d3.zoomIdentity;
    private zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
    private dataKey = "";
    private isDate = false;
    private rendered: RenderedRect[] = [];
    private colorOf = new Map<string, string>();

    // Geometry + style resolved in update(), reused by draw()
    private geom = { left: 0, right: 0, top: 0, bottom: 0, laneH: 24, barH: 18, radius: 3, alpha: 0.85,
        densityX: 0, densityW: 0, concurTop: 0, concurH: 0 };
    private opts = { showLabels: true, labelFs: 10, axisFs: 11, showAxis: true, pointR: 4, trackFs: 12, packing: "stack",
        showDensity: false, showConcurrency: false, concurColor: "#4682B4" };
    private titles = { track: "Track", start: "Start", end: "End", label: "Label", category: "Category", value: "Value" };

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.colorPalette = options.host.colorPalette;
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applyExternalDim());

        this.root = d3.select(options.element).append("div").classed("itv-root", true);
        this.canvas = this.root.append("canvas").classed("itv-canvas", true);
        this.svg = this.root.append("svg").classed("itv-svg", true)
            .attr("tabindex", 0).attr("role", "img").attr("aria-label", "Interval track");
        this.landing = this.svg.append("g").classed("itv-landing", true);
        this.overlay = this.svg.append("g").classed("itv-overlay", true);
    }

    private applyExternalDim(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.1, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 25) / 100));
        const hasSel = this.selectionManager.getSelectionIds().length > 0;
        this.canvas.style("opacity", hasSel ? String(dim) : "1");
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const tk = this.formattingSettings.tracksCard;
            const iv = this.formattingSettings.intervalsCard;
            const den = this.formattingSettings.densityCard;
            const ax = this.formattingSettings.axisCard;

            const width = options.viewport.width;
            const height = options.viewport.height;

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
            this.rendered = [];

            // ── Parse the table dataView ───────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const table = dataView?.table;
            const cols = table?.columns;
            const roleCol = (role: string): number =>
                cols ? cols.findIndex(c => c.roles && c.roles[role]) : -1;

            const cTrack = roleCol("track"), cStart = roleCol("start"), cEnd = roleCol("end");
            const cLabel = roleCol("label"), cCat = roleCol("category"), cVal = roleCol("value");

            if (!table?.rows?.length || cStart < 0) {
                this.renderLandingPage(width, height, cStart >= 0, cTrack >= 0);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            this.isDate = !!(cols![cStart].type && cols![cStart].type.dateTime);
            this.titles = {
                track: cTrack >= 0 ? (cols![cTrack].displayName || "Track") : "Track",
                start: cols![cStart].displayName || "Start",
                end: cEnd >= 0 ? (cols![cEnd].displayName || "End") : "End",
                label: cLabel >= 0 ? (cols![cLabel].displayName || "Label") : "Label",
                category: cCat >= 0 ? (cols![cCat].displayName || "Category") : "Category",
                value: cVal >= 0 ? (cols![cVal].displayName || "Value") : "Value"
            };

            const intervals: Interval[] = [];
            for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
                const row = table.rows[rowIdx];
                const start = safeNum(row[cStart]);
                if (start == null) continue;
                let end = cEnd >= 0 ? safeNum(row[cEnd]) : null;
                if (end != null && end <= start) end = null;      // zero-duration → point event

                let selectionId: ISelectionId | undefined;
                try {
                    selectionId = this.host.createSelectionIdBuilder()
                        .withTable(table, rowIdx)
                        .createSelectionId();
                } catch { /* skipped */ }

                intervals.push({
                    track: cTrack >= 0 && row[cTrack] != null ? String(row[cTrack]) : "All",
                    start, end,
                    label: cLabel >= 0 && row[cLabel] != null ? String(row[cLabel]) : null,
                    category: cCat >= 0 && row[cCat] != null ? String(row[cCat]) : null,
                    value: cVal >= 0 ? safeNum(row[cVal]) : null,
                    lane: 0,
                    selectionId
                });
            }
            if (!intervals.length) {
                this.renderLandingPage(width, height, true, cTrack >= 0);
                this.events.renderingFinished(options);
                return;
            }

            // ── Colors ─────────────────────────────────────────────
            // High contrast: categorical colors collapse to the foreground —
            // the two-color palette can't encode categories.
            const hc = this.colorPalette.isHighContrast === true;
            const hcFg = this.colorPalette.foreground?.value || "#000000";
            this.colorOf = new Map<string, string>();
            const catValues = Array.from(new Set(intervals.map(i => i.category).filter((c): c is string => c != null)));
            for (const c of catValues) this.colorOf.set(c, hc ? hcFg : this.colorPalette.getColor(c).value);

            // ── Lane packing per track ─────────────────────────────
            const packing = String(tk.packingMode.value?.value ?? "stack");
            this.opts.packing = packing;
            const byTrack = new Map<string, Interval[]>();
            for (const it of intervals) {
                let arr = byTrack.get(it.track);
                if (!arr) { arr = []; byTrack.set(it.track, arr); }
                arr.push(it);
            }
            const trackNames = Array.from(byTrack.keys()).sort();

            const laneCounts = new Map<string, number>();
            for (const name of trackNames) {
                const arr = byTrack.get(name)!;
                arr.sort((a, b) => a.start - b.start);
                if (packing !== "stack") {
                    for (const it of arr) it.lane = 0;
                    laneCounts.set(name, 1);
                    continue;
                }
                // Greedy interval scheduling: put each interval in the first lane
                // whose last interval already finished. Minimal lane count.
                const laneEnds: number[] = [];
                for (const it of arr) {
                    const finish = it.end != null ? it.end : it.start;
                    let placed = false;
                    for (let l = 0; l < laneEnds.length; l++) {
                        if (it.start >= laneEnds[l]) { it.lane = l; laneEnds[l] = finish; placed = true; break; }
                    }
                    if (!placed) { it.lane = laneEnds.length; laneEnds.push(finish); }
                }
                laneCounts.set(name, Math.max(1, laneEnds.length));
            }
            this.intervals = intervals;

            // ── Vertical layout (shrink to fit if needed) ──────────
            const axisH = ax.showAxis.value ? (ax.axisFontSize.value + 18) : 6;
            const padTop = 8, padBottom = 6;
            // Concurrency ribbon eats vertical space above the tracks.
            const concurH = den.showConcurrency.value
                ? Math.max(16, Math.min(80, den.concurrencyHeight.value ?? 28))
                : 0;
            const concurGap = concurH > 0 ? 6 : 0;
            const availH = Math.max(10, height - axisH - padTop - padBottom - concurH - concurGap);

            let laneH = Math.max(4, tk.trackHeight.value || 24);
            let barH = Math.max(2, iv.intervalHeight.value || 18);
            const gap = Math.max(0, tk.trackGap.value || 8);
            const totalLanes = trackNames.reduce((s, n) => s + laneCounts.get(n)!, 0);
            let needed = totalLanes * laneH + Math.max(0, trackNames.length - 1) * gap;
            if (needed > availH) {
                const f = availH / needed;
                laneH = Math.max(3, laneH * f);
                barH = Math.max(2, Math.min(barH * f, laneH - 1));
                needed = totalLanes * laneH + Math.max(0, trackNames.length - 1) * gap;
            }

            const tracks: TrackLayout[] = [];
            let y = padTop + concurH + concurGap;   // leave room for the ribbon above
            for (const name of trackNames) {
                const lc = laneCounts.get(name)!;
                const h = lc * laneH;
                tracks.push({ name, laneCount: lc, y, height: h });
                y += h + gap;
            }
            this.tracks = tracks;

            // ── X scale + zoom ─────────────────────────────────────
            const labelW = Math.max(0, Math.min(width * 0.4, tk.trackLabelWidth.value || 100));
            const densityW = den.showDensity.value
                ? Math.max(60, Math.min(300, den.densityWidth.value ?? 120))
                : 0;
            const left = labelW + 6, right = width - 10 - densityW;
            this.geom = {
                left, right,
                top: padTop + concurH + concurGap,
                bottom: padTop + concurH + concurGap + needed,
                laneH, barH, radius: Math.max(0, iv.intervalRadius.value || 0),
                alpha: Math.max(0, Math.min(1, (iv.intervalOpacity.value ?? 85) / 100)),
                densityX: right + 6, densityW,
                concurTop: padTop, concurH
            };
            this.opts = {
                showLabels: iv.showLabels.value, labelFs: Math.max(6, iv.labelFontSize.value),
                axisFs: Math.max(6, ax.axisFontSize.value), showAxis: ax.showAxis.value,
                pointR: Math.max(1, iv.pointEventRadius.value || 4),
                trackFs: Math.max(6, tk.trackLabelFontSize.value), packing,
                showDensity: den.showDensity.value,
                showConcurrency: den.showConcurrency.value,
                concurColor: den.concurrencyColor.value.value
            };

            const minStart = d3.min(intervals, i => i.start)!;
            const maxEnd = d3.max(intervals, i => i.end != null ? i.end : i.start)!;
            const span = maxEnd - minStart || 1;
            const dMin = minStart - span * 0.02, dMax = maxEnd + span * 0.02;

            if (right - left < 20) { this.events.renderingFinished(options); return; }

            this.baseX = this.isDate
                ? d3.scaleTime().domain([new Date(dMin), new Date(dMax)]).range([left, right])
                : d3.scaleLinear().domain([dMin, dMax]).range([left, right]);

            // Reset the zoom only when the underlying data actually changed —
            // resizing or restyling shouldn't throw away the user's zoom.
            const key = `${intervals.length}|${dMin}|${dMax}|${trackNames.length}`;
            if (key !== this.dataKey) { this.dataKey = key; this.transform = d3.zoomIdentity; }

            if (ax.enableZoom.value) {
                this.zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
                    .scaleExtent([1, 20000])
                    .extent([[left, 0], [right, height]])
                    .translateExtent([[left, 0], [right, height]])
                    .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
                        this.transform = event.transform;
                        this.draw();
                    });
                this.svg.call(this.zoomBehavior);
                // Re-apply the retained transform without re-firing a redraw storm.
                this.svg.call(this.zoomBehavior.transform, this.transform);
            } else {
                this.svg.on(".zoom", null);
                this.transform = d3.zoomIdentity;
            }

            this.draw();
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    /**
     * Redraw at the current zoom transform. Called on update and on every zoom
     * event, so it must stay cheap: only intervals overlapping the visible time
     * window are touched (virtualization), and SVG chrome is rebuilt small.
     */
    private draw(): void {
        if (!this.baseX) return;
        const canvasNode = this.canvas.node()!;
        const dpr = window.devicePixelRatio || 1;
        const width = canvasNode.width / dpr, height = canvasNode.height / dpr;
        const ctx = canvasNode.getContext("2d")!;
        ctx.clearRect(0, 0, width, height);
        this.overlay.selectAll("*").remove();
        this.rendered = [];

        const g = this.geom, o = this.opts;
        const x = this.transform.rescaleX(this.baseX as d3.ScaleLinear<number, number>);
        const [visMin, visMax] = x.domain().map(v => +v);

        // Track backgrounds + labels.
        const labels = this.overlay.append("g").classed("track-labels", true);
        for (const t of this.tracks) {
            this.overlay.append("rect")
                .attr("x", g.left).attr("y", t.y).attr("width", g.right - g.left).attr("height", t.height)
                .attr("fill", "#fafafa").attr("stroke", "#eee").attr("stroke-width", 1);
            if (g.left > 20) {
                labels.append("text")
                    .attr("x", g.left - 8).attr("y", t.y + t.height / 2)
                    .attr("text-anchor", "end").attr("dominant-baseline", "middle")
                    .attr("font-size", `${o.trackFs}px`).attr("fill", "#555")
                    .text(t.name);
            }
        }

        // Intervals — Canvas, virtualized to the visible window.
        const trackY = new Map<string, TrackLayout>();
        for (const t of this.tracks) trackY.set(t.name, t);
        const labelLayer = this.overlay.append("g").classed("bar-labels", true);
        let labelBudget = 250;

        ctx.save();
        ctx.beginPath();
        ctx.rect(g.left, 0, Math.max(0, g.right - g.left), height);
        ctx.clip();

        for (const it of this.intervals) {
            const finish = it.end != null ? it.end : it.start;
            if (finish < visMin || it.start > visMax) continue;      // virtualization
            const t = trackY.get(it.track);
            if (!t) continue;

            const laneTop = t.y + it.lane * g.laneH;
            const yy = laneTop + (g.laneH - g.barH) / 2;
            const fill = it.category != null ? (this.colorOf.get(it.category) || "#4682B4") : "#4682B4";

            // Value modulates intensity when bound.
            ctx.globalAlpha = o.packing === "overlap" ? g.alpha * 0.65 : g.alpha;
            ctx.fillStyle = fill;

            if (it.end == null) {
                // Point event → diamond marker.
                const cx = x(it.start as never), cy = laneTop + g.laneH / 2;
                const r = Math.min(o.pointR, g.laneH / 2);
                ctx.beginPath();
                ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy);
                ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
                ctx.closePath(); ctx.fill();
                this.rendered.push({ x: cx - r, y: cy - r, w: r * 2, h: r * 2, d: it });
            } else {
                const x0 = x(it.start as never), x1 = x(it.end as never);
                const w = Math.max(1, x1 - x0);                       // sub-pixel → density band
                roundRectPath(ctx, x0, yy, w, g.barH, g.radius);
                ctx.fill();
                this.rendered.push({ x: x0, y: yy, w, h: g.barH, d: it });

                // Labels only where they actually fit.
                if (o.showLabels && it.label && labelBudget > 0 && w > o.labelFs * 2.5 && g.barH >= o.labelFs) {
                    const maxChars = Math.floor(w / (o.labelFs * 0.58));
                    const text = it.label.length > maxChars ? it.label.slice(0, Math.max(1, maxChars - 1)) + "…" : it.label;
                    if (maxChars >= 2) {
                        labelLayer.append("text")
                            .attr("x", x0 + 4).attr("y", yy + g.barH / 2)
                            .attr("dominant-baseline", "middle")
                            .attr("font-size", `${o.labelFs}px`).attr("fill", "#fff")
                            .text(text);
                        labelBudget--;
                    }
                }
            }
        }
        ctx.restore();
        ctx.globalAlpha = 1;

        // ── Density stats column ───────────────────────────────
        // Per-track: coverage (fraction of visible span occupied by
        // intervals, capped at 100% by union), count and mean duration.
        // Computed over the visible window only, so zooming re-runs it and
        // makes the numbers reflect what's on screen.
        if (o.showDensity && g.densityW > 0) {
            const visSpan = Math.max(1e-9, visMax - visMin);
            for (const t of this.tracks) {
                let covered = 0, count = 0, sumDur = 0;
                // Union of intervals — sort within the track, merge overlapping,
                // sum the merged spans. Point events don't add to coverage but
                // do add to count.
                const list = this.intervals.filter(it => it.track === t.name);
                const clipped = list.map(it => {
                    const s = Math.max(it.start, visMin);
                    const e = Math.min(it.end != null ? it.end : it.start, visMax);
                    return { s, e, isPoint: it.end == null, start: it.start };
                }).filter(it => it.e >= visMin && it.s <= visMax);
                clipped.sort((a, b) => a.s - b.s);
                // Merged-interval union — start with a sentinel that no interval
                // extends. First finite interval initialises the accumulator;
                // subsequent ones either extend it or flush and restart.
                let cs = NaN, ce = NaN;
                for (const it of clipped) {
                    if (it.e < visMin || it.s > visMax) continue;
                    count++;
                    if (it.isPoint) continue;
                    sumDur += Math.max(0, it.e - it.s);
                    if (!Number.isFinite(cs)) { cs = it.s; ce = it.e; continue; }
                    if (it.s <= ce) { ce = Math.max(ce, it.e); }
                    else { covered += Math.max(0, ce - cs); cs = it.s; ce = it.e; }
                }
                if (Number.isFinite(cs) && ce > cs) covered += Math.max(0, ce - cs);
                const covPct = Math.min(100, covered / visSpan * 100);
                const meanDur = count > 0 ? sumDur / Math.max(1, clipped.filter(i => !i.isPoint).length) : 0;

                // Bar showing coverage as a filled progress bar.
                const yMid = t.y + t.height / 2;
                const barY = yMid - 4;
                const barW = Math.min(g.densityW - 8, 80);
                this.overlay.append("rect")
                    .attr("x", g.densityX).attr("y", barY)
                    .attr("width", barW).attr("height", 8)
                    .attr("fill", "#eee").attr("stroke", "none");
                this.overlay.append("rect")
                    .attr("x", g.densityX).attr("y", barY)
                    .attr("width", barW * covPct / 100).attr("height", 8)
                    .attr("fill", "#4682B4").attr("stroke", "none");

                // Text: coverage %, count, mean duration.
                this.overlay.append("text")
                    .attr("x", g.densityX + barW + 6).attr("y", yMid)
                    .attr("dominant-baseline", "middle")
                    .attr("font-size", `${Math.max(9, o.trackFs - 2)}px`)
                    .attr("fill", "#243b53").attr("font-weight", 600)
                    .text(`${covPct.toFixed(0)}%`);
                this.overlay.append("text")
                    .attr("x", g.densityX).attr("y", barY - 3)
                    .attr("font-size", `${Math.max(8, o.trackFs - 3)}px`)
                    .attr("fill", "#666")
                    .text(`${count} event${count === 1 ? "" : "s"}` + (meanDur > 0 ? `, mean ${this.fmtDuration(meanDur)}` : ""));
            }
        }

        // ── Concurrency ribbon ────────────────────────────────
        // A single strip above the tracks plotting how many intervals are
        // active at each moment, across all tracks. Sweep-line over
        // start/end events, sampled to the visible x pixels.
        if (o.showConcurrency && g.concurH > 0) {
            const pxN = Math.max(20, Math.round(g.right - g.left));
            const counts = new Float64Array(pxN);
            // Sample at each pixel: number of intervals whose window includes
            // the domain value at that pixel. Cheap for a few thousand
            // intervals; more than that would want a proper sweep.
            for (const it of this.intervals) {
                if (it.end == null) continue;   // point events skipped
                const finish = it.end;
                if (finish < visMin || it.start > visMax) continue;
                const x0 = Math.max(0, Math.floor(((it.start - visMin) / (visMax - visMin)) * pxN));
                const x1 = Math.min(pxN - 1, Math.floor(((finish - visMin) / (visMax - visMin)) * pxN));
                for (let i = x0; i <= x1; i++) counts[i]++;
            }
            let maxC = 1;
            for (let i = 0; i < pxN; i++) if (counts[i] > maxC) maxC = counts[i];
            // Draw as a filled path so 1000 pixels are one DOM node.
            const y0 = g.concurTop, y1 = g.concurTop + g.concurH;
            let d = `M ${g.left},${y1}`;
            for (let i = 0; i < pxN; i++) {
                const px = g.left + (i / (pxN - 1 || 1)) * (g.right - g.left);
                const yy = y1 - (counts[i] / maxC) * g.concurH;
                d += ` L ${px.toFixed(1)},${yy.toFixed(1)}`;
            }
            d += ` L ${g.right},${y1} Z`;
            this.overlay.append("rect")
                .attr("x", g.left).attr("y", y0)
                .attr("width", g.right - g.left).attr("height", g.concurH)
                .attr("fill", "#fafafa").attr("stroke", "#eee").attr("stroke-width", 0.5);
            this.overlay.append("path")
                .attr("d", d)
                .attr("fill", o.concurColor).attr("fill-opacity", 0.35)
                .attr("stroke", o.concurColor).attr("stroke-width", 1);
            this.overlay.append("text")
                .attr("x", g.left + 4).attr("y", y0 + 10)
                .attr("font-size", `${Math.max(8, o.axisFs - 2)}px`)
                .attr("fill", "#555").attr("font-weight", 600)
                .text(`concurrent · peak ${maxC}`);
            this.overlay.append("text")
                .attr("x", g.right - 4).attr("y", y0 + 10)
                .attr("text-anchor", "end")
                .attr("font-size", `${Math.max(8, o.axisFs - 2)}px`)
                .attr("fill", "#888")
                .text(`0-${maxC}`);
        }

        // Axis.
        if (o.showAxis) {
            const axisG = this.overlay.append("g")
                .attr("transform", `translate(0,${g.bottom + 4})`)
                .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor((g.right - g.left) / 90))).tickSize(4).tickPadding(4));
            axisG.select(".domain").attr("stroke", "#999");
            axisG.selectAll("text").attr("font-size", `${o.axisFs}px`).attr("fill", "#666");
        }

        // Hit layer for tooltips (added last so it sits on top).
        this.overlay.append("rect")
            .classed("hit", true)
            .attr("x", 0).attr("y", 0).attr("width", width).attr("height", height)
            .attr("fill", "transparent")
            .on("mousemove", (event: MouseEvent) => {
                const [px, py] = d3.pointer(event, this.svg.node());
                // Reverse scan so the most recently drawn (topmost) wins.
                for (let i = this.rendered.length - 1; i >= 0; i--) {
                    const r = this.rendered[i];
                    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
                        this.tooltipService.show({
                            dataItems: this.buildTooltip(r.d), identities: [],
                            coordinates: [px, py], isTouchEvent: false
                        });
                        return;
                    }
                }
                this.tooltipService.hide({ immediately: false, isTouchEvent: false });
            })
            .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }))
            .on("click", (event: MouseEvent) => {
                const [px, py] = d3.pointer(event, this.svg.node());
                for (let i = this.rendered.length - 1; i >= 0; i--) {
                    const r = this.rendered[i];
                    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
                        if (!r.d.selectionId) return;
                        event.stopPropagation();
                        const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                        this.selectionManager.select(r.d.selectionId, multi).then(() => this.applyExternalDim());
                        return;
                    }
                }
                this.selectionManager.clear().then(() => this.applyExternalDim());
            })
            .on("contextmenu", (event: MouseEvent) => {
                event.preventDefault();
                const [px, py] = d3.pointer(event, this.svg.node());
                for (let i = this.rendered.length - 1; i >= 0; i--) {
                    const r = this.rendered[i];
                    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
                        this.selectionManager.showContextMenu(r.d.selectionId ?? ({} as ISelectionId), { x: event.clientX, y: event.clientY });
                        return;
                    }
                }
            });
    }

    private fmtTime(v: number): string {
        return this.isDate ? new Date(v).toLocaleString() : numFmt(v);
    }

    private buildTooltip(d: Interval): VisualTooltipDataItem[] {
        const items: VisualTooltipDataItem[] = [{ displayName: this.titles.track, value: d.track }];
        if (d.label) items.push({ displayName: this.titles.label, value: d.label });
        if (d.category) items.push({ displayName: this.titles.category, value: d.category });
        items.push({ displayName: this.titles.start, value: this.fmtTime(d.start) });
        if (d.end != null) {
            items.push({ displayName: this.titles.end, value: this.fmtTime(d.end) });
            const ms = d.end - d.start;
            items.push({
                displayName: "Duration",
                value: this.isDate ? this.fmtDuration(ms) : numFmt(ms)
            });
        } else {
            items.push({ displayName: "Type", value: "Point event" });
        }
        if (d.value != null) items.push({ displayName: this.titles.value, value: numFmt(d.value) });
        return items;
    }

    private fmtDuration(ms: number): string {
        const s = ms / 1000;
        if (s < 60) return `${Math.round(s)} s`;
        const m = s / 60;
        if (m < 60) return `${m.toFixed(m < 10 ? 1 : 0)} min`;
        const h = m / 60;
        if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
        return `${(h / 24).toFixed(1)} d`;
    }

    private renderLandingPage(width: number, height: number, hasStart: boolean, hasTrack: boolean): void {
        this.landing.selectAll("*").remove();
        this.overlay.selectAll("*").remove();
        if (width < 160 || height < 110) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        // Mini track glyph: three lanes of bars plus a point event.
        const glyph = g.append("g").attr("transform", "translate(-92,-86)");
        const bars = [[0, 0, 46], [0, 54, 38], [1, 8, 70], [1, 96, 40], [2, 0, 30], [2, 40, 58], [2, 112, 26]];
        bars.forEach(([lane, x0, w]) => glyph.append("rect")
            .attr("x", x0).attr("y", lane * 18).attr("width", w).attr("height", 11).attr("rx", 3)
            .attr("fill", "#4682B4").attr("fill-opacity", 0.85));
        glyph.append("path").attr("d", "M 150 41 l 5 5 l -5 5 l -5 -5 z").attr("fill", "#E74C3C");

        g.append("text").attr("text-anchor", "middle").attr("y", -12)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px")
            .attr("font-weight", 600).attr("fill", "#333").text("Interval Track Viewer");

        const need = !hasStart ? "Add a Start field (date/time or numeric) to begin."
            : !hasTrack ? "Add a Track field to split intervals into lanes."
                : "Add Start, End and Track to begin.";
        g.append("text").attr("text-anchor", "middle").attr("y", 10)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666").text(need);
        g.append("text").attr("text-anchor", "middle").attr("y", 32)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
            .attr("fill", "#999").text("Rows with no End render as point events. Scroll to zoom the time axis.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
