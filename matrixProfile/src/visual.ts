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
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";
import { stomp, findMotifs, findDiscords, MatrixProfileResult, MotifPair, Discord } from "./matrixProfile";

/**
 * STOMP is O(n²). Past this many points the wait stops being interactive, so
 * the series is truncated and the user is told.
 */
const MAX_POINTS = 10000;

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
    private host: powerbi.extensibility.visual.IVisualHost;
    private tooltipService: ITooltipService;

    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private margin = { top: 14, right: 16, bottom: 30, left: 48 };

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.formattingSettingsService = new FormattingSettingsService();

        this.svg = d3.select(options.element).append("svg").classed("mp-root", true);
        this.landing = this.svg.append("g").classed("mp-landing", true);
        this.container = this.svg.append("g").classed("mp-container", true);
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

            const m = Math.max(4, Math.round(P.windowLength.value || 50));
            if (n < m * 2) {
                this.renderMessage(width, height, "Series too short",
                    `Need at least ${m * 2} points for a window length of ${m}.`,
                    `This series has ${n}. Lower the window length or add more data.`);
                this.events.renderingFinished(options);
                return;
            }

            // ── Compute ────────────────────────────────────────────
            const exclusion = Math.max(1, Math.round(m * (P.exclusionZone.value ?? 50) / 100));
            const res: MatrixProfileResult | null = stomp(series, m, exclusion);
            if (!res) {
                this.renderMessage(width, height, "Cannot compute profile",
                    "Check the window length against the series length.", "");
                this.events.renderingFinished(options);
                return;
            }

            const motifs = findMotifs(res, Math.max(0, Math.round(P.motifCount.value ?? 3)), exclusion);
            const discords = findDiscords(res, Math.max(0, Math.round(P.discordCount.value ?? 3)), exclusion);

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

            // Panel label for the strip.
            this.container.append("text")
                .attr("x", plotL + 4).attr("y", profY + fs)
                .attr("font-size", `${Math.max(9, fs - 1)}px`).attr("fill", "#888")
                .text("matrix profile");

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
        const spanOf = (i: number): string | null => {
            for (const mo of motifs) {
                if (i >= mo.a && i < mo.a + m) return `Motif (pairs with ${labels[mo.b] ?? mo.b})`;
                if (mo.b >= 0 && i >= mo.b && i < mo.b + m) return `Motif (pairs with ${labels[mo.a] ?? mo.a})`;
            }
            for (const di of discords) {
                if (i >= di.index && i < di.index + m) return "Discord (anomaly)";
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
