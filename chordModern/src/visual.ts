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
import ISandboxExtendedColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;

import { VisualFormattingSettingsModel } from "./settings";

// ── Types ──────────────────────────────────────────────────────

interface RenderPalette {
    highContrast: boolean;
    fg: string;
    axisText: string;
    background: string;
    labelText: string;
    landingText: string;
    landingSub: string;
}

interface EdgeRaw {
    source: string;
    target: string;
    weight: number;
    selectionId?: ISelectionId;
    isHighlighted: boolean;
}

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
    private defs: d3.Selection<SVGDefsElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;

    /** Aggregated selection ids indexed by node name (built each render). */
    private idsByNode = new Map<string, ISelectionId[]>();
    /** Selection ids indexed by "source→target" (for ribbon clicks). */
    private idByEdgeKey = new Map<string, ISelectionId>();

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.colorPalette = options.host.colorPalette;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applySelectionStyling());

        this.svg = d3.select(options.element).append("svg").classed("chord-modern", true);
        this.defs = this.svg.append("defs");
        this.landing = this.svg.append("g").classed("cm-landing", true);
        this.container = this.svg.append("g").classed("cm-container", true);

        this.svg.on("click", (event: MouseEvent) => {
            if (event.target === this.svg.node()) {
                this.selectionManager.clear().then(() => this.applySelectionStyling());
            }
        });
    }

    private applySelectionStyling(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.05, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 20) / 100));
        const activeIds = this.selectionManager.getSelectionIds() as ISelectionId[];
        const hasSel = activeIds.length > 0;
        const eq = (a: ISelectionId, b: ISelectionId) =>
            (a as { equals?: (b: ISelectionId) => boolean }).equals?.(b) ?? false;

        this.container.selectAll<SVGPathElement, { __ids?: ISelectionId[] }>(".arc, .ribbon").each(function (d) {
            const path = d3.select(this);
            const ids = d?.__ids ?? [];
            const isSel = ids.some(id => activeIds.some(a => eq(a, id)));
            const base = Number((this as SVGPathElement).dataset.baseOpacity ?? "1");
            let opacity = base;
            if (hasSel && !isSel) opacity = base * dim;
            path.attr("fill-opacity", opacity).attr("stroke-opacity", opacity);
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

            const edges = this.parseEdges(options.dataViews?.[0]);
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

    private parseEdges(dv?: powerbi.DataView): EdgeRaw[] | null {
        const cat = dv?.categorical;
        if (!cat?.categories?.length || !cat?.values?.length) return null;
        const sIdx = findCategoryIndex(cat.categories, "source");
        const tIdx = findCategoryIndex(cat.categories, "target");
        const wIdx = findValueIndex(cat.values, "weight");
        if (sIdx < 0 || tIdx < 0 || wIdx < 0) return null;
        const src = cat.categories[sIdx].values;
        const tgt = cat.categories[tIdx].values;
        const wVals = cat.values[wIdx].values;
        const wHighlights = cat.values[wIdx].highlights ?? null;
        const srcCat = cat.categories[sIdx];
        const rows = src.length;
        const out: EdgeRaw[] = [];
        for (let i = 0; i < rows; i++) {
            const s = src[i] == null ? null : String(src[i]);
            const t = tgt[i] == null ? null : String(tgt[i]);
            const w = safeNum(wVals[i]);
            if (!s || !t || w == null || w <= 0) continue;

            let selectionId: ISelectionId | undefined;
            try {
                selectionId = this.host.createSelectionIdBuilder()
                    .withCategory(srcCat, i)
                    .createSelectionId();
            } catch { /* skipped */ }

            const isHighlighted = wHighlights ? (wHighlights[i] != null) : true;

            out.push({ source: s, target: t, weight: w, selectionId, isHighlighted });
        }
        return out;
    }

    private render(edges: EdgeRaw[], width: number, height: number, palette: RenderPalette): void {
        this.container.selectAll("*").remove();
        this.defs.selectAll("*").remove();
        const s = this.formattingSettings;

        // Build node index — union of unique source/target names.
        const nameToIdx = new Map<string, number>();
        for (const e of edges) {
            if (!nameToIdx.has(e.source)) nameToIdx.set(e.source, nameToIdx.size);
            if (!nameToIdx.has(e.target)) nameToIdx.set(e.target, nameToIdx.size);
        }
        const N = nameToIdx.size;
        const names = new Array<string>(N);
        for (const [n, i] of nameToIdx) names[i] = n;

        // Build the flow matrix expected by d3.chord / chordDirected.
        const matrix: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
        this.idsByNode = new Map();
        this.idByEdgeKey = new Map();
        for (const e of edges) {
            const si = nameToIdx.get(e.source)!;
            const ti = nameToIdx.get(e.target)!;
            matrix[si][ti] += e.weight;
            if (e.selectionId) {
                if (!this.idsByNode.has(e.source)) this.idsByNode.set(e.source, []);
                if (!this.idsByNode.has(e.target)) this.idsByNode.set(e.target, []);
                this.idsByNode.get(e.source)!.push(e.selectionId);
                this.idsByNode.get(e.target)!.push(e.selectionId);
                this.idByEdgeKey.set(`${e.source}→${e.target}`, e.selectionId);
            }
        }

        // Sort groups.
        const sortMode = String(s.chordCard.sortGroups.value?.value ?? "size-desc");
        const directed = !!s.chordCard.directed.value;
        const chordGen = (directed ? d3.chordDirected() : d3.chord())
            .padAngle(((s.chordCard.padAngle.value ?? 3) * Math.PI) / 180);

        if (sortMode === "size-desc") {
            chordGen.sortGroups(d3.descending);
        } else if (sortMode === "alphabetical") {
            chordGen.sortGroups((a, b) => {
                // d3.chord's sortGroups compares group indices — access names via closure.
                return names[a].localeCompare(names[b]);
            });
        }
        chordGen.sortSubgroups(d3.descending);

        const chordData = chordGen(matrix);

        // Layout sizing.
        const size = Math.min(width, height);
        const cx = width / 2, cy = height / 2;
        const arcThickness = Math.max(4, s.chordCard.padAngle.value != null ? s.arcsCard.arcThickness.value ?? 14 : 14);
        const outerR = size / 2 - Math.max(30, arcThickness + 30);
        const innerR = outerR - arcThickness;
        const labelR = outerR + 8;

        this.container.attr("transform", `translate(${cx}, ${cy})`);

        // Color scale per group.
        const paletteFn = d3.scaleOrdinal<string, string>().range((d3.schemeTableau10 as unknown as string[]).concat(d3.schemeSet2 as unknown as string[]));
        const nodeColors = names.map((n, i) => palette.highContrast ? palette.fg : paletteFn(String(i)));

        // Arcs (groups).
        const arcGen = d3.arc<d3.ChordGroup>()
            .innerRadius(innerR)
            .outerRadius(outerR);

        // Ribbons.
        const ribbonGen = (directed ? d3.ribbonArrow() : d3.ribbon()) as unknown as { radius: (r: number) => unknown } & ((d: d3.Chord) => string);
        ribbonGen.radius(innerR - 1);

        // Gradient defs (per ribbon) when gradientRibbons is on.
        const useGradient = !!s.gradientsCard.gradientRibbons.value && !palette.highContrast;
        if (useGradient) {
            chordData.forEach((c, i) => {
                const g = this.defs.append("linearGradient")
                    .attr("id", `cm-grad-${i}`)
                    .attr("gradientUnits", "userSpaceOnUse")
                    .attr("x1", Math.cos((c.source.startAngle + c.source.endAngle) / 2 - Math.PI / 2) * innerR)
                    .attr("y1", Math.sin((c.source.startAngle + c.source.endAngle) / 2 - Math.PI / 2) * innerR)
                    .attr("x2", Math.cos((c.target.startAngle + c.target.endAngle) / 2 - Math.PI / 2) * innerR)
                    .attr("y2", Math.sin((c.target.startAngle + c.target.endAngle) / 2 - Math.PI / 2) * innerR);
                g.append("stop").attr("offset", "0%").attr("stop-color", nodeColors[c.source.index]);
                g.append("stop").attr("offset", "100%").attr("stop-color", nodeColors[c.target.index]);
            });
        }

        const ribbonOpacity = Math.max(0.05, Math.min(1, (s.chordCard.ribbonOpacity.value ?? 65) / 100));

        // Ribbons layer.
        const ribbons = this.container.append("g").classed("ribbons", true)
            .selectAll("path")
            .data(chordData)
            .enter().append("path")
            .attr("class", "ribbon")
            .attr("d", (d) => (ribbonGen as any)(d))
            .attr("fill", (d, i) => useGradient ? `url(#cm-grad-${i})` : nodeColors[d.source.index])
            .attr("fill-opacity", ribbonOpacity)
            .attr("stroke", (d) => nodeColors[d.source.index])
            .attr("stroke-opacity", ribbonOpacity + 0.15)
            .attr("stroke-width", 0.5)
            .each(function (d) {
                (this as SVGPathElement).dataset.baseOpacity = String(ribbonOpacity);
                const src = names[d.source.index], tgt = names[d.target.index];
                const id = this.parentElement?.parentElement ? undefined : undefined;
                (d as unknown as { __ids?: ISelectionId[] }).__ids = [];
                // Populated below via closure over `visual` self.
                (d as unknown as { __src?: string; __tgt?: string }).__src = src;
                (d as unknown as { __src?: string; __tgt?: string }).__tgt = tgt;
            });

        const self = this;
        ribbons.each(function (d) {
            const src = (d as unknown as { __src: string }).__src;
            const tgt = (d as unknown as { __tgt: string }).__tgt;
            const id = self.idByEdgeKey.get(`${src}→${tgt}`);
            (d as unknown as { __ids?: ISelectionId[] }).__ids = id ? [id] : [];
        });
        ribbons.style("cursor", "pointer")
            .attr("tabindex", 0).attr("role", "button")
            .on("click", (event: MouseEvent, d) => {
                event.stopPropagation();
                const ids = (d as unknown as { __ids?: ISelectionId[] }).__ids ?? [];
                if (ids.length === 0) return;
                const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                this.selectionManager.select(ids, multi).then(() => this.applySelectionStyling());
            })
            .on("contextmenu", (event: MouseEvent, d) => {
                event.preventDefault(); event.stopPropagation();
                const ids = (d as unknown as { __ids?: ISelectionId[] }).__ids ?? [];
                this.selectionManager.showContextMenu(ids[0] ?? ({} as ISelectionId), { x: event.clientX, y: event.clientY });
            });

        // Arcs (rendered on top of ribbons for a clean look).
        const arcs = this.container.append("g").classed("arcs", true)
            .selectAll("path")
            .data(chordData.groups)
            .enter().append("path")
            .attr("class", "arc")
            .attr("d", (d) => arcGen(d) as string)
            .attr("fill", d => nodeColors[d.index])
            .attr("stroke", palette.highContrast ? palette.fg : palette.background)
            .attr("stroke-width", 0.5)
            .each(function (d) {
                (this as SVGPathElement).dataset.baseOpacity = "1";
                const nodeName = names[d.index];
                (d as unknown as { __ids?: ISelectionId[] }).__ids = self.idsByNode.get(nodeName) ?? [];
            });
        arcs.style("cursor", "pointer")
            .attr("tabindex", 0).attr("role", "button")
            .on("click", (event: MouseEvent, d) => {
                event.stopPropagation();
                const ids = (d as unknown as { __ids?: ISelectionId[] }).__ids ?? [];
                if (ids.length === 0) return;
                const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                this.selectionManager.select(ids, multi).then(() => this.applySelectionStyling());
            })
            .on("contextmenu", (event: MouseEvent, d) => {
                event.preventDefault(); event.stopPropagation();
                const ids = (d as unknown as { __ids?: ISelectionId[] }).__ids ?? [];
                this.selectionManager.showContextMenu(ids[0] ?? ({} as ISelectionId), { x: event.clientX, y: event.clientY });
            });

        // Labels.
        const labelMode = String(s.arcsCard.labelMode.value?.value ?? "radial");
        const minAngle = ((s.arcsCard.minLabelAngle.value ?? 4) * Math.PI) / 180;
        const fs = Math.max(8, Math.min(28, s.arcsCard.fontSize.value ?? 11));

        if (labelMode !== "hidden") {
            const labelG = this.container.append("g").classed("labels", true);
            chordData.groups.forEach(g => {
                const angleSpan = g.endAngle - g.startAngle;
                if (angleSpan < minAngle) return;   // too small — skip labeling
                const mid = (g.startAngle + g.endAngle) / 2 - Math.PI / 2;
                const x = Math.cos(mid) * labelR;
                const y = Math.sin(mid) * labelR;
                const leftSide = mid > Math.PI / 2 || mid < -Math.PI / 2;
                if (labelMode === "radial") {
                    const rotate = (mid * 180) / Math.PI + (leftSide ? 180 : 0);
                    labelG.append("text")
                        .attr("transform", `translate(${x}, ${y}) rotate(${rotate})`)
                        .attr("dy", 4)
                        .attr("text-anchor", leftSide ? "end" : "start")
                        .attr("font-family", "Segoe UI, sans-serif")
                        .attr("font-size", `${fs}px`).attr("fill", palette.labelText)
                        .text(names[g.index]);
                } else {
                    labelG.append("text")
                        .attr("x", x).attr("y", y + 4)
                        .attr("text-anchor", leftSide ? "end" : "start")
                        .attr("font-family", "Segoe UI, sans-serif")
                        .attr("font-size", `${fs}px`).attr("fill", palette.labelText)
                        .text(names[g.index]);
                }
            });
        }

        // Hover behavior.
        const hoverMode = String(s.chordCard.hoverMode.value?.value ?? "highlight-connected");
        const isTouched = (c: d3.Chord, gi: number) => c.source.index === gi || c.target.index === gi;
        arcs.on("mouseenter", (_, g) => {
            if (hoverMode === "isolate") {
                ribbons.attr("display", c => isTouched(c, g.index) ? null : "none");
            } else {
                ribbons.attr("fill-opacity", c => isTouched(c, g.index) ? Math.min(1, ribbonOpacity + 0.25) : ribbonOpacity * 0.15);
            }
        }).on("mouseleave", () => {
            if (hoverMode === "isolate") ribbons.attr("display", null);
            else ribbons.attr("fill-opacity", ribbonOpacity);
        }).on("mousemove", (event: MouseEvent, g) => {
            this.tooltipService.show({
                dataItems: [
                    { displayName: "Group", value: names[g.index] },
                    { displayName: "Total", value: d3.format(",.4~g")(g.value) }
                ],
                identities: [], coordinates: [event.clientX, event.clientY], isTouchEvent: false
            });
        });
        arcs.on("mouseleave.tt", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));

        ribbons.on("mousemove", (event: MouseEvent, c) => {
            const flow = matrix[c.source.index][c.target.index];
            this.tooltipService.show({
                dataItems: [
                    { displayName: "Flow", value: `${names[c.source.index]} → ${names[c.target.index]}` },
                    { displayName: "Weight", value: d3.format(",.4~g")(flow) }
                ],
                identities: [], coordinates: [event.clientX, event.clientY], isTouchEvent: false
            });
        }).on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));

        this.applySelectionStyling();
    }

    private resolvePalette(): RenderPalette {
        const cp = this.colorPalette;
        if (cp.isHighContrast) {
            const fg = cp.foreground?.value || "#000";
            const bg = cp.background?.value || "#fff";
            return { highContrast: true, fg, axisText: fg, background: bg, labelText: fg, landingText: fg, landingSub: fg };
        }
        const bg = cp.background?.value || "#fff";
        const isDark = luminance(bg) < 0.5;
        const themeFg = cp.foreground?.value || (isDark ? "#f0f0f0" : "#333");
        return {
            highContrast: false, fg: cp.getColor("cmFg")?.value || "#4472C4",
            axisText: isDark ? "#bbb" : "#666", background: bg, labelText: themeFg,
            landingText: isDark ? "#eee" : "#333", landingSub: isDark ? "#aaa" : "#999"
        };
    }

    private renderLandingPage(width: number, height: number, palette: RenderPalette): void {
        this.landing.selectAll("*").remove();
        this.container.selectAll("*").remove();
        this.defs.selectAll("*").remove();
        if (width < 160 || height < 100) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);
        const glyph = g.append("g");
        // Simple chord glyph — four arcs with two ribbons
        const R = 40;
        const arcSlice = (start: number, end: number, color: string) => {
            const inner = R - 8, outer = R;
            const startX = Math.cos(start) * inner, startY = Math.sin(start) * inner;
            const endX = Math.cos(end) * inner, endY = Math.sin(end) * inner;
            const startXO = Math.cos(start) * outer, startYO = Math.sin(start) * outer;
            const endXO = Math.cos(end) * outer, endYO = Math.sin(end) * outer;
            const d = `M ${startX} ${startY} A ${inner} ${inner} 0 0 1 ${endX} ${endY} L ${endXO} ${endYO} A ${outer} ${outer} 0 0 0 ${startXO} ${startYO} Z`;
            glyph.append("path").attr("d", d).attr("fill", color);
        };
        arcSlice(-Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4, "#4E79A7");
        arcSlice(-0.4, 0.4, "#F28E2B");
        arcSlice(Math.PI / 2 - 0.4, Math.PI / 2 + 0.4, "#59A14F");
        arcSlice(Math.PI - 0.4, Math.PI + 0.4, "#E15759");
        // Ribbon lines
        glyph.append("path").attr("d", `M -32 0 Q 0 20 32 0`).attr("fill", "none").attr("stroke", "#F28E2B").attr("stroke-width", 12).attr("stroke-opacity", 0.5);
        glyph.append("path").attr("d", `M 0 -32 Q 20 0 0 32`).attr("fill", "none").attr("stroke", "#4E79A7").attr("stroke-width", 8).attr("stroke-opacity", 0.5);
        g.append("text").attr("text-anchor", "middle").attr("y", 70).attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px").attr("font-weight", 600).attr("fill", palette.landingText).text("Chord Modern");
        g.append("text").attr("text-anchor", "middle").attr("y", 90).attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px").attr("fill", palette.axisText).text("Add fields:  Source  +  Target  +  Weight");
        g.append("text").attr("text-anchor", "middle").attr("y", 108).attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px").attr("fill", palette.landingSub).text("One row per flow. Toggle Directed for asymmetric arrows.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
