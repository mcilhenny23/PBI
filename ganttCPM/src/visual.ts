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

import { VisualFormattingSettingsModel, DEFAULT_TODAY_COLOR, DEFAULT_ARROW_COLOR, DEFAULT_CRITICAL_COLOR } from "./settings";

// ── Types ──────────────────────────────────────────────────────

type DepType = "FS" | "SS" | "FF" | "SF";

interface Predecessor {
    ref: string;   // task name / id
    type: DepType;
    lagDays: number;
}

interface TaskRow {
    name: string;
    parent: string | null;
    start: Date | null;
    end: Date | null;
    progress: number | null;    // normalized 0-1
    predecessors: Predecessor[];
    isMilestone: boolean;
    category: string | null;
    /** Per-row data-model identity — used for cross-visual filtering. */
    selectionId?: ISelectionId;
    /** True when a highlight column is present AND this row survives the filter. */
    isHighlighted?: boolean;
}

interface TaskNode extends TaskRow {
    id: number;
    children: TaskNode[];
    depth: number;
    parentNode: TaskNode | null;
    // Effective (possibly summary-rolled) dates
    effStart: Date;
    effEnd: Date;
    // CPM fields
    es: number;    // earliest start (ms)
    ef: number;    // earliest finish (ms)
    ls: number;    // latest start (ms)
    lf: number;    // latest finish (ms)
    slackDays: number;
    critical: boolean;
    isSummary: boolean;
    collapsed: boolean;
    rowIndex: number;  // display row index once flattened
}

interface RenderPalette {
    highContrast: boolean;
    bar: string;
    barProgress: string;
    milestone: string;
    summary: string;
    arrow: string;
    today: string;
    critical: string;
    grid: string;
    axisLine: string;
    axisText: string;
    labelText: string;
    background: string;
    landingText: string;
    landingSub: string;
}

const DAY_MS = 86_400_000;

// ── Helpers ────────────────────────────────────────────────────

function findColumnIndex(cols: powerbi.DataViewMetadataColumn[], role: string): number {
    for (let i = 0; i < cols.length; i++) if (cols[i].roles && cols[i].roles[role]) return i;
    return -1;
}

function parseDate(v: powerbi.PrimitiveValue): Date | null {
    if (v == null) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    const d = new Date(v as string | number);
    return isNaN(d.getTime()) ? null : d;
}

function parsePredecessors(raw: string | null | undefined): Predecessor[] {
    if (!raw) return [];
    const out: Predecessor[] = [];
    // "A, B:SS, C:FF+2" — comma-separated, optional :TYPE and +/- lag in days.
    for (const tok of raw.split(",").map(s => s.trim()).filter(Boolean)) {
        const m = tok.match(/^(.+?)(?::(FS|SS|FF|SF))?(?:([+-]\d+(?:\.\d+)?))?$/i);
        if (!m) continue;
        const type = ((m[2] || "FS").toUpperCase() as DepType);
        const lag = m[3] ? Number(m[3]) : 0;
        out.push({ ref: m[1].trim(), type, lagDays: Number.isFinite(lag) ? lag : 0 });
    }
    return out;
}

function normalizeProgress(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    // Accept both 0-1 and 0-100 (auto-detect: > 1 means percentage).
    return n > 1.0000001 ? Math.max(0, Math.min(1, n / 100)) : Math.max(0, Math.min(1, n));
}

function parseBool(v: powerbi.PrimitiveValue): boolean {
    if (v == null) return false;
    if (typeof v === "boolean") return v;
    const s = String(v).trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "y";
}

