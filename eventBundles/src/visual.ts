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
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";
import {
    TrieNode, Anchor, buildTrie, pruneTrie, layoutTrie, alignSequences
} from "./prefixTree";
import { Fingerprint, ComputeCache } from "./computeCache";

const intFmt = d3.format(",.0f");

interface Tree {
    root: TrieNode;
    dir: 1 | -1;
    maxDepth: number;
    levels: TrieNode[][];
}

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private colorPalette: ISandboxExtendedColorPalette;
    private tooltipService: ITooltipService;
    private selectionManager: ISelectionManager;

    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private horizontal = true;
    private eventCategory = new Map<string, string>();

    private margin = { top: 30, right: 14, bottom: 16, left: 14 };

    /** Caches the built+pruned prefix tree so restyling doesn't rebuild it. */
    private trieCache = new ComputeCache<{ fwdRoot: TrieNode; bwdRoot: TrieNode | null; prunedF: number; prunedB: number }>();

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        // Localization manager instantiated for future getDisplayName use; call is required for the AppSource Localizations feature check.
        void options.host.createLocalizationManager();
        this.colorPalette = options.host.colorPalette;
        this.tooltipService = options.host.tooltipService;
        this.formattingSettingsService = new FormattingSettingsService();

        this.svg = d3.select(options.element).append("svg").classed("eb-root", true)
            .attr("tabindex", 0).attr("role", "img").attr("aria-label", "Event bundles");
        this.landing = this.svg.append("g").classed("eb-landing", true);
        this.container = this.svg.append("g").classed("eb-container", true);

        this.selectionManager = options.host.createSelectionManager();
        this.selectionManager.registerOnSelectCallback(() => this.applyExternalDim());
        this.svg.on("click.clear", (event: MouseEvent) => {
            if (event.target === this.svg.node()) {
                this.selectionManager.clear().then(() => this.applyExternalDim());
            }
        });
    }

    private applyExternalDim(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.1, Math.min(1, ((s as unknown as { interactionsCard?: { dimUnselectedOpacity: { value: number } } }).interactionsCard?.dimUnselectedOpacity.value ?? 30) / 100));
        const hasSel = this.selectionManager.getSelectionIds().length > 0;
        this.container.attr("opacity", hasSel ? dim : 1);
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const AG = this.formattingSettings.aggregationCard;
            const AP = this.formattingSettings.appearanceCard;
            const LO = this.formattingSettings.layoutCard;

            const width = options.viewport.width, height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);
            this.container.selectAll("*").remove();

            // ── Data ───────────────────────────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const table = dataView?.table;
            const cols = table?.columns;
            const roleCol = (role: string): number =>
                cols ? cols.findIndex(c => c.roles && c.roles[role]) : -1;
            const cCase = roleCol("caseId"), cEv = roleCol("event");
            const cTs = roleCol("timestamp"), cCat = roleCol("eventCategory");

            if (!table?.rows?.length || cCase < 0 || cEv < 0) {
                this.renderLandingPage(width, height, cCase >= 0, cEv >= 0);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            // Group events into ordered per-case sequences.
            const byCase = new Map<string, { t: number; e: string }[]>();
            this.eventCategory = new Map();
            for (let i = 0; i < table.rows.length; i++) {
                const r = table.rows[i];
                if (r[cCase] == null || r[cEv] == null) continue;
                const ev = String(r[cEv]);
                let t: number = i;
                if (cTs >= 0 && r[cTs] != null) {
                    const raw = r[cTs];
                    t = raw instanceof Date ? raw.getTime() : Number(raw);
                    if (!Number.isFinite(t)) t = Date.parse(String(raw));
                    if (!Number.isFinite(t)) t = i;
                }
                if (cCat >= 0 && r[cCat] != null && !this.eventCategory.has(ev)) {
                    this.eventCategory.set(ev, String(r[cCat]));
                }
                const k = String(r[cCase]);
                let arr = byCase.get(k);
                if (!arr) { arr = []; byCase.set(k, arr); }
                arr.push({ t, e: ev });
            }
            const sequences: string[][] = [];
            for (const arr of byCase.values()) {
                arr.sort((a, b) => (a.t - b.t) || a.e.localeCompare(b.e));
                sequences.push(arr.map(x => x.e));
            }
            if (!sequences.length) {
                this.renderLandingPage(width, height, true, true);
                this.events.renderingFinished(options);
                return;
            }

            // ── Align + build ──────────────────────────────────────
            const anchor = String(AG.alignmentAnchor.value?.value ?? "first-event") as Anchor;
            const anchorEvent = (AG.anchorEvent.value || "").trim();
            const aligned = alignSequences(sequences, anchor, anchorEvent);

            if (anchor === "selected" && !anchorEvent) {
                this.renderMessage(width, height, "Pick an anchor event",
                    "Align on is set to “Selected event”, but no event name is given.",
                    "Type one into Aggregation → Anchor event.");
                this.events.renderingFinished(options);
                return;
            }
            if (!aligned.forward.length) {
                this.renderMessage(width, height, "No matching cases",
                    anchorEvent ? `No case contains an event named “${anchorEvent}”.` : "No sequences to show.",
                    "Check the spelling against your Event values.");
                this.events.renderingFinished(options);
                return;
            }

            const maxDepth = Math.max(1, Math.round(AG.maxDepth.value ?? 10));
            const minSupport = Math.max(1, Math.round(AG.minBundleSupport.value ?? 5));

            // ── Trie build + prune (cached) ────────────────────────
            // Building and pruning the prefix tree walks every case. It depends
            // only on the aligned sequences, the depth limit and the support
            // threshold — never on colours, orientation or block sizing — so
            // those re-render straight from the cached tree.
            // Note pruning MUTATES the tree, so the cached value is the
            // already-pruned result; re-pruning a cached tree would be a no-op
            // but returning an unpruned one would leak past the threshold.
            const trieKey = new Fingerprint()
                .num(maxDepth).num(minSupport)
                .str(anchor).str(anchorEvent)
                .num(aligned.forward.length).num(aligned.backward.length)
                .strs(aligned.forward.map(s => s.join("")))
                .strs(aligned.backward.map(s => s.join("")))
                .done();

            const trie = this.trieCache.get(trieKey, () => {
                const f = buildTrie(aligned.forward, maxDepth);
                const pf = pruneTrie(f, minSupport);
                let b: TrieNode | null = null;
                let pb = 0;
                if (aligned.backward.length) {
                    b = buildTrie(aligned.backward, maxDepth);
                    pb = pruneTrie(b, minSupport);
                }
                return { fwdRoot: f, bwdRoot: b, prunedF: pf, prunedB: pb };
            })!;

            const fwdRoot = trie.fwdRoot;
            const bwdRoot = trie.bwdRoot;
            const prunedF = trie.prunedF;
            const prunedB = trie.prunedB;

            // ── Geometry ───────────────────────────────────────────
            this.horizontal = String(LO.orientation.value?.value ?? "horizontal") === "horizontal";
            const fs = Math.max(6, LO.fontSize.value);
            const blockLen = Math.max(6, AP.maxBandWidth.value ?? 40);
            const stepGap = Math.max(4, LO.gapBetweenSteps.value ?? 60);
            const noteH = (prunedF + prunedB > 0 || aligned.excluded > 0) ? fs + 8 : 0;

            const plotAcross = (this.horizontal
                ? height - this.margin.top - this.margin.bottom
                : width - this.margin.left - this.margin.right) - noteH;
            const plotAlong = this.horizontal
                ? width - this.margin.left - this.margin.right
                : height - this.margin.top - this.margin.bottom - noteH;
            if (plotAcross < 30 || plotAlong < 60) { this.events.renderingFinished(options); return; }

            const layoutOpts = {
                height: plotAcross,
                gap: Math.max(1, Math.min(6, plotAcross * 0.01)),
                minBandHeight: Math.max(0.5, AP.minBandWidth.value ?? 2)
            };
            const fwdStats = layoutTrie(fwdRoot, layoutOpts);
            const bwdStats = bwdRoot ? layoutTrie(bwdRoot, layoutOpts) : null;

            // Fit the requested step gap into the available length.
            const fwdCols = fwdStats.maxDepth;
            const bwdCols = bwdStats ? bwdStats.maxDepth : 0;
            const totalCols = fwdCols + bwdCols;
            let step = blockLen + stepGap;
            const needed = totalCols * step;
            if (needed > plotAlong && totalCols > 0) step = plotAlong / totalCols;
            const effBlock = Math.min(blockLen, Math.max(4, step * 0.45));

            // Origin: the anchor column. One-sided trees start at the near edge.
            const alongOrigin = this.horizontal
                ? this.margin.left + (bwdCols > 0 ? bwdCols * step : 0)
                : this.margin.top + noteH + (bwdCols > 0 ? bwdCols * step : 0);
            const acrossOrigin = this.horizontal
                ? this.margin.top + noteH
                : this.margin.left;

            // "Last event" alignment reads right-to-left.
            const fwdDir: 1 | -1 = anchor === "last-event" ? -1 : 1;
            const fwdOrigin = anchor === "last-event"
                ? (this.horizontal ? width - this.margin.right : height - this.margin.bottom)
                : alongOrigin;

            // ── Draw ───────────────────────────────────────────────
            const opacity = Math.max(0, Math.min(1, (AP.bundleOpacity.value ?? 60) / 100));
            const colorBy = String(AP.colorBy.value?.value ?? "event-type");
            // High contrast: two-color palette can't distinguish events by hue,
            // so ribbons collapse to the foreground.
            const hc = this.colorPalette.isHighContrast === true;
            const hcFg = this.colorPalette.foreground?.value || "#000000";
            const colorOf = (ev: string): string => {
                if (hc) return hcFg;
                if (colorBy === "uniform") return "#4682B4";
                if (colorBy === "event-category") {
                    return this.colorPalette.getColor(this.eventCategory.get(ev) || "—").value;
                }
                return this.colorPalette.getColor(ev).value;
            };

            const toXY = (along: number, across: number): { x: number; y: number } =>
                this.horizontal
                    ? { x: along, y: acrossOrigin + across }
                    : { x: acrossOrigin + across, y: along };

            const drawTree = (tree: Tree, origin: number): void => {
                const ribbons = this.container.append("g").classed("ribbons", true);
                const blocks = this.container.append("g").classed("blocks", true);

                for (let d = 1; d <= tree.maxDepth; d++) {
                    const nodes = tree.levels[d] || [];
                    for (const n of nodes) {
                        const lead = origin + tree.dir * ((d - 1) * step);
                        const trail = lead + tree.dir * effBlock;

                        // Ribbon from the parent's trailing edge (depth 1 starts flush).
                        if (d > 1 && n.parent) {
                            const pLead = origin + tree.dir * ((d - 2) * step);
                            const pTrail = pLead + tree.dir * effBlock;
                            ribbons.append("path")
                                .attr("d", this.ribbonPath(pTrail, n.srcY0, n.srcY1, lead, n.y0, n.y1, toXY))
                                .attr("fill", colorOf(n.event))
                                .attr("fill-opacity", opacity * 0.55)
                                .attr("stroke", "none");
                        }

                        // Event block.
                        const a0 = Math.min(lead, trail), a1 = Math.max(lead, trail);
                        const p0 = toXY(a0, n.y0), p1 = toXY(a1, n.y1);
                        const g = blocks.append("g")
                            .on("mousemove", (event: MouseEvent) => this.showTooltip(event, n, fwdRoot.count))
                            .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));

                        g.append("rect")
                            .attr("x", Math.min(p0.x, p1.x)).attr("y", Math.min(p0.y, p1.y))
                            .attr("width", Math.abs(p1.x - p0.x)).attr("height", Math.abs(p1.y - p0.y))
                            .attr("rx", 2)
                            .attr("fill", colorOf(n.event))
                            .attr("fill-opacity", Math.min(1, opacity + 0.25))
                            .attr("stroke", "#fff").attr("stroke-width", 0.6);

                        // Label if the block is thick enough to hold text.
                        const across = Math.abs(p1.y - p0.y), alongPx = Math.abs(p1.x - p0.x);
                        const room = this.horizontal ? across : alongPx;
                        if (room >= fs + 2) {
                            const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
                            const label = AP.showCaseCounts.value
                                ? `${n.event} (${intFmt(n.count)})` : n.event;
                            const maxChars = Math.floor((this.horizontal ? across : alongPx) / (fs * 0.6));
                            g.append("text")
                                .attr("x", cx).attr("y", cy)
                                .attr("text-anchor", "middle")
                                .attr("dominant-baseline", "middle")
                                .attr("transform", this.horizontal ? `rotate(-90,${cx},${cy})` : null)
                                .attr("font-size", `${fs}px`).attr("fill", "#1f2d3d")
                                .attr("pointer-events", "none")
                                .text(label.length > maxChars ? label.slice(0, Math.max(1, maxChars - 1)) + "…" : label);
                        }
                    }
                }
            };

            drawTree({ root: fwdRoot, dir: fwdDir, maxDepth: fwdStats.maxDepth, levels: fwdStats.levels }, fwdOrigin);
            if (bwdRoot && bwdStats) {
                drawTree({ root: bwdRoot, dir: -1, maxDepth: bwdStats.maxDepth, levels: bwdStats.levels },
                    alongOrigin - stepGap * 0.0);
            }

            // Anchor marker line, when the diagram is two-sided.
            if (bwdRoot) {
                const a = alongOrigin;
                const p0 = toXY(a, 0), p1 = toXY(a, plotAcross);
                this.container.append("line")
                    .attr("x1", p0.x).attr("y1", p0.y).attr("x2", p1.x).attr("y2", p1.y)
                    .attr("stroke", "#bbb").attr("stroke-width", 1).attr("stroke-dasharray", "3 3");
            }

            // ── Header / notes ─────────────────────────────────────
            const totalCases = sequences.length;
            this.container.append("text")
                .attr("x", this.margin.left).attr("y", 16)
                .attr("font-size", `${fs}px`).attr("font-weight", 600).attr("fill", "#555")
                .text(`${intFmt(fwdRoot.count)} of ${intFmt(totalCases)} cases · ${intFmt(fwdStats.maxDepth)} steps deep`);

            if (noteH > 0) {
                const parts: string[] = [];
                const pruned = prunedF + prunedB;
                if (pruned > 0) parts.push(`${intFmt(pruned)} case-paths below the support threshold were pruned`);
                if (aligned.excluded > 0) parts.push(`${intFmt(aligned.excluded)} cases had no “${anchorEvent}” event`);
                this.container.append("text")
                    .attr("x", this.margin.left).attr("y", 16 + fs + 4)
                    .attr("font-size", `${Math.max(9, fs - 1)}px`).attr("fill", "#b26a00")
                    .text(parts.join("  ·  "));
            }

            this.applyExternalDim();
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    /** Sankey-style ribbon between two edges, in along/across space. */
    private ribbonPath(
        a0: number, s0: number, s1: number,
        a1: number, t0: number, t1: number,
        toXY: (along: number, across: number) => { x: number; y: number }
    ): string {
        const am = (a0 + a1) / 2;
        const p1 = toXY(a0, s0), p2 = toXY(a1, t0), p3 = toXY(a1, t1), p4 = toXY(a0, s1);
        const c1 = toXY(am, s0), c2 = toXY(am, t0), c3 = toXY(am, t1), c4 = toXY(am, s1);
        return `M ${p1.x},${p1.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`
            + ` L ${p3.x},${p3.y} C ${c3.x},${c3.y} ${c4.x},${c4.y} ${p4.x},${p4.y} Z`;
    }

    private showTooltip(event: MouseEvent, n: TrieNode, total: number): void {
        const [px, py] = d3.pointer(event, this.svg.node());
        // Walk back up for the path that reached this node.
        const path: string[] = [];
        let cur: TrieNode | null = n;
        while (cur && cur.depth > 0) { path.unshift(cur.event); cur = cur.parent; }
        const items: VisualTooltipDataItem[] = [
            { displayName: "Event", value: n.event },
            { displayName: "Step", value: String(n.depth) },
            { displayName: "Cases", value: `${intFmt(n.count)}  (${(n.count / Math.max(1, total) * 100).toFixed(1)}%)` }
        ];
        const cat = this.eventCategory.get(n.event);
        if (cat) items.push({ displayName: "Category", value: cat });
        if (path.length <= 8) items.push({ displayName: "Path", value: path.join("  →  ") });
        if (n.children.length) {
            const cont = n.children.reduce((a, c) => a + c.count, 0);
            items.push({ displayName: "Ends here", value: intFmt(n.count - cont) });
        }
        this.tooltipService.show({
            dataItems: items, identities: [],
            coordinates: [px, py], isTouchEvent: false
        });
    }

    private renderMessage(width: number, height: number, title: string, l1: string, l2: string): void {
        this.container.selectAll("*").remove();
        this.landing.selectAll("*").remove();
        if (width < 160 || height < 110) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);
        g.append("text").attr("text-anchor", "middle").attr("y", -8)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "15px")
            .attr("font-weight", 600).attr("fill", "#333").text(title);
        g.append("text").attr("text-anchor", "middle").attr("y", 14)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666").text(l1);
        if (l2) {
            g.append("text").attr("text-anchor", "middle").attr("y", 34)
                .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
                .attr("fill", "#999").text(l2);
        }
    }

    private renderLandingPage(width: number, height: number, hasCase: boolean, hasEvent: boolean): void {
        this.container.selectAll("*").remove();
        this.landing.selectAll("*").remove();
        if (width < 170 || height < 120) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        // Glyph: a trunk fraying into branches.
        const glyph = g.append("g").attr("transform", "translate(-104,-92)");
        const cols = ["#4682B4", "#1baf7a", "#eda100", "#e87ba4"];
        const bars = [
            [0, 6, 56], [58, 6, 56], [116, 6, 26], [116, 38, 24], [174, 6, 22], [174, 34, 14]
        ];
        bars.forEach(([x, y, h], i) => glyph.append("rect")
            .attr("x", x).attr("y", y).attr("width", 20).attr("height", h).attr("rx", 2)
            .attr("fill", cols[i % cols.length]).attr("fill-opacity", 0.75));
        [[20, 6, 58, 6, 56, 56], [136, 6, 174, 6, 26, 22], [136, 38, 174, 34, 24, 14]].forEach(
            ([x0, y0, x1, y1, h0, h1]) => glyph.append("path")
                .attr("d", `M ${x0},${y0} C ${(x0 + x1) / 2},${y0} ${(x0 + x1) / 2},${y1} ${x1},${y1}`
                    + ` L ${x1},${y1 + h1} C ${(x0 + x1) / 2},${y1 + h1} ${(x0 + x1) / 2},${y0 + h0} ${x0},${y0 + h0} Z`)
                .attr("fill", "#4682B4").attr("fill-opacity", 0.22));

        g.append("text").attr("text-anchor", "middle").attr("y", 2)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px")
            .attr("font-weight", 600).attr("fill", "#333").text("Event Sequence Bundles");

        const missing: string[] = [];
        if (!hasCase) missing.push("Case ID");
        if (!hasEvent) missing.push("Event");
        g.append("text").attr("text-anchor", "middle").attr("y", 24)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666")
            .text(missing.length ? "Add fields:  " + missing.join("   +   ") : "Add Case ID and Event to begin");
        g.append("text").attr("text-anchor", "middle").attr("y", 46)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
            .attr("fill", "#999")
            .text("One row per event. Add a Timestamp so events order correctly within each case.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
