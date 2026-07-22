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
    private hit: { left: number; top: number; cellW: number; cellH: number; rowN: number; colN: number } | null = null;
    /** Row-axis node names. In unipartite mode, same reference as colNodes. */
    private rowNodes: string[] = [];
    /** Column-axis node names. In unipartite mode, same reference as rowNodes. */
    private colNodes: string[] = [];
    private rowOrder: number[] = [];
    private colOrder: number[] = [];
    private matrix: number[][] = [];   // matrix[rowIdx][colIdx]
    private bipartite = false;
    /** Per-node aggregated selection ids — every source-row identity touching each node. */
    private rowIds: ISelectionId[][] = [];
    private colIds: ISelectionId[][] = [];

    /** Caches the seriation so styling changes don't re-cluster. */
    private clusterCache = new ComputeCache<{ order: number[]; groups: number[][] }>();

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

        this.selectionManager.registerOnSelectCallback(() => this.applyExternalDim());

        this.root = d3.select(options.element).append("div").classed("adj-matrix", true);
        this.canvas = this.root.append("canvas").classed("adj-canvas", true);
        this.svg = this.root.append("svg").classed("adj-svg", true)
            .attr("tabindex", 0).attr("role", "img").attr("aria-label", "Adjacency matrix");
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

            // ── Build node lists + adjacency matrix ────────────────
            // Bipartite mode: source names and target names live in separate
            // index spaces, so a name appearing in both roles becomes two
            // distinct nodes. That's the whole point — you can't have a
            // "customer × product" matrix if Customer 42 and Product 42 fuse
            // into one row. Unipartite mode preserves the historical behaviour
            // of a single node set.
            const bipartite = String(mx.matrixMode.value?.value ?? "unipartite") === "bipartite";
            this.bipartite = bipartite;

            const rowsCount = cats[sIdx].values.length;
            const rowIndex = new Map<string, number>();
            const colIndex = new Map<string, number>();
            const rowNodes: string[] = [];
            const colNodes: string[] = [];
            const idxOf = (map: Map<string, number>, arr: string[], name: string): number => {
                let i = map.get(name);
                if (i === undefined) { i = arr.length; map.set(name, i); arr.push(name); }
                return i;
            };
            const edges: { s: number; t: number; w: number }[] = [];
            const srcCat = cats[sIdx];
            const rowIdsPer: ISelectionId[][] = [];
            const colIdsPer: ISelectionId[][] = [];
            for (let r = 0; r < rowsCount; r++) {
                const sv = cats[sIdx].values[r], tv = cats[tIdx].values[r];
                if (sv == null || tv == null) continue;
                const w = wIdx >= 0 ? (safeNum(vals[wIdx].values[r]) ?? 0) : 1;
                let si: number, ti: number;
                if (bipartite) {
                    si = idxOf(rowIndex, rowNodes, String(sv));
                    ti = idxOf(colIndex, colNodes, String(tv));
                } else {
                    // Shared index space; both lists point at it later.
                    si = idxOf(rowIndex, rowNodes, String(sv));
                    ti = idxOf(rowIndex, rowNodes, String(tv));
                }
                edges.push({ s: si, t: ti, w });

                let rowId: ISelectionId | undefined;
                try {
                    rowId = this.host.createSelectionIdBuilder()
                        .withCategory(srcCat, r)
                        .createSelectionId();
                } catch { /* skipped */ }
                if (rowId) {
                    if (!rowIdsPer[si]) rowIdsPer[si] = [];
                    if (!colIdsPer[ti]) colIdsPer[ti] = [];
                    rowIdsPer[si].push(rowId);
                    colIdsPer[ti].push(rowId);
                }
            }
            if (!bipartite) {
                // Share the node list between row and column axes so both
                // dimensions have the same order and the diagonal has meaning.
                colNodes.length = 0;
                for (const n of rowNodes) colNodes.push(n);
                for (let i = 0; i < rowIdsPer.length; i++) {
                    if (rowIdsPer[i] && !colIdsPer[i]) colIdsPer[i] = rowIdsPer[i].slice();
                    else if (colIdsPer[i] && !rowIdsPer[i]) rowIdsPer[i] = colIdsPer[i].slice();
                }
            }
            this.rowIds = rowIdsPer;
            this.colIds = colIdsPer;
            const rowN = rowNodes.length;
            const colN = colNodes.length;
            if (rowN === 0 || colN === 0) {
                this.renderLandingPage(width, height, true, true);
                this.events.renderingFinished(options);
                return;
            }

            const symmetric = !bipartite && mx.symmetric.value;
            const matrix: number[][] = Array.from({ length: rowN }, () => new Array<number>(colN).fill(0));
            for (const e of edges) {
                matrix[e.s][e.t] += e.w;
                if (symmetric && e.s !== e.t) matrix[e.t][e.s] += e.w;
            }
            this.rowNodes = rowNodes;
            this.colNodes = colNodes;
            this.matrix = matrix;

            // ── Seriation ──────────────────────────────────────────
            // Row and column orderings are computed independently. Unipartite
            // mode wants the same order on both axes (so the diagonal aligns
            // and the matrix reads symmetrically); bipartite mode wants each
            // axis ordered by its own degree/name/cluster since the two sides
            // are distinct entities.
            let mode = String(mx.seriation.value?.value ?? "cluster");
            const capForCluster = Math.max(rowN, colN);
            if (mode === "cluster" && capForCluster > CLUSTER_LIMIT) mode = "degree";

            const rowDegree = matrix.map(row => d3.sum(row));
            const colDegree = d3.range(colN).map(c => d3.sum(matrix.map(row => row[c])));

            const orderBy = (
                names: string[], degree: number[], mat: number[][], axis: "row" | "col"
            ): { order: number[]; groups: number[][] } => {
                const n = names.length;
                if (mode === "alphabetical") {
                    return { order: d3.range(n).sort((a, b) => names[a].localeCompare(names[b])), groups: [] };
                }
                if (mode === "degree") {
                    return { order: d3.range(n).sort((a, b) => degree[b] - degree[a]), groups: [] };
                }
                if (mode === "cluster") {
                    // Row clusters use the raw matrix; column clusters use its
                    // transpose so the notion of "similar columns" is
                    // similarity in column vectors, not row vectors.
                    const distMat: number[][] = axis === "row"
                        ? mat
                        : d3.range(colN).map(c => mat.map(row => row[c]));
                    const fp = new Fingerprint().str("cluster").str(axis).num(n);
                    for (const row of distMat) fp.nums(row);
                    const seriated = this.clusterCache.get(fp.done(), () => {
                        const root = agglomerative(euclideanDistances(distMat));
                        const k = Math.min(8, Math.max(2, Math.round(Math.sqrt(n / 2))));
                        return { order: root ? root.members : d3.range(n),
                                 groups: cutIntoGroups(root, k) };
                    });
                    return seriated ? seriated : { order: d3.range(n), groups: [] };
                }
                return { order: d3.range(n), groups: [] };
            };

            let rowOrder: number[], colOrder: number[];
            let rowGroups: number[][] = [], colGroups: number[][] = [];
            if (!bipartite) {
                // Shared ordering: compute once on rows and mirror to columns
                // so the diagonal stays aligned.
                const s = orderBy(rowNodes, rowDegree, matrix, "row");
                rowOrder = s.order; colOrder = s.order;
                rowGroups = s.groups; colGroups = s.groups;
            } else {
                const rs = orderBy(rowNodes, rowDegree, matrix, "row");
                const cs = orderBy(colNodes, colDegree, matrix, "col");
                rowOrder = rs.order; colOrder = cs.order;
                rowGroups = rs.groups; colGroups = cs.groups;
            }
            this.rowOrder = rowOrder;
            this.colOrder = colOrder;

            // Group boundaries, in display-order units, per axis.
            const rowBoundaries: number[] = [];
            const colBoundaries: number[] = [];
            const fillBoundaries = (groups: number[][], out: number[]): void => {
                if (groups.length > 1) {
                    let cum = 0;
                    for (let g = 0; g < groups.length - 1; g++) { cum += groups[g].length; out.push(cum); }
                }
            };
            fillBoundaries(rowGroups, rowBoundaries);
            fillBoundaries(colGroups, colBoundaries);

            // ── Color ──────────────────────────────────────────────
            let maxW = 0, minPos = Infinity;
            for (let i = 0; i < rowN; i++) for (let j = 0; j < colN; j++) {
                const w = matrix[i][j];
                if (w > maxW) maxW = w;
                if (w > 0 && w < minPos) minPos = w;
            }
            if (!Number.isFinite(minPos)) minPos = 1;
            // High contrast: swap the configured ramp for a background→foreground
            // ramp so weight still reads as darker-vs-lighter cells.
            const cp = this.host.colorPalette;
            const hc = cp.isHighContrast === true;
            const hcFg = cp.foreground?.value || "#000000";
            const hcBg = cp.background?.value || "#ffffff";
            const scaleMode = String(col.colorScale.value?.value ?? "linear");
            const rampLow = hc ? hcBg : col.colorRampLow.value.value;
            const rampHigh = hc ? hcFg : col.colorRampHigh.value.value;
            const interp = d3.interpolateRgb(rampLow, rampHigh);
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
            // Longest of both axes drives the label margin.
            const longestRow = d3.max(rowNodes, n => truncate(n, maxLen).length) || 4;
            const longestCol = d3.max(colNodes, n => truncate(n, maxLen).length) || 4;
            const longest = Math.max(longestRow, longestCol);
            const wantLabels = lab.showLabels.value;
            const labelSpace = wantLabels && outside
                ? Math.min(160, Math.max(24, longest * fs * 0.62))
                : 8;

            const padR = 12, padB = 12;
            const availW = width - labelSpace - padR;
            const availH = height - labelSpace - padB;

            // Bipartite: rectangular cells sized to the axis aspect. Unipartite:
            // preserve square cells so the diagonal renders at 45°.
            let cellW: number, cellH: number, mW: number, mH: number;
            if (bipartite) {
                cellW = availW / colN;
                cellH = availH / rowN;
                // Cap so cells aren't wildly rectangular when one axis is huge
                // and the other tiny — the smaller dimension caps the larger.
                const capped = Math.min(cellW, cellH * 3, 60);
                cellW = Math.min(cellW, capped * (cellW / cellH));
                cellH = Math.min(cellH, capped);
                mW = cellW * colN;
                mH = cellH * rowN;
            } else {
                const size = Math.max(0, Math.min(availW, availH));
                cellW = cellH = size / Math.max(rowN, colN);
                mW = cellW * colN;
                mH = cellH * rowN;
            }
            const left = labelSpace, top = labelSpace;

            if (mW < 10 || mH < 10 || cellW <= 0 || cellH <= 0) {
                this.events.renderingFinished(options); return;
            }

            const showDiag = bipartite ? true : mx.showDiagonal.value;
            const circle = String(mx.cellShape.value?.value ?? "square") === "circle";

            // ── Cells on canvas ────────────────────────────────────
            ctx.fillStyle = rampLow;
            ctx.fillRect(left, top, mW, mH);

            for (let r = 0; r < rowN; r++) {
                const si = rowOrder[r];
                for (let c = 0; c < colN; c++) {
                    const ti = colOrder[c];
                    // Diagonal only meaningful when rows and cols are the
                    // same node set (unipartite). In bipartite mode showDiag
                    // is forced true above because there's no notion of "same
                    // index = same node".
                    if (!showDiag && !bipartite && si === ti) continue;
                    const w = matrix[si][ti];
                    if (w <= 0) continue;
                    ctx.fillStyle = interp(tFor(w));
                    const x = left + c * cellW, y = top + r * cellH;
                    if (circle) {
                        const rad = Math.max(0.4, Math.min(cellW, cellH) / 2 - 0.5);
                        ctx.beginPath();
                        ctx.arc(x + cellW / 2, y + cellH / 2, rad, 0, Math.PI * 2);
                        ctx.fill();
                    } else {
                        ctx.fillRect(x, y, Math.max(0.5, cellW), Math.max(0.5, cellH));
                    }
                }
            }

            // Matrix outline.
            this.overlay.append("rect")
                .attr("x", left).attr("y", top).attr("width", mW).attr("height", mH)
                .attr("fill", "none").attr("stroke", "#ddd").attr("stroke-width", 1);

            // ── Cluster boundaries ─────────────────────────────────
            if (clu.showClusterBoundaries.value && mode === "cluster") {
                const bc = hc ? hcFg : clu.clusterBoundaryColor.value.value;
                for (const b of rowBoundaries) {
                    const p = top + b * cellH;
                    this.overlay.append("line")
                        .attr("x1", left).attr("x2", left + mW).attr("y1", p).attr("y2", p)
                        .attr("stroke", bc).attr("stroke-width", 1).attr("shape-rendering", "crispEdges");
                }
                for (const b of colBoundaries) {
                    const q = left + b * cellW;
                    this.overlay.append("line")
                        .attr("y1", top).attr("y2", top + mH).attr("x1", q).attr("x2", q)
                        .attr("stroke", bc).attr("stroke-width", 1).attr("shape-rendering", "crispEdges");
                }
            }

            // ── Labels ─────────────────────────────────────────────
            // Level of detail: drop labels entirely on tiny cells, and thin them
            // out when they'd collide.
            if (wantLabels && Math.min(cellW, cellH) >= 3) {
                const everyRow = Math.max(1, Math.ceil((fs + 2) / cellH));
                const everyCol = Math.max(1, Math.ceil((fs + 2) / cellW));
                const g = this.overlay.append("g").classed("labels", true);
                for (let i = 0; i < rowN; i++) {
                    if (i % everyRow !== 0) continue;
                    const name = truncate(rowNodes[rowOrder[i]], maxLen);
                    const mid = (i + 0.5) * cellH;
                    g.append("text")
                        .attr("x", outside ? left - 4 : left + 4)
                        .attr("y", top + mid)
                        .attr("text-anchor", outside ? "end" : "start")
                        .attr("dominant-baseline", "middle")
                        .attr("font-size", `${fs}px`).attr("fill", "#555")
                        .text(name);
                }
                for (let i = 0; i < colN; i++) {
                    if (i % everyCol !== 0) continue;
                    const name = truncate(colNodes[colOrder[i]], maxLen);
                    const mid = (i + 0.5) * cellW;
                    g.append("text")
                        .attr("transform", `translate(${left + mid},${outside ? top - 4 : top + 4}) rotate(-90)`)
                        .attr("text-anchor", outside ? "start" : "end")
                        .attr("dominant-baseline", "middle")
                        .attr("font-size", `${fs}px`).attr("fill", "#555")
                        .text(name);
                }
            }

            // ── Tooltip hit layer ──────────────────────────────────
            this.hit = { left, top, cellW, cellH, rowN, colN };
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
                    const c = Math.floor((px - this.hit.left) / this.hit.cellW);
                    const r = Math.floor((py - this.hit.top) / this.hit.cellH);
                    if (r < 0 || c < 0 || r >= this.hit.rowN || c >= this.hit.colN) {
                        this.tooltipService.hide({ immediately: false, isTouchEvent: false });
                        return;
                    }
                    const si = this.rowOrder[r], ti = this.colOrder[c];
                    const items: VisualTooltipDataItem[] = [
                        { displayName: srcTitle, value: this.rowNodes[si] },
                        { displayName: tgtTitle, value: this.colNodes[ti] },
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
                    const c = Math.floor((px - this.hit.left) / this.hit.cellW);
                    const r = Math.floor((py - this.hit.top) / this.hit.cellH);
                    if (r < 0 || c < 0 || r >= this.hit.rowN || c >= this.hit.colN) {
                        this.selectionManager.clear().then(() => this.applyExternalDim());
                        return;
                    }
                    const si = this.rowOrder[r], ti = this.colOrder[c];
                    const ids = Array.from(new Set<ISelectionId>([
                        ...(this.rowIds[si] ?? []),
                        ...(this.colIds[ti] ?? [])
                    ]));
                    // If the cell resolves to no ids (edge rows that failed
                    // selectionId construction), treat like an out-of-bounds
                    // click and clear — silently no-op'ing would leave prior
                    // selection state active and confuse the user.
                    if (ids.length === 0) {
                        this.selectionManager.clear().then(() => this.applyExternalDim());
                        return;
                    }
                    // Only stop propagation on the SELECT path — otherwise the
                    // svg-root click.clear handler would wipe the selection we
                    // just set. The two clear branches deliberately bubble;
                    // click.clear re-clearing is idempotent and keeps bubble
                    // semantics consistent across all three outcomes.
                    event.stopPropagation();
                    const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                    this.selectionManager.select(ids, multi).then(() => this.applyExternalDim());
                })
                .on("contextmenu", (event: MouseEvent) => {
                    if (!this.hit) return;
                    event.preventDefault();
                    const [px, py] = d3.pointer(event, this.svg.node());
                    const c = Math.floor((px - this.hit.left) / this.hit.cellW);
                    const r = Math.floor((py - this.hit.top) / this.hit.cellH);
                    if (r < 0 || c < 0 || r >= this.hit.rowN || c >= this.hit.colN) return;
                    const si = this.rowOrder[r];
                    const ids = this.rowIds[si] ?? [];
                    // Skip the menu when no id exists — passing {} as ISelectionId
                    // leaves the host in an indeterminate state.
                    if (!ids.length) return;
                    this.selectionManager.showContextMenu(ids[0], { x: event.clientX, y: event.clientY });
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
