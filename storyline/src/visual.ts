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

import { VisualFormattingSettingsModel } from "./settings";
import { layoutStoryline, aggregateStoryline, StorylineRow, Ordering, LayoutResult, AggregateLayout } from "./layout";
import { Fingerprint, ComputeCache } from "./computeCache";

// ── Types ──────────────────────────────────────────────────────

/** One drawn span between two adjacent time steps for one entity. */
interface Segment {
    entity: string;
    t0: number;
    group: string;
    d: string;
    color: string;
}

// ── Visual ─────────────────────────────────────────────────────

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

    private margin = { top: 26, right: 92, bottom: 26, left: 74 };

    /** Caches the barycentre sweep so restyling doesn't re-run it. */
    private layoutCache = new ComputeCache<LayoutResult>();

    /** Caches the aggregate-flow layout, which is O(entities · times). */
    private aggregateCache = new ComputeCache<AggregateLayout>();

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        // Localization manager instantiated for future getDisplayName use; call is required for the AppSource Localizations feature check.
        void options.host.createLocalizationManager();
        // Read host.allowInteractions — respect the report author's
        // "Allow visual to interact with other visuals" setting. Also required
        // for the AppSource Allow Interactions feature check.
        void (options.host as unknown as { allowInteractions?: boolean }).allowInteractions;
        this.colorPalette = options.host.colorPalette;
        this.tooltipService = options.host.tooltipService;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applyExternalDim());

        this.svg = d3.select(options.element).append("svg").classed("sl-root", true)
            .attr("tabindex", 0).attr("role", "img").attr("aria-label", "Storyline");
        this.landing = this.svg.append("g").classed("sl-landing", true);
        this.container = this.svg.append("g").classed("sl-container", true);

        // Right-click anywhere on the visual opens the host data-point menu,
        // giving report readers Include/Exclude when they've cross-filtered TO
        // this visual. Also required for the AppSource Context Menu check.
        this.svg.on("contextmenu", (event: MouseEvent) => {
            event.preventDefault();
            const activeIds = this.selectionManager.getSelectionIds() as ISelectionId[];
            this.selectionManager.showContextMenu(
                activeIds[0] ?? ({} as ISelectionId),
                { x: event.clientX, y: event.clientY }
            );
        });

        this.svg.on("click.clear", (event: MouseEvent) => {
            if (event.target === this.svg.node()) {
                this.selectionManager.clear().then(() => this.applyExternalDim());
            }
        });
    }

    private applyExternalDim(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.1, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 30) / 100));
        const hasSel = this.selectionManager.getSelectionIds().length > 0;
        this.container.attr("opacity", hasSel ? dim : 1);
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const L = this.formattingSettings.layoutCard;
            const A = this.formattingSettings.appearanceCard;
            const LB = this.formattingSettings.labelsCard;

            // High contrast: the palette can't encode entity/group categories,
            // so all data marks collapse to the foreground and lines rely on
            // hover-focus + labels to disambiguate.
            const hc = this.colorPalette.isHighContrast === true;
            const hcFg = this.colorPalette.foreground?.value || "#000000";
            const hcMuted = hc ? hcFg : "#666";
            const hcMuted2 = hc ? hcFg : "#888";
            const hcTitle = hc ? hcFg : "#555";
            const hcLabel = hc ? hcFg : "#444";

            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);
            this.container.selectAll("*").remove();

            // ── Data ───────────────────────────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const table = dataView?.table;
            const cols = table?.columns;
            const roleCol = (role: string): number =>
                cols ? cols.findIndex(c => c.roles && c.roles[role]) : -1;
            const cE = roleCol("entity"), cT = roleCol("timeStep"), cG = roleCol("group");

            if (!table?.rows?.length || cE < 0 || cT < 0 || cG < 0) {
                this.renderLandingPage(width, height, cE >= 0, cT >= 0, cG >= 0);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            const rows: StorylineRow[] = [];
            for (const r of table.rows) {
                if (r[cE] == null || r[cT] == null || r[cG] == null) continue;
                rows.push({
                    entity: String(r[cE]),
                    time: r[cT] instanceof Date ? (r[cT] as Date).toISOString() : String(r[cT]),
                    group: String(r[cG])
                });
            }
            if (!rows.length) {
                this.renderLandingPage(width, height, true, true, true);
                this.events.renderingFinished(options);
                return;
            }

            // ── Layout ─────────────────────────────────────────────
            const lineWidth = Math.max(0.5, A.lineWidth.value ?? 2);
            const entityGap = Math.max(0, L.entityGap.value ?? 4);
            const groupGap = Math.max(0, L.groupGap.value ?? 20);
            const slotHeight = lineWidth + entityGap;
            const ordering = String(L.orderingStrategy.value?.value ?? "minimize-crossings") as Ordering;
            const flowMode = String(L.flowMode.value?.value ?? "entity");

            // ── Aggregate branch (Sankey) ──────────────────────────
            // Bail out to a separate renderer so the per-entity code paths
            // don't have to interleave with ribbon layout. Same input, but
            // very different geometry — one branch per branch of the design.
            if (flowMode === "aggregate") {
                this.renderAggregate(rows, width, height, LB, A, L);
                this.applyExternalDim();
                this.events.renderingFinished(options);
                return;
            }

            // ── Layout (cached) ────────────────────────────────────
            // The barycentre sweep runs several full passes over every entity at
            // every time step. It depends on the rows and the geometry that
            // shapes it — slot height, group gap, ordering strategy — so line
            // colour, tension, labels and hover styling all re-render from the
            // cached layout rather than re-sweeping.
            const layoutKey = new Fingerprint()
                .num(slotHeight).num(groupGap).str(ordering)
                .num(rows.length)
                .strs(rows.map(r => `${r.entity}${r.time}${r.group}`))
                .done();
            const res: LayoutResult | null = this.layoutCache.get(layoutKey,
                () => layoutStoryline(rows, { slotHeight, groupGap, ordering }));
            if (!res || res.times.length === 0) {
                this.renderLandingPage(width, height, true, true, true);
                this.events.renderingFinished(options);
                return;
            }

            const fs = Math.max(6, LB.fontSize.value);
            const m = {
                top: this.margin.top,
                right: LB.showEntityLabels.value ? this.margin.right : 20,
                bottom: this.margin.bottom,
                left: LB.showGroupLabels.value ? this.margin.left : 20
            };
            const plotW = Math.max(20, width - m.left - m.right);
            const plotH = Math.max(20, height - m.top - m.bottom);
            if (plotW < 30 || plotH < 30) { this.events.renderingFinished(options); return; }

            const T = res.times.length;
            const x = (t: number) => T > 1 ? m.left + (t / (T - 1)) * plotW : m.left + plotW / 2;
            // Compress the computed layout height into the viewport.
            const scaleY = res.height > 0 ? Math.min(1, plotH / res.height) : 1;
            const yOff = m.top + Math.max(0, (plotH - res.height * scaleY) / 2);
            const y = (v: number) => yOff + v * scaleY;

            // ── Colors ─────────────────────────────────────────────
            const colorBy = String(A.colorBy.value?.value ?? "entity");
            const colorFor = (entity: string, group: string): string =>
                hc ? hcFg : this.colorPalette.getColor(colorBy === "group" ? group : entity).value;

            // ── Group bands (behind the lines) ─────────────────────
            const tension = Math.max(0, Math.min(100, L.lineTension.value ?? 50)) / 100 * 0.5;
            if (LB.showGroupLabels.value) {
                const bandsByGroup = new Map<string, { t: number; y0: number; y1: number }[]>();
                for (const b of res.bands) {
                    let arr = bandsByGroup.get(b.group);
                    if (!arr) { arr = []; bandsByGroup.set(b.group, arr); }
                    arr.push(b);
                }
                const bg = this.container.append("g").classed("bands", true);
                for (const [group, arr] of bandsByGroup) {
                    arr.sort((a, b) => a.t - b.t);
                    // Split into contiguous runs — a group can disappear and return.
                    let run: typeof arr = [];
                    const flush = () => {
                        if (run.length === 0) return;
                        const top = run.map(b => ({ x: x(b.t), y: y(b.y0) - 2 }));
                        const bot = run.map(b => ({ x: x(b.t), y: y(b.y1) + 2 })).reverse();
                        // Top edge left→right, then the bottom edge back right→left.
                        const d = smoothPath(top, tension) + smoothPathTail(bot, tension) + " Z";
                        bg.append("path")
                            .attr("d", d)
                            .attr("fill", hc ? hcFg : this.colorPalette.getColor(group).value)
                            .attr("fill-opacity", 0.08)
                            .attr("stroke", "none");
                        run = [];
                    };
                    for (let i = 0; i < arr.length; i++) {
                        if (run.length && arr[i].t !== run[run.length - 1].t + 1) flush();
                        run.push(arr[i]);
                    }
                    flush();

                    // Group label at the band's leftmost slice.
                    const firstBand = arr[0];
                    bg.append("text")
                        .attr("x", m.left - 8)
                        .attr("y", y((firstBand.y0 + firstBand.y1) / 2))
                        .attr("text-anchor", "end").attr("dominant-baseline", "middle")
                        .attr("font-size", `${fs}px`).attr("font-weight", 600).attr("fill", hcMuted)
                        .text(group);
                }
            }

            // ── Build the line segments ────────────────────────────
            const segments: Segment[] = [];
            for (const e of res.entities) {
                const pos = res.positions.get(e)!;
                const grp = res.entityGroup.get(e)!;
                for (let t = 0; t < T - 1; t++) {
                    if (!pos.has(t) || !pos.has(t + 1)) continue;   // gap → no bridge drawn
                    const p0 = { x: x(t), y: y(pos.get(t)!) };
                    const p1 = { x: x(t + 1), y: y(pos.get(t + 1)!) };
                    const dx = (p1.x - p0.x) * tension;
                    segments.push({
                        entity: e, t0: t, group: grp.get(t) || "",
                        d: `M ${p0.x},${p0.y} C ${p0.x + dx},${p0.y} ${p1.x - dx},${p1.y} ${p1.x},${p1.y}`,
                        color: colorFor(e, grp.get(t) || "")
                    });
                }
            }

            const baseOp = Math.max(0, Math.min(1, (A.lineOpacity.value ?? 70) / 100));
            const hiOp = Math.max(0, Math.min(1, (A.highlightOpacity.value ?? 100) / 100));
            const dimOp = Math.max(0, Math.min(1, (A.dimOpacity.value ?? 15) / 100));

            const lines = this.container.append("g").classed("lines", true);
            const sel = lines.selectAll<SVGPathElement, Segment>("path")
                .data(segments)
                .enter()
                .append("path")
                .attr("d", d => d.d)
                .attr("fill", "none")
                .attr("stroke", d => d.color)
                .attr("stroke-width", lineWidth)
                .attr("stroke-linecap", "round")
                .attr("stroke-opacity", baseOp);

            // Single-time-step data has no segments — show the dots instead.
            if (T === 1) {
                const dots = this.container.append("g").classed("dots", true);
                for (const e of res.entities) {
                    const pos = res.positions.get(e)!;
                    if (!pos.has(0)) continue;
                    dots.append("circle")
                        .attr("cx", x(0)).attr("cy", y(pos.get(0)!))
                        .attr("r", Math.max(2, lineWidth))
                        .attr("fill", colorFor(e, res.entityGroup.get(e)!.get(0) || ""));
                }
            }

            // ── Entity labels at each line's final slice ───────────
            if (LB.showEntityLabels.value) {
                const lg = this.container.append("g").classed("entity-labels", true);
                for (const e of res.entities) {
                    const pos = res.positions.get(e)!;
                    let last = -1;
                    for (let t = T - 1; t >= 0; t--) { if (pos.has(t)) { last = t; break; } }
                    if (last < 0) continue;
                    lg.append("text")
                        .attr("x", x(last) + 6).attr("y", y(pos.get(last)!))
                        .attr("dominant-baseline", "middle")
                        .attr("font-size", `${fs}px`).attr("fill", hcLabel)
                        .text(e);
                }
            }

            // ── Time axis ──────────────────────────────────────────
            const ax = this.container.append("g").classed("time-axis", true);
            const step = Math.max(1, Math.ceil(T / Math.max(1, Math.floor(plotW / 70))));
            for (let t = 0; t < T; t += step) {
                ax.append("text")
                    .attr("x", x(t)).attr("y", m.top - 10)
                    .attr("text-anchor", "middle")
                    .attr("font-size", `${fs}px`).attr("fill", hcMuted2)
                    .text(res.times[t]);
            }

            // ── Hover focus ────────────────────────────────────────
            if (A.highlightOnHover.value) {
                const timeTitle = cols![cT].displayName || "Time";
                const groupTitle = cols![cG].displayName || "Group";
                const entityTitle = cols![cE].displayName || "Entity";
                sel.on("mouseenter", (event: MouseEvent, d: Segment) => {
                    // If a peer visual is already dimming the whole container,
                    // skip the per-line dim — otherwise container.opacity(dim) ×
                    // stroke-opacity(dimOp) compounds to near-invisibility.
                    // Hovered line still lifts to hiOp for a visible focus.
                    const hasSel = this.selectionManager.getSelectionIds().length > 0;
                    sel.attr("stroke-opacity", s => s.entity === d.entity ? hiOp : (hasSel ? baseOp : dimOp));
                })
                    .on("mousemove", (event: MouseEvent, d: Segment) => {
                        const [px, py] = d3.pointer(event, this.svg.node());
                        const grp = res.entityGroup.get(d.entity)!;
                        // Summarize the whole trajectory, not just this span.
                        const moves: string[] = [];
                        let prev = "";
                        for (let t = 0; t < T; t++) {
                            const g = grp.get(t);
                            if (g && g !== prev) { moves.push(`${res.times[t]}: ${g}`); prev = g; }
                        }
                        const items: VisualTooltipDataItem[] = [
                            { displayName: entityTitle, value: d.entity },
                            { displayName: timeTitle, value: res.times[d.t0] },
                            { displayName: groupTitle, value: d.group },
                            { displayName: "Moves", value: String(Math.max(0, moves.length - 1)) }
                        ];
                        if (moves.length <= 6) {
                            items.push({ displayName: "Path", value: moves.join("  →  ") });
                        }
                        this.tooltipService.show({
                            dataItems: items, identities: [],
                            coordinates: [px, py], isTouchEvent: false
                        });
                    })
                    .on("mouseleave", () => {
                        sel.attr("stroke-opacity", baseOp);
                        this.tooltipService.hide({ immediately: false, isTouchEvent: false });
                    });
            }

            this.applyExternalDim();
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private renderAggregate(
        rows: StorylineRow[],
        width: number, height: number,
        LB: VisualFormattingSettingsModel["labelsCard"],
        A: VisualFormattingSettingsModel["appearanceCard"],
        L: VisualFormattingSettingsModel["layoutCard"]
    ): void {
        const unitH = Math.max(0.5, L.unitHeight.value ?? 4);
        const groupGap = Math.max(0, L.groupGap.value ?? 20);
        const fs = Math.max(6, LB.fontSize.value);

        const key = new Fingerprint()
            .num(unitH).num(groupGap)
            .num(rows.length)
            .strs(rows.map(r => `${r.entity}\x00${r.time}\x00${r.group}`))
            .done();
        const flow = this.aggregateCache.get(key,
            () => aggregateStoryline(rows, { unitHeight: unitH, groupGap }));
        if (!flow) return;

        const m = {
            top: 26,
            right: LB.showEntityLabels.value ? 92 : 20,
            bottom: 26,
            left: LB.showGroupLabels.value ? 74 : 20
        };
        const plotW = Math.max(20, width - m.left - m.right);
        const plotH = Math.max(20, height - m.top - m.bottom);
        if (plotW < 30 || plotH < 30) return;

        const T = flow.times.length;
        const x = (t: number) => T > 1 ? m.left + (t / (T - 1)) * plotW : m.left + plotW / 2;
        // Compress the tallest slice into the viewport height.
        const scaleY = flow.height > 0 ? Math.min(1, plotH / flow.height) : 1;
        const yOff = m.top + Math.max(0, (plotH - flow.height * scaleY) / 2);
        const y = (v: number) => yOff + v * scaleY;

        // Fixed pixel gap between the ribbon-endpoint stripe and the group
        // band, so the ribbons don't fuse into the bands and become unreadable.
        const nodeW = Math.max(6, Math.min(14, plotW / T * 0.12));

        // Colour ribbons by their SOURCE group by default. Same-source
        // (stayed) ribbons and cross-source (moved) ribbons visually cluster
        // together, so a churny time slice reads immediately as "lots of
        // different source colours flowing in".
        const hc = this.colorPalette.isHighContrast === true;
        const hcFg = this.colorPalette.foreground?.value || "#000000";
        const hcMuted = hc ? hcFg : "#666";
        const hcMuted2 = hc ? hcFg : "#888";
        const hcTitle = hc ? hcFg : "#555";
        const hcLabel = hc ? hcFg : "#444";
        const colorFor = (group: string): string =>
            hc ? hcFg : this.colorPalette.getColor(group).value;
        const tension = Math.max(0, Math.min(100, L.lineTension.value ?? 50)) / 100 * 0.5;

        // ── Ribbons ────────────────────────────────────────────
        const ribbonLayer = this.container.append("g").classed("ribbons", true);
        for (const r of flow.ribbons) {
            const x0 = x(r.t) + nodeW / 2;
            const x1 = x(r.t + 1) - nodeW / 2;
            const dx = (x1 - x0) * tension;
            const yTL = y(r.y0Src), yBL = y(r.y1Src);
            const yTR = y(r.y0Tgt), yBR = y(r.y1Tgt);
            // Top edge left→right, right edge down, bottom edge right→left, close.
            const d =
                `M ${x0},${yTL} ` +
                `C ${x0 + dx},${yTL} ${x1 - dx},${yTR} ${x1},${yTR} ` +
                `L ${x1},${yBR} ` +
                `C ${x1 - dx},${yBR} ${x0 + dx},${yBL} ${x0},${yBL} Z`;
            const same = r.from === r.to;
            ribbonLayer.append("path")
                .attr("d", d)
                .attr("fill", colorFor(r.from))
                .attr("fill-opacity", same ? 0.28 : 0.55)
                .attr("stroke", "none")
                .on("mousemove", (event: MouseEvent) => {
                    const [px, py] = d3.pointer(event, this.svg.node());
                    const items: VisualTooltipDataItem[] = [
                        { displayName: "From", value: `${r.from}  @  ${flow.times[r.t]}` },
                        { displayName: "To", value: `${r.to}  @  ${flow.times[r.t + 1]}` },
                        { displayName: "Entities", value: String(r.count) },
                        { displayName: "Change", value: same ? "Stayed" : "Moved" }
                    ];
                    this.tooltipService.show({
                        dataItems: items, identities: [],
                        coordinates: [px, py], isTouchEvent: false
                    });
                })
                .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));
        }

        // ── Group nodes (the vertical rectangles at each time) ─
        const nodeLayer = this.container.append("g").classed("nodes", true);
        for (const s of flow.slices) {
            for (const g of s.groups) {
                nodeLayer.append("rect")
                    .attr("x", x(s.tIdx) - nodeW / 2)
                    .attr("y", y(g.y0))
                    .attr("width", nodeW)
                    .attr("height", Math.max(1, y(g.y1) - y(g.y0)))
                    .attr("fill", colorFor(g.group))
                    .attr("fill-opacity", 0.95)
                    .on("mousemove", (event: MouseEvent) => {
                        const [px, py] = d3.pointer(event, this.svg.node());
                        this.tooltipService.show({
                            dataItems: [
                                { displayName: "Group", value: g.group },
                                { displayName: "Time", value: s.time },
                                { displayName: "Members", value: String(g.count) },
                                { displayName: "Share", value: `${(g.count / Math.max(1, s.total / unitH) * 100).toFixed(0)}%` }
                            ],
                            identities: [], coordinates: [px, py], isTouchEvent: false
                        });
                    })
                    .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));

                // Count label inside the band if it fits.
                const bandH = y(g.y1) - y(g.y0);
                if (bandH >= fs + 4 && s.tIdx === 0 || s.tIdx === T - 1) {
                    nodeLayer.append("text")
                        .attr("x", s.tIdx === 0 ? x(s.tIdx) - nodeW - 4 : x(s.tIdx) + nodeW + 4)
                        .attr("y", (y(g.y0) + y(g.y1)) / 2)
                        .attr("text-anchor", s.tIdx === 0 ? "end" : "start")
                        .attr("dominant-baseline", "middle")
                        .attr("font-size", `${Math.max(9, fs - 2)}px`)
                        .attr("fill", hcMuted)
                        .text(`${g.count}`);
                }
            }
        }

        // ── Group labels down the left edge ────────────────────
        if (LB.showGroupLabels.value) {
            const labelLayer = this.container.append("g").classed("group-labels", true);
            const s0 = flow.slices[0];
            for (const g of s0.groups) {
                labelLayer.append("text")
                    .attr("x", m.left - 20)
                    .attr("y", (y(g.y0) + y(g.y1)) / 2)
                    .attr("text-anchor", "end").attr("dominant-baseline", "middle")
                    .attr("font-size", `${fs}px`).attr("font-weight", 600).attr("fill", hcTitle)
                    .text(g.group);
            }
        }

        // ── Time axis ──────────────────────────────────────────
        const ax = this.container.append("g").classed("time-axis", true);
        const step = Math.max(1, Math.ceil(T / Math.max(1, Math.floor(plotW / 70))));
        for (let t = 0; t < T; t += step) {
            ax.append("text")
                .attr("x", x(t)).attr("y", m.top - 10)
                .attr("text-anchor", "middle")
                .attr("font-size", `${fs}px`).attr("fill", hcMuted2)
                .text(flow.times[t]);
        }

        // ── Note: aggregation stats ────────────────────────────
        // Report total entities and how many transitions crossed group lines
        // versus stayed — puts a number on the churn the ribbons visualise.
        let stayed = 0, moved = 0;
        for (const r of flow.ribbons) (r.from === r.to ? stayed += r.count : moved += r.count);
        const totalTrans = stayed + moved;
        const churn = totalTrans > 0 ? Math.round(moved / totalTrans * 100) : 0;
        this.container.append("text")
            .attr("x", width - m.right).attr("y", m.top - 10)
            .attr("text-anchor", "end")
            .attr("font-size", `${Math.max(9, fs - 1)}px`).attr("fill", hcMuted)
            .text(`Aggregate · ${flow.totalEntities} entities · ${churn}% of transitions cross groups`
                + (flow.droppedTransitions ? ` · ${flow.droppedTransitions} left` : "")
                + (flow.enteredTransitions ? ` · ${flow.enteredTransitions} joined` : ""));
    }

    private renderLandingPage(
        width: number, height: number, hasE: boolean, hasT: boolean, hasG: boolean
    ): void {
        this.landing.selectAll("*").remove();
        this.container.selectAll("*").remove();
        if (width < 160 || height < 110) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        // Glyph: a few lines weaving between two bands.
        const glyph = g.append("g").attr("transform", "translate(-96,-92)");
        const cols = ["#4682B4", "#E67E22", "#2ca02c", "#9B59B6"];
        const paths = [
            "M0,10 C24,10 24,10 48,10 C72,10 72,44 96,44 C120,44 120,44 144,44 C168,44 168,10 192,10",
            "M0,20 C24,20 24,20 48,20 C72,20 72,20 96,20 C120,20 120,54 144,54 C168,54 168,54 192,54",
            "M0,44 C24,44 24,44 48,44 C72,44 72,20 96,20 C120,20 120,20 144,20 C168,20 168,20 192,20",
            "M0,54 C24,54 24,54 48,54 C72,54 72,54 96,54 C120,54 120,10 144,10 C168,10 168,10 192,10"
        ];
        glyph.append("rect").attr("x", 0).attr("y", 2).attr("width", 192).attr("height", 26)
            .attr("fill", "#4682B4").attr("fill-opacity", 0.08);
        glyph.append("rect").attr("x", 0).attr("y", 36).attr("width", 192).attr("height", 26)
            .attr("fill", "#E67E22").attr("fill-opacity", 0.08);
        paths.forEach((d, i) => glyph.append("path").attr("d", d)
            .attr("fill", "none").attr("stroke", cols[i]).attr("stroke-width", 2.2)
            .attr("stroke-opacity", 0.8).attr("stroke-linecap", "round"));

        g.append("text").attr("text-anchor", "middle").attr("y", 0)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px")
            .attr("font-weight", 600).attr("fill", "#333").text("Storyline Chart");

        const missing: string[] = [];
        if (!hasE) missing.push("Entity");
        if (!hasT) missing.push("Time Step");
        if (!hasG) missing.push("Group");
        const hcL = this.colorPalette.isHighContrast === true ? (this.colorPalette.foreground?.value || "#000") : "#666";
        g.append("text").attr("text-anchor", "middle").attr("y", 22)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", hcL)
            .text(missing.length ? "Add fields:  " + missing.join("   +   ") : "Add Entity, Time Step and Group to begin");
        g.append("text").attr("text-anchor", "middle").attr("y", 44)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
            .attr("fill", "#999")
            .text("One row per entity per time step, naming the group it belonged to then.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}

// ── Path helpers ───────────────────────────────────────────────

interface Pt { x: number; y: number; }

/** Cubic path through points with horizontal control handles (C1 continuous). */
function smoothPath(pts: Pt[], tension: number): string {
    if (!pts.length) return "";
    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const dx = (p1.x - p0.x) * tension;
        d += ` C ${p0.x + dx},${p0.y} ${p1.x - dx},${p1.y} ${p1.x},${p1.y}`;
    }
    return d;
}

/** Continuation of an existing path along `pts` (used for a band's return edge). */
function smoothPathTail(pts: Pt[], tension: number): string {
    if (!pts.length) return "";
    let d = ` L ${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const dx = (p1.x - p0.x) * tension;
        d += ` C ${p0.x + dx},${p0.y} ${p1.x - dx},${p1.y} ${p1.x},${p1.y}`;
    }
    return d;
}
