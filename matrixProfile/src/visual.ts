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
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";
import {
    stomp, findMotifs, findDiscords, panMatrixProfile, candidateLengths,
    MatrixProfileResult, MotifPair, Discord, PanProfile
} from "./matrixProfile";
import { Fingerprint, ComputeCache } from "./computeCache";

/**
 * STOMP is O(n²). Past this many points the wait stops being interactive, so
 * the series is truncated and the user is told.
 */
const MAX_POINTS = 10000;

/**
 * Multi-length costs O(lengths x n^2), so the series is capped harder there than
 * in fixed mode to keep a scan interactive.
 */
const MAX_MULTI_POINTS = 3000;

// ── Helpers ────────────────────────────────────────────────────

function findValueIndex(values: powerbi.DataViewValueColumns, roleName: string): number {
    for (let i = 0; i < values.length; i++) {
        if (values[i].source.roles && values[i].source.roles[roleName]) return i;
    }
    return -1;
}

function safeNum(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

const numFmt = d3.format(",.4~g");

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private tooltipService: ITooltipService;
    private selectionManager: ISelectionManager;

    private root: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private canvas: d3.Selection<HTMLCanvasElement, unknown, null, undefined>;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private margin = { top: 14, right: 16, bottom: 30, left: 48 };

    /** Caches the O(n²) profile so styling changes don't recompute it. */
    private profileCache = new ComputeCache<MatrixProfileResult>();

    /** Caches the multi-length scan, which is O(lengths x n^2). */
    private panCache = new ComputeCache<PanProfile>();

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applyExternalDim());

        this.root = d3.select(options.element).append("div").classed("mp-wrap", true);
        this.canvas = this.root.append("canvas").classed("mp-canvas", true);
        this.svg = this.root.append("svg").classed("mp-root", true);
        this.landing = this.svg.append("g").classed("mp-landing", true);
        this.container = this.svg.append("g").classed("mp-container", true);

        // Also accept clicks on the tooltip hit rect (transparent, full-plot) —
        // it sits over the whole visual and would otherwise swallow every
        // background click before this guard could fire.
        this.svg.on("click.clear", (event: MouseEvent) => {
            const t = event.target as Element | null;
            if (t === this.svg.node() || (t && t.classList?.contains("hit"))) {
                this.selectionManager.clear().then(() => this.applyExternalDim());
            }
        });
    }

    private applyExternalDim(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.1, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 30) / 100));
        const hasSel = this.selectionManager.getSelectionIds().length > 0;
        this.canvas.style("opacity", hasSel ? String(dim) : "1");
        this.container.attr("opacity", hasSel ? dim : 1);
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const P = this.formattingSettings.profileCard;
            const D = this.formattingSettings.displayCard;
            const A = this.formattingSettings.axisCard;

            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);
            this.container.selectAll("*").remove();
            // Clear the heatmap underlay every pass; it is only redrawn in
            // multi-length mode, and a stale image must never show through.
            {
                const cvNode = this.canvas.node();
                if (cvNode) {
                    const dpr0 = window.devicePixelRatio || 1;
                    cvNode.width = Math.max(1, Math.floor(width * dpr0));
                    cvNode.height = Math.max(1, Math.floor(height * dpr0));
                    this.canvas.style("width", `${width}px`).style("height", `${height}px`);
                    cvNode.getContext("2d")?.clearRect(0, 0, width, height);
                }
            }

            // ── Data ───────────────────────────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const cat = dataView?.categorical;
            const vals = cat?.values;
            const vIdx = vals ? findValueIndex(vals, "value") : -1;
            const labels = cat?.categories?.[0]?.values;

            if (vIdx < 0 || !vals?.length) {
                this.renderMessage(width, height, "Matrix Profile",
                    "Add a Value measure to begin.",
                    "Add a Time / Index (Don't summarize) so every point arrives as a row.");
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            const raw: number[] = [];
            const rawLabels: string[] = [];
            const src = vals[vIdx].values;
            for (let i = 0; i < src.length; i++) {
                const n = safeNum(src[i]);
                if (n == null) continue;
                raw.push(n);
                rawLabels.push(labels ? String(labels[i]) : String(i));
            }

            const truncated = raw.length > MAX_POINTS;
            const series = Float64Array.from(truncated ? raw.slice(0, MAX_POINTS) : raw);
            const seriesLabels = truncated ? rawLabels.slice(0, MAX_POINTS) : rawLabels;
            const n = series.length;

            let m = Math.max(4, Math.round(P.windowLength.value || 50));
            if (n < m * 2) {
                this.renderMessage(width, height, "Series too short",
                    `Need at least ${m * 2} points for a window length of ${m}.`,
                    `This series has ${n}. Lower the window length or add more data.`);
                this.events.renderingFinished(options);
                return;
            }

            // ── Compute (cached) ───────────────────────────────────
            // STOMP is O(n²) — the single most expensive thing in the visual.
            // It depends only on the series, the window length and the exclusion
            // zone, so recolouring or resizing must never trigger it. Motif and
            // discord extraction stays outside the cache: it is O(n) and lets
            // the highlight mode respond instantly.
            const exclusionPct = P.exclusionZone.value ?? 50;
            const multiLength = String(P.windowMode.value?.value ?? "fixed") === "multi";

            // Multi-length scans every candidate m, so it costs O(lengths · n²).
            // The series is capped harder here than in fixed mode to keep that
            // product interactive.
            let pan: PanProfile | null = null;
            if (multiLength) {
                const scanSeries = series.length > MAX_MULTI_POINTS
                    ? series.slice(0, MAX_MULTI_POINTS)
                    : series;
                const lengths = candidateLengths(
                    scanSeries.length,
                    Math.max(2, Math.round(P.lengthSteps.value ?? 12)),
                    P.minWindow.value, P.maxWindow.value
                );
                const panKey = new Fingerprint()
                    .nums(scanSeries).nums(lengths).num(exclusionPct).done();
                pan = this.panCache.get(panKey,
                    () => panMatrixProfile(scanSeries, lengths, exclusionPct));
                // Highlights come from the suggested length, so the user sees the
                // findings at the scale the scan actually recommends.
                if (pan) m = pan.suggestedMotifLength;
            }

            const exclusion = Math.max(1, Math.round(m * exclusionPct / 100));
            const key = new Fingerprint()
                .nums(series)
                .num(m)
                .num(exclusion)
                .done();
            const res: MatrixProfileResult | null = multiLength && pan
                ? (pan.scans.find(sc => sc.m === m)?.result ?? null)
                : this.profileCache.get(key, () => stomp(series, m, exclusion));
            if (!res) {
                this.renderMessage(width, height, "Cannot compute profile",
                    "Check the window length against the series length.", "");
                this.events.renderingFinished(options);
                return;
            }

            // ── Focus + salience gate ──────────────────────────────
            // Most series support motifs OR discords, not both: a repetitive
            // series makes anomalies obvious but every "motif" trivial, and an
            // aperiodic one makes a planted repeat obvious but every "discord"
            // just the top of a continuum. In Auto the salience gate decides per
            // dataset, so the visual stops asserting findings that aren't there.
            const mode = String(P.highlightMode.value?.value ?? "auto");
            const auto = mode === "auto";
            const gate = auto ? Math.max(0, P.minSalience.value ?? 1) : 0;
            const wantMotifs = auto || mode === "motifs" || mode === "both";
            const wantDiscords = auto || mode === "discords" || mode === "both";

            const motifs = wantMotifs
                ? findMotifs(res, Math.max(0, Math.round(P.motifCount.value ?? 3)), exclusion, gate)
                : [];
            const discords = wantDiscords
                ? findDiscords(res, Math.max(0, Math.round(P.discordCount.value ?? 3)), exclusion, gate)
                : [];

            // ── Layout ─────────────────────────────────────────────
            const fs = Math.max(6, A.fontSize.value);
            const plotL = this.margin.left;
            const plotW = Math.max(10, width - this.margin.left - this.margin.right);
            const noteH = truncated ? fs + 8 : 0;
            const totalH = Math.max(20, height - this.margin.top - this.margin.bottom - noteH);
            const profFrac = Math.max(10, Math.min(70, D.profileHeight.value ?? 30)) / 100;
            const gap = 10;
            const profH = Math.max(16, totalH * profFrac - gap);
            const serH = Math.max(20, totalH - profH - gap);
            const serY = this.margin.top + noteH;
            const profY = serY + serH + gap;

            if (plotW < 30 || serH < 20) { this.events.renderingFinished(options); return; }

            // ── Scales ─────────────────────────────────────────────
            const x = d3.scaleLinear().domain([0, n - 1]).range([plotL, plotL + plotW]);
            const yMin = d3.min(series as unknown as number[])!;
            const yMax = d3.max(series as unknown as number[])!;
            const yPad = (yMax - yMin) * 0.06 || 1;
            const y = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).range([serY + serH, serY]);

            const finiteMp = Array.from(res.mp).filter(Number.isFinite);
            const mpMax = finiteMp.length ? d3.max(finiteMp)! : 1;
            const yp = d3.scaleLinear().domain([0, mpMax || 1]).range([profY + profH, profY]);

            const opacity = Math.max(0, Math.min(1, (D.highlightOpacity.value ?? 30) / 100));
            const motifColor = D.motifColor.value.value;
            const discordColor = D.discordColor.value.value;

            // ── Truncation notice ──────────────────────────────────
            if (truncated) {
                this.container.append("text")
                    .attr("x", plotL).attr("y", this.margin.top + fs)
                    .attr("font-size", `${fs}px`).attr("fill", "#b26a00")
                    .text(`Showing first ${MAX_POINTS.toLocaleString()} of ${raw.length.toLocaleString()} points — matrix profile is O(n²).`);
            }

            // ── Status note ────────────────────────────────────────
            // Silence would read as "broken", so say what was suppressed and why.
            const statusParts: string[] = [];
            if (multiLength && pan) {
                statusParts.push(
                    `Scanned ${pan.lengths.length} lengths (${pan.lengths[0]}-${pan.lengths[pan.lengths.length - 1]}) · ` +
                    `suggested m=${pan.suggestedMotifLength} for motifs, m=${pan.suggestedDiscordLength} for discords`);
                if (series.length > MAX_MULTI_POINTS) {
                    statusParts.push(`scan used the first ${MAX_MULTI_POINTS.toLocaleString()} points`);
                }
            }
            if (auto) {
                if (motifs.length === 0 && discords.length === 0) {
                    statusParts.push("No motif or discord stands out above the salience threshold — this series may have no strong repeated pattern or anomaly");
                } else if (motifs.length === 0) {
                    statusParts.push("Discords only: no repeated pattern stands out");
                } else if (discords.length === 0) {
                    statusParts.push("Motifs only: no anomaly stands out from the background");
                }
            }
            if (res.lowVarianceCount > 0) {
                statusParts.push(`${res.lowVarianceCount.toLocaleString()} near-flat window(s) excluded from anomalies (z-normalization amplifies noise there)`);
            }
            if (statusParts.length) {
                this.container.append("text")
                    .attr("x", plotL).attr("y", this.margin.top + (truncated ? fs * 2 + 4 : fs))
                    .attr("font-size", `${Math.max(9, fs - 1)}px`).attr("fill", "#8a8a8a")
                    .text(statusParts.join("  ·  "));
            }

            // ── Highlight spans (drawn under the series line) ──────
            const spans = this.container.append("g").classed("spans", true);
            const addSpan = (start: number, color: string) => {
                const x0 = x(start), x1 = x(Math.min(n - 1, start + m));
                spans.append("rect")
                    .attr("x", x0).attr("y", serY)
                    .attr("width", Math.max(1, x1 - x0)).attr("height", serH)
                    .attr("fill", color).attr("fill-opacity", opacity);
            };
            for (const mo of motifs) {
                addSpan(mo.a, motifColor);
                if (mo.b >= 0) addSpan(mo.b, motifColor);
            }
            for (const di of discords) addSpan(di.index, discordColor);

            // ── Motif connector arcs ───────────────────────────────
            if (D.showMotifConnectors.value) {
                const arcs = this.container.append("g").classed("arcs", true);
                for (const mo of motifs) {
                    if (mo.b < 0) continue;
                    const ax = x(mo.a + m / 2), bx = x(mo.b + m / 2);
                    // Anchor near the panel floor and arc upward. Both the base
                    // and the lift are expressed as fractions of the panel so the
                    // apex can never escape above it and get clipped.
                    const baseY = serY + serH * 0.88;
                    const lift = Math.min(serH * 0.76, Math.abs(bx - ax) * 0.22 + 12);
                    arcs.append("path")
                        .attr("d", `M ${ax} ${baseY} Q ${(ax + bx) / 2} ${baseY - lift} ${bx} ${baseY}`)
                        .attr("fill", "none")
                        .attr("stroke", motifColor)
                        .attr("stroke-width", 1.4)
                        .attr("stroke-opacity", 0.85)
                        .attr("stroke-dasharray", "4 3");
                }
            }

            // ── Series line ────────────────────────────────────────
            const line = d3.line<number>()
                .x((_, i) => x(i))
                .y(d => y(d))
                .curve(d3.curveLinear);
            this.container.append("path")
                .datum(Array.from(series))
                .attr("d", line)
                .attr("fill", "none")
                .attr("stroke", D.seriesColor.value.value)
                .attr("stroke-width", n > 2000 ? 0.8 : 1.4)
                .attr("stroke-linejoin", "round");

            // ── Profile strip ──────────────────────────────────────
            // Multi-length replaces the 1-D strip with a pan heatmap: X is
            // position, Y is window length, colour is the normalized distance.
            // Dark valleys are motifs, bright ridges are discords, and reading
            // *up* a column shows at which scales a pattern exists at all —
            // which is the actual answer to "what should m be?".
            if (multiLength && pan) {
                // The scan is capped at MAX_MULTI_POINTS so the heatmap covers only the
                // scanned prefix — stretching it across the full plotW would make column
                // positions disagree with the series line and motif markers above.
                const heatX = x(0);
                const heatW = Math.max(0, x(pan.n - 1) - x(0));
                this.renderPanHeatmap(pan, heatX, profY, heatW, profH, m, width, height);
            } else {
            const profArea = d3.area<number>()
                .defined(d => Number.isFinite(d))
                .x((_, i) => x(i))
                .y0(profY + profH)
                .y1(d => yp(d));
            this.container.append("path")
                .datum(Array.from(res.mp))
                .attr("d", profArea)
                .attr("fill", D.profileColor.value.value)
                .attr("fill-opacity", 0.45)
                .attr("stroke", D.profileColor.value.value)
                .attr("stroke-width", 0.8);

            // Mark motif minima / discord maxima on the profile too.
            const marks = this.container.append("g").classed("marks", true);
            for (const mo of motifs) {
                if (!Number.isFinite(res.mp[mo.a])) continue;
                marks.append("circle")
                    .attr("cx", x(mo.a)).attr("cy", yp(res.mp[mo.a])).attr("r", 3)
                    .attr("fill", motifColor).attr("stroke", "#fff").attr("stroke-width", 1);
            }
            for (const di of discords) {
                if (!Number.isFinite(res.mp[di.index])) continue;
                marks.append("circle")
                    .attr("cx", x(di.index)).attr("cy", yp(res.mp[di.index])).attr("r", 3)
                    .attr("fill", discordColor).attr("stroke", "#fff").attr("stroke-width", 1);
            }

            }   // end of single-length profile strip

            // Panel label for the strip.
            this.container.append("text")
                .attr("x", plotL + 4).attr("y", profY + fs)
                .attr("font-size", `${Math.max(9, fs - 1)}px`)
                .attr("fill", multiLength && pan ? "#fff" : "#888")
                .attr("paint-order", "stroke")
                .attr("stroke", multiLength && pan ? "rgba(0,0,0,0.45)" : "none")
                .attr("stroke-width", multiLength && pan ? 2 : 0)
                .text(multiLength && pan
                    ? `pan matrix profile · ${pan.lengths.length} lengths`
                    : "matrix profile");

            // ── Axes ───────────────────────────────────────────────
            if (A.showAxis.value) {
                const ticks = x.ticks(Math.max(2, Math.floor(plotW / 90)));
                const axisG = this.container.append("g")
                    .attr("transform", `translate(0,${profY + profH})`)
                    .call(d3.axisBottom(x)
                        .tickValues(ticks)
                        .tickFormat((d) => {
                            const i = Math.round(Number(d));
                            return i >= 0 && i < seriesLabels.length ? seriesLabels[i] : String(i);
                        })
                        .tickSize(4).tickPadding(3));
                axisG.select(".domain").attr("stroke", "#999");
                axisG.selectAll("text").attr("font-size", `${fs}px`).attr("fill", "#666");

                const yAxis = this.container.append("g")
                    .attr("transform", `translate(${plotL},0)`)
                    .call(d3.axisLeft(y).ticks(Math.max(2, Math.floor(serH / 34))).tickSize(3).tickPadding(3));
                yAxis.select(".domain").attr("stroke", "#999");
                yAxis.selectAll("text").attr("font-size", `${fs}px`).attr("fill", "#666");
            }

            // ── Hover ──────────────────────────────────────────────
            this.attachTooltip(width, height, plotL, plotW, n, x, series, res, seriesLabels, m, motifs, discords);

            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private attachTooltip(
        width: number, height: number, plotL: number, plotW: number, n: number,
        x: d3.ScaleLinear<number, number>, series: Float64Array,
        res: MatrixProfileResult, labels: string[], m: number,
        motifs: MotifPair[], discords: Discord[]
    ): void {
        // Precompute which indices are inside a highlighted span.
        const salFmt = d3.format(",.2~f");
        const spanOf = (i: number): string | null => {
            for (const mo of motifs) {
                const s = `  ·  salience ${salFmt(mo.salience)}σ`;
                if (i >= mo.a && i < mo.a + m) return `Motif (pairs with ${labels[mo.b] ?? mo.b})${s}`;
                if (mo.b >= 0 && i >= mo.b && i < mo.b + m) return `Motif (pairs with ${labels[mo.a] ?? mo.a})${s}`;
            }
            for (const di of discords) {
                if (i >= di.index && i < di.index + m) {
                    return `Discord (anomaly)  ·  salience ${salFmt(di.salience)}σ`;
                }
            }
            return null;
        };

        this.container.append("rect")
            .classed("hit", true)
            .attr("x", 0).attr("y", 0).attr("width", width).attr("height", height)
            .attr("fill", "transparent")
            .on("mousemove", (event: MouseEvent) => {
                const [px, py] = d3.pointer(event, this.svg.node());
                if (px < plotL || px > plotL + plotW) {
                    this.tooltipService.hide({ immediately: false, isTouchEvent: false });
                    return;
                }
                const i = Math.max(0, Math.min(n - 1, Math.round(x.invert(px))));
                const items: VisualTooltipDataItem[] = [
                    { displayName: "Index", value: labels[i] ?? String(i) },
                    { displayName: "Value", value: numFmt(series[i]) }
                ];
                if (i < res.length && Number.isFinite(res.mp[i])) {
                    items.push({ displayName: "Profile distance", value: numFmt(res.mp[i]) });
                    if (res.mpi[i] >= 0) {
                        items.push({ displayName: "Nearest match at", value: labels[res.mpi[i]] ?? String(res.mpi[i]) });
                    }
                }
                const tag = spanOf(i);
                if (tag) items.push({ displayName: "Region", value: tag });
                this.tooltipService.show({
                    dataItems: items, identities: [],
                    coordinates: [px, py], isTouchEvent: false
                });
            })
            .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));
    }

    /**
     * Pan matrix profile heatmap: X = position, Y = window length (short at the
     * bottom), colour = normalized distance. Drawn on the canvas underlay via an
     * offscreen image because the grid is lengths × n cells — far too many for
     * SVG rects.
     */
    private renderPanHeatmap(
        pan: PanProfile, x0: number, y0: number, w: number, h: number,
        selectedM: number, width: number, height: number
    ): void {
        const dpr = window.devicePixelRatio || 1;
        const cv = this.canvas.node()!;
        cv.width = Math.max(1, Math.floor(width * dpr));
        cv.height = Math.max(1, Math.floor(height * dpr));
        this.canvas.style("width", `${width}px`).style("height", `${height}px`);
        const ctx = cv.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const rows = pan.lengths.length, cols = pan.n;
        if (rows === 0 || cols === 0 || w <= 0 || h <= 0) return;

        const off = document.createElement("canvas");
        off.width = cols; off.height = rows;
        const octx = off.getContext("2d")!;
        const img = octx.createImageData(cols, rows);
        const px = img.data;

        // Viridis, low distance to dark: a window with a close match sinks into
        // the background, one with no match anywhere glows yellow. Same reading
        // as the 1-D strip, where motifs are dips and discords are peaks.
        for (let r = 0; r < rows; r++) {
            const srcRow = rows - 1 - r;              // shortest length at the bottom
            const base = srcRow * cols;
            for (let c = 0; c < cols; c++) {
                const v = pan.grid[base + c];
                const o = (r * cols + c) * 4;
                if (!Number.isFinite(v)) {
                    // Past n - m: no window starts here. Left fully transparent
                    // so it reads as absence on whatever background is behind,
                    // rather than as a pale colour in the ramp.
                    px[o + 3] = 0;
                    continue;
                }
                const t = Math.max(0, Math.min(1, v));
                const rgb = d3.color(d3.interpolateViridis(t))!.rgb();
                px[o] = rgb.r; px[o + 1] = rgb.g; px[o + 2] = rgb.b; px[o + 3] = 255;
            }
        }
        octx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, cols, rows, x0, y0, w, h);

        // Marker for the length whose findings are being highlighted above.
        const idx = pan.lengths.indexOf(selectedM);
        if (idx >= 0) {
            const rowH = h / rows;
            const yy = y0 + h - (idx + 1) * rowH + rowH / 2;
            this.container.append("line")
                .attr("x1", x0).attr("x2", x0 + w).attr("y1", yy).attr("y2", yy)
                .attr("stroke", "#fff").attr("stroke-width", 1.2)
                .attr("stroke-dasharray", "4 3").attr("opacity", 0.9);
            this.container.append("text")
                .attr("x", x0 - 4).attr("y", yy)
                .attr("text-anchor", "end").attr("dominant-baseline", "middle")
                .attr("font-size", "9px").attr("fill", "#555")
                .text(`m=${selectedM}`);
        }

        // Length axis: label the extremes so the vertical scale is readable.
        this.container.append("text")
            .attr("x", x0 - 4).attr("y", y0 + h)
            .attr("text-anchor", "end").attr("dominant-baseline", "middle")
            .attr("font-size", "9px").attr("fill", "#999")
            .text(String(pan.lengths[0]));
        this.container.append("text")
            .attr("x", x0 - 4).attr("y", y0 + 4)
            .attr("text-anchor", "end").attr("dominant-baseline", "middle")
            .attr("font-size", "9px").attr("fill", "#999")
            .text(String(pan.lengths[pan.lengths.length - 1]));
    }

    private renderMessage(width: number, height: number, title: string, line1: string, line2: string): void {
        this.landing.selectAll("*").remove();
        this.container.selectAll("*").remove();
        if (width < 150 || height < 110) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        // Glyph: a squiggle with two matched spans and one odd one out.
        const glyph = g.append("g").attr("transform", "translate(-95,-86)");
        const pts: string[] = [];
        for (let i = 0; i <= 190; i += 2) {
            const v = 16 + Math.sin(i / 9) * 9 + (i > 88 && i < 108 ? -14 : 0);
            pts.push(`${i},${v}`);
        }
        glyph.append("rect").attr("x", 20).attr("y", 0).attr("width", 26).attr("height", 34)
            .attr("fill", "#2ca02c").attr("fill-opacity", 0.28);
        glyph.append("rect").attr("x", 140).attr("y", 0).attr("width", 26).attr("height", 34)
            .attr("fill", "#2ca02c").attr("fill-opacity", 0.28);
        glyph.append("rect").attr("x", 88).attr("y", 0).attr("width", 22).attr("height", 34)
            .attr("fill", "#d62728").attr("fill-opacity", 0.28);
        glyph.append("polyline").attr("points", pts.join(" "))
            .attr("fill", "none").attr("stroke", "#1f77b4").attr("stroke-width", 1.6);

        g.append("text").attr("text-anchor", "middle").attr("y", -14)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px")
            .attr("font-weight", 600).attr("fill", "#333").text(title);
        g.append("text").attr("text-anchor", "middle").attr("y", 8)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666").text(line1);
        if (line2) {
            g.append("text").attr("text-anchor", "middle").attr("y", 30)
                .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
                .attr("fill", "#999").text(line2);
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
