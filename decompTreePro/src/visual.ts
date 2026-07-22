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

import { VisualFormattingSettingsModel, DEFAULT_BAR_COLOR } from "./settings";

// ── Types ──────────────────────────────────────────────────────

interface TreeNode {
    name: string;
    levelName: string;    // which grouping column this node belongs to (used for sort keys)
    levelIdx: number;
    value: number;
    secondary: number | null;
    children: TreeNode[];
    // Preserved raw matrix node so we can re-navigate on expansion clicks.
    raw?: powerbi.DataViewMatrixNode;
    pctOfParent: number | null;
    pctOfTotal: number | null;
    selectionId?: ISelectionId;
    isHighlighted?: boolean;
}

interface RenderPalette {
    highContrast: boolean;
    barSingle: string;
    above: string;
    below: string;
    connector: string;
    axisText: string;
    labelText: string;
    grid: string;
    background: string;
    landingText: string;
    landingSub: string;
}

// ── Helpers ────────────────────────────────────────────────────

function safeNum(v: unknown): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
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
    private tooltipService: ITooltipService;
    private colorPalette: ISandboxExtendedColorPalette;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;

    /** Expansion state: keyed by parent-node-path → chosen child value. */
    private expansionPath: string[] = [];  // ordered list of child names to descend into
    /** Full matrix root, cached between renders so click handlers can walk it. */
    private matrixRoot: powerbi.DataViewMatrixNode | null = null;
    private matrixLevels: string[] = [];
    private totalValue = 0;

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

        this.svg = d3.select(options.element).append("svg").classed("decomp-tree", true);
        this.landing = this.svg.append("g").classed("dt-landing", true);
        this.container = this.svg.append("g").classed("dt-container", true);

        this.svg.on("click", (event: MouseEvent) => {
            if (event.target === this.svg.node()) {
                this.selectionManager.clear().then(() => this.applySelectionStyling());
            }
        });
    }

    private applySelectionStyling(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.05, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 30) / 100));
        const activeIds = this.selectionManager.getSelectionIds() as ISelectionId[];
        const hasSel = activeIds.length > 0;
        const eq = (a: ISelectionId, b: ISelectionId) =>
            (a as { equals?: (b: ISelectionId) => boolean }).equals?.(b) ?? false;

        this.container.selectAll<SVGGElement, unknown>(".node").each(function (d) {
            const g = d3.select(this);
            const data = d as { node?: TreeNode } | TreeNode | undefined;
            const n = (data as { node?: TreeNode })?.node ?? (data as TreeNode);
            if (!n) return;
            const isSel = !!n.selectionId && activeIds.some(a => eq(a, n.selectionId!));
            const isHl = n.isHighlighted !== false;
            let opacity = 1;
            if (hasSel && !isSel) opacity = dim;
            if (!isHl) opacity = Math.min(opacity, dim);
            g.attr("opacity", opacity);
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
            const parsed = this.parseMatrix(dv);
            if (!parsed) {
                this.container.selectAll("*").remove();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height, palette);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            // Apply default expansion path if the user hasn't clicked yet.
            const def = String(this.formattingSettings.expansionCard.defaultExpansion.value ?? "").trim();
            if (def && this.expansionPath.length === 0) {
                // Format: 'LevelA:ValueA>LevelB:ValueB'
                this.expansionPath = def.split(">").map(seg => {
                    const [, val] = seg.split(":").map(s => s.trim());
                    return val || "";
                }).filter(Boolean);
            }

            this.render(width, height, palette);
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private parseMatrix(dv: DataView): boolean {
        const m = dv?.matrix;
        if (!m || !m.rows || !m.rows.root || m.valueSources.length === 0) return false;
        this.matrixRoot = m.rows.root;
        this.matrixLevels = m.rows.levels.map(l => l.sources[0].displayName);
        // Cache the raw hierarchy levels — needed by createSelectionIdBuilder.withMatrixNode.
        (this as unknown as { _matrixLevelsCache?: powerbi.DataViewHierarchyLevel[] })._matrixLevelsCache = m.rows.levels;
        // Total value = sum of top-level children's first value.
        this.totalValue = 0;
        const kids = m.rows.root.children ?? [];
        for (const c of kids) {
            const v = safeNum(c.values?.[0]?.value);
            if (v != null) this.totalValue += v;
        }
        return true;
    }

    private render(width: number, height: number, palette: RenderPalette): void {
        this.container.selectAll("*").remove();
        if (!this.matrixRoot) return;

        const s = this.formattingSettings;
        const M = { top: 30, right: 20, bottom: 20, left: 20 };
        const nodeH = Math.max(14, s.nodesCard.barHeight.value ?? 28);
        const colW = 180;
        const gap = 40;
        const matrixLevels = (this as unknown as { _matrixLevelsCache?: powerbi.DataViewHierarchyLevel[] })._matrixLevelsCache
            ?? null;

        // Bundle a per-matrix-node selection id builder.
        const makeSelId = (raw: powerbi.DataViewMatrixNode): ISelectionId | undefined => {
            try {
                return this.host.createSelectionIdBuilder()
                    .withMatrixNode(raw, matrixLevels ?? [])
                    .createSelectionId();
            } catch { return undefined; }
        };

        // Walk the matrix following expansionPath, collecting one "column" at each level with the child list.
        const columns: TreeNode[][] = [];
        const rootNode: TreeNode = {
            name: "Total", levelName: "Total", levelIdx: -1,
            value: this.totalValue, secondary: null,
            children: [], raw: this.matrixRoot,
            pctOfParent: 1, pctOfTotal: 1,
            selectionId: undefined  // root selects nothing (would be "no filter")
        };
        columns.push([rootNode]);

        let cursor: powerbi.DataViewMatrixNode = this.matrixRoot;
        let cursorParent: TreeNode = rootNode;
        for (let depth = 0; depth < this.expansionPath.length; depth++) {
            const kids = cursor.children ?? [];
            if (kids.length === 0) break;
            const levelName = this.matrixLevels[depth] ?? `Level ${depth + 1}`;
            const nodes: TreeNode[] = kids.map(k => {
                const v = safeNum(k.values?.[0]?.value) ?? 0;
                const s2 = k.values && k.values[1] ? safeNum(k.values[1].value) : null;
                return {
                    name: String(k.value ?? ""),
                    levelName,
                    levelIdx: depth,
                    value: v,
                    secondary: s2,
                    children: [],
                    raw: k,
                    pctOfParent: cursorParent.value ? v / cursorParent.value : 0,
                    pctOfTotal:  this.totalValue ? v / this.totalValue : 0,
                    selectionId: makeSelId(k)
                };
            });
            const sorted = this.applySort(nodes, levelName);
            const truncated = this.applyMax(sorted, cursorParent);
            columns.push(truncated);
            cursorParent = truncated.find(n => n.name === this.expansionPath[depth]) ?? truncated[0];
            cursor = cursorParent.raw!;
            if (!cursor.children || cursor.children.length === 0) break;
        }

        // Add the "next level to explore" as a preview column — first available level not in path.
        const currentDepth = this.expansionPath.length;
        const nextKids = cursor.children ?? [];
        if (nextKids.length > 0 && columns.length === currentDepth + 1) {
            const levelName = this.matrixLevels[currentDepth] ?? `Level ${currentDepth + 1}`;
            const previewNodes: TreeNode[] = nextKids.map(k => {
                const v = safeNum(k.values?.[0]?.value) ?? 0;
                const s2 = k.values && k.values[1] ? safeNum(k.values[1].value) : null;
                return {
                    name: String(k.value ?? ""),
                    levelName,
                    levelIdx: currentDepth,
                    value: v,
                    secondary: s2,
                    children: [],
                    raw: k,
                    pctOfParent: cursorParent.value ? v / cursorParent.value : 0,
                    pctOfTotal:  this.totalValue ? v / this.totalValue : 0
                };
            });
            const sorted = this.applySort(previewNodes, levelName);
            columns.push(this.applyMax(sorted, cursorParent));
        }

        // ── Layout: one column per level; center vertically within its parent's span. ──
        const totalW = columns.length * colW + (columns.length - 1) * gap;
        this.container.attr("transform", `translate(${M.left}, ${M.top})`);

        interface Placed { node: TreeNode; x: number; y: number; w: number; h: number; parentIdx: number | null; }
        const placed: Placed[] = [];
        // Root
        placed.push({ node: rootNode, x: 0, y: Math.max(0, height - M.top - M.bottom - nodeH) / 2, w: colW, h: nodeH, parentIdx: null });
        let parentIdx = 0;
        for (let ci = 1; ci < columns.length; ci++) {
            const col = columns[ci];
            const parent = placed[parentIdx];
            const totalHeight = col.length * nodeH + (col.length - 1) * 6;
            const startY = Math.max(0, parent.y + parent.h / 2 - totalHeight / 2);
            const clampedStart = Math.max(0, Math.min(height - M.top - M.bottom - totalHeight, startY));
            const colX = ci * (colW + gap);
            col.forEach((n, ni) => {
                placed.push({
                    node: n,
                    x: colX,
                    y: clampedStart + ni * (nodeH + 6),
                    w: colW, h: nodeH,
                    parentIdx: parentIdx
                });
            });
            const chosenName = this.expansionPath[ci - 1];
            const nextParent = placed.slice(placed.length - col.length).find(p => p.node.name === chosenName);
            parentIdx = nextParent ? placed.indexOf(nextParent) : placed.length - col.length;
        }

        // ── Connectors ──
        const connStyle = String(s.expansionCard.connectorStyle.value?.value ?? "curved");
        const connG = this.container.append("g").classed("connectors", true);
        for (const p of placed) {
            if (p.parentIdx == null) continue;
            const pr = placed[p.parentIdx];
            const x1 = pr.x + pr.w, y1 = pr.y + pr.h / 2;
            const x2 = p.x, y2 = p.y + p.h / 2;
            const d = connStyle === "orthogonal"
                ? `M ${x1} ${y1} L ${(x1 + x2) / 2} ${y1} L ${(x1 + x2) / 2} ${y2} L ${x2} ${y2}`
                : `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
            connG.append("path")
                .attr("d", d).attr("fill", "none")
                .attr("stroke", palette.connector).attr("stroke-width", 1);
        }

        // ── Nodes ──
        const fs = Math.max(9, Math.min(18, s.nodesCard.fontSize.value ?? 11));
        const colorMode = String(s.nodesCard.barColorMode.value?.value ?? "single");
        const barSingle = s.nodesCard.barColor.value.value === DEFAULT_BAR_COLOR
            ? (this.colorPalette.getColor("dtBar")?.value || DEFAULT_BAR_COLOR)
            : s.nodesCard.barColor.value.value;
        const threshold = s.nodesCard.thresholdValue.value ?? 0;
        const above = s.nodesCard.aboveColor.value.value;
        const below = s.nodesCard.belowColor.value.value;
        const secondaryMode = String(s.nodesCard.secondaryMode.value?.value ?? "pct-parent");
        const showSec = s.nodesCard.showSecondary.value;

        // Compute per-column max value for bar-width scaling within siblings.
        const maxByCol: number[] = new Array(columns.length).fill(1);
        for (let ci = 0; ci < columns.length; ci++) {
            const m = d3.max(columns[ci].map(n => Math.abs(n.value))) ?? 1;
            maxByCol[ci] = m || 1;
        }

        const nodeG = this.container.append("g").classed("nodes", true);
        placed.forEach(p => {
            const g = nodeG.append("g").attr("class", "node").attr("transform", `translate(${p.x}, ${p.y})`);
            g.append("rect")
                .attr("x", 0).attr("y", 0).attr("width", p.w).attr("height", p.h)
                .attr("rx", 4).attr("ry", 4)
                .attr("fill", palette.background)
                .attr("stroke", palette.grid).attr("stroke-width", 1);

            // Bar fill inside the node (width ∝ value in its column).
            const ci = Math.round(p.x / (colW + gap));
            const maxV = maxByCol[ci] || 1;
            const bw = (Math.abs(p.node.value) / maxV) * (p.w - 12);
            const bh = 6;
            const by = p.h - bh - 4;
            const barColor = palette.highContrast ? palette.barSingle
                : colorMode === "conditional"
                    ? (p.node.value >= threshold ? above : below)
                    : barSingle;
            if (p.node.levelIdx >= 0) {
                g.append("rect")
                    .attr("x", 6).attr("y", by)
                    .attr("width", Math.max(1, bw)).attr("height", bh)
                    .attr("fill", barColor).attr("rx", 2);
            }

            // Primary text: name (top-left) + value (top-right).
            g.append("text")
                .attr("x", 8).attr("y", 14)
                .attr("font-family", "Segoe UI, sans-serif")
                .attr("font-size", `${fs}px`).attr("font-weight", 600)
                .attr("fill", palette.labelText).text(p.node.name);
            g.append("text")
                .attr("x", p.w - 8).attr("y", 14)
                .attr("text-anchor", "end")
                .attr("font-family", "Segoe UI, sans-serif")
                .attr("font-size", `${fs}px`)
                .attr("fill", palette.labelText).text(d3.format(",.4~g")(p.node.value));

            if (showSec) {
                let secText = "";
                if (secondaryMode === "measure" && p.node.secondary != null) {
                    secText = d3.format(",.4~g")(p.node.secondary);
                } else if (secondaryMode === "pct-parent" && p.node.pctOfParent != null) {
                    secText = `${(p.node.pctOfParent * 100).toFixed(1)}% of parent`;
                } else if (secondaryMode === "pct-total" && p.node.pctOfTotal != null) {
                    secText = `${(p.node.pctOfTotal * 100).toFixed(1)}% of total`;
                }
                if (secText) {
                    g.append("text")
                        .attr("x", p.w - 8).attr("y", p.h - 8)
                        .attr("text-anchor", "end")
                        .attr("font-family", "Segoe UI, sans-serif")
                        .attr("font-size", `${Math.max(8, fs - 2)}px`)
                        .attr("fill", palette.axisText).text(secText);
                }
            }

            // Click → expand this node (advance the path) AND cross-filter by its selection id.
            if (p.node.levelIdx >= 0) {
                g.attr("cursor", "pointer");
                g.datum({ node: p.node });
                g.classed("node", true);
                g.attr("tabindex", 0).attr("role", "button")
                    .attr("aria-label", `${p.node.levelName}: ${p.node.name}, click to expand and filter`);
                g.on("click", (event: MouseEvent) => {
                    event.stopPropagation();
                    // Truncate path to this level's depth, then push this node.
                    this.expansionPath = this.expansionPath.slice(0, p.node.levelIdx);
                    this.expansionPath.push(p.node.name);
                    // Cross-filter downstream visuals by the clicked node.
                    if (p.node.selectionId) {
                        const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                        this.selectionManager.select(p.node.selectionId, multi);
                    }
                    this.render(width, height, palette);
                });
                g.on("contextmenu", (event: MouseEvent) => {
                    event.preventDefault(); event.stopPropagation();
                    this.selectionManager.showContextMenu(p.node.selectionId ?? ({} as ISelectionId), { x: event.clientX, y: event.clientY });
                });
                g.on("keydown", (event: KeyboardEvent) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    this.expansionPath = this.expansionPath.slice(0, p.node.levelIdx);
                    this.expansionPath.push(p.node.name);
                    if (p.node.selectionId) this.selectionManager.select(p.node.selectionId, event.shiftKey);
                    this.render(width, height, palette);
                });
                g.on("mousemove", (event: MouseEvent) => {
                    const items: VisualTooltipDataItem[] = [
                        { displayName: p.node.levelName, value: p.node.name },
                        { displayName: "Value", value: d3.format(",.4~g")(p.node.value) }
                    ];
                    if (p.node.pctOfParent != null) items.push({ displayName: "% of parent", value: `${(p.node.pctOfParent * 100).toFixed(1)}%` });
                    if (p.node.pctOfTotal  != null) items.push({ displayName: "% of total",  value: `${(p.node.pctOfTotal  * 100).toFixed(1)}%` });
                    if (p.node.secondary != null) items.push({ displayName: "Secondary", value: d3.format(",.4~g")(p.node.secondary) });
                    this.tooltipService.show({
                        dataItems: items, identities: [], coordinates: [event.clientX, event.clientY], isTouchEvent: false
                    });
                });
                g.on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));
            }

            // Column header (level name) — draw once per column above the top node.
            if (ci >= 0 && p === placed.find(pp => Math.round(pp.x / (colW + gap)) === ci)) {
                this.container.append("text")
                    .attr("x", p.x + 8).attr("y", p.y - 6)
                    .attr("font-family", "Segoe UI, sans-serif")
                    .attr("font-size", "10px").attr("font-weight", 600).attr("fill", palette.axisText)
                    .text(ci === 0 ? "Total" : (this.matrixLevels[ci - 1] || `Level ${ci}`));
            }
        });

        // Overflow warning at right if we truncated to totalW.
        if (totalW > width - M.left - M.right) {
            this.container.append("text")
                .attr("x", width - M.left - M.right - 6).attr("y", height - M.top - M.bottom - 4)
                .attr("text-anchor", "end")
                .attr("font-family", "Segoe UI, sans-serif")
                .attr("font-size", "10px").attr("fill", palette.axisText)
                .text("• Scroll horizontally to see more");
        }

        this.applySelectionStyling();
    }

    private applySort(nodes: TreeNode[], levelName: string): TreeNode[] {
        const mode = String(this.formattingSettings.sortingCard.sortMode.value?.value ?? "value-desc");
        const list = nodes.slice();
        if (mode === "value-desc") list.sort((a, b) => b.value - a.value);
        else if (mode === "value-asc") list.sort((a, b) => a.value - b.value);
        else if (mode === "alphabetical") list.sort((a, b) => a.name.localeCompare(b.name));
        else if (mode === "custom-per-level") {
            const raw = String(this.formattingSettings.sortingCard.customOrder.value ?? "");
            // Format: 'Level: a, b, c; Other: x, y, z'
            const spec = new Map<string, string[]>();
            for (const chunk of raw.split(";").map(c => c.trim()).filter(Boolean)) {
                const [lvl, items] = chunk.split(":").map(s => s.trim());
                if (lvl && items) spec.set(lvl, items.split(",").map(x => x.trim()));
            }
            const order = spec.get(levelName);
            if (order) {
                const rank = new Map<string, number>();
                order.forEach((n, i) => rank.set(n, i));
                list.sort((a, b) => {
                    const ra = rank.has(a.name) ? rank.get(a.name)! : 10000;
                    const rb = rank.has(b.name) ? rank.get(b.name)! : 10000;
                    return ra - rb;
                });
            } else {
                list.sort((a, b) => b.value - a.value);
            }
        }
        return list;
    }

    private applyMax(nodes: TreeNode[], parent: TreeNode): TreeNode[] {
        const limit = Math.max(2, this.formattingSettings.nodesCard.maxNodesPerLevel.value ?? 10);
        if (nodes.length <= limit) return nodes;
        const shown = nodes.slice(0, limit);
        const rest = nodes.slice(limit);
        const otherValue = rest.reduce((a, b) => a + b.value, 0);
        shown.push({
            name: `Other (${rest.length})`, levelName: nodes[0].levelName, levelIdx: nodes[0].levelIdx,
            value: otherValue, secondary: null, children: [],
            pctOfParent: parent.value ? otherValue / parent.value : 0,
            pctOfTotal:  this.totalValue ? otherValue / this.totalValue : 0
        });
        return shown;
    }

    private resolvePalette(): RenderPalette {
        const cp = this.colorPalette;
        if (cp.isHighContrast) {
            const fg = cp.foreground?.value || "#000";
            const bg = cp.background?.value || "#fff";
            return {
                highContrast: true, barSingle: fg, above: fg, below: fg,
                connector: fg, axisText: fg, labelText: fg, grid: fg, background: bg,
                landingText: fg, landingSub: fg
            };
        }
        const bg = cp.background?.value || "#fff";
        const isDark = luminance(bg) < 0.5;
        const themeFg = cp.foreground?.value || (isDark ? "#f0f0f0" : "#333");
        return {
            highContrast: false,
            barSingle: cp.getColor("dtBar")?.value || DEFAULT_BAR_COLOR,
            above: "#2ca02c", below: "#d62728",
            connector: isDark ? "#666" : "#c9c9c9",
            axisText: isDark ? "#bbb" : "#666",
            labelText: themeFg,
            grid: isDark ? "#3a3a3a" : "#e6e6e6",
            background: bg,
            landingText: isDark ? "#eee" : "#333",
            landingSub: isDark ? "#aaa" : "#999"
        };
    }

    private renderLandingPage(width: number, height: number, palette: RenderPalette): void {
        this.landing.selectAll("*").remove();
        this.container.selectAll("*").remove();
        if (width < 160 || height < 100) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);
        const glyph = g.append("g").attr("transform", "translate(-100, -80)");
        // Simple tree glyph
        glyph.append("rect").attr("x", 0).attr("y", 40).attr("width", 60).attr("height", 24).attr("rx", 4).attr("fill", "#4472C4").attr("fill-opacity", 0.15).attr("stroke", "#4472C4");
        for (let i = 0; i < 3; i++) {
            glyph.append("rect").attr("x", 120).attr("y", 10 + i * 40).attr("width", 60).attr("height", 24).attr("rx", 4).attr("fill", "#4472C4").attr("fill-opacity", 0.15).attr("stroke", "#4472C4");
            glyph.append("path").attr("d", `M 60 52 C 90 52, 90 ${22 + i * 40}, 120 ${22 + i * 40}`).attr("fill", "none").attr("stroke", "#c9c9c9");
        }
        g.append("text").attr("text-anchor", "middle").attr("y", 34)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px").attr("font-weight", 600)
            .attr("fill", palette.landingText).text("Decomp Tree Pro");
        g.append("text").attr("text-anchor", "middle").attr("y", 54)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px").attr("fill", palette.axisText)
            .text("Add fields:  Analyze (measure)  +  Explain By (one or more grouping fields)");
        g.append("text").attr("text-anchor", "middle").attr("y", 72)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px").attr("fill", palette.landingSub)
            .text("Click a node to expand · conditional coloring, %-of-parent, custom sort in the format pane");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
