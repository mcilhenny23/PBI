"use strict";

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";
import * as dagre from "dagre";
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
    EventRow, CaseTrace, Variant, Dfg, DfgEdge, ReferenceModel, ConformanceReport,
    ReworkReport,
    buildTraces, buildDfg, buildVariants, metricOf, edgeKey, variantEdgeKeys,
    parseReference, referenceFromVariant, conformance, computeRework
} from "./processMining";
import { Fingerprint, ComputeCache } from "./computeCache";

const ROW_LIMIT = 30000;

// ── Helpers ────────────────────────────────────────────────────

function safeTime(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    if (v instanceof Date) return v.getTime();
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    const p = Date.parse(String(v));
    return Number.isFinite(p) ? p : null;
}

function safeNum(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, Math.max(1, max - 1)) + "…" : s;
}

const intFmt = d3.format(",.0f");
const numFmt = d3.format(",.3~s");

/** Human-readable duration from milliseconds. */
function fmtDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0";
    const s = ms / 1000;
    if (s < 90) return `${s.toFixed(1)}s`;
    const m = s / 60;
    if (m < 90) return `${m.toFixed(1)}m`;
    const h = m / 60;
    if (h < 48) return `${h.toFixed(1)}h`;
    return `${(h / 24).toFixed(1)}d`;
}

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private tooltipService: ITooltipService;
    private selectionManager: ISelectionManager;

    private root: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private mapDiv: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private panelDiv: d3.Selection<HTMLDivElement, unknown, null, undefined>;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;
    private plot: d3.Selection<SVGGElement, unknown, null, undefined>;

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    // Parsed model, retained so a variant click can re-render without re-parsing.
    private traces: CaseTrace[] = [];
    private variants: Variant[] = [];
    private dfg: Dfg | null = null;
    private selectedVariant: string | null = null;
    private ambiguous = 0;
    private truncated = false;
    private viewport = { width: 0, height: 0 };
    /** Selection IDs for every row, grouped by caseId — powers cross-filter on variant click. */
    private selectionByCase = new Map<string, powerbi.visuals.ISelectionId[]>();

    /** Caches the dagre layout so variant clicks and restyles don't relayout. */
    private layoutCache = new ComputeCache<dagre.graphlib.Graph>();

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applyExternalDim());

        this.root = d3.select(options.element).append("div").classed("dfg-root", true);
        this.mapDiv = this.root.append("div").classed("dfg-map", true);
        this.panelDiv = this.root.append("div").classed("dfg-panel", true);
        this.svg = this.mapDiv.append("svg").classed("dfg-svg", true);
        this.landing = this.svg.append("g").classed("dfg-landing", true);
        this.plot = this.svg.append("g").classed("dfg-plot", true);

        this.svg.on("click.clear", (event: MouseEvent) => {
            if (event.target === this.svg.node()) {
                this.selectionManager.clear().then(() => this.applyExternalDim());
            }
        });

        // Arrowhead markers, one per role. Colours are patched at render time.
        // Kept in userSpaceOnUse so marker size doesn't track stroke-width —
        // otherwise the heaviest edges sprout arrowheads bigger than the nodes.
        const defs = this.svg.append("defs");
        for (const id of ["dfg-arrow", "dfg-arrow-conform", "dfg-arrow-violation", "dfg-arrow-missing"]) {
            defs.append("marker")
                .attr("id", id)
                .attr("viewBox", "0 0 10 10")
                .attr("refX", 10).attr("refY", 5)
                .attr("markerWidth", 9).attr("markerHeight", 9)
                .attr("markerUnits", "userSpaceOnUse")
                .attr("orient", "auto-start-reverse")
                .append("path")
                .attr("d", "M 0 0 L 10 5 L 0 10 z")
                .attr("fill", "#999");
        }
    }

    private applyExternalDim(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.1, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 30) / 100));
        const hasSel = this.selectionManager.getSelectionIds().length > 0;
        this.plot.attr("opacity", hasSel ? dim : 1);
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);

            this.viewport = { width: options.viewport.width, height: options.viewport.height };

            const dataView: DataView = options.dataViews?.[0];
            const table = dataView?.table;
            const cols = table?.columns;
            const roleCol = (role: string): number =>
                cols ? cols.findIndex(c => c.roles && c.roles[role]) : -1;
            const cCase = roleCol("caseId"), cAct = roleCol("activity"), cTs = roleCol("timestamp");
            const cRes = roleCol("resource"), cVal = roleCol("value");

            if (!table?.rows?.length || cCase < 0 || cAct < 0) {
                this.traces = []; this.variants = []; this.dfg = null;
                this.renderLandingPage(cCase >= 0, cAct >= 0, cTs >= 0);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            // ── Parse rows ─────────────────────────────────────────
            const rows: EventRow[] = [];
            this.selectionByCase = new Map();
            for (let i = 0; i < table.rows.length; i++) {
                const r = table.rows[i];
                if (r[cCase] == null || r[cAct] == null) continue;
                // With no timestamp column, fall back to row order within the case.
                const ts = cTs >= 0 ? safeTime(r[cTs]) : i;
                const caseId = String(r[cCase]);
                rows.push({
                    caseId,
                    activity: String(r[cAct]),
                    timestamp: ts == null ? i : ts,
                    resource: cRes >= 0 && r[cRes] != null ? String(r[cRes]) : null,
                    value: cVal >= 0 ? safeNum(r[cVal]) : null
                });
                // One row-level selection id per event, grouped by case so a
                // variant click can select every row belonging to any case in
                // the variant — Power BI cross-filters downstream visuals by
                // those rows.
                try {
                    const sid = this.host.createSelectionIdBuilder()
                        .withTable(table, i)
                        .createSelectionId();
                    let arr = this.selectionByCase.get(caseId);
                    if (!arr) { arr = []; this.selectionByCase.set(caseId, arr); }
                    arr.push(sid);
                } catch { /* skipped */ }
            }
            this.truncated = table.rows.length >= ROW_LIMIT;

            const built = buildTraces(rows);
            this.traces = built.traces;
            this.ambiguous = built.ambiguous;
            this.variants = buildVariants(this.traces);
            this.dfg = buildDfg(this.traces);

            // Drop a stale selection if the data changed underneath it.
            if (this.selectedVariant && !this.variants.some(v => v.key === this.selectedVariant)) {
                this.selectedVariant = null;
            }

            this.render();
            this.applyExternalDim();
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    /**
     * Draw the map and the variant panel from the retained model.
     *
     * Layout is always computed from the *full* graph, even when a variant is
     * selected: the selection highlights a path rather than re-laying-out, so
     * the map stays put and you can see where the variant sits in the whole
     * process instead of losing your bearings on every click.
     */
    private render(): void {
        if (!this.dfg) return;
        const D = this.formattingSettings.dfgCard;
        const V = this.formattingSettings.variantsCard;
        const N = this.formattingSettings.nodesCard;
        const E = this.formattingSettings.edgesCard;

        const width = this.viewport.width, height = this.viewport.height;
        const showPanel = V.showVariants.value && width >= 420;
        const panelPct = Math.max(15, Math.min(50, V.variantPanelWidth.value ?? 30));
        const panelW = showPanel ? Math.round(width * panelPct / 100) : 0;
        const mapW = Math.max(50, width - panelW);

        this.root.style("width", `${width}px`).style("height", `${height}px`);
        this.mapDiv.style("width", `${mapW}px`).style("height", `${height}px`);
        this.panelDiv
            .style("display", showPanel ? "block" : "none")
            .style("width", `${panelW}px`).style("height", `${height}px`);
        this.svg.attr("width", mapW).attr("height", height);
        this.plot.selectAll("*").remove();

        const metric = String(D.edgeMetric.value?.value ?? "frequency");
        const threshold = Math.max(0, D.frequencyThreshold.value ?? 0);
        const showLoops = D.showLoops.value;
        const fs = Math.max(6, N.nodeFontSize.value);

        // ── Conformance ──────────────────────────────────────────
        // Compute the classification up-front so edge/node draw code can pull
        // colours from it. Reference-only edges are held for a post-layout
        // overlay pass — dagre never sees them, so toggling conformance on/off
        // never disturbs the map layout.
        const C = this.formattingSettings.conformanceCard;
        const conformOn = C.showConformance.value && this.dfg != null;
        let reference: ReferenceModel | null = null;
        let report: ConformanceReport | null = null;
        if (conformOn) {
            const src = String(C.referenceSource.value?.value ?? "manual");
            if (src === "top-variant" && this.variants.length) {
                reference = referenceFromVariant(this.variants[0]);
            } else {
                reference = parseReference(String(C.referenceEdges.value ?? ""));
            }
            report = conformance(this.dfg!, this.traces, reference);
        }

        // ── Rework ────────────────────────────────────────────────
        // Compute unconditionally when the summary or badges are on so both
        // features share one pass over the traces. Cheap: O(cases × avg
        // trace length), no cache needed.
        const R = this.formattingSettings.reworkCard;
        const reworkOn = (R.showRework.value || R.showReworkBadges.value) && this.dfg != null;
        const rework: ReworkReport | null = reworkOn
            ? computeRework(this.dfg!, this.traces)
            : null;
        const badgeActs = new Set<string>();
        if (rework && R.showReworkBadges.value) {
            const n = Math.max(0, Math.min(20, Math.round(R.reworkBadgeCount.value ?? 3)));
            for (let i = 0; i < Math.min(n, rework.reworkPerActivity.length); i++) {
                badgeActs.add(rework.reworkPerActivity[i].activity);
            }
        }

        // ── Prune ──────────────────────────────────────────────
        const kept: DfgEdge[] = [];
        for (const e of this.dfg.edges.values()) {
            if (e.count < threshold) continue;
            if (e.source === e.target && !showLoops) continue;
            kept.push(e);
        }
        const selfLoops = kept.filter(e => e.source === e.target);
        const flowEdges = kept.filter(e => e.source !== e.target);

        // Only keep activities still connected (or present at all if nothing survives).
        const liveNodes = new Set<string>();
        for (const e of kept) { liveNodes.add(e.source); liveNodes.add(e.target); }
        if (liveNodes.size === 0) for (const a of this.dfg.activityFreq.keys()) liveNodes.add(a);

        // ── Dagre layout ───────────────────────────────────────
        const rankdir = String(D.layoutDirection.value?.value ?? "LR");
        const nodeH = N.showFrequencyLabel.value ? fs * 2.7 + 8 : fs * 1.9 + 8;
        const nodeMinW = N.nodeMinWidth.value ?? 80;

        // Layout is keyed on the graph's *shape*, deliberately not on the
        // selection: clicking a variant only changes which path is highlighted,
        // so re-running dagre there would be pure waste - and node positions
        // have to stay put anyway, or the user loses their bearings on what is
        // meant to be a stable map of the process.
        const layoutKey = new Fingerprint()
            .str(rankdir).num(nodeH).num(nodeMinW).num(fs)
            .strs(Array.from(liveNodes).sort())
            .strs(flowEdges.map(e => e.source + " -> " + e.target).sort())
            .done();

        const g = this.layoutCache.get(layoutKey, () => {
            const gg = new dagre.graphlib.Graph();
            gg.setGraph({ rankdir, ranksep: 62, nodesep: 26, marginx: 10, marginy: 10 });
            gg.setDefaultEdgeLabel(() => ({}));
            for (const a of liveNodes) {
                const label = truncate(a, 26);
                const w = Math.max(nodeMinW, label.length * fs * 0.62 + 20);
                gg.setNode(a, { width: w, height: nodeH, label });
            }
            for (const e of flowEdges) {
                gg.setEdge(e.source, e.target, { weight: Math.max(1, e.count) });
            }
            dagre.layout(gg);
            return gg;
        })!;

        const gr = g.graph();
        const gw = Math.max(1, gr.width || 1), gh = Math.max(1, gr.height || 1);
        const reworkSummaryOn = R.showRework.value && rework != null;
        const hasWarning = this.truncated || this.ambiguous > 0;
        const twoLines = reworkSummaryOn && hasWarning;
        const noteH = twoLines ? 32
            : (hasWarning || (conformOn && report) || reworkSummaryOn ? 20 : 0);
        const availW = mapW - 12, availH = height - 12 - noteH;
        const scale = Math.min(availW / gw, availH / gh, 1.5);
        const tx = (mapW - gw * scale) / 2;
        const ty = noteH + (height - noteH - gh * scale) / 2;
        this.plot.attr("transform", `translate(${tx},${ty}) scale(${scale})`);

        // ── Warnings ───────────────────────────────────────────
        this.svg.selectAll("text.dfg-note").remove();
        this.svg.selectAll("text.dfg-rework-note").remove();
        if (noteH > 0) {
            const msgs: string[] = [];
            if (this.truncated) msgs.push(`Showing the first ${intFmt(ROW_LIMIT)} events — the log is truncated, so counts may be incomplete.`);
            if (this.ambiguous > 0) msgs.push(`${intFmt(this.ambiguous)} case(s) have tied timestamps; event order there is a guess.`);
            if (msgs.length) {
                this.svg.append("text").classed("dfg-note", true)
                    .attr("x", 8).attr("y", 14)
                    .attr("font-size", "11px").attr("fill", "#b26a00")
                    .text(msgs.join("  ·  "));
            }
        }

        // ── Rework summary ────────────────────────────────────
        // Left-aligned, same row as warnings when there are none; otherwise
        // shares the row — both are short strings and the warning triggers
        // are rare in practice.
        if (reworkSummaryOn && rework) {
            const pct = rework.totalCases > 0
                ? Math.round(rework.reworkCases / rework.totalCases * 100)
                : 0;
            const parts: string[] = [
                `${pct}% of ${intFmt(rework.totalCases)} cases have rework`,
                `${intFmt(rework.reworkEvents)} re-visit${rework.reworkEvents === 1 ? "" : "s"}`,
                `${intFmt(rework.selfLoopEvents)} self-loop${rework.selfLoopEvents === 1 ? "" : "s"}`
            ];
            if (rework.reworkValue !== 0) parts.push(`rework cost ${numFmt(rework.reworkValue)}`);
            if (rework.reworkPerActivity.length) {
                const top = rework.reworkPerActivity[0];
                parts.push(`top: ${top.activity} (${intFmt(top.extraVisits)})`);
            }
            this.svg.append("text").classed("dfg-rework-note", true)
                .attr("x", 8).attr("y", twoLines ? 28 : 14)
                .attr("font-size", "11px").attr("fill", "#243b53")
                .attr("font-weight", 600)
                .text(`Rework · ${parts.join(" · ")}`);
        }

        // ── Conformance summary ───────────────────────────────
        this.svg.selectAll("text.dfg-conform").remove();
        if (conformOn && report && reference) {
            const totalEdges = report.conformingEdges.size + report.violationEdges.size;
            const edgePct = totalEdges ? Math.round(report.conformingEdges.size / totalEdges * 100) : 0;
            const casePct = report.totalCases ? Math.round(report.conformingCases / report.totalCases * 100) : 0;
            const parts: string[] = [
                `${casePct}% of ${intFmt(report.totalCases)} cases fully conform`,
                `${edgePct}% of ${intFmt(totalEdges)} distinct transitions`,
                `${intFmt(report.violationEdges.size)} violation${report.violationEdges.size === 1 ? "" : "s"}`,
                `${intFmt(report.missingEdges.size)} missing`
            ];
            if (report.unmappableEdgeCount) parts.push(`${intFmt(report.unmappableEdgeCount)} reference edge${report.unmappableEdgeCount === 1 ? "" : "s"} unmappable`);
            if (reference.invalidLines.length) parts.push(`${reference.invalidLines.length} unparseable ref line${reference.invalidLines.length === 1 ? "" : "s"}`);
            this.svg.append("text").classed("dfg-conform", true)
                .attr("x", mapW - 8).attr("y", 14)
                .attr("text-anchor", "end")
                .attr("font-size", "11px").attr("fill", "#243b53")
                .attr("font-weight", 600)
                .text(`Conformance · ${parts.join(" · ")}`);
        }

        // ── Metric scale ───────────────────────────────────────
        const metricVals = flowEdges.map(e => metricOf(e, metric));
        const maxMetric = metricVals.length ? Math.max(...metricVals) : 1;
        const minW = Math.max(0.5, E.edgeMinWidth.value ?? 1);
        const maxW = Math.max(minW, E.edgeMaxWidth.value ?? 8);
        const wScale = d3.scaleSqrt().domain([0, maxMetric || 1]).range([minW, maxW]);
        const fmtMetric = (e: DfgEdge): string =>
            metric === "mean-duration" ? fmtDuration(metricOf(e, metric))
                : metric === "total-value" ? numFmt(metricOf(e, metric))
                    : intFmt(e.count);

        // Selected variant → the edges it traverses.
        const sel = this.selectedVariant
            ? this.variants.find(v => v.key === this.selectedVariant) || null
            : null;
        const pathEdges = sel ? variantEdgeKeys(sel) : null;
        const pathNodes = sel ? new Set(sel.sequence) : null;

        // Recolour arrowheads in place. Each marker paints in a distinct role
        // colour so an edge only has to pick the right marker id — no
        // per-edge marker defs needed.
        this.svg.select("#dfg-arrow path").attr("fill", E.edgeColor.value.value);
        this.svg.select("#dfg-arrow-conform path").attr("fill", C.conformingColor.value.value);
        this.svg.select("#dfg-arrow-violation path").attr("fill", C.violationColor.value.value);
        this.svg.select("#dfg-arrow-missing path").attr("fill", C.missingColor.value.value);

        // Pick the stroke and arrowhead for an edge. Non-conformance mode
        // falls back to the plain edge colour. Reference-only "missing" edges
        // never reach this function; they're overlaid separately below.
        const edgeStyle = (k: string): { stroke: string; marker: string } => {
            if (!conformOn || !report) return { stroke: E.edgeColor.value.value, marker: "url(#dfg-arrow)" };
            if (report.conformingEdges.has(k)) return { stroke: C.conformingColor.value.value, marker: "url(#dfg-arrow-conform)" };
            return { stroke: C.violationColor.value.value, marker: "url(#dfg-arrow-violation)" };
        };

        // ── Edges ──────────────────────────────────────────────
        const edgeLayer = this.plot.append("g").classed("edges", true);
        const lineGen = d3.line<{ x: number; y: number }>()
            .x(d => d.x).y(d => d.y).curve(d3.curveBasis);

        for (const e of flowEdges) {
            const ge = g.edge({ v: e.source, w: e.target });
            if (!ge || !ge.points) continue;
            const onPath = !pathEdges || pathEdges.has(edgeKey(e.source, e.target));
            const w = wScale(metricOf(e, metric));
            const style = edgeStyle(edgeKey(e.source, e.target));
            edgeLayer.append("path")
                .attr("d", lineGen(ge.points as { x: number; y: number }[]))
                .attr("fill", "none")
                .attr("stroke", style.stroke)
                .attr("stroke-width", onPath ? w : Math.min(w, 1.2))
                .attr("stroke-opacity", onPath ? 0.9 : 0.12)
                .attr("marker-end", style.marker)
                .style("cursor", "default")
                .on("mousemove", (event: MouseEvent) => this.showEdgeTooltip(event, e, metric, report))
                .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));

            if (E.showEdgeLabel.value && onPath) {
                const pts = ge.points as { x: number; y: number }[];
                const mid = pts[Math.floor(pts.length / 2)];
                edgeLayer.append("text")
                    .attr("x", mid.x).attr("y", mid.y - 3)
                    .attr("text-anchor", "middle")
                    .attr("font-size", `${Math.max(8, fs - 3)}px`)
                    .attr("fill", "#666")
                    .attr("paint-order", "stroke")
                    .attr("stroke", "#fff").attr("stroke-width", 3)
                    .text(fmtMetric(e));
            }
        }

        // ── Self-loops ─────────────────────────────────────────
        for (const e of selfLoops) {
            const nd = g.node(e.source);
            if (!nd) continue;
            const onPath = !pathEdges || pathEdges.has(edgeKey(e.source, e.target));
            const r = nodeH * 0.55;
            const cx = nd.x + nd.width / 2 - 6, cy = nd.y - nd.height / 2;
            const style = edgeStyle(edgeKey(e.source, e.target));
            edgeLayer.append("path")
                .attr("d", `M ${cx - 8} ${cy} C ${cx - 6} ${cy - r * 1.7}, ${cx + r} ${cy - r * 1.7}, ${cx + 2} ${cy}`)
                .attr("fill", "none")
                .attr("stroke", style.stroke)
                .attr("stroke-width", onPath ? wScale(metricOf(e, metric)) : 1)
                .attr("stroke-opacity", onPath ? 0.9 : 0.12)
                .attr("marker-end", style.marker)
                .on("mousemove", (event: MouseEvent) => this.showEdgeTooltip(event, e, metric, report))
                .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));
        }

        // ── Missing edges overlay ──────────────────────────────
        // Reference edges the log never took. Drawn as dashed straight lines
        // between node centres because they weren't in dagre's layout — so
        // toggling conformance on/off never disturbs the map.
        if (conformOn && report && C.showMissing.value && report.missingEdges.size) {
            const missingLayer = this.plot.append("g").classed("missing-edges", true);
            const missingColor = C.missingColor.value.value;
            for (const k of report.missingEdges) {
                const sp = k.indexOf(" ");
                const s = k.slice(0, sp), t = k.slice(sp + 1);
                const nA = g.node(s), nB = g.node(t);
                if (!nA || !nB) continue;
                missingLayer.append("path")
                    .attr("d", `M ${nA.x} ${nA.y} L ${nB.x} ${nB.y}`)
                    .attr("fill", "none")
                    .attr("stroke", missingColor)
                    .attr("stroke-width", 1.4)
                    .attr("stroke-opacity", 0.75)
                    .attr("stroke-dasharray", "5 4")
                    .attr("marker-end", "url(#dfg-arrow-missing)")
                    .on("mousemove", (event: MouseEvent) => {
                        const [px, py] = d3.pointer(event, this.svg.node());
                        this.tooltipService.show({
                            dataItems: [
                                { displayName: "Missing transition", value: `${s} → ${t}` },
                                { displayName: "Status", value: "In reference, never observed" }
                            ],
                            identities: [], coordinates: [px, py], isTouchEvent: false
                        });
                    })
                    .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));
            }
        }

        // ── Nodes ──────────────────────────────────────────────
        const nodeLayer = this.plot.append("g").classed("nodes", true);
        for (const a of liveNodes) {
            const nd = g.node(a);
            if (!nd) continue;
            const onPath = !pathNodes || pathNodes.has(a);
            const freq = this.dfg.activityFreq.get(a) || 0;
            const gNode = nodeLayer.append("g")
                .attr("transform", `translate(${nd.x - nd.width / 2},${nd.y - nd.height / 2})`)
                .attr("opacity", onPath ? 1 : 0.22)
                .on("mousemove", (event: MouseEvent) => {
                    const [px, py] = d3.pointer(event, this.svg.node());
                    const items: VisualTooltipDataItem[] = [
                        { displayName: "Activity", value: a },
                        { displayName: "Occurrences", value: intFmt(freq) }
                    ];
                    const st = this.dfg!.startActivities.get(a) || 0;
                    const en = this.dfg!.endActivities.get(a) || 0;
                    if (st) items.push({ displayName: "Starts a case", value: `${intFmt(st)}×` });
                    if (en) items.push({ displayName: "Ends a case", value: `${intFmt(en)}×` });
                    this.tooltipService.show({
                        dataItems: items, identities: [],
                        coordinates: [px, py], isTouchEvent: false
                    });
                })
                .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));

            gNode.append("rect")
                .attr("width", nd.width).attr("height", nd.height)
                .attr("rx", 5)
                .attr("fill", N.nodeColor.value.value)
                .attr("fill-opacity", 0.14)
                .attr("stroke", N.nodeColor.value.value)
                .attr("stroke-width", 1.4);

            gNode.append("text")
                .attr("x", nd.width / 2)
                .attr("y", N.showFrequencyLabel.value ? fs * 1.25 : nd.height / 2)
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", N.showFrequencyLabel.value ? "auto" : "middle")
                .attr("font-size", `${fs}px`).attr("font-weight", 600)
                .attr("fill", "#243b53")
                .text(nd.label as string);

            if (N.showFrequencyLabel.value) {
                gNode.append("text")
                    .attr("x", nd.width / 2).attr("y", fs * 2.4)
                    .attr("text-anchor", "middle")
                    .attr("font-size", `${Math.max(8, fs - 3)}px`)
                    .attr("fill", "#6b7c93")
                    .text(intFmt(freq));
            }

            // Rework badge — a small ↺ circle in the top-right corner of the
            // node for activities that are frequent re-visits. Positioned
            // outside the node so it doesn't collide with the activity name.
            if (badgeActs.has(a) && rework) {
                const stat = rework.reworkPerActivity.find(x => x.activity === a);
                if (stat) {
                    const r = Math.max(7, fs * 0.65);
                    const bx = nd.width - r * 0.4;
                    const by = -r * 0.4;
                    const badgeColor = R.reworkBadgeColor.value.value;
                    gNode.append("circle")
                        .attr("cx", bx).attr("cy", by).attr("r", r)
                        .attr("fill", badgeColor)
                        .attr("stroke", "#fff").attr("stroke-width", 1.5);
                    gNode.append("text")
                        .attr("x", bx).attr("y", by + 1)
                        .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
                        .attr("font-size", `${Math.max(9, fs - 1)}px`).attr("font-weight", 700)
                        .attr("fill", "#fff")
                        .style("pointer-events", "none")
                        .text("↺");
                    gNode.append("title").text(
                        `Rework hotspot · ${a}: ${intFmt(stat.extraVisits)} re-visit(s) across ${intFmt(stat.casesAffected)} case(s)`
                    );
                }
            }
        }

        // ── Variant panel ──────────────────────────────────────
        if (showPanel) this.renderVariantPanel(N.nodeColor.value.value, fs);
        else this.panelDiv.selectAll("*").remove();
    }

    private showEdgeTooltip(event: MouseEvent, e: DfgEdge, metric: string, report: ConformanceReport | null): void {
        const [px, py] = d3.pointer(event, this.svg.node());
        const items: VisualTooltipDataItem[] = [
            { displayName: "Transition", value: `${e.source} → ${e.target}` },
            { displayName: "Frequency", value: intFmt(e.count) }
        ];
        if (e.totalDuration > 0) {
            items.push({ displayName: "Mean duration", value: fmtDuration(e.totalDuration / Math.max(1, e.count)) });
        }
        if (e.totalValue !== 0) {
            items.push({ displayName: "Total value", value: numFmt(e.totalValue) });
        }
        if (e.source === e.target) items.push({ displayName: "Type", value: "Self-loop (rework)" });
        if (report) {
            const k = edgeKey(e.source, e.target);
            items.push({
                displayName: "Conformance",
                value: report.conformingEdges.has(k) ? "Conforming (in reference)" : "Violation (not in reference)"
            });
        }
        this.tooltipService.show({
            dataItems: items, identities: [],
            coordinates: [px, py], isTouchEvent: false
        });
    }

    /** Ranked variant list; clicking one highlights its path in the map. */
    private renderVariantPanel(accent: string, fs: number): void {
        const V = this.formattingSettings.variantsCard;
        const topN = Math.max(1, Math.round(V.variantCount.value ?? 10));
        const shown = this.variants.slice(0, topN);
        const covered = shown.reduce((a, v) => a + v.count, 0);
        const total = this.traces.length || 1;

        this.panelDiv.selectAll("*").remove();

        const header = this.panelDiv.append("div").classed("vp-header", true);
        header.append("div").classed("vp-title", true)
            .text(`Variants (${intFmt(this.variants.length)})`);
        header.append("div").classed("vp-sub", true)
            .text(`Top ${shown.length} cover ${Math.round(covered / total * 100)}% of ${intFmt(total)} cases`);

        if (this.selectedVariant) {
            header.append("button").classed("vp-clear", true)
                .text("Clear selection")
                .on("click", () => {
                    this.selectedVariant = null;
                    // Also drop the report-level filter — otherwise the
                    // in-visual "clear" would leave other visuals dimmed.
                    this.selectionManager.clear().then(() => this.applyExternalDim());
                    this.render();
                });
        }

        const list = this.panelDiv.append("div").classed("vp-list", true);
        shown.forEach((v, i) => {
            const selected = this.selectedVariant === v.key;
            const row = list.append("div")
                .classed("vp-row", true)
                .classed("selected", selected)
                .on("click", (event: MouseEvent) => {
                    this.selectedVariant = selected ? null : v.key;
                    // Cross-filter the report: gather every row-level
                    // selection id for the cases in this variant and pass
                    // them to the selection manager. Clicking the same
                    // variant a second time clears (parity with in-visual
                    // toggle behaviour).
                    if (this.selectedVariant) {
                        const ids: powerbi.visuals.ISelectionId[] = [];
                        for (const caseId of v.caseIds) {
                            const arr = this.selectionByCase.get(caseId);
                            if (arr) for (const id of arr) ids.push(id);
                        }
                        // Multi-select flag preserves any pre-existing
                        // cross-highlight if the user shift-clicks.
                        const multi = event.shiftKey || event.ctrlKey || event.metaKey;
                        this.selectionManager.select(ids, multi)
                            .then(() => this.applyExternalDim());
                    } else {
                        this.selectionManager.clear().then(() => this.applyExternalDim());
                    }
                    this.render();
                });

            const top = row.append("div").classed("vp-row-top", true);
            top.append("span").classed("vp-rank", true).text(`#${i + 1}`);
            top.append("span").classed("vp-count", true)
                .text(`${intFmt(v.count)} cases · ${(v.share * 100).toFixed(1)}%`);

            // Proportion bar so relative volume is readable at a glance.
            row.append("div").classed("vp-bar", true)
                .append("div").classed("vp-bar-fill", true)
                .style("width", `${Math.max(2, v.share * 100)}%`)
                .style("background", accent);

            const chips = row.append("div").classed("vp-chips", true);
            const maxChips = 7;
            v.sequence.slice(0, maxChips).forEach((a, k) => {
                if (k > 0) chips.append("span").classed("vp-arrow", true).text("›");
                chips.append("span").classed("vp-chip", true)
                    .style("background", selected ? `${accent}38` : `${accent}1f`)
                    .text(truncate(a, 14));
            });
            if (v.sequence.length > maxChips) {
                chips.append("span").classed("vp-more", true)
                    .text(` +${v.sequence.length - maxChips}`);
            }
        });
    }

    private renderLandingPage(hasCase: boolean, hasAct: boolean, hasTs: boolean): void {
        const width = this.viewport.width, height = this.viewport.height;
        this.plot.selectAll("*").remove();
        this.panelDiv.selectAll("*").remove().style("display", "none");
        this.svg.selectAll("text.dfg-note").remove();
        this.root.style("width", `${width}px`).style("height", `${height}px`);
        this.mapDiv.style("width", `${width}px`).style("height", `${height}px`);
        this.svg.attr("width", width).attr("height", height);
        this.landing.selectAll("*").remove();
        if (width < 170 || height < 120) return;

        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        // Glyph: a small process map with a rework loop.
        const glyph = g.append("g").attr("transform", "translate(-110,-92)");
        const boxes = [[0, 20], [76, 20], [152, 0], [152, 44]];
        boxes.forEach(([bx, by]) => {
            glyph.append("rect").attr("x", bx).attr("y", by).attr("width", 58).attr("height", 24)
                .attr("rx", 4).attr("fill", "#4682B4").attr("fill-opacity", 0.16)
                .attr("stroke", "#4682B4").attr("stroke-width", 1.2);
        });
        ["M58,32 L76,32", "M134,32 L152,12", "M134,32 L152,56"].forEach(d =>
            glyph.append("path").attr("d", d).attr("stroke", "#999").attr("stroke-width", 1.4).attr("fill", "none"));
        glyph.append("path").attr("d", "M92,20 C92,2 128,2 128,20")
            .attr("stroke", "#999").attr("stroke-width", 1.4).attr("fill", "none");

        g.append("text").attr("text-anchor", "middle").attr("y", 8)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px")
            .attr("font-weight", 600).attr("fill", "#333").text("Process Map & Variant Explorer");

        const missing: string[] = [];
        if (!hasCase) missing.push("Case ID");
        if (!hasAct) missing.push("Activity");
        g.append("text").attr("text-anchor", "middle").attr("y", 30)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666")
            .text(missing.length ? "Add fields:  " + missing.join("   +   ") : "Add Case ID and Activity to begin");
        g.append("text").attr("text-anchor", "middle").attr("y", 52)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
            .attr("fill", "#999")
            .text(hasTs ? "One row per event. Timestamp orders events within each case."
                : "Add a Timestamp so events can be ordered within each case.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
