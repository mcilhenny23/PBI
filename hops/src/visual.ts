"use strict";

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";

// ── Types ──────────────────────────────────────────────────────

interface Member {
    name: string;
    values: (number | null)[];   // one value per axis category
}

// ── Helpers ────────────────────────────────────────────────────

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

function getCurve(name: string): d3.CurveFactory {
    switch (name) {
        case "step": return d3.curveStepAfter;
        case "basis": return d3.curveBasis;
        case "monotone": return d3.curveMonotoneX;
        default: return d3.curveLinear;
    }
}

/** Deterministic PRNG so pre-generated frames are stable across re-renders. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: powerbi.extensibility.visual.IVisualHost;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;
    private outcomeLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private margin = { top: 16, right: 24, bottom: 36, left: 52 };

    // ── Animation state ──
    private rafId: number | null = null;
    private visibilityHandler: () => void;
    private hoverPaused = false;
    private docHidden = false;
    private pauseOnHoverEnabled = true;

    private memberPaths: string[] = [];      // one line-path string per ensemble member
    private frames: number[] = [];           // member index shown on each frame
    private currentFrame = 0;
    private trailHistory: number[] = [];      // recent member indices, newest first
    private lastAdvance = 0;
    private frameInterval = 250;              // ms between advances

    private outcomePath: d3.Selection<SVGPathElement, unknown, null, undefined> | null = null;
    private trailPaths: d3.Selection<SVGPathElement, unknown, null, undefined>[] = [];
    private trailBaseOpacity = 0.15;

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.formattingSettingsService = new FormattingSettingsService();

        this.svg = d3.select(options.element).append("svg").classed("hops", true);
        this.landing = this.svg.append("g").classed("hops-landing", true);
        this.container = this.svg.append("g").classed("hops-container", true);

        // Hover pause — set a flag the loop reads (never mutate DOM here).
        this.svg
            .on("mouseenter", () => { this.hoverPaused = true; })
            .on("mouseleave", () => { this.hoverPaused = false; });

        // Stop advancing when the tab/visual is hidden (saves CPU, avoids drift).
        this.visibilityHandler = () => { this.docHidden = document.hidden; };
        document.addEventListener("visibilitychange", this.visibilityHandler);
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const anim = this.formattingSettings.animationCard;
            const lines = this.formattingSettings.linesCard;
            const axes = this.formattingSettings.axesCard;

            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);

            const plotW = Math.max(0, width - this.margin.left - this.margin.right);
            const plotH = Math.max(0, height - this.margin.top - this.margin.bottom);
            this.container.attr("transform", `translate(${this.margin.left},${this.margin.top})`);

            // ── Data ───────────────────────────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const cat = dataView?.categorical;
            const axisCol = cat?.categories?.[0];
            const vals = cat?.values;
            const sampleIdx = vals ? findRoleIndices(vals, "samples") : [];
            const actualsIdx = vals ? findRoleIndices(vals, "actuals")[0] ?? -1 : -1;

            if (!axisCol?.values?.length || !vals?.length || (sampleIdx.length === 0 && actualsIdx < 0)) {
                this.stopLoop();
                this.container.selectAll("*").remove();
                this.renderLandingPage(width, height, !!axisCol?.values?.length, sampleIdx.length);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            const axisCats = axisCol.values.map(v => String(v));
            const axisTitle = axisCol.source.displayName || "Axis";

            const members: Member[] = sampleIdx.map(idx => ({
                name: vals[idx].source.displayName || "Draw",
                values: axisCats.map((_, i) => safeNum(vals[idx].values[i]))
            }));
            const actuals: (number | null)[] | null = actualsIdx >= 0
                ? axisCats.map((_, i) => safeNum(vals[actualsIdx].values[i]))
                : null;

            // ── Scales ─────────────────────────────────────────────
            const allValues: number[] = [];
            for (const m of members) for (const v of m.values) if (v != null) allValues.push(v);
            if (actuals) for (const v of actuals) if (v != null) allValues.push(v);
            if (allValues.length === 0) {
                this.stopLoop();
                this.container.selectAll("*").remove();
                this.events.renderingFinished(options);
                return;
            }

            const xScale = d3.scalePoint<string>().domain(axisCats).range([0, plotW]).padding(0.05);
            const yMin = d3.min(allValues)!, yMax = d3.max(allValues)!;
            const yPad = (yMax - yMin) * 0.06 || 1;
            const yScale = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).range([plotH, 0]).nice();

            const curve = getCurve(String(lines.curveType.value?.value ?? "monotone"));
            const lineGen = d3.line<{ cx: number; v: number | null }>()
                .defined(d => d.v != null)
                .x(d => d.cx)
                .y(d => yScale(d.v as number))
                .curve(curve);

            // Precompute a line-path string per member (cheap per-frame swaps later).
            this.memberPaths = members.map(m =>
                lineGen(axisCats.map((c, i) => ({ cx: xScale(c)!, v: m.values[i] }))) || "");

            // ── Static layer (redrawn each update) ─────────────────
            this.container.selectAll("*").remove();

            if (axes.showGridlines.value) {
                const grid = this.container.append("g").classed("gridlines", true);
                grid.selectAll("line").data(yScale.ticks(6)).enter().append("line")
                    .attr("x1", 0).attr("x2", plotW)
                    .attr("y1", d => yScale(d)).attr("y2", d => yScale(d))
                    .attr("stroke", "#e0e0e0").attr("stroke-width", 1)
                    .attr("shape-rendering", "crispEdges");
            }

            // Trail ghosts (created before outcome so they sit beneath it).
            const trailG = this.container.append("g").classed("trails", true);
            const showTrail = anim.showTrail.value;
            const trailCount = showTrail ? Math.max(1, Math.min(10, Math.round(anim.trailCount.value || 3))) : 0;
            this.trailBaseOpacity = Math.max(0, Math.min(1, anim.trailOpacity.value / 100));
            this.trailPaths = [];
            for (let k = 0; k < trailCount; k++) {
                this.trailPaths.push(
                    trailG.append("path")
                        .attr("fill", "none")
                        .attr("stroke", lines.outcomeColor.value.value)
                        .attr("stroke-width", lines.outcomeWidth.value)
                        .attr("stroke-linejoin", "round")
                        .attr("opacity", 0)
                );
            }

            // Actuals line (static).
            if (actuals) {
                const pts = axisCats.map((c, i) => ({ cx: xScale(c)!, v: actuals[i] }));
                if (pts.some(p => p.v != null)) {
                    this.container.append("path")
                        .datum(pts)
                        .attr("d", lineGen)
                        .attr("fill", "none")
                        .attr("stroke", lines.actualsColor.value.value)
                        .attr("stroke-width", lines.actualsWidth.value)
                        .attr("stroke-linejoin", "round");
                }
            }

            // Outcome line (persistent target the loop updates).
            this.outcomeLayer = this.container.append("g").classed("outcome", true);
            this.outcomePath = this.outcomeLayer.append("path")
                .attr("fill", "none")
                .attr("stroke", lines.outcomeColor.value.value)
                .attr("stroke-width", lines.outcomeWidth.value)
                .attr("stroke-linejoin", "round")
                .attr("stroke-linecap", "round");

            // Single axis point → also show a marker so the "jump" is visible.
            const singlePoint = axisCats.length === 1;

            // Axes.
            if (axes.showXAxis.value) {
                const g = this.container.append("g")
                    .attr("transform", `translate(0,${plotH})`)
                    .call(d3.axisBottom(xScale).tickSize(0).tickPadding(8));
                g.select(".domain").attr("stroke", "#999");
                g.selectAll("text").attr("font-size", `${axes.fontSize.value}px`).attr("fill", "#666");
                // Thin out labels on dense axes.
                const every = Math.ceil(axisCats.length / Math.max(1, Math.floor(plotW / 60)));
                if (every > 1) g.selectAll<SVGTextElement, string>("text").attr("opacity", (_, i) => i % every === 0 ? 1 : 0);
            }
            if (axes.showYAxis.value) {
                const g = this.container.append("g")
                    .call(d3.axisLeft(yScale).ticks(6).tickSize(0).tickPadding(6));
                g.select(".domain").attr("stroke", "#999");
                g.selectAll("text").attr("font-size", `${axes.fontSize.value}px`).attr("fill", "#666");
            }

            // ── Frames + loop ──────────────────────────────────────
            this.pauseOnHoverEnabled = anim.pauseOnHover.value;
            const frameCount = Math.max(1, Math.min(500, Math.round(anim.frameCount.value || 50)));
            const fps = Math.max(1, Math.min(15, anim.frameRate.value || 4));
            this.frameInterval = 1000 / fps;

            const memberCount = Math.max(1, members.length);
            const rand = mulberry32(1234567 + frameCount * 31 + memberCount);
            this.frames = Array.from({ length: frameCount }, () => Math.floor(rand() * memberCount));
            this.currentFrame = 0;
            this.trailHistory = [];

            // Paint the first frame immediately so nothing is blank pre-tick.
            if (this.memberPaths.length > 0) {
                this.outcomePath.attr("d", this.memberPaths[this.frames[0]] || this.memberPaths[0]);
            }

            // Marker for single-point mode (updated each frame via a small helper).
            if (singlePoint) {
                this.outcomeLayer.append("circle").classed("outcome-dot", true)
                    .attr("r", Math.max(3, lines.outcomeWidth.value + 2))
                    .attr("fill", lines.outcomeColor.value.value)
                    .attr("cx", xScale(axisCats[0])!)
                    .attr("cy", yScale(members[0]?.values[0] ?? yMin));
            }
            this.singlePointState = singlePoint ? { xScale, yScale, members, cat: axisCats[0] } : null;

            // Restart the loop cleanly (cancel any prior frame first).
            this.stopLoop();
            this.lastAdvance = 0;
            // Only animate when there's more than one distinct outcome to show.
            if (this.memberPaths.length > 1) {
                this.rafId = requestAnimationFrame(this.tick);
            }

            this.tooltip(axisTitle, members, actuals, axisCats, xScale, yScale);

            this.events.renderingFinished(options);
        } catch (error) {
            this.stopLoop();
            this.events.renderingFailed(options, String(error));
        }
    }

    private singlePointState: { xScale: d3.ScalePoint<string>; yScale: d3.ScaleLinear<number, number>; members: Member[]; cat: string } | null = null;

    /** rAF loop with a frame-rate limiter. Advances only when enough time passed. */
    private tick = (now: number) => {
        this.rafId = requestAnimationFrame(this.tick);

        const paused = this.docHidden || (this.pauseOnHoverEnabled && this.hoverPaused);
        if (paused) { this.lastAdvance = now; return; }   // hold; reset timer so no jump on resume

        if (this.lastAdvance === 0) this.lastAdvance = now;
        if (now - this.lastAdvance >= this.frameInterval) {
            this.lastAdvance = now;
            this.advanceFrame();
        }
    };

    private advanceFrame(): void {
        if (!this.frames.length || !this.memberPaths.length || !this.outcomePath) return;
        this.currentFrame = (this.currentFrame + 1) % this.frames.length;
        const idx = this.frames[this.currentFrame];

        this.outcomePath.attr("d", this.memberPaths[idx] || "");

        // Trail: newest-first history of member indices.
        if (this.trailPaths.length) {
            this.trailHistory.unshift(idx);
            this.trailHistory = this.trailHistory.slice(0, this.trailPaths.length + 1);
            this.trailPaths.forEach((p, k) => {
                const hidx = this.trailHistory[k + 1];
                if (hidx == null) { p.attr("opacity", 0); return; }
                p.attr("d", this.memberPaths[hidx] || "")
                    .attr("opacity", this.trailBaseOpacity * (1 - k / (this.trailPaths.length + 1)));
            });
        }

        // Single-point marker jump.
        if (this.singlePointState) {
            const st = this.singlePointState;
            const v = st.members[idx]?.values[0];
            if (v != null) this.outcomeLayer.select("circle.outcome-dot").attr("cy", st.yScale(v));
        }
    }

    private stopLoop(): void {
        if (this.rafId != null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    /** Hover tooltip: report every draw's value plus the actual at the hovered axis point. */
    private tooltip(
        axisTitle: string, members: Member[], actuals: (number | null)[] | null,
        axisCats: string[], xScale: d3.ScalePoint<string>, yScale: d3.ScaleLinear<number, number>
    ): void {
        const tooltipService = this.host.tooltipService;
        const fmt = d3.format(",.4~g");
        const plotH = yScale.range()[0];
        const step = axisCats.length > 1 ? (xScale.step()) : xScale.range()[1];
        const hit = this.container.append("g").classed("hover", true);
        hit.selectAll("rect").data(axisCats).enter().append("rect")
            .attr("x", d => (xScale(d)! - step / 2))
            .attr("y", 0).attr("width", Math.max(1, step)).attr("height", plotH)
            .attr("fill", "transparent")
            .on("mousemove", (event: MouseEvent, d: string) => {
                const i = axisCats.indexOf(d);
                const [px, py] = d3.pointer(event, this.svg.node());
                const items: powerbi.extensibility.VisualTooltipDataItem[] = [{ displayName: axisTitle, value: d }];
                if (actuals && actuals[i] != null) items.push({ displayName: "Actual", value: fmt(actuals[i] as number) });
                const vs = members.map(m => m.values[i]).filter((v): v is number => v != null);
                if (vs.length) {
                    items.push({ displayName: "Draws", value: `${vs.length}` });
                    items.push({ displayName: "Range", value: `${fmt(d3.min(vs)!)} – ${fmt(d3.max(vs)!)}` });
                    items.push({ displayName: "Mean", value: fmt(d3.mean(vs)!) });
                }
                tooltipService.show({ dataItems: items, identities: [], coordinates: [px, py], isTouchEvent: false });
            })
            .on("mouseleave", () => tooltipService.hide({ immediately: false, isTouchEvent: false }));
    }

    private renderLandingPage(width: number, height: number, hasAxis: boolean, sampleCount: number): void {
        this.landing.selectAll("*").remove();
        if (width < 140 || height < 100) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        // Small "spaghetti" glyph — a few faint lines and one bold one.
        const glyph = g.append("g").attr("transform", "translate(0,-78)");
        const paths = ["M-52 8 Q-18 -18 0 -4 Q22 8 52 -14", "M-52 -6 Q-16 12 2 2 Q26 -10 52 6", "M-52 0 Q-20 -8 0 6 Q24 16 52 -2"];
        paths.forEach((d, i) => glyph.append("path").attr("d", d).attr("fill", "none")
            .attr("stroke", "#4682B4").attr("stroke-width", i === 2 ? 2.4 : 1.4).attr("opacity", i === 2 ? 1 : 0.3));

        g.append("text").attr("text-anchor", "middle").attr("y", -14)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px")
            .attr("font-weight", 600).attr("fill", "#333").text("Hypothetical Outcome Plots");

        const msg = !hasAxis ? "Add an Axis (time / category) to begin."
            : sampleCount === 0 ? "Add Sample Draws (measures) to animate."
                : "Add more Sample Draws for a richer flicker.";
        g.append("text").attr("text-anchor", "middle").attr("y", 8)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666").text(msg);
        g.append("text").attr("text-anchor", "middle").attr("y", 30)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
            .attr("fill", "#999").text("Bind several ensemble measures (model runs / simulations); each frame shows one.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    /** Critical: stop the loop and detach listeners so nothing leaks. */
    public destroy(): void {
        this.stopLoop();
        if (this.visibilityHandler) {
            document.removeEventListener("visibilitychange", this.visibilityHandler);
        }
    }
}
