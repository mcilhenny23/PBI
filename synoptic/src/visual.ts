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
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";
import { parseSvgTemplate, shapeBounds, ShapeNode, SvgModel } from "./svgModel";

interface Binding {
    value: number | null;
    state: string | null;
}

type AnySel = d3.Selection<d3.BaseType, unknown, null, undefined>;

const numFmt = d3.format(",.4~g");

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: powerbi.extensibility.visual.IVisualHost;
    private tooltipService: ITooltipService;

    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private defs: d3.Selection<SVGDefsElement, unknown, null, undefined>;
    private scene: d3.Selection<SVGGElement, unknown, null, undefined>;
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    /**
     * Unique per instance — several visuals can share one report page, and
     * clip-path ids must not collide. Uses the crypto RNG because the
     * powerbi-visuals lint rule (rightly) refuses Math.random.
     */
    private uid = "syn" + (() => {
        const a = new Uint32Array(2);
        window.crypto.getRandomValues(a);
        return a[0].toString(36) + a[1].toString(36);
    })();
    private clipSeq = 0;

    // ── Animation state ──
    private rafId: number | null = null;
    private visibilityHandler: () => void;
    private docHidden = false;
    private flowEls: { sel: AnySel; len: number }[] = [];
    private blinkEls: AnySel[] = [];
    private flowSpeed = 50;
    private lastTs = 0;
    private dashOffset = 0;

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.tooltipService = options.host.tooltipService;
        this.formattingSettingsService = new FormattingSettingsService();

        this.svg = d3.select(options.element).append("svg").classed("syn-root", true);
        this.defs = this.svg.append("defs");
        this.landing = this.svg.append("g").classed("syn-landing", true);
        this.scene = this.svg.append("g").classed("syn-scene", true);

        this.visibilityHandler = () => { this.docHidden = document.hidden; };
        document.addEventListener("visibilitychange", this.visibilityHandler);
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);
            const T = this.formattingSettings.templateCard;
            const V = this.formattingSettings.valueMappingCard;
            const A = this.formattingSettings.animationCard;

            const width = options.viewport.width, height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);

            this.stopLoop();
            this.scene.selectAll("*").remove();
            this.defs.selectAll("*").remove();
            this.flowEls = [];
            this.blinkEls = [];
            this.clipSeq = 0;

            // ── Data ───────────────────────────────────────────────
            const dataView: DataView = options.dataViews?.[0];
            const table = dataView?.table;
            const cols = table?.columns;
            const roleCol = (role: string): number =>
                cols ? cols.findIndex(c => c.roles && c.roles[role]) : -1;
            const cId = roleCol("elementId"), cVal = roleCol("value");
            const cState = roleCol("state"), cSvg = roleCol("svgContent");

            if (!table?.rows?.length || cSvg < 0) {
                this.renderLandingPage(width, height, cSvg >= 0, cId >= 0);
                this.events.renderingFinished(options);
                return;
            }

            // The template lives in one cell; take the first non-blank.
            let source = "";
            for (const r of table.rows) {
                const v = r[cSvg];
                if (v != null && String(v).trim().length > 20) { source = String(v); break; }
            }
            if (!source) {
                this.renderLandingPage(width, height, true, cId >= 0);
                this.events.renderingFinished(options);
                return;
            }

            const bindings = new Map<string, Binding>();
            if (cId >= 0) {
                for (const r of table.rows) {
                    if (r[cId] == null) continue;
                    const key = String(r[cId]).trim();
                    if (!key) continue;
                    const raw = cVal >= 0 ? Number(r[cVal]) : NaN;
                    bindings.set(key, {
                        value: Number.isFinite(raw) ? raw : null,
                        state: cState >= 0 && r[cState] != null ? String(r[cState]) : null
                    });
                }
            }

            // ── Parse the template into the internal model ─────────
            const model = parseSvgTemplate(source);
            if (!model || model.shapes.length === 0) {
                this.renderMessage(width, height, "Template not usable",
                    "The SVG Template value could not be parsed, or contained no supported shapes.",
                    "Supported: g, rect, circle, ellipse, line, polyline, polygon, path, text.");
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();

            // Letterbox the template into the viewport.
            const [vx, vy, vw, vh] = model.viewBox;
            this.svg.attr("viewBox", `${vx} ${vy} ${vw} ${vh}`)
                .attr("preserveAspectRatio", "xMidYMid meet");

            // ── Re-render from the model ───────────────────────────
            const ctx = {
                defaultFill: T.defaultFillColor.value.value,
                showIds: T.showElementIds.value,
                bindings,
                mode: String(V.bindingMode.value?.value ?? "fill-level"),
                lo: V.valueLow.value ?? 0,
                hi: V.valueHigh.value ?? 100,
                colorLow: V.colorLow.value.value,
                colorHigh: V.colorHigh.value.value,
                alarm: A.alarmThreshold.value ?? 90,
                blink: A.blinkOnAlarm.value,
                flow: A.flowAnimation.value
            };
            for (const s of model.shapes) this.renderShape(this.scene, s, ctx);

            // ── Notes ──────────────────────────────────────────────
            if (T.showRejectedNote.value && model.rejected.size > 0) {
                const parts: string[] = [];
                model.rejected.forEach((n, tag) => parts.push(`${tag}×${n}`));
                this.scene.append("text")
                    .attr("x", vx + vw * 0.01).attr("y", vy + vh * 0.035)
                    .attr("font-size", `${Math.max(6, vh * 0.026)}`)
                    .attr("fill", "#b26a00")
                    .text(`Dropped by the allow-list: ${parts.slice(0, 6).join(", ")}`);
            }

            // ── Animation ──────────────────────────────────────────
            this.flowSpeed = Math.max(1, A.flowSpeed.value ?? 50);
            if (this.flowEls.length || this.blinkEls.length) {
                this.lastTs = 0;
                this.rafId = requestAnimationFrame(this.tick);
            }

            this.events.renderingFinished(options);
        } catch (error) {
            this.stopLoop();
            this.events.renderingFailed(options, String(error));
        }
    }

    /**
     * Create one element from the model.
     *
     * Every tag name and attribute here is chosen by *this* code — the model
     * only supplies validated numbers and strings. Nothing from the parsed
     * template document is ever attached to the live DOM.
     */
    private renderShape(parent: AnySel, n: ShapeNode, ctx: {
        defaultFill: string; showIds: boolean; bindings: Map<string, Binding>;
        mode: string; lo: number; hi: number; colorLow: string; colorHigh: string;
        alarm: number; blink: boolean; flow: boolean;
    }): void {
        const binding = n.id ? ctx.bindings.get(n.id) : undefined;
        const value = binding?.value ?? null;
        const t = value != null && ctx.hi !== ctx.lo
            ? Math.max(0, Math.min(1, (value - ctx.lo) / (ctx.hi - ctx.lo)))
            : null;

        if (n.kind === "group") {
            const g = parent.append("g") as AnySel;
            if (n.transform) g.attr("transform", n.transform);
            if (n.opacity != null) g.attr("opacity", n.opacity);
            for (const c of n.children) this.renderShape(g, c, ctx);
            return;
        }

        const tag = n.kind === "text" ? "text" : n.kind;
        const el = parent.append(tag) as AnySel;

        for (const k in n.nums) el.attr(k, n.nums[k]);
        for (const k in n.strs) el.attr(k, n.strs[k]);

        let fill = n.fill ?? ctx.defaultFill;
        let opacity = n.opacity;
        let transform = n.transform;

        // ── Apply the data binding ──
        if (t != null) {
            if (ctx.mode === "color") {
                fill = d3.interpolateRgb(ctx.colorLow, ctx.colorHigh)(t);
            } else if (ctx.mode === "opacity") {
                opacity = 0.15 + t * 0.85;
            } else if (ctx.mode === "rotation") {
                const b = shapeBounds(n);
                if (b) {
                    const deg = -90 + t * 180;
                    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
                    transform = `${transform ? transform + " " : ""}rotate(${deg.toFixed(2)},${cx},${cy})`;
                }
            }
        }

        if (n.kind === "text") {
            // textContent, never markup.
            const label = (ctx.mode === "text" && value != null) ? numFmt(value) : (n.text || "");
            el.text(label);
            if (!n.fill) fill = "#333333";
        }

        el.attr("fill", fill);
        if (n.stroke) el.attr("stroke", n.stroke);
        if (n.strokeWidth != null) el.attr("stroke-width", n.strokeWidth);
        if (opacity != null) el.attr("opacity", opacity);
        if (transform) el.attr("transform", transform);

        // ── Fill level: a second, clipped copy of the same shape ──
        if (t != null && ctx.mode === "fill-level" && n.kind !== "text") {
            const b = shapeBounds(n);
            if (b && b.h > 0) {
                const clipId = `${this.uid}-c${this.clipSeq++}`;
                const fillH = b.h * t;
                this.defs.append("clipPath")
                    .attr("id", clipId)
                    .append("rect")
                    .attr("x", b.x - 1).attr("y", b.y + (b.h - fillH))
                    .attr("width", b.w + 2).attr("height", fillH);

                const filled = parent.append(tag) as AnySel;
                for (const k in n.nums) filled.attr(k, n.nums[k]);
                for (const k in n.strs) filled.attr(k, n.strs[k]);
                filled
                    .attr("fill", d3.interpolateRgb(ctx.colorLow, ctx.colorHigh)(t))
                    .attr("clip-path", `url(#${clipId})`)
                    .attr("pointer-events", "none");
                if (transform) filled.attr("transform", transform);
            }
        }

        // ── Register for animation ──
        if (n.id) {
            const isPipe = /^pipe/i.test(n.id);
            if (ctx.flow && isPipe && n.stroke) {
                const dash = Math.max(2, (n.strokeWidth ?? 2) * 2.2);
                el.attr("stroke-dasharray", `${dash} ${dash}`);
                this.flowEls.push({ sel: el, len: dash * 2 });
            }
            if (ctx.blink && value != null && value >= ctx.alarm) {
                this.blinkEls.push(el);
            }
        }

        // ── Interaction ──
        if (n.id) {
            const id = n.id;
            el.style("cursor", "pointer")
                .on("mousemove", (event: MouseEvent) => {
                    const [px, py] = d3.pointer(event, this.svg.node());
                    const items: VisualTooltipDataItem[] = [{ displayName: "Element", value: id }];
                    if (binding?.value != null) items.push({ displayName: "Value", value: numFmt(binding.value) });
                    if (binding?.state) items.push({ displayName: "State", value: binding.state });
                    if (!binding) items.push({ displayName: "", value: "No data bound to this element" });
                    this.tooltipService.show({
                        dataItems: items, identities: [],
                        coordinates: [px, py], isTouchEvent: false
                    });
                })
                .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));

            if (ctx.showIds) {
                const b = shapeBounds(n);
                if (b) {
                    parent.append("text")
                        .attr("x", b.x + b.w / 2).attr("y", b.y + b.h / 2)
                        .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
                        .attr("font-size", Math.max(4, Math.min(12, b.h * 0.3)))
                        .attr("fill", "#c0392b").attr("pointer-events", "none")
                        .text(id);
                }
            }
        }
    }

    /** Single rAF loop driving both flow dashes and alarm blinking. */
    private tick = (ts: number) => {
        this.rafId = requestAnimationFrame(this.tick);
        if (this.docHidden) { this.lastTs = ts; return; }
        if (!this.lastTs) this.lastTs = ts;
        const dt = Math.min(100, ts - this.lastTs);
        this.lastTs = ts;

        if (this.flowEls.length) {
            this.dashOffset -= (this.flowSpeed / 50) * (dt / 16);
            for (const f of this.flowEls) {
                f.sel.attr("stroke-dashoffset", this.dashOffset % f.len);
            }
        }
        if (this.blinkEls.length) {
            const on = Math.floor(ts / 500) % 2 === 0;
            for (const b of this.blinkEls) b.attr("opacity", on ? 1 : 0.28);
        }
    };

    private stopLoop(): void {
        if (this.rafId != null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    private renderMessage(width: number, height: number, title: string, l1: string, l2: string): void {
        this.scene.selectAll("*").remove();
        this.svg.attr("viewBox", `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);
        this.landing.selectAll("*").remove();
        if (width < 160 || height < 110) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);
        g.append("text").attr("text-anchor", "middle").attr("y", -6)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "15px")
            .attr("font-weight", 600).attr("fill", "#333").text(title);
        g.append("text").attr("text-anchor", "middle").attr("y", 16)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666").text(l1);
        if (l2) {
            g.append("text").attr("text-anchor", "middle").attr("y", 36)
                .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
                .attr("fill", "#999").text(l2);
        }
    }

    private renderLandingPage(width: number, height: number, hasSvg: boolean, hasId: boolean): void {
        this.scene.selectAll("*").remove();
        this.svg.attr("viewBox", `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);
        this.landing.selectAll("*").remove();
        if (width < 170 || height < 120) return;
        const g = this.landing.attr("transform", `translate(${width / 2}, ${height / 2})`);

        // Glyph: two tanks, a pipe and a valve.
        const glyph = g.append("g").attr("transform", "translate(-92,-96)");
        [[0, 20], [120, 8]].forEach(([x, y], i) => {
            glyph.append("rect").attr("x", x).attr("y", y).attr("width", 46).attr("height", 54)
                .attr("rx", 4).attr("fill", "none").attr("stroke", "#4682B4").attr("stroke-width", 2);
            glyph.append("rect").attr("x", x + 1).attr("y", y + 54 - (i ? 34 : 20))
                .attr("width", 44).attr("height", i ? 34 : 20)
                .attr("fill", i ? "#1a9850" : "#d73027").attr("fill-opacity", 0.75);
        });
        glyph.append("path").attr("d", "M46,50 L84,50 L84,34 L120,34")
            .attr("fill", "none").attr("stroke", "#8d99ae").attr("stroke-width", 4)
            .attr("stroke-dasharray", "6 4");
        glyph.append("circle").attr("cx", 84).attr("cy", 50).attr("r", 7)
            .attr("fill", "#1a9850").attr("stroke", "#fff").attr("stroke-width", 1.5);

        g.append("text").attr("text-anchor", "middle").attr("y", 4)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px")
            .attr("font-weight", 600).attr("fill", "#333").text("Synoptic Mimic Diagram");

        const missing: string[] = [];
        if (!hasSvg) missing.push("SVG Template");
        if (!hasId) missing.push("Element ID");
        g.append("text").attr("text-anchor", "middle").attr("y", 26)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("fill", "#666")
            .text(missing.length ? "Add fields:  " + missing.join("   +   ") : "Add an SVG Template and Element IDs to begin");
        g.append("text").attr("text-anchor", "middle").attr("y", 48)
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px")
            .attr("fill", "#999")
            .text("The template is parsed and re-drawn from validated geometry — never injected as markup.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    public destroy(): void {
        this.stopLoop();
        if (this.visibilityHandler) {
            document.removeEventListener("visibilitychange", this.visibilityHandler);
        }
    }
}
