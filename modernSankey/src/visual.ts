"use strict";

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";
import { sankey as d3sankey, sankeyLinkHorizontal, sankeyJustify, sankeyLeft, sankeyRight, sankeyCenter, SankeyGraph, SankeyNode, SankeyLink } from "d3-sankey";
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
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel, DEFAULT_NODE_COLOR, DEFAULT_CYCLE_COLOR } from "./settings";

// ── Types ──────────────────────────────────────────────────────

interface RawEdge {
    source: string;
    target: string;
    weight: number;
    linkCategory?: string;
}

interface NodeExtra {
    name: string;
    baseName: string;    // pre-"(return)" name
    color?: string;
    level?: number;
}
interface LinkExtra {
    weight: number;
    category?: string;
    isCycleEdge?: boolean;
}
type MyNode = SankeyNode<NodeExtra, LinkExtra>;
type MyLink = SankeyLink<NodeExtra, LinkExtra>;

interface RenderPalette {
    highContrast: boolean;
    single: string;
    border: string;
    cycle: string;
    axisText: string;
    labelText: string;
    background: string;
    landingText: string;
    landingSub: string;
}

// ── Helpers ────────────────────────────────────────────────────

function safeNum(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function findCategoryIndex(cats: powerbi.DataViewCategoryColumn[] | undefined, role: string): number {
    if (!cats) return -1;
    for (let i = 0; i < cats.length; i++) {
        if (cats[i].source.roles && cats[i].source.roles[role]) return i;
    }
    return -1;
}

function findValueIndex(values: powerbi.DataViewValueColumns, role: string): number {
    for (let i = 0; i < values.length; i++) {
        if (values[i].source.roles && values[i].source.roles[role]) return i;
    }
    return -1;
}

function luminance(hex: string): number {
    const c = d3.color(hex)?.rgb();
    if (!c) return 1;
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

/**
 * DFS-based feedback-arc-set heuristic.
 * Returns the set of edge indices that, if removed, make the graph acyclic.
 * Not minimum, but sufficient and O(V+E).
 */
function findBackEdges(nodeCount: number, edges: Array<{ s: number; t: number; idx: number }>): Set<number> {
    const adj: Array<Array<{ t: number; idx: number }>> = Array.from({ length: nodeCount }, () => []);
    for (const e of edges) adj[e.s].push({ t: e.t, idx: e.idx });

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Array<number>(nodeCount).fill(WHITE);
    const back = new Set<number>();

    // Iterative DFS to avoid stack overflows on large graphs.
    for (let root = 0; root < nodeCount; root++) {
        if (color[root] !== WHITE) continue;
        const stack: Array<{ v: number; i: number }> = [{ v: root, i: 0 }];
        color[root] = GRAY;
        while (stack.length) {
            const top = stack[stack.length - 1];
            const nbrs = adj[top.v];
            if (top.i < nbrs.length) {
                const { t, idx } = nbrs[top.i++];
                if (color[t] === GRAY) {
                    back.add(idx);
                } else if (color[t] === WHITE) {
                    color[t] = GRAY;
                    stack.push({ v: t, i: 0 });
                }
            } else {
                color[top.v] = BLACK;
                stack.pop();
            }
        }
    }
    return back;
}

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private tooltipService: ITooltipService;
    private colorPalette: ISandboxExtendedColorPalette;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;
    private defs: d3.Selection<SVGDefsElement, unknown, null, undefined>;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    /** Live per-node color assigned this render; used by highlight/dim on hover. */
    private nodeColorByName = new Map<string, string>();

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.colorPalette = options.host.colorPalette;
        this.formattingSettingsService = new FormattingSettingsService();

        this.svg = d3.select(options.element)
            .append("svg")
            .classed("modern-sankey", true);

        this.defs = this.svg.append("defs");
        this.landing = this.svg.append("g").classed("ms-landing", true);
        this.container = this.svg.append("g").classed("ms-container", true);
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
            const edges = this.parseEdges(dv);
            if (!edges || edges.length === 0) {
                this.container.selectAll("*").remove();
                this.defs.selectAll("*").remove();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height, palette);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            this.render(edges, width, height, palette);
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private parseEdges(dv: DataView): RawEdge[] | null {
        if (!dv?.categorical) return null;
        const cat = dv.categorical;
        const srcIdx = findCategoryIndex(cat.categories, "source");
        const tgtIdx = findCategoryIndex(cat.categories, "target");
        const catIdx = findCategoryIndex(cat.categories, "linkColorBy");
        if (srcIdx < 0 || tgtIdx < 0) return null;
        const wIdx = cat.values ? findValueIndex(cat.values, "weight") : -1;
        if (wIdx < 0) return null;

        const srcVals = cat.categories![srcIdx].values;
        const tgtVals = cat.categories![tgtIdx].values;
        const wVals = cat.values![wIdx].values;
        const catVals = catIdx >= 0 ? cat.categories![catIdx].values : null;
        const rows = srcVals.length;

        const edges: RawEdge[] = [];
        for (let i = 0; i < rows; i++) {
            const s = srcVals[i] == null ? null : String(srcVals[i]);
            const t = tgtVals[i] == null ? null : String(tgtVals[i]);
            const w = safeNum(wVals[i]);
            if (!s || !t || w == null || w <= 0) continue;
            edges.push({
                source: s, target: t, weight: w,
                linkCategory: catVals ? String(catVals[i]) : undefined
            });
        }
        return edges;
    }

    private render(rawEdges: RawEdge[], width: number, height: number, palette: RenderPalette): void {
        this.container.selectAll("*").remove();
        this.defs.selectAll("*").remove();
        this.nodeColorByName.clear();

        const s = this.formattingSettings;
        const cycleMode = String(s.cyclesCard.cycleHandling.value?.value ?? "route-back");

        const M = { top: 16, right: 12, bottom: 16, left: 12 };
        const W = Math.max(60, width  - M.left - M.right);
        const H = Math.max(60, height - M.top  - M.bottom);
        this.container.attr("transform", `translate(${M.left},${M.top})`);

        // ── Build the acyclic graph (handling cycles per mode) ──
        // Assign integer ids to node names for the cycle detector.
        const nameToId = new Map<string, number>();
        const idToName: string[] = [];
        const idFor = (n: string) => {
            let id = nameToId.get(n);
            if (id == null) { id = idToName.length; nameToId.set(n, id); idToName.push(n); }
            return id;
        };
        // First pass: collect edges plus explicit self-loops.
        const indexedEdges: Array<{ s: number; t: number; idx: number; raw: RawEdge; isSelf: boolean }> = [];
        rawEdges.forEach((e, i) => {
            const s = idFor(e.source);
            const t = idFor(e.target);
            indexedEdges.push({ s, t, idx: i, raw: e, isSelf: s === t });
        });

        const selfLoops = indexedEdges.filter(e => e.isSelf);
        const nonSelf = indexedEdges.filter(e => !e.isSelf);
        const backEdges = findBackEdges(idToName.length, nonSelf);

        // Feedback set = self-loops (always cycle) + heuristic back-edges.
        const cycleEdgeIdxs = new Set<number>();
        selfLoops.forEach(e => cycleEdgeIdxs.add(e.idx));
        backEdges.forEach(i => cycleEdgeIdxs.add(i));

        let acyclicEdges: RawEdge[] = [];
        const cycleEdgesForRoute: RawEdge[] = [];

        if (cycleMode === "drop") {
            acyclicEdges = rawEdges.filter((_, i) => !cycleEdgeIdxs.has(i));
        } else if (cycleMode === "duplicate-node") {
            // Rewrite each cycle edge's target to `<name> (return)` (a new node), keeping the DAG acyclic.
            acyclicEdges = rawEdges.map((e, i) => {
                if (!cycleEdgeIdxs.has(i)) return e;
                return { ...e, target: `${e.target} (return)` };
            });
        } else {
            // route-back: keep only non-cycle edges for the layout; render cycle edges separately.
            acyclicEdges = rawEdges.filter((_, i) => !cycleEdgeIdxs.has(i));
            for (let i = 0; i < rawEdges.length; i++) if (cycleEdgeIdxs.has(i)) cycleEdgesForRoute.push(rawEdges[i]);
        }

        if (acyclicEdges.length === 0 && cycleEdgesForRoute.length === 0) return;

        // ── Build sankey inputs (name-keyed) ──
        const nameSet = new Set<string>();
        for (const e of acyclicEdges) { nameSet.add(e.source); nameSet.add(e.target); }
        // Cycle route-back nodes must exist even if only touched by cycle edges.
        for (const e of cycleEdgesForRoute) { nameSet.add(e.source); nameSet.add(e.target); }

        // Persisted-order: comma-separated list. Nodes in the list come first, rest keep discovery order.
        const orderRaw = String(s.nodeOrderCard.order.value ?? "").trim();
        const orderList = orderRaw ? orderRaw.split(",").map(x => x.trim()).filter(Boolean) : [];
        const orderIndex = new Map<string, number>();
        orderList.forEach((n, i) => orderIndex.set(n, i));

        const nodes: NodeExtra[] = Array.from(nameSet).map(name => ({
            name, baseName: name.replace(/ \(return\)$/, "")
        }));
        nodes.sort((a, b) => {
            const ia = orderIndex.has(a.name) ? orderIndex.get(a.name)! : Number.MAX_SAFE_INTEGER;
            const ib = orderIndex.has(b.name) ? orderIndex.get(b.name)! : Number.MAX_SAFE_INTEGER;
            return ia - ib;
        });

        const nameToNode = new Map<string, NodeExtra>();
        nodes.forEach(n => nameToNode.set(n.name, n));

        const links: LinkExtra[] & Array<{ source: NodeExtra; target: NodeExtra } & LinkExtra> = [] as any;
        for (const e of acyclicEdges) {
            const src = nameToNode.get(e.source);
            const tgt = nameToNode.get(e.target);
            if (!src || !tgt) continue;
            (links as any).push({
                source: src, target: tgt, value: e.weight,
                weight: e.weight, category: e.linkCategory, isCycleEdge: false
            });
        }

        const alignFn = (function () {
            const v = String(s.layoutCard.nodeAlignment.value?.value ?? "justify");
            return v === "left" ? sankeyLeft : v === "right" ? sankeyRight : v === "center" ? sankeyCenter : sankeyJustify;
        })();

        const sankeyLayout = d3sankey<NodeExtra, LinkExtra>()
            .nodeId(d => (d as NodeExtra).name)
            .nodeAlign(alignFn)
            .nodeWidth(Math.max(4, Math.min(80, s.layoutCard.nodeWidth.value ?? 18)))
            .nodePadding(Math.max(0, Math.min(80, s.layoutCard.nodePadding.value ?? 12)))
            .iterations(Math.max(0, Math.min(200, s.layoutCard.iterations.value ?? 32)))
            .extent([[0, 0], [W, H]]);

        // Feed a shallow clone of the arrays so d3-sankey can mutate freely.
        const graphInput: SankeyGraph<NodeExtra, LinkExtra> = {
            nodes: nodes.map(n => ({ ...n })) as MyNode[],
            links: (links as any[]).map(l => ({ ...l })) as MyLink[]
        };

        let graph: SankeyGraph<NodeExtra, LinkExtra>;
        try {
            graph = sankeyLayout(graphInput);
        } catch {
            // Layout failure — most commonly a cycle we missed. Bail with a message.
            this.container.append("text")
                .attr("x", 12).attr("y", 20)
                .attr("font-family", "Segoe UI, sans-serif")
                .attr("font-size", "12px").attr("fill", palette.landingText)
                .text("Sankey layout failed (unexpected cycle). Try changing Cycle Handling.");
            return;
        }

        // ── Node color assignment ──
        const nodeColorMode = String(s.nodesCard.nodeColorMode.value?.value ?? "palette");
        const singleColor = s.nodesCard.nodeColor.value.value;
        const usingCustomSingle = singleColor !== DEFAULT_NODE_COLOR;
        const themedSingle = usingCustomSingle ? singleColor : (this.colorPalette.getColor("modernSankeyNode")?.value || singleColor);
        const paletteOrdinal = d3.scaleOrdinal<string, string>()
            .range(palette.highContrast
                ? [palette.single]
                : (d3.schemeTableau10 as unknown as string[]).concat(d3.schemeSet2 as unknown as string[]));

        for (const n of graph.nodes as MyNode[]) {
            let c: string;
            if (nodeColorMode === "single" || palette.highContrast) {
                c = palette.highContrast ? palette.single : themedSingle;
            } else if (nodeColorMode === "by-level") {
                const lvl = (n as MyNode).depth ?? 0;
                c = paletteOrdinal(String(lvl));
            } else {
                c = paletteOrdinal(n.baseName ?? n.name);
            }
            n.color = c;
            this.nodeColorByName.set(n.name, c);
        }

        // ── Link gradients (defs) ──
        const linkColorMode = String(s.linksCard.linkColorMode.value?.value ?? "gradient");
        const linkCategoryColor = d3.scaleOrdinal<string, string>().range(d3.schemeTableau10 as unknown as string[]);

        const linkColor = (l: MyLink): string => {
            const src = l.source as MyNode;
            const tgt = l.target as MyNode;
            if (linkColorMode === "category" && (l as LinkExtra).category) {
                return linkCategoryColor((l as LinkExtra).category!);
            }
            if (linkColorMode === "target") return tgt.color || themedSingle;
            if (linkColorMode === "source") return src.color || themedSingle;
            return src.color || themedSingle; // gradient falls back to source at fill; the actual gradient is applied via url()
        };

        // Register gradient defs when gradient mode is on.
        if (linkColorMode === "gradient" && !palette.highContrast) {
            (graph.links as MyLink[]).forEach((l, i) => {
                const gid = `msg-${i}`;
                const grad = this.defs.append("linearGradient")
                    .attr("id", gid)
                    .attr("gradientUnits", "userSpaceOnUse")
                    .attr("x1", (l.source as MyNode).x1!).attr("x2", (l.target as MyNode).x0!)
                    .attr("y1", 0).attr("y2", 0);
                grad.append("stop").attr("offset", "0%").attr("stop-color", (l.source as MyNode).color!);
                grad.append("stop").attr("offset", "100%").attr("stop-color", (l.target as MyNode).color!);
            });
        }

        // ── Draw links (acyclic) ──
        const linksG = this.container.append("g").classed("links", true);
        const linkPath = sankeyLinkHorizontal<NodeExtra, LinkExtra>();
        const baseOpacity = Math.max(0.05, Math.min(1, (s.linksCard.linkOpacity.value ?? 40) / 100));

        const linkSel = linksG.selectAll<SVGPathElement, MyLink>("path")
            .data(graph.links as MyLink[])
            .enter()
            .append("path")
            .attr("class", "link")
            .attr("d", linkPath)
            .attr("fill", "none")
            .attr("stroke", (l, i) => (linkColorMode === "gradient" && !palette.highContrast) ? `url(#msg-${i})` : linkColor(l))
            .attr("stroke-width", d => Math.max(1, d.width!))
            .attr("stroke-opacity", baseOpacity);

        // ── Draw route-back cycle edges as arcs ──
        const cycleG = this.container.append("g").classed("cycle-links", true);
        const cycleColor = palette.highContrast ? palette.cycle : s.cyclesCard.cycleLinkColor.value.value;
        const nodePos = new Map<string, MyNode>();
        (graph.nodes as MyNode[]).forEach(n => nodePos.set(n.name, n));
        const maxWeight = d3.max((graph.links as MyLink[]).map(l => l.width ?? 0)) ?? 4;
        for (const e of cycleEdgesForRoute) {
            const src = nodePos.get(e.source);
            const tgt = nodePos.get(e.target);
            if (!src || !tgt) continue;
            const sy = (src.y0! + src.y1!) / 2;
            const ty = (tgt.y0! + tgt.y1!) / 2;
            const sx = src.x1!;
            const tx = tgt.x0!;
            // Sweep OUT the right side of the source, down past the layout, and back to the target.
            const sweepY = H + 20;
            const path = `M ${sx} ${sy}
                          C ${sx + 40} ${sy}, ${sx + 40} ${sweepY}, ${(sx + tx) / 2} ${sweepY}
                          C ${tx - 40} ${sweepY}, ${tx - 40} ${ty}, ${tx} ${ty}`;
            cycleG.append("path")
                .attr("d", path)
                .attr("fill", "none")
                .attr("stroke", cycleColor)
                .attr("stroke-width", Math.max(1, Math.min(maxWeight, e.weight * (maxWeight / Math.max(1, e.weight)))))
                .attr("stroke-opacity", baseOpacity + 0.2)
                .datum({ weight: e.weight, category: e.linkCategory, isCycleEdge: true });
        }

        // ── Nodes ──
        const nodesG = this.container.append("g").classed("nodes", true);
        const borderWidth = Math.max(0, Math.min(4, s.nodesCard.nodeBorderWidth.value ?? 0));
        const borderColor = s.nodesCard.nodeBorderColor.value.value;

        const nodeSel = nodesG.selectAll<SVGRectElement, MyNode>("rect")
            .data(graph.nodes as MyNode[])
            .enter()
            .append("rect")
            .attr("class", "node")
            .attr("x", d => d.x0!)
            .attr("y", d => d.y0!)
            .attr("width", d => Math.max(1, d.x1! - d.x0!))
            .attr("height", d => Math.max(1, d.y1! - d.y0!))
            .attr("fill", d => d.color!)
            .attr("stroke", palette.highContrast ? palette.border : borderColor)
            .attr("stroke-width", palette.highContrast ? 1 : borderWidth);

        // ── Labels ──
        const showValues = s.labelsCard.showValues.value;
        const maxLen = Math.max(4, Math.min(80, s.labelsCard.maxLabelLength.value ?? 24));
        const fs = Math.max(8, Math.min(28, s.labelsCard.fontSize.value ?? 11));
        const posMode = String(s.labelsCard.labelPosition.value?.value ?? "auto");
        const labelG = this.container.append("g").classed("labels", true);

        const truncate = (t: string): string => t.length <= maxLen ? t : t.slice(0, maxLen - 1) + "…";
        const nodeLabel = (n: MyNode) => {
            const base = truncate(n.name);
            return showValues ? `${base}  (${d3.format(",.4~g")((n as MyNode).value ?? 0)})` : base;
        };

        (graph.nodes as MyNode[]).forEach(n => {
            const nx0 = n.x0!, nx1 = n.x1!;
            const leftCol = nx0 < 4;
            const rightCol = nx1 > W - 4;
            let anchor: "start" | "end";
            let x: number;
            if (posMode === "inside") {
                anchor = "start"; x = nx1 + 6;
            } else if (posMode === "outside") {
                anchor = leftCol ? "end" : "start";
                x = leftCol ? nx0 - 6 : nx1 + 6;
            } else {
                // auto: outside for edge columns, inside-adjacent otherwise
                if (leftCol) { anchor = "end"; x = nx0 - 6; }
                else if (rightCol) { anchor = "start"; x = nx1 + 6; }
                else { anchor = "start"; x = nx1 + 6; }
            }
            labelG.append("text")
                .attr("x", x)
                .attr("y", (n.y0! + n.y1!) / 2)
                .attr("dominant-baseline", "central")
                .attr("text-anchor", anchor)
                .attr("font-size", `${fs}px`)
                .attr("font-family", "Segoe UI, sans-serif")
                .attr("fill", palette.labelText)
                .attr("pointer-events", "none")
                .text(nodeLabel(n));
        });

        // Simple label collision pass: shrink font when adjacent labels overlap.
        this.resolveLabelCollisions(labelG, fs);

        // ── Hover highlighting ──
        if (s.linksCard.hoverHighlight.value) {
            const isLinked = (l: MyLink, n: MyNode) => (l.source as MyNode).name === n.name || (l.target as MyNode).name === n.name;
            nodeSel
                .on("mouseenter", (_, n) => {
                    linkSel
                        .attr("stroke-opacity", (d: MyLink) => isLinked(d, n) ? Math.min(1, baseOpacity + 0.35) : baseOpacity * 0.25);
                })
                .on("mouseleave", () => {
                    linkSel.attr("stroke-opacity", baseOpacity);
                });
        }

        // ── Tooltips ──
        nodeSel.on("mousemove", (event: MouseEvent, n: MyNode) => {
            const [px, py] = d3.pointer(event, this.svg.node());
            const items: VisualTooltipDataItem[] = [
                { displayName: "Node", value: n.name },
                { displayName: "Total", value: d3.format(",.4~g")(n.value ?? 0) }
            ];
            this.tooltipService.show({ dataItems: items, identities: [], coordinates: [px, py], isTouchEvent: false });
        }).on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));

        linkSel.on("mousemove", (event: MouseEvent, l: MyLink) => {
            const [px, py] = d3.pointer(event, this.svg.node());
            const items: VisualTooltipDataItem[] = [
                { displayName: "Flow", value: `${(l.source as MyNode).name} → ${(l.target as MyNode).name}` },
                { displayName: "Weight", value: d3.format(",.4~g")((l as any).weight ?? l.value ?? 0) }
            ];
            const cat = (l as LinkExtra).category;
            if (cat) items.push({ displayName: "Category", value: cat });
            this.tooltipService.show({ dataItems: items, identities: [], coordinates: [px, py], isTouchEvent: false });
        }).on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));

        // ── Drag reorder ──
        if (s.layoutCard.enableDragReorder.value) {
            this.attachDrag(nodeSel, linkSel, labelG, graph as SankeyGraph<NodeExtra, LinkExtra>, H, linkPath);
        }
    }

    /**
     * Constrain node drag to Y within its column; on release, re-compute link paths
     * (cheap — no full relayout) and persist the new node order.
     */
    private attachDrag(
        nodeSel: d3.Selection<SVGRectElement, MyNode, SVGGElement, unknown>,
        linkSel: d3.Selection<SVGPathElement, MyLink, SVGGElement, unknown>,
        labelG: d3.Selection<SVGGElement, unknown, null, undefined>,
        graph: SankeyGraph<NodeExtra, LinkExtra>,
        H: number,
        linkPath: (l: MyLink) => string
    ): void {
        const self = this;
        const drag = d3.drag<SVGRectElement, MyNode>()
            .on("start", function () {
                d3.select(this).attr("cursor", "grabbing");
            })
            .on("drag", function (event, n) {
                const height = n.y1! - n.y0!;
                let newY0 = event.y - height / 2;
                newY0 = Math.max(0, Math.min(H - height, newY0));
                n.y0 = newY0;
                n.y1 = newY0 + height;
                d3.select(this).attr("y", newY0);
                // Move labels attached to this node.
                labelG.selectAll<SVGTextElement, unknown>("text")
                    .filter((_, i, arr) => (arr[i] as SVGTextElement).dataset.node === n.name);
                // Simpler: re-emit label positions for all — small N.
                labelG.selectAll<SVGTextElement, unknown>("text").each(function () { /* no-op; positioned once */ });
                // Update link paths that touch this node.
                linkSel.attr("d", linkPath);
            })
            .on("end", function (event, n) {
                d3.select(this).attr("cursor", "grab");
                // Persist the new order: sort by current y0 within each column, flatten in x-order.
                const nodesByColumn = new Map<number, MyNode[]>();
                (graph.nodes as MyNode[]).forEach(nn => {
                    const key = nn.x0 ?? 0;
                    if (!nodesByColumn.has(key)) nodesByColumn.set(key, []);
                    nodesByColumn.get(key)!.push(nn);
                });
                const columnKeys = Array.from(nodesByColumn.keys()).sort((a, b) => a - b);
                const orderedNames: string[] = [];
                for (const k of columnKeys) {
                    const col = nodesByColumn.get(k)!;
                    col.sort((a, b) => (a.y0 ?? 0) - (b.y0 ?? 0));
                    for (const cn of col) orderedNames.push(cn.name);
                }
                self.persistNodeOrder(orderedNames.join(","));
            });
        nodeSel.attr("cursor", "grab").call(drag);
    }

    private persistNodeOrder(order: string): void {
        try {
            this.host.persistProperties({
                merge: [{
                    objectName: "nodeOrder",
                    selector: null,
                    properties: { order }
                }]
            });
        } catch { /* persistProperties can throw during initial-load races; ignore silently */ }
    }

    /**
     * Shrink font size one step when two labels within the same column overlap.
     * Runs at most twice — enough for the common tight-fit case without a full solver.
     */
    private resolveLabelCollisions(labelG: d3.Selection<SVGGElement, unknown, null, undefined>, startFs: number): void {
        const texts = labelG.selectAll<SVGTextElement, unknown>("text").nodes();
        if (texts.length < 2) return;
        // Group by anchor x (labels attached to same column all share x).
        const byX = new Map<number, SVGTextElement[]>();
        for (const t of texts) {
            const x = Math.round(+t.getAttribute("x")!);
            if (!byX.has(x)) byX.set(x, []);
            byX.get(x)!.push(t);
        }
        let shrink = 0;
        for (const [, arr] of byX) {
            arr.sort((a, b) => +a.getAttribute("y")! - +b.getAttribute("y")!);
            for (let i = 1; i < arr.length; i++) {
                const gap = +arr[i].getAttribute("y")! - +arr[i - 1].getAttribute("y")!;
                if (gap < startFs * 1.05) shrink = Math.max(shrink, 1);
                if (gap < startFs * 0.75) shrink = Math.max(shrink, 2);
            }
        }
        if (shrink > 0) {
            const newFs = Math.max(8, startFs - shrink);
            labelG.selectAll("text").attr("font-size", `${newFs}px`);
        }
    }

    private resolvePalette(): RenderPalette {
        const cp = this.colorPalette;
        const s = this.formattingSettings;
        if (cp.isHighContrast) {
            const fg = cp.foreground?.value || "#000";
            const bg = cp.background?.value || "#fff";
            return {
                highContrast: true, single: fg, border: fg, cycle: fg,
                axisText: fg, labelText: fg, background: bg,
                landingText: fg, landingSub: fg
            };
        }
        const bg = cp.background?.value || "#ffffff";
        const isDark = luminance(bg) < 0.5;
        const themeFg = cp.foreground?.value || (isDark ? "#f0f0f0" : "#333");
        const single = s.nodesCard.nodeColor.value.value === DEFAULT_NODE_COLOR
            ? (cp.getColor("modernSankeyNode")?.value || DEFAULT_NODE_COLOR)
            : s.nodesCard.nodeColor.value.value;
        const cycle = s.cyclesCard.cycleLinkColor.value.value === DEFAULT_CYCLE_COLOR
            ? DEFAULT_CYCLE_COLOR
            : s.cyclesCard.cycleLinkColor.value.value;
        return {
            highContrast: false,
            single,
            border: s.nodesCard.nodeBorderColor.value.value,
            cycle,
            axisText: isDark ? "#bbb" : "#666",
            labelText: themeFg,
            background: bg,
            landingText: isDark ? "#eee" : "#333",
            landingSub:  isDark ? "#aaa" : "#999"
        };
    }

    private renderLandingPage(width: number, height: number, palette: RenderPalette): void {
        this.landing.selectAll("*").remove();
        this.container.selectAll("*").remove();
        this.defs.selectAll("*").remove();
        if (width < 160 || height < 100) return;

        const cx = width / 2;
        const g = this.landing.attr("transform", `translate(${cx}, ${height / 2})`);
        const c = palette.highContrast ? palette.single : DEFAULT_NODE_COLOR;
        const glyph = g.append("g").attr("transform", "translate(-90, -80)");
        // Two-column sankey glyph
        glyph.append("rect").attr("x", 0).attr("y", 20).attr("width", 14).attr("height", 60).attr("fill", c);
        glyph.append("rect").attr("x", 170).attr("y", 5).attr("width", 14).attr("height", 40).attr("fill", "#2ca02c");
        glyph.append("rect").attr("x", 170).attr("y", 55).attr("width", 14).attr("height", 45).attr("fill", "#d62728");
        // Ribbons via cubic beziers
        glyph.append("path").attr("d", "M 14 40 C 100 40, 90 25, 170 25").attr("fill", "none").attr("stroke", c).attr("stroke-width", 22).attr("stroke-opacity", 0.35);
        glyph.append("path").attr("d", "M 14 65 C 100 65, 90 78, 170 78").attr("fill", "none").attr("stroke", "#d62728").attr("stroke-width", 26).attr("stroke-opacity", 0.35);

        g.append("text")
            .attr("text-anchor", "middle").attr("y", 30)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "16px").attr("font-weight", 600)
            .attr("fill", palette.landingText)
            .text("Modern Sankey");

        g.append("text")
            .attr("text-anchor", "middle").attr("y", 54)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "12px")
            .attr("fill", palette.axisText)
            .text("Add fields:  Source  +  Target  +  Weight");

        g.append("text")
            .attr("text-anchor", "middle").attr("y", 74)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "11px")
            .attr("fill", palette.landingSub)
            .text("One row per flow. Chain rows to build multi-level diagrams.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
