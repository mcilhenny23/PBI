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
import { euclideanDistances, agglomerative, cutIntoGroups } from "./cluster";
import { Fingerprint, ComputeCache } from "./computeCache";

/** Above this node count, clustering is too slow — fall back to degree order. */
const CLUSTER_LIMIT = 400;

// ── Helpers ────────────────────────────────────────────────────

function findCategoryIndex(cats: powerbi.DataViewCategoryColumn[], roleName: string): number {
    for (let i = 0; i < cats.length; i++) {
        if (cats[i].source.roles && cats[i].source.roles[roleName]) return i;
    }
    return -1;
}

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

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, Math.max(1, max - 1)) + "…" : s;
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
    private overlay: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    // Kept so the pointer can be mapped back to a matrix cell.
    private hit: { left: number; top: number; cell: number; n: number } | null = null;
    private nodes: string[] = [];
    private order: number[] = [];
    private matrix: number[][] = [];
    /** Per-node aggregated selection ids — every source-row identity touching each node. */
    private nodeIds: ISelectionId[][] = [];

    /** Caches the seriation so styling changes don't re-cluster. */
    private clusterCache = new ComputeCache<{ order: number[]; groups: number[][] }>();

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applyExternalDim());

        this.root = d3.select(options.element).append("div").classed("adj-matrix", true);
        this.canvas = this.root.append("canvas").classed("adj-canvas", true);
        this.svg = this.root.append("svg").classed("adj-svg", true);
        this.landing = this.svg.append("g").classed("adj-landing", true);
        this.overlay = this.svg.append("g").classed("adj-overlay", true);
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
            const mx = this.formattingSettings.matrixCard;
            const col = this.formattingSettings.colorCard;
            const lab = this.formattingSettings.labelsCard;
            const clu = this.formattingSettings.clustersCard;

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
            this.hit = null;

            // ── Data ───────────────────────────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const cats = dataView?.categorical?.categories;
            const vals = dataView?.categorical?.values;
            const sIdx = cats ? findCategoryIndex(cats, "source") : -1;
            const tIdx = cats ? findCategoryIndex(cats, "target") : -1;
            const wIdx = vals ? findValueIndex(vals, "weight") : -1;

            if (sIdx < 0 || tIdx < 0 || !cats?.[sIdx]?.values?.length) {
                this.renderLandingPage(width, height, sIdx >= 0, tIdx >= 0);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            // ── Build node list + adjacency matrix ─────────────────
            const rows = cats[sIdx].values.length;
            const index = new Map<string, number>();
            const nodes: string[] = [];
            const nodeIdx = (name: string): number => {
                let i = index.get(name);
                if (i === undefined) { i = nodes.length; index.set(name, i); nodes.push(name); }
                return i;
            };
            const edges: { s: number; t: number; w: number }[] = [];
            const srcCat = cats[sIdx];
            const nodeIdsPer: ISelectionId[][] = [];
            for (let r = 0; r < rows; r++) {
                const sv = cats[sIdx].values[r], tv = cats[tIdx].values[r];
                if (sv == null || tv == null) continue;
                const w = wIdx >= 0 ? (safeNum(vals[wIdx].values[r]) ?? 0) : 1;
                const si = nodeIdx(String(sv)), ti = nodeIdx(String(tv));
                edges.push({ s: si, t: ti, w });

                // Aggregate row-level identity onto both endpoints so a click on
                // either node selects every touching edge.
                let rowId: ISelectionId | undefined;
                try {
                    rowId = this.host.createSelectionIdBuilder()
                        .withCategory(srcCat, r)
                        .createSelectionId();
                } catch { /* skipped */ }
                if (rowId) {
                    if (!nodeIdsPer[si]) nodeIdsPer[si] = [];
                    if (!nodeIdsPer[ti]) nodeIdsPer[ti] = [];
                    nodeIdsPer[si].push(rowId);
                    nodeIdsPer[ti].push(rowId);
                }
            }
            this.nodeIds = nodeIdsPer;
            const N = nodes.length;
            if (N === 0) {
                this.renderLandingPage(width, height, true, true);
                this.events.renderingFinished(options);
                return;
            }

            const symmetric = mx.symmetric.value;
            const matrix: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
            for (const e of edges) {
                matrix[e.s][e.t] += e.w;
                if (symmetric && e.s !== e.t) matrix[e.t][e.s] += e.w;
            }
            this.nodes = nodes;
            this.matrix = matrix;

            // ── Seriation ──────────────────────────────────────────
            let mode = String(mx.seriation.value?.value ?? "cluster");
            if (mode === "cluster" && N > CLUSTER_LIMIT) mode = "degree";   // perf guard

            const degree = matrix.map(row => d3.sum(row));
            let order: number[];
            let groups: number[][] = [];

            if (mode === "alphabetical") {
                order = d3.range(N).sort((a, b) => nodes[a].localeCompare(nodes[b]));
            } else if (mode === "degree") {
                order = d3.range(N).sort((a, b) => degree[b] - degree[a]);
            } else if (mode === "cluster") {
                // Agglomerative clustering is the expensive step here (an N×N
                // distance matrix plus N−1 merges). It depends only on the
                // adjacency matrix, so colour ramps, labels and boundary styling
                // must never re-run it — hence the cache.
                const fp = new Fingerprint().str("cluster").num(N);
                for (const row of matrix) fp.nums(row);
                const seriated = this.clusterCache.get(fp.done(), () => {
                    const root = agglomerative(euclideanDistances(matrix));
                    const k = Math.min(8, Math.max(2, Math.round(Math.sqrt(N / 2))));
                    return {
                        order: root ? root.members : d3.range(N),
                        groups: cutIntoGroups(root, k)
                    };
                });
                order = seriated ? seriated.order : d3.range(N);
                groups = seriated ? seriated.groups : [];
            } else {
                order = d3.range(N);                                        // data order
            }
            this.order = order;

            // Position of each group boundary, in display-order units.
            const boundaries: number[] = [];
            if (groups.length > 1) {
                let cum = 0;
                for (let g = 0; g < groups.length - 1; g++) { cum += groups[g].length; boundaries.push(cum); }
            }

            // ── Color ──────────────────────────────────────────────
            let maxW = 0, minPos = Infinity;
            for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
                const w = matrix[i][j];
                if (w > maxW) maxW = w;
                if (w > 0 && w < minPos) minPos = w;
            }
            if (!Number.isFinite(minPos)) minPos = 1;
            const scaleMode = String(col.colorScale.value?.value ?? "linear");
            const interp = d3.interpolateRgb(col.colorRampLow.value.value, col.colorRampHigh.value.value);
            const tFor = (w: number): number => {
                if (w <= 0 || maxW <= 0) return 0;
                if (scaleMode === "sqrt") return Math.sqrt(w / maxW);
                if (scaleMode === "log") {
                    if (maxW === minPos) return 1;
                    return Math.max(0, Math.min(1, Math.log(w / minPos) / Math.log(maxW / minPos)));
                }
                return w / maxW;
            };

            // ── Layout ─────────────────────────────────────────────
            const fs = Math.max(6, lab.labelFontSize.value);
            const maxLen = Math.max(2, Math.round(lab.maxLabelLength.value || 20));
            const outside = String(lab.labelPosition.value?.value ?? "outside") === "outside";
            const longest = d3.max(nodes, n => truncate(n, maxLen).length) || 4;
            const wantLabels = lab.showLabels.value;
            const labelSpace = wantLabels && outside
                ? Math.min(160, Math.max(24, longest * fs * 0.62))
                : 8;

            const padR = 12, padB = 12;
            const availW = width - labelSpace - padR;
            const availH = height - labelSpace - padB;
            const size = Math.max(0, Math.min(availW, availH));
            const cell = size / N;
            const left = labelSpace, top = labelSpace;

            if (size < 10 || cell <= 0) { this.events.renderingFinished(options); return; }

            const showDiag = mx.showDiagonal.value;
            const circle = String(mx.cellShape.value?.value ?? "square") === "circle";

            // ── Cells on canvas ────────────────────────────────────
            // Paint the "zero" background once, then only non-zero cells — much
            // cheaper than N² fills on a sparse network.
            ctx.fillStyle = col.colorRampLow.value.value;
            ctx.fillRect(left, top, size, size);

            for (let r = 0; r < N; r++) {
                const si = order[r];
                for (let c = 0; c < N; c++) {
                    const ti = order[c];
                    if (!showDiag && si === ti) continue;
                    const w = matrix[si][ti];
                    if (w <= 0) continue;
                    ctx.fillStyle = interp(tFor(w));
                    const x = left + c * cell, y = top + r * cell;
                    if (circle) {
                        const rad = Math.max(0.4, cell / 2 - 0.5);
                        ctx.beginPath();
                        ctx.arc(x + cell / 2, y + cell / 2, rad, 0, Math.PI * 2);
                        ctx.fill();
                    } else {
                        ctx.fillRect(x, y, Math.max(0.5, cell), Math.max(0.5, cell));
                    }
                }
            }

            // Matrix outline.
            this.overlay.append("rect")
                .attr("x", left).attr("y", top).attr("width", size).attr("height", size)
                .attr("fill", "none").attr("stroke", "#ddd").attr("stroke-width", 1);

            // ── Cluster boundaries ─────────────────────────────────
            if (clu.showClusterBoundaries.value && mode === "cluster" && boundaries.length) {
                const bc = clu.clusterBoundaryColor.value.value;
                for (const b of boundaries) {
                    const p = top + b * cell, q = left + b * cell;
                    this.overlay.append("line")
                        .attr("x1", left).attr("x2", left + size).attr("y1", p).attr("y2", p)
                        .attr("stroke", bc).attr("stroke-width", 1).attr("shape-rendering", "crispEdges");
                    this.overlay.append("line")
                        .attr("y1", top).attr("y2", top + size).attr("x1", q).attr("x2", q)
                        .attr("stroke", bc).attr("stroke-width", 1).attr("shape-rendering", "crispEdges");
                }
            }

            // ── Labels ─────────────────────────────────────────────
            // Level of detail: drop labels entirely on tiny cells, and thin them
            // out when they'd collide.
            if (wantLabels && cell >= 3) {
                const every = Math.max(1, Math.ceil((fs + 2) / cell));
                const g = this.overlay.append("g").classed("labels", true);
                for (let i = 0; i < N; i++) {
                    if (i % every !== 0) continue;
                    const name = truncate(nodes[order[i]], maxLen);
                    const mid = (i + 0.5) * cell;
                    // Rows, on the left.
                    g.append("text")
                        .attr("x", outside ? left - 4 : left + 4)
                        .attr("y", top + mid)
                        .attr("text-anchor", outside ? "end" : "start")
                        .attr("dominant-baseline", "middle")
                        .attr("font-size", `${fs}px`).attr("fill", "#555")
                        .text(name);
                    // Columns, along the top, rotated.
                    g.append("text")
                        .attr("transform", `translate(${left + mid},${outside ? top - 4 : top + 4}) rotate(-90)`)
                        .attr("text-anchor", outside ? "start" : "end")
                        .attr("dominant-baseline", "middle")
                        .attr("font-size", `${fs}px`).attr("fill", "#555")
                        .text(name);
                }
            }

            // ── Tooltip hit layer ──────────────────────────────────
            this.hit = { left, top, cell, n: N };
            const srcTitle = cats[sIdx].source.displayName || "Source";
            const tgtTitle = cats[tIdx].source.displayName || "Target";
            const wTitle = wIdx >= 0 ? (vals[wIdx].source.displayName || "Weight") : "Weight";

            this.overlay.append("rect")
                .classed("hit", true)
                .attr("x", 0).attr("y", 0).attr("width", width).attr("height", height)
                .attr("fill", "transparent")
                .on("mousemove", (event: MouseEvent) => {
                    if (!this.hit) return;
                    const [px, py] = d3.pointer(event, this.svg.node());
                    const c = Math.floor((px - this.hit.left) / this.hit.cell);
                    const r = Math.floor((py - this.hit.top) / this.hit.cell);
                    if (r < 0 || c < 0 || r >= this.hit.n || c >= this.hit.n) {
                        this.tooltipService.hide({ immediately: false, isTouchEvent: false });
                        return;
                    }
                    const si = this.order[r], ti = this.order[c];
                    const items: VisualTooltipDataItem[] = [
                        { displayName: srcTitle, value: this.nodes[si] },
                        { displayName: tgtTitle, value: this.nodes[ti] },
                        { displayName: wTitle, value: numFmt(this.matrix[si][ti]) }
                    ];
                    this.tooltipService.show({
                        dataItems: items, identities: [],
                        coordinates: [px, py], isTouchEvent: false
                    });
                })
                .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }))
                .on("click", (event: MouseEvent) => {
                    if (!this.hit) return;
                    const [px, py] = d3.pointer(event, this.svg.node());
                    const c = Math.floor((px - this.hit.left) / this.hit.cell);
                    const r = Math.floor((py - this.hit.top) / this.hit.cell);
                    if (r < 0 || c < 0 || r >= this.hit.n || c >= this.hit.n) {
                        this.selectionManager.clear().then(() => this.applyExternalDim());
                        return;
                    }
                    event.stopPropagation();
                    // Aggregate every edge id touching either endpoint node.
                    const si = this.order[r], ti = this.order[c];
                    const ids = [...(this.nodeIds[si] ?? []), ...(this.nodeIds[ti] ?? [])];
                    if (ids.length === 0) return;
                    const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                    this.selectionManager.select(ids, multi).then(() => this.applyExternalDim());
                })
                .on("contextmenu", (event: MouseEvent) => {
                    if (!this.hit) return;
                    event.preventDefault();
                    const [px, py] = d3.pointer(event, this.svg.node());
                    const c = Math.floor((px - this.hit.left) / this.hit.cell);
                    const r = Math.floor((py - this.hit.top) / this.hit.cell);
                    if (r < 0 || c < 0 || r >= this.hit.n || c >= this.hit.n) return;
                    const si = this.order[r];
                    const ids = this.nodeIds[si] ?? [];
                    this.selectionManager.showContextMenu(ids[0] ?? ({} as ISelectionId), { x: event.clientX, y: event.clientY });
                });

            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private renderLandingPage(width: number, height: number, hasSource: boolean, hasTarget: boolean): void {
        this.landing.selectAll("*").remove();
        this.overlay.selectAll("*").remove();
        if (width < 150 || height < 110) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        // Mini block-diagonal glyph.
        const glyph = g.append("g").attr("transform", "translate(-46,-104)");
        const cell = 8, n = 11;
        const blocks = [[0, 4], [4, 8], [8, 11]];
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                const inBlock = blocks.some(([a, b]) => r >= a && r < b && c >= a && c < b);
                const on = inBlock ? ((r * 7 + c * 3) % 4 !== 0) : ((r * 5 + c * 11) % 13 === 0);
                if (!on) continue;
                glyph.append("rect")
                    .attr("x", c * cell).attr("y", r * cell)
                    .attr("width", cell - 1).attr("height", cell - 1)
                    .attr("fill", "#2166ac").attr("fill-opacity", inBlock ? 0.85 : 0.25);
            }
        }

        g.append("text").attr("text-anchor", "middle").attr("y", 4)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px")
            .attr("font-weight", 600).attr("fill", "#333").text("Adjacency Matrix");

        const missing: string[] = [];
        if (!hasSource) missing.push("Source Node");
        if (!hasTarget) missing.push("Target Node");
        g.append("text").attr("text-anchor", "middle").attr("y", 26)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666")
            .text(missing.length ? "Add fields:  " + missing.join("   +   ") : "Add Source and Target nodes to begin");
        g.append("text").attr("text-anchor", "middle").attr("y", 48)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
            .attr("fill", "#999")
            .text("One row per edge. Add a Weight measure for intensity; cluster order reveals communities.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
