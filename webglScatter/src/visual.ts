"use strict";

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";
import { hexbin as d3hexbin } from "d3-hexbin";
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
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;

import { VisualFormattingSettingsModel } from "./settings";

// ── Types ──────────────────────────────────────────────────────

interface DataPoint {
    x: number;
    y: number;
    colorId: number;   // index into categoryLabels
    size: number | null;
    label: string | null;
    selectionId?: ISelectionId;
    highlighted?: boolean;    // present when another visual is cross-filtering this one
}

interface RenderPalette {
    highContrast: boolean;
    axisLine: string;
    axisText: string;
    background: string;
    labelText: string;
    badgeBg: string;
    badgeFg: string;
    landingText: string;
    landingSub: string;
    fallback: string;
}

// Color ramps as arrays of [r,g,b] tuples (0-255) sampled at ~11 stops.
const RAMPS: Record<string, [number, number, number][]> = {
    viridis: [[68,1,84],[71,44,122],[59,81,139],[44,113,142],[33,144,141],[39,173,129],[92,200,99],[170,220,50],[253,231,37],[253,231,37],[253,231,37]],
    inferno: [[0,0,4],[40,11,84],[101,21,110],[159,42,99],[212,72,66],[245,125,21],[250,193,39],[252,255,164],[252,255,164],[252,255,164],[252,255,164]],
    blues:   [[247,251,255],[222,235,247],[198,219,239],[158,202,225],[107,174,214],[66,146,198],[33,113,181],[8,81,156],[8,48,107],[8,48,107],[8,48,107]],
    turbo:   [[48,18,59],[71,68,181],[36,144,220],[27,207,180],[139,241,86],[228,236,49],[253,175,38],[241,80,29],[177,20,4],[122,4,3],[122,4,3]]
};

function sampleRamp(name: string, t: number): [number, number, number] {
    const r = RAMPS[name] || RAMPS.viridis;
    const idx = Math.max(0, Math.min(r.length - 1, t * (r.length - 1)));
    const lo = Math.floor(idx), hi = Math.min(r.length - 1, lo + 1);
    const f = idx - lo;
    return [
        r[lo][0] + (r[hi][0] - r[lo][0]) * f,
        r[lo][1] + (r[hi][1] - r[lo][1]) * f,
        r[lo][2] + (r[hi][2] - r[lo][2]) * f
    ];
}

const CAT_PALETTE = d3.schemeTableau10 as unknown as string[];

// ── Helpers ────────────────────────────────────────────────────