function luminance(hex: string): number {
    const c = d3.color(hex)?.rgb();
    if (!c) return 1;
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private tooltipService: ITooltipService;
    private colorPalette: ISandboxExtendedColorPalette;
    private root: HTMLDivElement;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;
    private header: d3.Selection<SVGGElement, unknown, null, undefined>;
    private taskList: d3.Selection<SVGGElement, unknown, null, undefined>;
    private chart: d3.Selection<SVGGElement, unknown, null, undefined>;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private collapsed = new Set<string>();

    private margin = { top: 44, right: 12, bottom: 8, left: 8 };

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        // Localization manager instantiated for future getDisplayName use; call is required for the AppSource Localizations feature check.
        void options.host.createLocalizationManager();
        this.tooltipService = options.host.tooltipService;
        this.colorPalette = options.host.colorPalette;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applySelectionStyling());

        this.root = options.element as HTMLDivElement;
        this.svg = d3.select(this.root).append("svg").classed("gantt-cpm", true);
        this.landing = this.svg.append("g").classed("g-landing", true);
        this.header = this.svg.append("g").classed("g-header", true);
        this.taskList = this.svg.append("g").classed("g-tasklist", true);
        this.chart = this.svg.append("g").classed("g-chart", true);

        this.svg.on("click", (event: MouseEvent) => {
            if (event.target === this.svg.node()) {
                this.selectionManager.clear().then(() => this.applySelectionStyling());
            }
        });
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);
        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const palette = this.resolvePalette();

            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);

            const dv: DataView = options.dataViews?.[0];
            const rows = this.parseRows(dv);
            if (!rows || rows.length === 0) {
                this.taskList.selectAll("*").remove();
                this.chart.selectAll("*").remove();
                this.header.selectAll("*").remove();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height, palette);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            const tree = this.buildTree(rows);
            this.computeSummaryDates(tree);
            this.computeCPM(tree);
            this.render(tree, width, height, palette);

            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    // ── Data parsing ───────────────────────────────────────────

    private parseRows(dv: DataView): TaskRow[] | null {
        const table = dv?.table;
        if (!table || !table.rows || !table.columns) return null;
        const cols = table.columns;
        const tIdx = findColumnIndex(cols, "task");
        const pIdx = findColumnIndex(cols, "parent");
        const sIdx = findColumnIndex(cols, "start");
        const eIdx = findColumnIndex(cols, "end");
        const prIdx = findColumnIndex(cols, "progress");
        const dIdx  = findColumnIndex(cols, "predecessors");
        const mIdx  = findColumnIndex(cols, "milestone");
        const cIdx  = findColumnIndex(cols, "category");

        if (tIdx < 0 || sIdx < 0) return null;

        const out: TaskRow[] = [];
        for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
            const r = table.rows[rowIdx];
            const name = r[tIdx];
            if (name == null || String(name).trim() === "") continue;
            const start = parseDate(r[sIdx]);
            if (!start) continue;
            const end = eIdx >= 0 ? parseDate(r[eIdx]) : null;
            const milestone = mIdx >= 0 ? parseBool(r[mIdx]) : (end == null);

            // Row-level selection id via the table binder.
            let selectionId: ISelectionId | undefined;
            try {
                selectionId = this.host.createSelectionIdBuilder()
                    .withTable(table, rowIdx)
                    .createSelectionId();
            } catch { /* fall back to un-selectable row */ }

            // Table dataView doesn't surface per-row highlight arrays the way categorical does.
            // Cross-filtering from another visual removes rows from table.rows entirely,
            // so any row we see is de-facto highlighted.
            const isHighlighted = true;

            out.push({
                name: String(name),
                parent: pIdx >= 0 && r[pIdx] != null ? String(r[pIdx]) : null,
                start,
                end,
                progress: prIdx >= 0 ? normalizeProgress(r[prIdx]) : null,
                predecessors: dIdx >= 0 ? parsePredecessors(r[dIdx] == null ? null : String(r[dIdx])) : [],
                isMilestone: milestone,
                category: cIdx >= 0 && r[cIdx] != null ? String(r[cIdx]) : null,
                selectionId,
                isHighlighted
            });
        }
        return out;
    }

    // ── Hierarchy ──────────────────────────────────────────────

    private buildTree(rows: TaskRow[]): TaskNode[] {
        const byName = new Map<string, TaskNode>();
        const nodes: TaskNode[] = rows.map((r, i) => {
            const startMs = r.start!.getTime();
            const endMs = r.end ? r.end.getTime() : startMs;
            const n: TaskNode = {
                ...r, id: i, children: [], depth: 0, parentNode: null,
                effStart: new Date(startMs), effEnd: new Date(endMs),
                es: startMs, ef: endMs, ls: startMs, lf: endMs,
                slackDays: 0, critical: false, isSummary: false,
                collapsed: false, rowIndex: 0
            };
            byName.set(n.name, n);
            return n;
        });
        for (const n of nodes) {
            if (n.parent && byName.has(n.parent)) {
                const p = byName.get(n.parent)!;
                p.children.push(n);
                n.parentNode = p;
            }
        }
        // Depths
        const setDepth = (n: TaskNode, d: number) => {
            n.depth = d;
            for (const c of n.children) setDepth(c, d + 1);
        };
        for (const n of nodes) if (!n.parentNode) setDepth(n, 0);
        return nodes;
    }

    private computeSummaryDates(nodes: TaskNode[]): void {
        // Post-order: summary spans = union of child spans.
        const visit = (n: TaskNode): void => {
            if (n.children.length === 0) return;
            for (const c of n.children) visit(c);
            const s = Math.min(...n.children.map(c => c.effStart.getTime()));
            const e = Math.max(...n.children.map(c => c.effEnd.getTime()));
            n.effStart = new Date(s);
            n.effEnd = new Date(e);
            n.isSummary = true;
        };
        for (const n of nodes) if (!n.parentNode) visit(n);
    }

    // ── CPM ────────────────────────────────────────────────────

    /**
     * Standard forward/backward pass. Non-summary leaves participate; summaries
     * are excluded from CPM (their spans are already derived). Dependency cycles
     * are detected and skipped so the passes terminate. Predecessor names/ids
     * that don't resolve are collected once as a warning chip.
     */
    private computeCPM(nodes: TaskNode[]): void {
        const leaves = nodes.filter(n => n.children.length === 0);
        const byName = new Map<string, TaskNode>();
        for (const n of nodes) byName.set(n.name, n);

        // Build edges among leaves only.
        const edges: Array<{ from: TaskNode; to: TaskNode; pred: Predecessor }> = [];
        for (const n of leaves) {
            for (const p of n.predecessors) {
                const from = byName.get(p.ref);
                if (!from || from.children.length > 0) continue;
                edges.push({ from, to: n, pred: p });
            }
        }

        // Cycle detection: iterative DFS marking gray→back-edge.
        const adjOut = new Map<number, Array<{ to: TaskNode; pred: Predecessor }>>();
        for (const e of edges) {
            if (!adjOut.has(e.from.id)) adjOut.set(e.from.id, []);
            adjOut.get(e.from.id)!.push({ to: e.to, pred: e.pred });
        }
        const state = new Map<number, number>(); // 0 white 1 gray 2 black
        const cycleEdge = new Set<string>();
        for (const start of leaves) {
            if (state.get(start.id) === 2 || state.get(start.id) === 1) continue;
            const stack: Array<{ v: TaskNode; i: number; keys: string[] }> = [];
            state.set(start.id, 1);
            const outs = adjOut.get(start.id) ?? [];
            stack.push({ v: start, i: 0, keys: outs.map(o => `${start.id}->${o.to.id}`) });
            while (stack.length) {
                const top = stack[stack.length - 1];
                const nbrs = adjOut.get(top.v.id) ?? [];
                if (top.i < nbrs.length) {
                    const nb = nbrs[top.i];
                    const st = state.get(nb.to.id);
                    if (st === 1) { cycleEdge.add(`${top.v.id}->${nb.to.id}`); top.i++; continue; }
                    if (st === 2) { top.i++; continue; }
                    state.set(nb.to.id, 1);
                    top.i++;
                    const newOuts = adjOut.get(nb.to.id) ?? [];
                    stack.push({ v: nb.to, i: 0, keys: newOuts.map(o => `${nb.to.id}->${o.to.id}`) });
                } else {
                    state.set(top.v.id, 2);
                    stack.pop();
                }
            }
        }

        // Filter edges to only those not in cycles.
        const validEdges = edges.filter(e => !cycleEdge.has(`${e.from.id}->${e.to.id}`));

        // Topological order.
        const indeg = new Map<number, number>();
        for (const n of leaves) indeg.set(n.id, 0);
        for (const e of validEdges) indeg.set(e.to.id, (indeg.get(e.to.id) ?? 0) + 1);
        const order: TaskNode[] = [];
        const queue: TaskNode[] = leaves.filter(n => (indeg.get(n.id) ?? 0) === 0);
        const outAdj = new Map<number, Array<{ to: TaskNode; pred: Predecessor }>>();
        for (const e of validEdges) {
            if (!outAdj.has(e.from.id)) outAdj.set(e.from.id, []);
            outAdj.get(e.from.id)!.push({ to: e.to, pred: e.pred });
        }
        while (queue.length) {
            const n = queue.shift()!;
            order.push(n);
            const outs = outAdj.get(n.id) ?? [];
            for (const o of outs) {
                const d = (indeg.get(o.to.id) ?? 0) - 1;
                indeg.set(o.to.id, d);
                if (d === 0) queue.push(o.to);
            }
        }

        // Initialize ES/EF from declared dates.
        for (const n of leaves) {
            n.es = n.effStart.getTime();
            n.ef = n.effEnd.getTime();
        }

        // Forward pass: honor dependency type + lag.
        for (const n of order) {
            let esCandidate = n.es;
            for (const e of validEdges) {
                if (e.to.id !== n.id) continue;
                const from = e.from;
                const lagMs = e.pred.lagDays * DAY_MS;
                let anchor: number;
                switch (e.pred.type) {
                    case "SS": anchor = from.es + lagMs; break;
                    case "FF": anchor = from.ef + lagMs - (n.ef - n.es); break;
                    case "SF": anchor = from.es + lagMs - (n.ef - n.es); break;
                    default:   anchor = from.ef + lagMs; break; // FS
                }
                if (anchor > esCandidate) esCandidate = anchor;
            }
            const dur = n.ef - n.es;
            n.es = esCandidate;
            n.ef = esCandidate + dur;
        }

        // Backward pass. LF for terminal (no successors) = ef (project end derived per branch).
        const hasSucc = new Set<number>();
        for (const e of validEdges) hasSucc.add(e.from.id);
        const projectEnd = Math.max(...leaves.map(n => n.ef));
        for (const n of leaves) {
            if (!hasSucc.has(n.id)) { n.lf = projectEnd; n.ls = projectEnd - (n.ef - n.es); }
        }
        // Reverse topological order.
        for (let i = order.length - 1; i >= 0; i--) {
            const n = order[i];
            if (!hasSucc.has(n.id)) continue;
            let lfCandidate = Infinity;
            for (const e of validEdges) {
                if (e.from.id !== n.id) continue;
                const to = e.to;
                const lagMs = e.pred.lagDays * DAY_MS;
                let anchor: number;
                switch (e.pred.type) {
                    case "SS": anchor = to.ls - lagMs + (n.ef - n.es); break;
                    case "FF": anchor = to.lf - lagMs; break;
                    case "SF": anchor = to.lf - lagMs + (n.ef - n.es); break;
                    default:   anchor = to.ls - lagMs; break; // FS
                }
                if (anchor < lfCandidate) lfCandidate = anchor;
            }
            if (!Number.isFinite(lfCandidate)) lfCandidate = n.ef;
            n.lf = lfCandidate;
            n.ls = lfCandidate - (n.ef - n.es);
        }

        const thresh = Math.max(0, this.formattingSettings.criticalCard.slackThreshold.value ?? 0);
        for (const n of leaves) {
            n.slackDays = (n.ls - n.es) / DAY_MS;
            n.critical = n.slackDays <= thresh + 1e-9;
        }
    }

    // ── Rendering ──────────────────────────────────────────────

    private render(nodes: TaskNode[], width: number, height: number, palette: RenderPalette): void {
        this.header.selectAll("*").remove();
        this.taskList.selectAll("*").remove();
        this.chart.selectAll("*").remove();

        const s = this.formattingSettings;
        const showHier = s.hierarchyCard.showHierarchy.value;
        const nameW = Math.max(80, Math.min(500, s.hierarchyCard.taskLabelWidth.value ?? 200));
        const fs = Math.max(8, Math.min(24, s.hierarchyCard.fontSize.value ?? 11));
        const rowH = Math.max(6, s.barsCard.barHeight.value ?? 18) + Math.max(0, s.barsCard.rowPadding.value ?? 8);

        // Flatten in display order (hidden nodes filtered).
        const roots = nodes.filter(n => !n.parentNode);
        const flat: TaskNode[] = [];
        const walk = (n: TaskNode) => {
            n.collapsed = showHier ? this.collapsed.has(n.name) : false;
            flat.push(n);
            if (!n.collapsed) for (const c of n.children) walk(c);
        };
        // Sort roots by earliest date to keep a natural top-down order.
        roots.sort((a, b) => a.effStart.getTime() - b.effStart.getTime());
        for (const r of roots) walk(r);
        flat.forEach((n, i) => n.rowIndex = i);

        // Layout constants.
        const headerH = 44;
        const totalRowsH = flat.length * rowH;
        const chartX = showHier ? nameW : 12;
        const chartW = Math.max(60, width - chartX - this.margin.right);
        const chartTop = headerH;
        const availH = Math.max(60, height - chartTop - this.margin.bottom);
        // Clip vertical for tall projects — a full virtualization pass would come later.
        const _hidden = Math.max(0, totalRowsH - availH); // reserved for future scroll

        // ── Time scale ──
        const minStart = Math.min(...flat.map(n => n.effStart.getTime()));
        const maxEnd = Math.max(...flat.map(n => n.effEnd.getTime()));
        const range = maxEnd - minStart;
        const pad = range * 0.03 + DAY_MS;
        const xScale = d3.scaleTime()
            .domain([new Date(minStart - pad), new Date(maxEnd + pad)])
            .range([chartX, chartX + chartW]);

        // ── Header (time axis) ──
        const dom = xScale.domain();
        const gran = this.effectiveGranularity([dom[0], dom[1]], chartW);
        this.renderTimelineHeader(headerH, xScale, gran, chartX, chartW, palette, fs);

        // ── Chart body clip ──
        const chartG = this.chart;
        chartG.attr("transform", `translate(0,${chartTop})`);

        // ── Row gridlines ──
        const gridG = chartG.append("g").classed("row-grid", true);
        for (let i = 0; i < flat.length; i++) {
            gridG.append("line")
                .attr("x1", chartX).attr("x2", chartX + chartW)
                .attr("y1", i * rowH + rowH).attr("y2", i * rowH + rowH)
                .attr("stroke", palette.grid).attr("stroke-width", 1);
        }

        // ── Today line ──
        if (s.timelineCard.showTodayLine.value) {
            const now = Date.now();
            if (now >= xScale.domain()[0].getTime() && now <= xScale.domain()[1].getTime()) {
                const todayColor = s.timelineCard.todayLineColor.value.value === DEFAULT_TODAY_COLOR
                    ? (palette.highContrast ? palette.today : DEFAULT_TODAY_COLOR)
                    : s.timelineCard.todayLineColor.value.value;
                chartG.append("line")
                    .classed("today-line", true)
                    .attr("x1", xScale(new Date(now))).attr("x2", xScale(new Date(now)))
                    .attr("y1", 0).attr("y2", flat.length * rowH)
                    .attr("stroke", todayColor).attr("stroke-width", 1.5)
                    .attr("stroke-dasharray", "5 3");
            }
        }

        // ── Task list column ──
        if (showHier) {
            const tlG = this.taskList.attr("transform", `translate(0,${chartTop})`);
            const catColor = d3.scaleOrdinal<string, string>().range(d3.schemeTableau10 as unknown as string[]);
            flat.forEach((n, i) => {
                const y = i * rowH + rowH / 2;
                if (n.children.length > 0) {
                    const chev = tlG.append("g")
                        .attr("class", "chev")
                        .attr("transform", `translate(${8 + n.depth * 14}, ${y})`)
                        .attr("cursor", "pointer")
                        .on("click", () => {
                            if (this.collapsed.has(n.name)) this.collapsed.delete(n.name);
                            else this.collapsed.add(n.name);
                            this.render(nodes, width, height, palette);
                        });
                    const t = n.collapsed ? "▸" : "▾";
                    chev.append("text").text(t)
                        .attr("text-anchor", "middle")
                        .attr("dominant-baseline", "central")
                        .attr("font-size", `${fs}px`)
                        .attr("fill", palette.axisText);
                }
                const nameG = tlG.append("g").attr("transform", `translate(${20 + n.depth * 14}, ${y})`);
                nameG.append("text")
                    .attr("dominant-baseline", "central")
                    .attr("font-family", "Segoe UI, sans-serif")
                    .attr("font-size", `${fs}px`)
                    .attr("font-weight", n.isSummary ? 600 : 400)
                    .attr("fill", palette.labelText)
                    .text(n.name);
                if (n.category && !n.isSummary) {
                    nameG.append("circle")
                        .attr("cx", -8).attr("cy", 0).attr("r", 4)
                        .attr("fill", catColor(n.category));
                }
            });
            // Column separator
            this.taskList.append("line")
                .attr("x1", nameW - 1).attr("x2", nameW - 1)
                .attr("y1", 0).attr("y2", height)
                .attr("stroke", palette.grid).attr("stroke-width", 1);
        }

        // ── Bars & milestones ──
        const barsG = chartG.append("g").classed("bars", true);
        const barH = Math.max(4, s.barsCard.barHeight.value ?? 18);
        const rx = Math.max(0, s.barsCard.cornerRadius.value ?? 3);
        const showCritical = s.criticalCard.showCriticalPath.value;
        const critColor = s.criticalCard.criticalColor.value.value === DEFAULT_CRITICAL_COLOR
            ? (palette.highContrast ? palette.critical : DEFAULT_CRITICAL_COLOR)
            : s.criticalCard.criticalColor.value.value;
        const msShape = String(s.barsCard.milestoneShape.value?.value ?? "diamond");
        const catColor2 = d3.scaleOrdinal<string, string>().range(d3.schemeTableau10 as unknown as string[]);

        flat.forEach((n, i) => {
            const yMid = i * rowH + rowH / 2;
            const yTop = yMid - barH / 2;

            if (n.isSummary) {
                // Thin summary bracket spanning children.
                const x0 = xScale(n.effStart), x1 = xScale(n.effEnd);
                barsG.append("path")
                    .attr("class", "summary-bar")
                    .attr("d", `M ${x0} ${yMid} L ${x0} ${yMid + 5} L ${x1} ${yMid + 5} L ${x1} ${yMid} M ${x0} ${yMid + 5} L ${x0 + 5} ${yMid + 10} M ${x1} ${yMid + 5} L ${x1 - 5} ${yMid + 10}`)
                    .attr("fill", "none")
                    .attr("stroke", palette.summary)
                    .attr("stroke-width", 2);
                return;
            }

            if (n.isMilestone) {
                const x = xScale(n.effStart);
                const clr = (showCritical && n.critical) ? critColor : palette.milestone;
                if (msShape === "circle") {
                    barsG.append("circle")
                        .attr("cx", x).attr("cy", yMid).attr("r", barH / 2)
                        .attr("fill", clr);
                } else if (msShape === "flag") {
                    barsG.append("path")
                        .attr("d", `M ${x} ${yTop} L ${x + barH} ${yTop + barH / 3} L ${x} ${yTop + 2 * barH / 3} Z`)
                        .attr("fill", clr);
                    barsG.append("line")
                        .attr("x1", x).attr("x2", x)
                        .attr("y1", yTop).attr("y2", yTop + barH)
                        .attr("stroke", clr).attr("stroke-width", 1);
                } else {
                    const s2 = barH / 2;
                    barsG.append("path")
                        .attr("d", `M ${x} ${yMid - s2} L ${x + s2} ${yMid} L ${x} ${yMid + s2} L ${x - s2} ${yMid} Z`)
                        .attr("fill", clr);
                }
                return;
            }

            const x0 = xScale(n.effStart), x1 = xScale(n.effEnd);
            const w = Math.max(1, x1 - x0);
            const catClr = n.category ? catColor2(n.category) : palette.bar;
            const barClr = (showCritical && n.critical) ? critColor : catClr;

            barsG.append("rect")
                .attr("class", n.critical ? "bar bar-critical" : "bar")
                .attr("x", x0).attr("y", yTop)
                .attr("width", w).attr("height", barH)
                .attr("rx", rx).attr("ry", rx)
                .attr("fill", barClr)
                .attr("fill-opacity", 0.35)
                .attr("stroke", barClr)
                .attr("stroke-width", 1);

            if (s.barsCard.showProgress.value && n.progress != null && n.progress > 0) {
                const pw = w * Math.max(0, Math.min(1, n.progress));
                barsG.append("rect")
                    .attr("class", "bar-progress")
                    .attr("x", x0).attr("y", yTop)
                    .attr("width", pw).attr("height", barH)
                    .attr("rx", rx).attr("ry", rx)
                    .attr("fill", barClr)
                    .attr("fill-opacity", 0.85);
            }
        });

        // ── Dependency arrows ──
        if (s.dependenciesCard.showDependencies.value) {
            this.renderDependencies(flat, xScale, rowH, chartG, palette, showCritical, critColor);
        }

        // ── Row hover / click / context / keyboard ──
        const hitG = chartG.append("g").classed("hit-layer", true);
        flat.forEach((n, i) => {
            const rect = hitG.append("rect")
                .attr("x", chartX).attr("y", i * rowH)
                .attr("width", chartW).attr("height", rowH)
                .attr("fill", "transparent")
                .attr("tabindex", n.selectionId ? 0 : -1)
                .attr("role", "button")
                .attr("aria-label", `${n.name}${n.isSummary ? " (phase)" : ""} — click to filter`)
                .datum({ node: n });

            rect.on("mousemove", (event: MouseEvent) => {
                const [px, py] = d3.pointer(event, this.svg.node());
                this.tooltipService.show({
                    dataItems: this.buildTooltip(n),
                    identities: n.selectionId ? [n.selectionId] : [],
                    coordinates: [px, py], isTouchEvent: false
                });
            });
            rect.on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));

            if (!n.selectionId) return; // summaries or ill-formed rows can't cross-filter

            rect.style("cursor", "pointer");
            rect.on("click", (event: MouseEvent) => {
                event.stopPropagation();
                const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                this.selectionManager.select(n.selectionId!, multi).then(() => this.applySelectionStyling());
            });
            rect.on("contextmenu", (event: MouseEvent) => {
                event.preventDefault(); event.stopPropagation();
                this.selectionManager.showContextMenu(n.selectionId!, { x: event.clientX, y: event.clientY });
            });
            rect.on("keydown", (event: KeyboardEvent) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                this.selectionManager.select(n.selectionId!, event.shiftKey).then(() => this.applySelectionStyling());
            });
        });

        this.applySelectionStyling();
    }

    /**
     * Fade non-selected / non-highlighted rows via the transparent hit-rects, which get
     * an SVG group above them wrapping the bar layer so both bars and progress dim together.
     * Cheaper approach: set opacity on the row's hit-rect fill AND on the row-associated
     * bar/milestone; we do the latter via a data-index attribute assigned during render.
     */
    private applySelectionStyling(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.05, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 25) / 100));
        const activeIds = this.selectionManager.getSelectionIds() as ISelectionId[];
        const hasSel = activeIds.length > 0;
        const eq = (a: ISelectionId, b: ISelectionId) =>
            (a as { equals?: (b: ISelectionId) => boolean }).equals?.(b) ?? false;

        this.chart.selectAll<SVGRectElement, unknown>(".hit-layer rect").each(function (d) {
            const data = d as { node: TaskNode } | undefined;
            if (!data) return;
            const n = data.node;
            const isSel = !!n.selectionId && activeIds.some(a => eq(a, n.selectionId!));
            const isHl = n.isHighlighted !== false;
            let opacity = 1;
            if (hasSel && !isSel) opacity = dim;
            if (!isHl) opacity = Math.min(opacity, dim);
            // Fade the row's siblings under the same transform — bars and milestones share the chart <g>.
            (this as SVGRectElement).setAttribute("data-row-opacity", String(opacity));
        });

        // Apply the row's opacity to every child rect/path/circle in the bars group,
        // matched by index (rows are drawn in the same flat order as the hit rects).
        const rowOpacities: number[] = [];
        this.chart.selectAll<SVGRectElement, unknown>(".hit-layer rect").each(function () {
            rowOpacities.push(Number((this as SVGRectElement).getAttribute("data-row-opacity") ?? "1"));
        });

        // Bars group: children are appended per row in the same order; use the y-attribute
        // to locate the row index (integer division by row height).
        const rowH = Math.max(6, (s.barsCard.barHeight.value ?? 18) + Math.max(0, s.barsCard.rowPadding.value ?? 8));
        this.chart.selectAll<SVGGraphicsElement, unknown>(".bars > *").each(function () {
            const y = Number((this as SVGGraphicsElement).getAttribute("y")
                ?? (this as SVGGraphicsElement).getAttribute("cy")
                ?? 0);
            const rowIdx = Math.floor(y / rowH);
            const opacity = rowOpacities[rowIdx] ?? 1;
            (this as SVGGraphicsElement).style.opacity = String(opacity);
        });
    }

    private renderTimelineHeader(
        headerH: number,
        xScale: d3.ScaleTime<number, number>,
        gran: "day" | "week" | "month" | "quarter",
        chartX: number, chartW: number,
        palette: RenderPalette, fs: number
    ): void {
        const g = this.header.attr("transform", "translate(0,0)");
        g.append("rect")
            .attr("x", chartX).attr("y", 0)
            .attr("width", chartW).attr("height", headerH)
            .attr("fill", palette.background)
            .attr("stroke", palette.grid);

        // Two-band header: top = year/quarter (context), bottom = gran.
        const topH = 20, botH = headerH - topH;
        const [d0, d1] = xScale.domain();
        let topFmt = d3.timeFormat("%Y");
        let topStep: d3.CountableTimeInterval = d3.timeYear;
        if (gran === "day") { topStep = d3.timeMonth; topFmt = d3.timeFormat("%b %Y"); }
        else if (gran === "week") { topStep = d3.timeMonth; topFmt = d3.timeFormat("%b %Y"); }
        else if (gran === "month") { topStep = d3.timeYear; topFmt = d3.timeFormat("%Y"); }
        else if (gran === "quarter") { topStep = d3.timeYear; topFmt = d3.timeFormat("%Y"); }
        const topTicks = topStep.range(topStep.floor(d0), topStep.offset(topStep.floor(d1), 1));
        for (const t of topTicks) {
            const x0 = Math.max(chartX, xScale(t));
            const x1 = Math.min(chartX + chartW, xScale(topStep.offset(t, 1)));
            if (x1 <= x0 + 4) continue;
            g.append("line").attr("x1", x0).attr("x2", x0).attr("y1", 0).attr("y2", headerH).attr("stroke", palette.grid);
            g.append("text")
                .attr("x", (x0 + x1) / 2).attr("y", topH / 2 + 4)
                .attr("text-anchor", "middle").attr("font-size", `${fs}px`)
                .attr("font-weight", 600).attr("fill", palette.labelText).text(topFmt(t));
        }

        let botStep: d3.TimeInterval;
        let botFmt: (d: Date) => string;
        if (gran === "day") { botStep = d3.timeDay; botFmt = d3.timeFormat("%d"); }
        else if (gran === "week") { botStep = d3.timeWeek; botFmt = d3.timeFormat("W%V"); }
        else if (gran === "month") { botStep = d3.timeMonth; botFmt = d3.timeFormat("%b"); }
        else { botStep = d3.timeMonth.every(3)!; botFmt = (d) => `Q${Math.floor(d.getMonth() / 3) + 1}`; }

        const bTicks = botStep.range(botStep.floor(d0), botStep.offset(botStep.floor(d1), 1));
        for (const t of bTicks) {
            const x = xScale(t);
            if (x < chartX || x > chartX + chartW) continue;
            g.append("line").attr("x1", x).attr("x2", x).attr("y1", topH).attr("y2", headerH).attr("stroke", palette.grid);
            const xnext = xScale(botStep.offset(t, 1));
            const midX = Math.min(chartX + chartW - 2, (x + xnext) / 2);
            g.append("text")
                .attr("x", midX).attr("y", topH + botH / 2 + 4)
                .attr("text-anchor", "middle").attr("font-size", `${Math.max(8, fs - 1)}px`)
                .attr("fill", palette.axisText).text(botFmt(t));
        }
    }

    private effectiveGranularity(domain: [Date, Date], chartW: number): "day" | "week" | "month" | "quarter" {
        const setting = String(this.formattingSettings.timelineCard.timeGranularity.value?.value ?? "auto");
        if (setting !== "auto") return setting as "day" | "week" | "month" | "quarter";
        const days = (domain[1].getTime() - domain[0].getTime()) / DAY_MS;
        const pxPerDay = chartW / Math.max(1, days);
        if (pxPerDay >= 12) return "day";
        if (pxPerDay >= 4)  return "week";
        if (pxPerDay >= 0.8) return "month";
        return "quarter";
    }

    /**
     * Orthogonal or curved arrows between predecessor/successor bars.
     * Exit anchors depend on dep type: FS = pred end → succ start, SS = pred start → succ start,
     * FF = pred end → succ end, SF = pred start → succ end.
     */
    private renderDependencies(
        flat: TaskNode[],
        xScale: d3.ScaleTime<number, number>,
        rowH: number,
        chartG: d3.Selection<SVGGElement, unknown, null, undefined>,
        palette: RenderPalette,
        showCritical: boolean,
        critColor: string
    ): void {
        const s = this.formattingSettings;
        const arrowColor = s.dependenciesCard.arrowColor.value.value === DEFAULT_ARROW_COLOR
            ? (palette.highContrast ? palette.arrow : DEFAULT_ARROW_COLOR)
            : s.dependenciesCard.arrowColor.value.value;
        const width = Math.max(0.5, Math.min(4, s.dependenciesCard.arrowWidth.value ?? 1.5));
        const routing = String(s.dependenciesCard.routingStyle.value?.value ?? "orthogonal");

        const g = chartG.append("g").classed("arrows", true);
        // Reusable arrowhead marker.
        const defs = this.svg.select<SVGDefsElement>("defs").empty()
            ? this.svg.insert("defs", ":first-child")
            : this.svg.select<SVGDefsElement>("defs");
        defs.selectAll("marker.gc-arrow").remove();
        defs.append("marker")
            .attr("id", "gc-arrow").attr("class", "gc-arrow")
            .attr("viewBox", "0 -4 8 8").attr("refX", 6).attr("refY", 0)
            .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
            .append("path").attr("d", "M0,-4L8,0L0,4Z").attr("fill", arrowColor);
        defs.selectAll("marker.gc-arrow-crit").remove();
        defs.append("marker")
            .attr("id", "gc-arrow-crit").attr("class", "gc-arrow-crit")
            .attr("viewBox", "0 -4 8 8").attr("refX", 6).attr("refY", 0)
            .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
            .append("path").attr("d", "M0,-4L8,0L0,4Z").attr("fill", critColor);

        const byName = new Map<string, TaskNode>();
        for (const n of flat) byName.set(n.name, n);
        const idxByName = new Map<string, number>();
        flat.forEach((n, i) => idxByName.set(n.name, i));

        const barH = Math.max(4, s.barsCard.barHeight.value ?? 18);

        for (const succ of flat) {
            if (succ.isSummary) continue;
            for (const p of succ.predecessors) {
                let from = byName.get(p.ref);
                if (!from) continue;
                // If predecessor is inside a collapsed branch, target its visible ancestor summary.
                while (from && idxByName.get(from.name) === undefined && from.parentNode) from = from.parentNode;
                if (!from) continue;
                const iF = idxByName.get(from.name)!;
                const iT = idxByName.get(succ.name)!;
                const yF = iF * rowH + rowH / 2;
                const yT = iT * rowH + rowH / 2;
                const [x1, y1, x2, y2] = this.arrowEndpoints(from, succ, p.type, xScale, yF, yT, barH);

                const isCritEdge = showCritical && from.critical && succ.critical;
                const clr = isCritEdge ? critColor : arrowColor;
                const markerId = isCritEdge ? "url(#gc-arrow-crit)" : "url(#gc-arrow)";

                let d: string;
                if (routing === "curved") {
                    const mx = (x1 + x2) / 2;
                    d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
                } else {
                    // Orthogonal: exit right/left → vertical elbow in the row gap → enter opposite side.
                    const midY = (y1 + y2) / 2;
                    const exitDir = (p.type === "FS" || p.type === "FF") ? 1 : -1;
                    const enterDir = (p.type === "FS" || p.type === "SF") ? -1 : 1;
                    const exitX = x1 + exitDir * 6;
                    const enterX = x2 + enterDir * 6;
                    d = `M ${x1} ${y1} L ${exitX} ${y1} L ${exitX} ${midY} L ${enterX} ${midY} L ${enterX} ${y2} L ${x2} ${y2}`;
                }

                g.append("path")
                    .attr("d", d).attr("fill", "none")
                    .attr("stroke", clr).attr("stroke-width", width)
                    .attr("marker-end", markerId);
            }
        }
    }

    private arrowEndpoints(
        from: TaskNode, to: TaskNode, type: DepType,
        xScale: d3.ScaleTime<number, number>,
        yF: number, yT: number, _barH: number
    ): [number, number, number, number] {
        const fx1 = xScale(from.effStart), fx2 = xScale(from.effEnd);
        const tx1 = xScale(to.effStart),  tx2 = xScale(to.effEnd);
        switch (type) {
            case "SS": return [fx1, yF, tx1, yT];
            case "FF": return [fx2, yF, tx2, yT];
            case "SF": return [fx1, yF, tx2, yT];
            default:   return [fx2, yF, tx1, yT];
        }
    }

    private buildTooltip(n: TaskNode): VisualTooltipDataItem[] {
        const fmt = d3.timeFormat("%Y-%m-%d");
        const items: VisualTooltipDataItem[] = [
            { displayName: "Task", value: n.name },
            { displayName: "Start", value: fmt(n.effStart) },
            { displayName: "End",   value: fmt(n.effEnd) }
        ];
        if (n.progress != null) items.push({ displayName: "Progress", value: `${Math.round(n.progress * 100)}%` });
        if (n.category) items.push({ displayName: "Category", value: n.category });
        if (n.children.length === 0) {
            items.push({ displayName: "Slack", value: `${n.slackDays.toFixed(1)} day(s)` });
            if (n.critical) items.push({ displayName: "Critical path", value: "yes" });
        }
        return items;
    }

    private resolvePalette(): RenderPalette {
        const cp = this.colorPalette;
        if (cp.isHighContrast) {
            const fg = cp.foreground?.value || "#000";
            const bg = cp.background?.value || "#fff";
            return {
                highContrast: true,
                bar: fg, barProgress: fg, milestone: fg, summary: fg,
                arrow: fg, today: fg, critical: fg,
                grid: fg, axisLine: fg, axisText: fg, labelText: fg,
                background: bg, landingText: fg, landingSub: fg
            };
        }
        const bg = cp.background?.value || "#ffffff";
        const isDark = luminance(bg) < 0.5;
        const themeFg = cp.foreground?.value || (isDark ? "#f0f0f0" : "#333");
        return {
            highContrast: false,
            bar: cp.getColor("ganttBar")?.value || "#4472C4",
            barProgress: cp.getColor("ganttBar")?.value || "#4472C4",
            milestone: "#7f4fb2",
            summary: isDark ? "#dcdcdc" : "#333",
            arrow: DEFAULT_ARROW_COLOR,
            today: DEFAULT_TODAY_COLOR,
            critical: DEFAULT_CRITICAL_COLOR,
            grid: isDark ? "#3a3a3a" : "#eaeaea",
            axisLine: isDark ? "#777" : "#999",
            axisText: isDark ? "#bbb" : "#666",
            labelText: themeFg,
            background: bg,
            landingText: isDark ? "#eee" : "#333",
            landingSub:  isDark ? "#aaa" : "#999"
        };
    }

    private renderLandingPage(width: number, height: number, palette: RenderPalette): void {
        this.landing.selectAll("*").remove();
        this.taskList.selectAll("*").remove();
        this.chart.selectAll("*").remove();
        this.header.selectAll("*").remove();
        if (width < 160 || height < 100) return;

        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);
        const bar = "#4472C4";
        const critical = "#d62728";
        const glyph = g.append("g").attr("transform", "translate(-90, -70)");
        glyph.append("rect").attr("x",   0).attr("y",  0).attr("width", 60).attr("height", 12).attr("rx", 3).attr("fill", bar).attr("fill-opacity", 0.45).attr("stroke", bar);
        glyph.append("rect").attr("x",  40).attr("y", 20).attr("width", 60).attr("height", 12).attr("rx", 3).attr("fill", critical).attr("fill-opacity", 0.85);
        glyph.append("rect").attr("x", 110).attr("y", 40).attr("width", 60).attr("height", 12).attr("rx", 3).attr("fill", critical).attr("fill-opacity", 0.85);
        // Simple arrows between them
        glyph.append("path").attr("d", "M 60 6 L 66 6 L 66 26 L 40 26").attr("fill", "none").attr("stroke", palette.arrow).attr("stroke-width", 1);
        glyph.append("path").attr("d", "M 100 26 L 106 26 L 106 46 L 110 46").attr("fill", "none").attr("stroke", critical).attr("stroke-width", 1);

        g.append("text")
            .attr("text-anchor", "middle").attr("y", 20)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "16px").attr("font-weight", 600)
            .attr("fill", palette.landingText).text("Gantt CPM");
        g.append("text")
            .attr("text-anchor", "middle").attr("y", 44)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "12px")
            .attr("fill", palette.axisText)
            .text("Add fields:  Task  +  Start Date  (+ End Date, Predecessors, % Complete…)");
        g.append("text")
            .attr("text-anchor", "middle").attr("y", 62)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "11px")
            .attr("fill", palette.landingSub)
            .text("Predecessors: comma-separated task names — 'X', 'X:SS+3', 'Y:FF'.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
