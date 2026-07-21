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

// ── Types ──────────────────────────────────────────────────────

interface MapPoint {
    x: number;
    y: number;
    label: string | null;
    cat: string | null;
    value: number | null;
    selectionId?: ISelectionId;
    isHighlighted?: boolean;
}

interface RenderPalette {
    highContrast: boolean;
    single: string;
    labelText: string;
    background: string;
    landingText: string;
    landingSub: string;
    axisText: string;
}

const CAT_PALETTE = d3.schemeTableau10 as unknown as string[];

const RAMPS: Record<string, [number, number, number][]> = {
    viridis: [[68,1,84],[71,44,122],[59,81,139],[44,113,142],[33,144,141],[39,173,129],[92,200,99],[170,220,50],[253,231,37]],
    inferno: [[0,0,4],[40,11,84],[101,21,110],[159,42,99],[212,72,66],[245,125,21],[250,193,39],[252,255,164],[252,255,164]],
    blues:   [[247,251,255],[222,235,247],[198,219,239],[158,202,225],[107,174,214],[66,146,198],[33,113,181],[8,81,156],[8,48,107]],
    turbo:   [[48,18,59],[71,68,181],[36,144,220],[27,207,180],[139,241,86],[228,236,49],[253,175,38],[241,80,29],[122,4,3]]
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

/**
 * Strict raster-only validator. SVG data URIs are rejected — they can carry
 * script tags and would reintroduce a markup-injection surface. See design doc §21.
 */
function isValidRasterDataUri(s: string | null | undefined): boolean {
    if (!s) return false;
    return /^data:image\/(png|jpeg|jpg|webp);base64,/.test(s.trim());
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

    private root: HTMLDivElement;
    private container: HTMLDivElement;
    private heatCanvas: HTMLCanvasElement;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;
    private imageG: d3.Selection<SVGGElement, unknown, null, undefined>;
    private pointsG: d3.Selection<SVGGElement, unknown, null, undefined>;
    private labelsG: d3.Selection<SVGGElement, unknown, null, undefined>;

    private naturalW = 800;
    private naturalH = 600;
    private currentImage: string | null = null;

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.colorPalette = options.host.colorPalette;
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();

        this.selectionManager.registerOnSelectCallback(() => this.applySelectionStyling());

        this.root = options.element as HTMLDivElement;
        this.container = document.createElement("div");
        this.container.className = "im-container";
        Object.assign(this.container.style, { position: "relative", width: "100%", height: "100%" });
        this.root.appendChild(this.container);

        // Layer stack: heat canvas (bg) → svg (image + points + labels)
        this.heatCanvas = document.createElement("canvas");
        this.heatCanvas.className = "im-heat";
        Object.assign(this.heatCanvas.style, { position: "absolute", left: "0", top: "0", pointerEvents: "none" });
        this.container.appendChild(this.heatCanvas);

        const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        Object.assign(svgEl.style, { position: "absolute", left: "0", top: "0" });
        this.container.appendChild(svgEl);
        this.svg = d3.select(svgEl).classed("im-svg", true);
        this.imageG = this.svg.append("g").classed("im-image", true);
        this.pointsG = this.svg.append("g").classed("im-points", true);
        this.labelsG = this.svg.append("g").classed("im-labels", true);
        this.landing = this.svg.append("g").classed("im-landing", true);

        this.svg.on("click", (event: MouseEvent) => {
            if (event.target === this.svg.node()) {
                this.selectionManager.clear().then(() => this.applySelectionStyling());
            }
        });
    }

    private applySelectionStyling(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.05, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 25) / 100));
        const activeIds = this.selectionManager.getSelectionIds() as ISelectionId[];
        const hasSel = activeIds.length > 0;
        const eq = (a: ISelectionId, b: ISelectionId) =>
            (a as { equals?: (b: ISelectionId) => boolean }).equals?.(b) ?? false;

        this.pointsG.selectAll<SVGCircleElement, MapPoint>("circle").each(function (d) {
            if (!d) return;
            const isSel = !!d.selectionId && activeIds.some(a => eq(a, d.selectionId!));
            const isHl = d.isHighlighted !== false;
            let mult = 1;
            if (hasSel && !isSel) mult = dim;
            if (!isHl) mult = Math.min(mult, dim);
            const circle = d3.select(this);
            const base = Number(circle.attr("fill-opacity") ?? 0.9);
            // Store the base once so repeated applies don't compound the dim.
            const stored = Number((this as SVGCircleElement).dataset.baseOpacity ?? base);
            if (!(this as SVGCircleElement).dataset.baseOpacity) {
                (this as SVGCircleElement).dataset.baseOpacity = String(stored);
            }
            circle.attr("fill-opacity", stored * mult);
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

            const parsed = this.parseData(options.dataViews?.[0]);
            if (!parsed || parsed.points.length === 0) {
                this.clearAll();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height, palette);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();
            this.render(parsed, width, height, palette);
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private parseData(dv?: DataView): { points: MapPoint[]; imageDataUri: string | null; rejectionMsg: string | null } | null {
        const cat = dv?.categorical;
        if (!cat?.values?.length) return null;
        const values = cat.values;
        const xIdx = findValueIndex(values, "x");
        const yIdx = findValueIndex(values, "y");
        if (xIdx < 0 || yIdx < 0) return null;
        const vIdx = findValueIndex(values, "value");
        const lblIdx = findCategoryIndex(cat.categories, "label");
        const catIdx = findCategoryIndex(cat.categories, "colorBy");
        const imgIdx = findCategoryIndex(cat.categories, "imageData");

        // Selection identity: prefer the Label category, fall back to colorBy.
        const identityCat = lblIdx >= 0 ? cat.categories![lblIdx]
                          : catIdx >= 0 ? cat.categories![catIdx]
                          : null;
        // Highlights ride on the X value column when present.
        const xHighlights = values[xIdx].highlights ?? null;

        const rows = values[xIdx].values.length;
        const points: MapPoint[] = [];
        for (let i = 0; i < rows; i++) {
            const x = safeNum(values[xIdx].values[i]);
            const y = safeNum(values[yIdx].values[i]);
            if (x == null || y == null) continue;

            let selectionId: ISelectionId | undefined;
            if (identityCat) {
                try {
                    selectionId = this.host.createSelectionIdBuilder()
                        .withCategory(identityCat, i)
                        .createSelectionId();
                } catch { /* skipped */ }
            }
            const isHighlighted = xHighlights ? (xHighlights[i] != null) : true;

            points.push({
                x, y,
                label: lblIdx >= 0 ? String(cat.categories![lblIdx].values[i]) : null,
                cat:   catIdx >= 0 ? String(cat.categories![catIdx].values[i]) : null,
                value: vIdx >= 0 ? safeNum(values[vIdx].values[i]) : null,
                selectionId, isHighlighted
            });
        }

        let imageDataUri: string | null = null;
        let rejection: string | null = null;
        if (imgIdx >= 0) {
            const raw = cat.categories![imgIdx].values.find(v => v != null);
            if (raw != null) {
                const s = String(raw).trim();
                if (isValidRasterDataUri(s)) imageDataUri = s;
                else if (s.startsWith("data:image/svg")) rejection = "SVG floor plans are not accepted — use PNG or JPEG (raster only).";
                else if (s.startsWith("data:")) rejection = "Unsupported floor-plan data URI (need PNG, JPEG, or WebP).";
                else rejection = "Floor Plan column must contain a base64 data URI.";
            }
        }
        return { points, imageDataUri, rejectionMsg: rejection };
    }

    private render(
        parsed: { points: MapPoint[]; imageDataUri: string | null; rejectionMsg: string | null },
        width: number, height: number, palette: RenderPalette
    ): void {
        const s = this.formattingSettings;
        const M = { top: 10, right: 10, bottom: 30, left: 10 };
        const availW = Math.max(60, width - M.left - M.right);
        const availH = Math.max(60, height - M.top - M.bottom);

        this.imageG.selectAll("*").remove();
        this.pointsG.selectAll("*").remove();
        this.labelsG.selectAll("*").remove();

        // Set the natural image dimensions from either the loaded image or user override.
        const declaredW = Math.max(0, s.imageCard.imageWidth.value ?? 0);
        const declaredH = Math.max(0, s.imageCard.imageHeight.value ?? 0);
        const naturalW = declaredW > 0 ? declaredW : this.naturalW;
        const naturalH = declaredH > 0 ? declaredH : this.naturalH;

        // Fit image into viewport preserving aspect.
        const imgAspect = naturalW / naturalH;
        const availAspect = availW / availH;
        let imgRenderW: number, imgRenderH: number;
        if (imgAspect > availAspect) { imgRenderW = availW; imgRenderH = availW / imgAspect; }
        else { imgRenderH = availH; imgRenderW = availH * imgAspect; }
        const imgX = M.left + (availW - imgRenderW) / 2;
        const imgY = M.top + (availH - imgRenderH) / 2;

        // If we have a valid image URI, insert it. Otherwise draw a placeholder grid so points still make sense.
        if (parsed.imageDataUri) {
            const opacity = Math.max(0, Math.min(1, (s.imageCard.imageOpacity.value ?? 100) / 100));
            this.imageG.append("image")
                .attr("href", parsed.imageDataUri)
                .attr("x", imgX).attr("y", imgY)
                .attr("width", imgRenderW).attr("height", imgRenderH)
                .attr("preserveAspectRatio", "xMidYMid meet")
                .attr("opacity", opacity)
                .on("load", () => {
                    // Update natural dimensions if user hasn't overridden.
                    // Note: for SVG <image>, natural dims come from the underlying data URI when loaded.
                });
            this.currentImage = parsed.imageDataUri;
        } else {
            // Placeholder: a light grid so users can still see relative positions.
            const gg = this.imageG.append("g");
            gg.append("rect")
                .attr("x", imgX).attr("y", imgY)
                .attr("width", imgRenderW).attr("height", imgRenderH)
                .attr("fill", "#f6f6f6").attr("stroke", "#ddd");
            const gridStep = 40;
            for (let x = imgX; x <= imgX + imgRenderW; x += gridStep) {
                gg.append("line").attr("x1", x).attr("x2", x).attr("y1", imgY).attr("y2", imgY + imgRenderH).attr("stroke", "#e6e6e6");
            }
            for (let y = imgY; y <= imgY + imgRenderH; y += gridStep) {
                gg.append("line").attr("x1", imgX).attr("x2", imgX + imgRenderW).attr("y1", y).attr("y2", y).attr("stroke", "#e6e6e6");
            }
        }

        // Coordinate transform: data (x,y) in image-space units → screen px inside the letterboxed image.
        const bottomOrigin = String(s.imageCard.coordinateSystem.value?.value ?? "top-left") === "bottom-left";
        const px = (v: number) => imgX + (v / naturalW) * imgRenderW;
        const py = (v: number) => bottomOrigin
            ? imgY + imgRenderH - (v / naturalH) * imgRenderH
            : imgY + (v / naturalH) * imgRenderH;

        // Filter to points inside the image bounds (v1 clip; no "show outside" toggle in this build).
        const inRange = (p: MapPoint): boolean => (
            p.x >= 0 && p.x <= naturalW && p.y >= 0 && p.y <= naturalH
        );
        const pts = parsed.points.filter(inRange);

        // ── Heat layer ──
        const mode = String(s.overlayCard.overlayMode.value?.value ?? "points");
        if (mode === "heat" || mode === "both") {
            this.renderHeat(pts, px, py, imgX, imgY, imgRenderW, imgRenderH, palette);
        } else {
            const ctx = this.heatCanvas.getContext("2d");
            if (ctx) ctx.clearRect(0, 0, this.heatCanvas.width, this.heatCanvas.height);
        }

        // ── Points layer ──
        const showPoints = mode === "points" || mode === "both";
        if (showPoints) {
            const catColor = d3.scaleOrdinal<string, string>().range(CAT_PALETTE);
            const baseR = Math.max(1, s.overlayCard.pointRadius.value ?? 5);
            const opacity = Math.max(0.05, Math.min(1, (s.overlayCard.pointOpacity.value ?? 90) / 100));
            const values = pts.map(p => p.value ?? 1);
            const maxV = Math.max(1, d3.max(values) ?? 1);
            const rScale = (v: number | null): number => v == null ? baseR : baseR * Math.sqrt(v / maxV) * 1.5;

            const pointG = this.pointsG.append("g");
            const circles = pointG.selectAll("circle")
                .data(pts).enter().append("circle")
                .attr("cx", d => px(d.x)).attr("cy", d => py(d.y))
                .attr("r", d => Math.max(2, rScale(d.value)))
                .attr("fill", d => palette.highContrast ? palette.single : (d.cat ? catColor(d.cat) : palette.single))
                .attr("fill-opacity", opacity)
                .attr("stroke", palette.background)
                .attr("stroke-width", 1)
                .attr("tabindex", d => d.selectionId ? 0 : -1)
                .attr("role", "button")
                .attr("aria-label", d => d.label ? `Point ${d.label}` : "Point");

            circles.style("cursor", d => d.selectionId ? "pointer" : "default");
            circles.on("click", (event: MouseEvent, d) => {
                event.stopPropagation();
                if (!d.selectionId) return;
                const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                this.selectionManager.select(d.selectionId, multi).then(() => this.applySelectionStyling());
            });
            circles.on("contextmenu", (event: MouseEvent, d) => {
                event.preventDefault(); event.stopPropagation();
                this.selectionManager.showContextMenu(d.selectionId ?? ({} as ISelectionId), { x: event.clientX, y: event.clientY });
            });
            circles.on("keydown", (event: KeyboardEvent, d) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                if (!d.selectionId) return;
                this.selectionManager.select(d.selectionId, event.shiftKey).then(() => this.applySelectionStyling());
            });
        }

        // ── Labels ──
        const labelMode = String(s.labelsCard.labelMode.value?.value ?? "hover");
        const fs = Math.max(8, Math.min(24, s.labelsCard.fontSize.value ?? 11));
        if (labelMode === "always") {
            this.labelsG.selectAll("text").data(pts.filter(p => p.label))
                .enter().append("text")
                .attr("x", d => px(d.x) + 6).attr("y", d => py(d.y) + 3)
                .attr("font-family", "Segoe UI, sans-serif")
                .attr("font-size", `${fs}px`).attr("fill", palette.labelText)
                .attr("stroke", palette.background).attr("stroke-width", 3).attr("paint-order", "stroke")
                .text(d => d.label!);
        }

        // ── Rejection message (if any) ──
        if (parsed.rejectionMsg) {
            const g = this.labelsG.append("g");
            const t = g.append("text")
                .attr("x", M.left + 8).attr("y", height - 14)
                .attr("font-family", "Segoe UI, sans-serif")
                .attr("font-size", "11px").attr("fill", "#a15c00")
                .attr("font-weight", 600)
                .text(parsed.rejectionMsg);
            const bb = (t.node() as SVGTextElement).getBBox();
            g.insert("rect", "text")
                .attr("x", bb.x - 6).attr("y", bb.y - 3)
                .attr("width", bb.width + 12).attr("height", bb.height + 6)
                .attr("rx", 3).attr("fill", "#fff4e5").attr("stroke", "#a15c00");
        }

        // ── Quadtree hover ──
        const qt = d3.quadtree<MapPoint>().x(p => px(p.x)).y(p => py(p.y)).addAll(pts);
        // Full-viewport hit rect (below the image so the image itself still shows on top).
        this.labelsG.selectAll("rect.im-hit").remove();
        const hit = this.labelsG.append("rect")
            .attr("class", "im-hit")
            .attr("x", imgX).attr("y", imgY).attr("width", imgRenderW).attr("height", imgRenderH)
            .attr("fill", "transparent")
            .lower();  // sit under labels/points but above image
        hit.on("mousemove", (event: MouseEvent) => {
            const [mx, my] = d3.pointer(event, this.svg.node());
            const p = qt.find(mx, my, 30);
            if (!p) { this.tooltipService.hide({ immediately: false, isTouchEvent: false }); return; }
            const items: VisualTooltipDataItem[] = [
                { displayName: "X", value: d3.format(",.2f")(p.x) },
                { displayName: "Y", value: d3.format(",.2f")(p.y) }
            ];
            if (p.label) items.unshift({ displayName: "Location", value: p.label });
            if (p.cat) items.push({ displayName: "Category", value: p.cat });
            if (p.value != null) items.push({ displayName: "Value", value: d3.format(",.4~g")(p.value) });
            this.tooltipService.show({
                dataItems: items, identities: [], coordinates: [event.clientX, event.clientY], isTouchEvent: false
            });
        }).on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));

        this.applySelectionStyling();
    }

    private renderHeat(
        pts: MapPoint[],
        px: (v: number) => number, py: (v: number) => number,
        imgX: number, imgY: number, imgRenderW: number, imgRenderH: number,
        _palette: RenderPalette
    ): void {
        const s = this.formattingSettings;
        const dpr = window.devicePixelRatio || 1;
        this.heatCanvas.style.left = `${imgX}px`;
        this.heatCanvas.style.top = `${imgY}px`;
        this.heatCanvas.style.width = `${imgRenderW}px`;
        this.heatCanvas.style.height = `${imgRenderH}px`;
        this.heatCanvas.width = Math.max(1, Math.round(imgRenderW * dpr));
        this.heatCanvas.height = Math.max(1, Math.round(imgRenderH * dpr));

        const acc = document.createElement("canvas");
        acc.width = this.heatCanvas.width; acc.height = this.heatCanvas.height;
        const accCtx = acc.getContext("2d")!;
        accCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        accCtx.clearRect(0, 0, imgRenderW, imgRenderH);
        accCtx.globalCompositeOperation = "lighter";

        const radius = Math.max(4, s.overlayCard.heatRadius.value ?? 30);
        const maxV = Math.max(1, d3.max(pts.map(p => p.value ?? 1)) ?? 1);
        const grad = accCtx.createRadialGradient(0, 0, 0, 0, 0, radius);
        grad.addColorStop(0, "rgba(255,255,255,0.35)");
        grad.addColorStop(1, "rgba(255,255,255,0)");

        for (const p of pts) {
            const w = (p.value ?? 1) / maxV;  // relative weight → alpha scale
            const lx = px(p.x) - imgX;
            const ly = py(p.y) - imgY;
            accCtx.save();
            accCtx.translate(lx, ly);
            accCtx.globalAlpha = 0.15 + 0.85 * w;
            accCtx.fillStyle = grad;
            accCtx.beginPath();
            accCtx.arc(0, 0, radius, 0, Math.PI * 2);
            accCtx.fill();
            accCtx.restore();
        }

        const src = accCtx.getImageData(0, 0, this.heatCanvas.width, this.heatCanvas.height).data;
        const ctx = this.heatCanvas.getContext("2d")!;
        const dst = ctx.createImageData(this.heatCanvas.width, this.heatCanvas.height);
        const rampName = String(s.overlayCard.colorRamp.value?.value ?? "inferno");
        const opacity = Math.max(0.05, Math.min(1, (s.overlayCard.heatOpacity.value ?? 70) / 100));
        let maxA = 1;
        for (let i = 3; i < src.length; i += 4) if (src[i] > maxA) maxA = src[i];
        for (let i = 0, j = 0; i < src.length; i += 4, j += 4) {
            const a = src[i + 3];
            if (a === 0) { dst.data[j + 3] = 0; continue; }
            const t = Math.log1p((a / maxA) * 9) / Math.log(10);
            const rgb = sampleRamp(rampName, t);
            dst.data[j] = rgb[0];
            dst.data[j + 1] = rgb[1];
            dst.data[j + 2] = rgb[2];
            dst.data[j + 3] = Math.min(255, Math.round(t * 255 * opacity));
        }
        ctx.putImageData(dst, 0, 0);
    }

    private clearAll(): void {
        this.imageG.selectAll("*").remove();
        this.pointsG.selectAll("*").remove();
        this.labelsG.selectAll("*").remove();
        const ctx = this.heatCanvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, this.heatCanvas.width, this.heatCanvas.height);
    }

    private resolvePalette(): RenderPalette {
        const cp = this.colorPalette;
        if (cp.isHighContrast) {
            const fg = cp.foreground?.value || "#000";
            const bg = cp.background?.value || "#fff";
            return { highContrast: true, single: fg, labelText: fg, background: bg, landingText: fg, landingSub: fg, axisText: fg };
        }
        const bg = cp.background?.value || "#fff";
        const isDark = luminance(bg) < 0.5;
        return {
            highContrast: false,
            single: cp.getColor("imPoint")?.value || "#4472C4",
            labelText: isDark ? "#f0f0f0" : "#333",
            background: bg,
            landingText: isDark ? "#eee" : "#333",
            landingSub: isDark ? "#aaa" : "#888",
            axisText: isDark ? "#bbb" : "#666"
        };
    }

    private renderLandingPage(width: number, height: number, palette: RenderPalette): void {
        this.landing.selectAll("*").remove();
        this.clearAll();
        if (width < 160 || height < 100) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);
        const glyph = g.append("g").attr("transform", "translate(-90, -70)");
        // Rough floor-plan glyph
        glyph.append("rect").attr("x", 0).attr("y", 0).attr("width", 180).attr("height", 100).attr("fill", "#f5f5f5").attr("stroke", "#ccc");
        glyph.append("line").attr("x1", 60).attr("x2", 60).attr("y1", 0).attr("y2", 100).attr("stroke", "#ccc");
        glyph.append("line").attr("x1", 60).attr("x2", 180).attr("y1", 50).attr("y2", 50).attr("stroke", "#ccc");
        // Fake points
        glyph.append("circle").attr("cx", 30).attr("cy", 30).attr("r", 6).attr("fill", "#4472C4").attr("fill-opacity", 0.8);
        glyph.append("circle").attr("cx", 100).attr("cy", 25).attr("r", 6).attr("fill", "#ff7f0e").attr("fill-opacity", 0.8);
        glyph.append("circle").attr("cx", 140).attr("cy", 75).attr("r", 6).attr("fill", "#2ca02c").attr("fill-opacity", 0.8);

        g.append("text")
            .attr("text-anchor", "middle").attr("y", 44)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "16px").attr("font-weight", 600)
            .attr("fill", palette.landingText).text("Indoor Map");
        g.append("text")
            .attr("text-anchor", "middle").attr("y", 66)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "12px").attr("fill", palette.axisText)
            .text("Add fields:  X  +  Y  (+ Label, Category, Value, Floor Plan)");
        g.append("text")
            .attr("text-anchor", "middle").attr("y", 84)
            .attr("font-family", "Segoe UI, sans-serif")
            .attr("font-size", "11px").attr("fill", palette.landingSub)
            .text("Floor Plan: single row with a data:image/png;base64,… URI (SVG not accepted).");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