function safeNum(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function findCategoryIndex(cats: powerbi.DataViewCategoryColumn[] | undefined, role: string): number {
    if (!cats) return -1;
    for (let i = 0; i < cats.length; i++) if (cats[i].source.roles && cats[i].source.roles[role]) return i;
    return -1;
}
function findValueIndex(values: powerbi.DataViewValueColumns, role: string): number {
    for (let i = 0; i < values.length; i++) if (values[i].source.roles && values[i].source.roles[role]) return i;
    return -1;
}
function luminance(hex: string): number {
    const c = d3.color(hex)?.rgb();
    if (!c) return 1;
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

// ── Minimal WebGL2 point renderer ──────────────────────────────
// One buffer of xy pairs, one of color ids. Shader is a pair of inline
// template strings (no dynamic generation — cert-safe).

const VERT_SRC = `#version 300 es
precision highp float;
in vec2 a_position;
in float a_color;
in float a_highlight;      // 1.0 = highlighted / no external filter, 0.0 = dimmed by another visual
uniform vec2 u_scale;
uniform vec2 u_offset;
uniform float u_pointSize;
uniform float u_dpr;
uniform vec4 u_brushRect;  // x0, y0, x1, y1 in data coords (only when u_brushActive > 0.5)
uniform float u_brushActive;
uniform float u_dimAlpha;  // scale factor for non-highlighted / non-brushed points (0..1)
flat out int v_color;
out float v_alphaScale;
void main() {
    vec2 clip = (a_position * u_scale + u_offset) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    gl_PointSize = u_pointSize * u_dpr;
    v_color = int(a_color);

    // Combine external-highlight dimming with brush dimming (both scale the fragment alpha).
    float highlightScale = mix(u_dimAlpha, 1.0, a_highlight);
    float brushScale = 1.0;
    if (u_brushActive > 0.5) {
        float inside = step(u_brushRect.x, a_position.x) *
                       step(a_position.x, u_brushRect.z) *
                       step(u_brushRect.y, a_position.y) *
                       step(a_position.y, u_brushRect.w);
        brushScale = mix(u_dimAlpha, 1.0, inside);
    }
    v_alphaScale = highlightScale * brushScale;
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
flat in int v_color;
in float v_alphaScale;
uniform vec3 u_palette[16];
uniform float u_alpha;
out vec4 outColor;
void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float r = dot(p, p);
    if (r > 0.25) discard;
    vec3 col = u_palette[v_color];
    outColor = vec4(col, u_alpha * v_alphaScale);
}`;

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private tooltipService: ITooltipService;
    private colorPalette: ISandboxExtendedColorPalette;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private root: HTMLDivElement;
    private container: HTMLDivElement;
    private glCanvas: HTMLCanvasElement;
    private densityCanvas: HTMLCanvasElement;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;
    private overlay: d3.Selection<SVGGElement, unknown, null, undefined>;
    private axesG: d3.Selection<SVGGElement, unknown, null, undefined>;
    private hexG: d3.Selection<SVGGElement, unknown, null, undefined>;

    // WebGL bits
    private gl: WebGL2RenderingContext | null = null;
    private glProg: WebGLProgram | null = null;
    private posBuf: WebGLBuffer | null = null;
    private colBuf: WebGLBuffer | null = null;
    private hlBuf: WebGLBuffer | null = null;
    private glReady = false;
    private webglBlocked = false;

    // Selection
    private selectionManager: ISelectionManager;
    private brushG: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
    private brushRect: [number, number, number, number] | null = null;  // x0, y0, x1, y1 in DATA coords
    private brushCountChip: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

    // State
    private data: DataPoint[] = [];
    private categoryLabels: string[] = [];
    private quadtree: d3.Quadtree<DataPoint> | null = null;
    private moreDataInFlight = false;

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.colorPalette = options.host.colorPalette;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => {
            if (this.glReady) this.redrawWebGL();
        });

        this.root = options.element as HTMLDivElement;
        this.container = document.createElement("div");
        this.container.className = "wgs-container";
        this.container.style.position = "relative";
        this.container.style.width = "100%";
        this.container.style.height = "100%";
        this.root.appendChild(this.container);

        // Layers stacked: density canvas (bg) → gl canvas (points) → svg (axes + overlay)
        this.densityCanvas = document.createElement("canvas");
        this.densityCanvas.className = "wgs-density";
        Object.assign(this.densityCanvas.style, { position: "absolute", left: "0", top: "0", pointerEvents: "none" });
        this.container.appendChild(this.densityCanvas);

        this.glCanvas = document.createElement("canvas");
        this.glCanvas.className = "wgs-gl";
        Object.assign(this.glCanvas.style, { position: "absolute", left: "0", top: "0", pointerEvents: "none" });
        this.container.appendChild(this.glCanvas);

        const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        this.container.appendChild(svgEl);
        this.svg = d3.select(svgEl).classed("wgs-svg", true)
            .attr("tabindex", 0).attr("role", "img").attr("aria-label", "WebGL scatter plot")
            .style("position", "absolute").style("left", "0").style("top", "0");

        this.hexG = this.svg.append("g").classed("wgs-hex", true);
        this.axesG = this.svg.append("g").classed("wgs-axes", true);
        this.overlay = this.svg.append("g").classed("wgs-overlay", true);
        this.landing = this.svg.append("g").classed("wgs-landing", true);

        this.initGL();

        // Handle WebGL context loss: rebuild buffers on restore, fall back otherwise.
        this.glCanvas.addEventListener("webglcontextlost", (e: Event) => {
            e.preventDefault();
            this.glReady = false;
        }, false);
        this.glCanvas.addEventListener("webglcontextrestored", () => {
            this.initGL();
            this.uploadBuffers();
        }, false);
    }

    private initGL(): void {
        try {
            const gl = this.glCanvas.getContext("webgl2", { antialias: true, premultipliedAlpha: false });
            if (!gl) { this.webglBlocked = true; return; }
            this.gl = gl;

            const compile = (type: number, src: string): WebGLShader => {
                const sh = gl.createShader(type)!;
                gl.shaderSource(sh, src);
                gl.compileShader(sh);
                if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                    const log = gl.getShaderInfoLog(sh);
                    gl.deleteShader(sh);
                    throw new Error(`Shader compile: ${log}`);
                }
                return sh;
            };
            const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
            const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
            const prog = gl.createProgram()!;
            gl.attachShader(prog, vs);
            gl.attachShader(prog, fs);
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                const log = gl.getProgramInfoLog(prog);
                gl.deleteProgram(prog);
                throw new Error(`Program link: ${log}`);
            }
            this.glProg = prog;
            this.posBuf = gl.createBuffer();
            this.colBuf = gl.createBuffer();
            this.hlBuf = gl.createBuffer();
            this.glReady = true;
        } catch {
            this.webglBlocked = true;
            this.gl = null;
            this.glReady = false;
        }
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);
        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const palette = this.resolvePalette();

            const dv: DataView = options.dataViews?.[0];
            const parsed = this.parseData(dv);
            this.data = parsed.data;
            this.categoryLabels = parsed.labels;

            // Segmented data-loading: request more segments if the host says there are more.
            if (dv?.metadata?.segment && !this.moreDataInFlight && this.data.length < 500_000) {
                this.moreDataInFlight = true;
                const asked = this.host.fetchMoreData?.(true) ?? false;
                if (!asked) this.moreDataInFlight = false;
            } else if (!dv?.metadata?.segment) {
                this.moreDataInFlight = false;
            }

            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);

            if (this.data.length === 0) {
                this.clearCanvases();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height, palette);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();
            this.render(width, height, palette);

            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private parseData(dv: DataView): { data: DataPoint[]; labels: string[] } {
        if (!dv?.categorical?.values?.length) return { data: [], labels: [] };
        const cat = dv.categorical;
        const values = cat.values;
        const xIdx = findValueIndex(values, "x");
        const yIdx = findValueIndex(values, "y");
        if (xIdx < 0 || yIdx < 0) return { data: [], labels: [] };
        const sIdx = findValueIndex(values, "sizeBy");
        const detIdx = findCategoryIndex(cat.categories, "detail");
        const colIdx = findCategoryIndex(cat.categories, "colorBy");
        const detVals = detIdx >= 0 ? cat.categories![detIdx].values : null;
        const colVals = colIdx >= 0 ? cat.categories![colIdx].values : null;
        const rows = values[xIdx].values.length;

        // Highlights come through on the X (or Y) value column when another visual
        // cross-filters this one. Null means "not highlighted → dim".
        const xHighlights = values[xIdx].highlights ?? null;

        // Selection identity: prefer the Details category, fall back to the colorBy category.
        const identityCat = detIdx >= 0 ? cat.categories![detIdx]
                          : colIdx >= 0 ? cat.categories![colIdx]
                          : null;

        const labelMap = new Map<string, number>();
        const labels: string[] = [];
        const idFor = (v: string) => {
            let id = labelMap.get(v);
            if (id == null) { id = labels.length; labelMap.set(v, id); labels.push(v); }
            return id;
        };

        const out: DataPoint[] = [];
        for (let i = 0; i < rows; i++) {
            const x = safeNum(values[xIdx].values[i]);
            const y = safeNum(values[yIdx].values[i]);
            if (x == null || y == null) continue;
            const size = sIdx >= 0 ? safeNum(values[sIdx].values[i]) : null;
            const cval = colVals ? String(colVals[i]) : "All";
            const colorId = idFor(cval);
            const label = detVals ? String(detVals[i]) : null;

            let selectionId: ISelectionId | undefined;
            if (identityCat) {
                try {
                    selectionId = this.host.createSelectionIdBuilder()
                        .withCategory(identityCat, i)
                        .createSelectionId();
                } catch { /* fall back to un-selectable point */ }
            }
            const hl = xHighlights ? xHighlights[i] : null;
            const highlighted = xHighlights ? (hl != null) : true;

            out.push({ x, y, colorId, size, label, selectionId, highlighted });
        }
        return { data: out, labels };
    }

    private render(width: number, height: number, palette: RenderPalette): void {
        const s = this.formattingSettings;
        const margin = { top: 20, right: 24, bottom: 40, left: 52 };
        const plotW = Math.max(60, width - margin.left - margin.right);
        const plotH = Math.max(60, height - margin.top - margin.bottom);

        // Compute domains.
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        for (const p of this.data) {
            if (p.x < xMin) xMin = p.x;
            if (p.x > xMax) xMax = p.x;
            if (p.y < yMin) yMin = p.y;
            if (p.y > yMax) yMax = p.y;
        }
        if (!Number.isFinite(xMin) || xMin === xMax) { xMin -= 1; xMax += 1; }
        if (!Number.isFinite(yMin) || yMin === yMax) { yMin -= 1; yMax += 1; }
        const xPad = (xMax - xMin) * 0.03;
        const yPad = (yMax - yMin) * 0.03;
        const xScale = d3.scaleLinear().domain([xMin - xPad, xMax + xPad]).range([margin.left, margin.left + plotW]).nice();
        const yScale = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).range([margin.top + plotH, margin.top]).nice();

        // ── Axes ──
        this.axesG.selectAll("*").remove();
        if (s.axesCard.showAxes.value) {
            const xa = this.axesG.append("g")
                .attr("transform", `translate(0,${margin.top + plotH})`)
                .call(d3.axisBottom(xScale).ticks(6));
            const ya = this.axesG.append("g")
                .attr("transform", `translate(${margin.left},0)`)
                .call(d3.axisLeft(yScale).ticks(6));
            [xa, ya].forEach(g => {
                g.select(".domain").attr("stroke", palette.axisLine);
                g.selectAll("text").attr("fill", palette.axisText).attr("font-size", `${s.axesCard.fontSize.value}px`);
                g.selectAll("line").attr("stroke", palette.axisLine);
            });
        }

        // ── Pick mode ──
        const N = this.data.length;
        const requested = String(s.modeCard.renderMode.value?.value ?? "auto");
        const threshold = Math.max(100, s.modeCard.autoThreshold.value ?? 20000);
        let mode: "points" | "density" | "hexbin";
        if (requested === "auto") mode = N > threshold ? "density" : "points";
        else mode = requested as "points" | "density" | "hexbin";

        // Force fallback to canvas points if WebGL isn't available.
        if (mode === "points" && (this.webglBlocked || !this.glReady)) {
            mode = "density";
        }

        // ── Size canvases to plot area × dpr ──
        const dpr = window.devicePixelRatio || 1;
        for (const c of [this.glCanvas, this.densityCanvas]) {
            c.style.left = `${margin.left}px`;
            c.style.top  = `${margin.top}px`;
            c.style.width  = `${plotW}px`;
            c.style.height = `${plotH}px`;
            c.width  = Math.max(1, Math.round(plotW * dpr));
            c.height = Math.max(1, Math.round(plotH * dpr));
        }
        this.clearCanvases();
        this.hexG.selectAll("*").remove();

        // Data-to-plot converters (plot-local px, canvases are positioned at plot origin).
        const px = (v: number) => xScale(v) - margin.left;
        const py = (v: number) => yScale(v) - margin.top;

        // ── Render by mode ──
        this.lastRenderParams = { plotW, plotH, xScale, yScale, palette, dpr };
        if (mode === "points") {
            if (this.glReady) {
                this.uploadBuffers();
                this.renderWebGLPoints(plotW, plotH, xScale, yScale, palette, dpr);
            } else {
                this.renderCanvasPoints(plotW, plotH, dpr, px, py, palette);
            }
        } else if (mode === "density") {
            this.renderDensity(plotW, plotH, dpr, px, py);
        } else {
            this.renderHexbin(plotW, plotH, margin, px, py, palette);
        }

        // ── Quadtree for tooltips ──
        this.quadtree = d3.quadtree<DataPoint>()
            .x(d => xScale(d.x))
            .y(d => yScale(d.y))
            .addAll(this.data);

        // ── Overlay: tooltip crosshair + hover hit rect ──
        this.overlay.selectAll("*").remove();
        const cx = this.overlay.append("circle")
            .attr("r", 5).attr("fill", "none")
            .attr("stroke", palette.labelText).attr("stroke-width", 1.5)
            .attr("pointer-events", "none").attr("opacity", 0);
        const hit = this.overlay.append("rect")
            .attr("x", margin.left).attr("y", margin.top)
            .attr("width", plotW).attr("height", plotH)
            .attr("fill", "transparent");
        hit.on("mousemove", (event: MouseEvent) => {
            if (!this.quadtree) return;
            const [mx, my] = d3.pointer(event, this.svg.node());
            const p = this.quadtree.find(mx, my, 20);
            if (p) {
                cx.attr("cx", xScale(p.x)).attr("cy", yScale(p.y)).attr("opacity", 1);
                const items: VisualTooltipDataItem[] = [
                    { displayName: "X", value: d3.format(",.4~g")(p.x) },
                    { displayName: "Y", value: d3.format(",.4~g")(p.y) }
                ];
                if (this.categoryLabels.length > 1) items.push({ displayName: "Category", value: this.categoryLabels[p.colorId] });
                if (p.size != null) items.push({ displayName: "Size", value: d3.format(",.4~g")(p.size) });
                if (p.label) items.push({ displayName: "ID", value: p.label });
                this.tooltipService.show({ dataItems: items, identities: [], coordinates: [event.clientX, event.clientY], isTouchEvent: false });
            } else {
                cx.attr("opacity", 0);
                this.tooltipService.hide({ immediately: false, isTouchEvent: false });
            }
        }).on("mouseleave", () => {
            cx.attr("opacity", 0);
            this.tooltipService.hide({ immediately: false, isTouchEvent: false });
        });

        // ── Legend (small, top-right) ──
        if (this.categoryLabels.length > 1 && this.categoryLabels.length <= 12) {
            const lg = this.overlay.append("g").attr("transform", `translate(${margin.left + plotW - 12}, ${margin.top + 4})`);
            this.categoryLabels.forEach((label, i) => {
                const g = lg.append("g").attr("transform", `translate(0, ${i * 16})`);
                g.append("rect").attr("x", -10).attr("y", -6).attr("width", 10).attr("height", 10)
                    .attr("fill", CAT_PALETTE[i % CAT_PALETTE.length]);
                g.append("text").attr("x", -14).attr("y", 3).attr("text-anchor", "end")
                    .attr("font-size", "10px").attr("fill", palette.labelText).text(label);
            });
        }

        // ── Honesty badge ──
        if (s.axesCard.showSampleWarningBadge.value) {
            const badge = this.overlay.append("g").attr("transform", `translate(${margin.left + 8}, ${margin.top + 12})`);
            const modeLabel = mode === "hexbin" ? "hexbin summary" : mode === "density" ? "density" : "points";
            const t = badge.append("text")
                .attr("x", 8).attr("y", 2).attr("dominant-baseline", "middle")
                .attr("font-family", "Segoe UI, sans-serif")
                .attr("font-size", "10px").attr("font-weight", 600)
                .attr("fill", palette.badgeFg)
                .text(`n = ${d3.format(",")(N)}  ·  ${modeLabel}${(this.webglBlocked && mode === "density") ? "  ·  Canvas fallback (WebGL blocked)" : ""}`);
            const bb = (t.node() as SVGTextElement).getBBox();
            badge.insert("rect", "text")
                .attr("x", bb.x - 6).attr("y", bb.y - 2)
                .attr("width", bb.width + 12).attr("height", bb.height + 4)
                .attr("rx", 3)
                .attr("fill", palette.badgeBg).attr("stroke", palette.badgeFg).attr("stroke-width", 1);
        }

        // ── Selection: brush overlay or click-nearest ──
        const selectionMode = String(s.interactionsCard.selectionMode.value?.value ?? "brush");
        if (selectionMode === "brush" && mode === "points") {
            this.setupBrush(hit, margin.left, margin.top, plotW, plotH, xScale, yScale, palette);
        } else if (selectionMode === "click") {
            this.setupClickSelect(hit, xScale, yScale);
        } else {
            // Off — make sure the hit rect can still clear on click.
            hit.on("click", (event: MouseEvent) => {
                if (event.shiftKey || event.ctrlKey || event.metaKey) return;
                this.selectionManager.clear();
            });
        }
    }

    /**
     * Attach a d3.brush to the SVG hit layer. During drag the brush rect is stored
     * in data coords and pushed to the WebGL shader via u_brushRect so points outside
     * the rectangle dim in real time. On brush-end the enclosed points are collected
     * (linear scan of the parsed `this.data`) and committed via SelectionManager.
     */
    private setupBrush(
        hit: d3.Selection<SVGRectElement, unknown, null, undefined>,
        offX: number, offY: number, plotW: number, plotH: number,
        xScale: d3.ScaleLinear<number, number>, yScale: d3.ScaleLinear<number, number>,
        palette: RenderPalette
    ): void {
        // Remove any previous brush + chip (the SVG overlay was already cleared).
        this.brushG = this.overlay.append("g").classed("wgs-brush", true)
            .attr("transform", `translate(${offX}, ${offY})`);
        // Hide the default tooltip hit rect when brush mode is active — d3.brush installs its own.
        hit.style("pointer-events", "none");

        const brush = d3.brush<unknown>()
            .extent([[0, 0], [plotW, plotH]])
            .on("brush", (event) => this.onBrushMove(event.selection as [[number, number], [number, number]] | null, xScale, yScale, offX, offY, plotW, plotH, palette))
            .on("end", (event) => this.onBrushEnd(event.selection as [[number, number], [number, number]] | null, event.sourceEvent as MouseEvent | undefined, xScale, yScale));
        this.brushG.call(brush);

        // Style the brush handles to match the mockup: dashed outline, subtle fill.
        this.brushG.selectAll(".selection")
            .attr("fill", "rgba(66, 135, 245, 0.08)")
            .attr("stroke", "#4287f5").attr("stroke-width", 1.5).attr("stroke-dasharray", "5 3");

        // Prepare the info chip (rendered / repositioned during brush move).
        this.brushCountChip = this.overlay.append("g").classed("wgs-brush-chip", true).style("display", "none");
        const chipText = this.brushCountChip.append("text")
            .attr("y", 3).attr("dominant-baseline", "middle")
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "11px").attr("font-weight", 600)
            .attr("fill", "#1a4a8f");
        // Chip backdrop drawn first (behind the text).
        this.brushCountChip.insert("rect", "text")
            .attr("rx", 3).attr("fill", "#e8f0fe").attr("stroke", "#4287f5").attr("stroke-width", 1);
        chipText.text("0 selected");
    }

    private onBrushMove(
        selection: [[number, number], [number, number]] | null,
        xScale: d3.ScaleLinear<number, number>, yScale: d3.ScaleLinear<number, number>,
        offX: number, offY: number, plotW: number, plotH: number,
        _palette: RenderPalette
    ): void {
        if (!selection) {
            this.brushRect = null;
            this.brushCountChip?.style("display", "none");
            this.redrawWebGL();
            return;
        }
        const [[px0, py0], [px1, py1]] = selection;
        // px/py are already in the brush group's local coords (plot-relative). Invert via the scales:
        // the scales expect SVG-space, so add the offset before inverting.
        const xd0 = xScale.invert(px0 + offX);
        const xd1 = xScale.invert(px1 + offX);
        const yd0 = yScale.invert(py1 + offY);   // y flipped
        const yd1 = yScale.invert(py0 + offY);
        this.brushRect = [xd0, yd0, xd1, yd1];

        // Count enclosed points (fast — single linear pass on the parsed array).
        let n = 0;
        for (const p of this.data) {
            if (p.x >= xd0 && p.x <= xd1 && p.y >= yd0 && p.y <= yd1) n++;
        }
        // Update the chip position + text.
        if (this.brushCountChip) {
            const cx = offX + plotW - 12;
            const cy = offY + 14;
            this.brushCountChip.style("display", null)
                .attr("transform", `translate(${cx}, ${cy})`);
            const text = this.brushCountChip.select<SVGTextElement>("text")
                .text(`${d3.format(",")(n)} of ${d3.format(",")(this.data.length)} selected`)
                .attr("text-anchor", "end")
                .attr("x", 0);
            const bb = text.node()!.getBBox();
            this.brushCountChip.select("rect")
                .attr("x", bb.x - 8).attr("y", bb.y - 4)
                .attr("width", bb.width + 16).attr("height", bb.height + 8);
        }
        // Repaint WebGL layer with the new brush uniform so points outside dim in real time.
        this.redrawWebGL();
    }

    private onBrushEnd(
        selection: [[number, number], [number, number]] | null,
        sourceEvent: MouseEvent | undefined,
        _xScale: d3.ScaleLinear<number, number>, _yScale: d3.ScaleLinear<number, number>
    ): void {
        if (!selection) {
            // Empty brush click — clear the selection.
            this.brushRect = null;
            this.brushCountChip?.style("display", "none");
            this.selectionManager.clear().then(() => this.redrawWebGL());
            return;
        }
        const [xd0, yd0, xd1, yd1] = this.brushRect!;
        const ids: ISelectionId[] = [];
        for (const p of this.data) {
            if (p.x >= xd0 && p.x <= xd1 && p.y >= yd0 && p.y <= yd1 && p.selectionId) {
                ids.push(p.selectionId);
            }
        }
        if (ids.length === 0) return;
        const multi = !!(sourceEvent && (sourceEvent.ctrlKey || sourceEvent.metaKey || sourceEvent.shiftKey));
        this.selectionManager.select(ids, multi).then(() => this.redrawWebGL());
    }

    private setupClickSelect(
        hit: d3.Selection<SVGRectElement, unknown, null, undefined>,
        xScale: d3.ScaleLinear<number, number>, yScale: d3.ScaleLinear<number, number>
    ): void {
        hit.on("click", (event: MouseEvent) => {
            if (!this.quadtree) return;
            const [mx, my] = d3.pointer(event, this.svg.node());
            const p = this.quadtree.find(mx, my, 20);
            if (!p?.selectionId) {
                this.selectionManager.clear().then(() => this.redrawWebGL());
                return;
            }
            const multi = event.ctrlKey || event.metaKey || event.shiftKey;
            this.selectionManager.select(p.selectionId, multi).then(() => this.redrawWebGL());
        });
        hit.on("contextmenu", (event: MouseEvent) => {
            if (!this.quadtree) return;
            event.preventDefault(); event.stopPropagation();
            const [mx, my] = d3.pointer(event, this.svg.node());
            const p = this.quadtree.find(mx, my, 20);
            this.selectionManager.showContextMenu(p?.selectionId ?? ({} as ISelectionId), { x: event.clientX, y: event.clientY });
        });
        // Silence pointer conflicts — using d3.pointer directly, no brush layer.
        hit.style("pointer-events", "all");
    }

    private uploadBuffers(): void {
        if (!this.gl || !this.glReady) return;
        const gl = this.gl;
        const N = this.data.length;
        const pos = new Float32Array(N * 2);
        const col = new Float32Array(N);
        const hl  = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            pos[i * 2]     = this.data[i].x;
            pos[i * 2 + 1] = this.data[i].y;
            col[i] = this.data[i].colorId;
            hl[i]  = this.data[i].highlighted === false ? 0 : 1;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf!);
        gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf!);
        gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.hlBuf!);
        gl.bufferData(gl.ARRAY_BUFFER, hl, gl.DYNAMIC_DRAW);
    }

    private renderWebGLPoints(
        plotW: number, plotH: number,
        xScale: d3.ScaleLinear<number, number>, yScale: d3.ScaleLinear<number, number>,
        palette: RenderPalette, dpr: number
    ): void {
        const gl = this.gl!;
        const prog = this.glProg!;
        const s = this.formattingSettings;

        gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.useProgram(prog);
        const aPos = gl.getAttribLocation(prog, "a_position");
        const aCol = gl.getAttribLocation(prog, "a_color");
        const aHl  = gl.getAttribLocation(prog, "a_highlight");
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf!);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf!);
        gl.enableVertexAttribArray(aCol);
        gl.vertexAttribPointer(aCol, 1, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.hlBuf!);
        gl.enableVertexAttribArray(aHl);
        gl.vertexAttribPointer(aHl, 1, gl.FLOAT, false, 0, 0);

        // Map data → plot-local (0..1) → clip in vert shader.
        // clip = (a_pos * u_scale + u_offset) * 2 - 1; y flipped in shader.
        const [xd0, xd1] = xScale.domain(); const xr = xd1 - xd0;
        const [yd1s, yd0s] = yScale.domain(); const yr = yd0s - yd1s;
        const uScale = new Float32Array([1 / xr, -1 / yr]);
        const uOffset = new Float32Array([-xd0 / xr, 1 + yd1s / yr]);

        gl.uniform2fv(gl.getUniformLocation(prog, "u_scale"), uScale);
        gl.uniform2fv(gl.getUniformLocation(prog, "u_offset"), uOffset);
        gl.uniform1f(gl.getUniformLocation(prog, "u_pointSize"), Math.max(1, s.pointsCard.pointSize.value ?? 3));
        gl.uniform1f(gl.getUniformLocation(prog, "u_dpr"), dpr);
        gl.uniform1f(gl.getUniformLocation(prog, "u_alpha"), Math.max(0.05, Math.min(1, (s.pointsCard.pointOpacity.value ?? 60) / 100)));

        // Brush uniforms — feed the current brush rect (or zeros when inactive).
        const brush = this.brushRect;
        gl.uniform1f(gl.getUniformLocation(prog, "u_brushActive"), brush ? 1 : 0);
        gl.uniform4f(gl.getUniformLocation(prog, "u_brushRect"),
            brush ? brush[0] : 0, brush ? brush[1] : 0,
            brush ? brush[2] : 0, brush ? brush[3] : 0);

        // Dim scale — points outside the brush / non-highlighted fade to this alpha multiplier.
        const dim = Math.max(0.02, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 15) / 100));
        gl.uniform1f(gl.getUniformLocation(prog, "u_dimAlpha"), dim);

        // Palette uniform (16 slots).
        const paletteArr = new Float32Array(16 * 3);
        for (let i = 0; i < 16; i++) {
            const hex = palette.highContrast ? palette.labelText : CAT_PALETTE[i % CAT_PALETTE.length];
            const rgb = d3.color(hex)?.rgb() ?? d3.rgb(120, 120, 120);
            paletteArr[i * 3]     = rgb.r / 255;
            paletteArr[i * 3 + 1] = rgb.g / 255;
            paletteArr[i * 3 + 2] = rgb.b / 255;
        }
        gl.uniform3fv(gl.getUniformLocation(prog, "u_palette"), paletteArr);

        gl.drawArrays(gl.POINTS, 0, this.data.length);
    }

    /** Repaint the WebGL layer using the last render's parameters — invoked by the brush during drag. */
    private redrawWebGL(): void {
        if (!this.glReady || !this.lastRenderParams) return;
        const p = this.lastRenderParams;
        this.renderWebGLPoints(p.plotW, p.plotH, p.xScale, p.yScale, p.palette, p.dpr);
    }

    /** Snapshot of the parameters needed to redraw the point layer during a brush drag. */
    private lastRenderParams: {
        plotW: number; plotH: number;
        xScale: d3.ScaleLinear<number, number>; yScale: d3.ScaleLinear<number, number>;
        palette: RenderPalette; dpr: number;
    } | null = null;

    private renderCanvasPoints(
        plotW: number, plotH: number, dpr: number,
        px: (v: number) => number, py: (v: number) => number,
        palette: RenderPalette
    ): void {
        const ctx = this.glCanvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, plotW, plotH);
        const s = this.formattingSettings;
        const r = Math.max(1, s.pointsCard.pointSize.value ?? 3) / 2;
        const alpha = Math.max(0.05, Math.min(1, (s.pointsCard.pointOpacity.value ?? 60) / 100));
        // Cap fallback to a safe count with a notice.
        const cap = 50_000;
        const N = Math.min(this.data.length, cap);
        ctx.globalAlpha = alpha;
        for (let i = 0; i < N; i++) {
            const p = this.data[i];
            const c = palette.highContrast ? palette.labelText : CAT_PALETTE[p.colorId % CAT_PALETTE.length];
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(px(p.x), py(p.y), r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    /**
     * Two-pass Canvas density:
     *  1. Additively splat a small radial-falloff kernel per point onto an intensity buffer.
     *  2. Map accumulated intensity → color via the chosen ramp (with log/sqrt/linear).
     */
    private renderDensity(
        plotW: number, plotH: number, dpr: number,
        px: (v: number) => number, py: (v: number) => number
    ): void {
        const s = this.formattingSettings;
        const cw = this.densityCanvas.width, ch = this.densityCanvas.height;
        const ctx = this.densityCanvas.getContext("2d");
        if (!ctx) return;

        // Pass 1: additive splats on an offscreen 8-bit canvas.
        const acc = document.createElement("canvas");
        acc.width = cw; acc.height = ch;
        const accCtx = acc.getContext("2d")!;
        accCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        accCtx.clearRect(0, 0, plotW, plotH);
        const splatR = Math.max(2, Math.round(Math.min(plotW, plotH) / 120));
        // Radial gradient kernel; each additive draw layers alpha, giving a density surrogate.
        const grad = accCtx.createRadialGradient(0, 0, 0, 0, 0, splatR);
        grad.addColorStop(0, "rgba(255,255,255,0.28)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        accCtx.globalCompositeOperation = "lighter";
        for (let i = 0; i < this.data.length; i++) {
            const p = this.data[i];
            const x = px(p.x), y = py(p.y);
            if (x < -splatR || y < -splatR || x > plotW + splatR || y > plotH + splatR) continue;
            accCtx.save();
            accCtx.translate(x, y);
            accCtx.fillStyle = grad;
            accCtx.beginPath();
            accCtx.arc(0, 0, splatR, 0, Math.PI * 2);
            accCtx.fill();
            accCtx.restore();
        }

        // Pass 2: read alpha channel, apply intensity scale + color ramp, write RGBA.
        const src = accCtx.getImageData(0, 0, cw, ch).data;
        const dst = ctx.createImageData(cw, ch);
        const scale = String(s.densityCard.intensityScale.value?.value ?? "log");
        const rampName = String(s.densityCard.colorRamp.value?.value ?? "viridis");
        // Find max alpha for normalization.
        let maxA = 1;
        for (let i = 3; i < src.length; i += 4) if (src[i] > maxA) maxA = src[i];
        for (let i = 0, j = 0; i < src.length; i += 4, j += 4) {
            const a = src[i + 3];
            if (a === 0) { dst.data[j + 3] = 0; continue; }
            let t = a / maxA;
            if (scale === "log")  t = Math.log1p(t * 9) / Math.log(10);
            if (scale === "sqrt") t = Math.sqrt(t);
            const rgb = sampleRamp(rampName, t);
            dst.data[j]     = rgb[0];
            dst.data[j + 1] = rgb[1];
            dst.data[j + 2] = rgb[2];
            dst.data[j + 3] = Math.min(255, Math.round(t * 255));
        }
        ctx.putImageData(dst, 0, 0);
    }

    private renderHexbin(
        plotW: number, plotH: number, margin: { top: number; left: number },
        px: (v: number) => number, py: (v: number) => number, palette: RenderPalette
    ): void {
        const s = this.formattingSettings;
        const radius = Math.max(4, s.densityCard.hexRadius.value ?? 12);
        const hb = d3hexbin<DataPoint>()
            .x(d => px(d.x))
            .y(d => py(d.y))
            .radius(radius)
            .extent([[0, 0], [plotW, plotH]]);
        const bins = hb(this.data);
        const maxC = d3.max(bins, b => b.length) ?? 1;
        const rampName = String(s.densityCard.colorRamp.value?.value ?? "viridis");
        const scale = String(s.densityCard.intensityScale.value?.value ?? "log");
        this.hexG.attr("transform", `translate(${margin.left}, ${margin.top})`);
        this.hexG.selectAll("path")
            .data(bins)
            .enter().append("path")
            .attr("d", hb.hexagon())
            .attr("transform", b => `translate(${b.x},${b.y})`)
            .attr("fill", b => {
                let t = b.length / maxC;
                if (scale === "log") t = Math.log1p(t * 9) / Math.log(10);
                if (scale === "sqrt") t = Math.sqrt(t);
                const rgb = sampleRamp(rampName, t);
                return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            })
            .attr("stroke", palette.background)
            .attr("stroke-width", 0.5);
    }

    private clearCanvases(): void {
        const dctx = this.densityCanvas.getContext("2d");
        if (dctx) dctx.clearRect(0, 0, this.densityCanvas.width, this.densityCanvas.height);
        if (this.gl && this.glReady) {
            this.gl.clearColor(0, 0, 0, 0);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        } else {
            const gctx = this.glCanvas.getContext("2d");
            if (gctx) gctx.clearRect(0, 0, this.glCanvas.width, this.glCanvas.height);
        }
    }

    private resolvePalette(): RenderPalette {
        const cp = this.colorPalette;
        if (cp.isHighContrast) {
            const fg = cp.foreground?.value || "#000";
            const bg = cp.background?.value || "#fff";
            return {
                highContrast: true,
                axisLine: fg, axisText: fg, background: bg, labelText: fg,
                badgeBg: bg, badgeFg: fg, landingText: fg, landingSub: fg,
                fallback: fg
            };
        }
        const bg = cp.background?.value || "#ffffff";
        const isDark = luminance(bg) < 0.5;
        const themeFg = cp.foreground?.value || (isDark ? "#f0f0f0" : "#333");
        return {
            highContrast: false,
            axisLine: isDark ? "#777" : "#999",
            axisText: isDark ? "#bbb" : "#666",
            background: bg,
            labelText: themeFg,
            badgeBg: isDark ? "#2a2a2a" : "#f5f5f5",
            badgeFg: isDark ? "#dcdcdc" : "#555",
            landingText: isDark ? "#eee" : "#333",
            landingSub:  isDark ? "#aaa" : "#999",
            fallback: cp.getColor("wgsPoint")?.value || "#4472C4"
        };
    }

    private renderLandingPage(width: number, height: number, palette: RenderPalette): void {
        this.landing.selectAll("*").remove();
        this.overlay.selectAll("*").remove();
        this.axesG.selectAll("*").remove();
        this.hexG.selectAll("*").remove();
        if (width < 160 || height < 100) return;

        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);
        const glyph = g.append("g").attr("transform", "translate(-70, -80)");
        // Fake point cloud
        const rand = (seed: number) => { let x = Math.sin(seed) * 10000; return x - Math.floor(x); };
        for (let i = 0; i < 240; i++) {
            const rx = rand(i) * 140;
            const ry = rand(i + 1000) * 100;
            const dx = (rx - 70) * 0.6;
            const dy = (ry - 50) * 0.6;
            const r = Math.sqrt(dx * dx + dy * dy);
            const a = Math.max(0, 1 - r / 45);
            if (a <= 0) continue;
            glyph.append("circle").attr("cx", rx).attr("cy", ry).attr("r", 2).attr("fill", "#4472C4").attr("fill-opacity", a * 0.5);
        }

        g.append("text")
            .attr("text-anchor", "middle").attr("y", 40)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "16px").attr("font-weight", 600)
            .attr("fill", palette.landingText).text("WebGL Scatter (Honest)");
        g.append("text")
            .attr("text-anchor", "middle").attr("y", 60)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "12px")
            .attr("fill", palette.axisText).text("Add fields:  X  +  Y  (+ Legend, Size, Details)");
        g.append("text")
            .attr("text-anchor", "middle").attr("y", 78)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "11px")
            .attr("fill", palette.landingSub).text("Renders every row — no silent downsampling.");
    }

    public destroy(): void {
        if (this.gl) {
            const ext = this.gl.getExtension("WEBGL_lose_context");
            ext?.loseContext();
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
