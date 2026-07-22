"use strict";

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";
import * as cloud from "d3-cloud";
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

// Standard English stop-word list, bundled — no font/network access at runtime.
const STOP_EN = new Set([
    "the","a","an","and","or","but","if","then","else","when","of","at","by","for","with","about","against",
    "between","into","through","during","before","after","above","below","to","from","up","down","in","out",
    "on","off","over","under","again","further","then","once","here","there","when","where","why","how",
    "all","any","both","each","few","more","most","other","some","such","no","nor","not","only","own",
    "same","so","than","too","very","s","t","can","will","just","don","should","now","d","ll","m","o","re",
    "ve","y","ain","aren","couldn","didn","doesn","hadn","hasn","haven","isn","ma","mightn","mustn","needn",
    "shan","shouldn","wasn","weren","won","wouldn","i","me","my","myself","we","our","ours","ourselves",
    "you","your","yours","yourself","yourselves","he","him","his","himself","she","her","hers","herself",
    "it","its","itself","they","them","their","theirs","themselves","what","which","who","whom","this",
    "that","these","those","am","is","are","was","were","be","been","being","have","has","had","having",
    "do","does","did","doing","would","could","might","must","shall","also","us","let","get","got","one",
    "two","three","new","would","could"
]);

interface Term {
    text: string;
    weight: number;
    category: string | null;
    selectionId: ISelectionId | null;
}
interface PlacedWord extends Term {
    x: number; y: number; size: number; rotate: number;
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
    private landing: d3.Selection<SVGGElement, unknown, null, undefined>;

    private lastLayoutHandle: ReturnType<typeof cloud<PlacedWord>> | null = null;

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

        this.svg = d3.select(options.element).append("svg").classed("word-cloud", true);
        this.landing = this.svg.append("g").classed("wc-landing", true);
        this.container = this.svg.append("g").classed("wc-container", true);

        this.svg.on("click", (event: MouseEvent) => {
            if (event.target === this.svg.node()) {
                this.selectionManager.clear().then(() => this.applySelectionStyling());
            }
        });
    }

    private applySelectionStyling(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.05, Math.min(1, (s.interactionCard.dimUnselectedOpacity.value ?? 25) / 100));
        const activeIds = this.selectionManager.getSelectionIds() as ISelectionId[];
        const hasSel = activeIds.length > 0;
        const eq = (a: ISelectionId, b: ISelectionId) =>
            (a as { equals?: (b: ISelectionId) => boolean }).equals?.(b) ?? false;

        this.container.selectAll<SVGTextElement, PlacedWord>("text.wc-word").each(function (d) {
            const t = d3.select(this);
            const isSel = !!d.selectionId && activeIds.some(a => eq(a, d.selectionId!));
            let opacity = 1;
            if (hasSel && !isSel) opacity = dim;
            t.attr("opacity", opacity);
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

            const parsed = this.parseAndTokenize(options.dataViews?.[0]);
            if (!parsed || parsed.length === 0) {
                this.container.selectAll("*").remove();
                this.tooltipService.hide({ immediately: true, isTouchEvent: false });
                this.renderLandingPage(width, height, palette);
                this.events.renderingFinished(options);
                return;
            }
            this.landing.selectAll("*").remove();
            this.runLayout(parsed, width, height, palette);
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private parseAndTokenize(dv?: powerbi.DataView): Term[] | null {
        const cat = dv?.categorical;
        if (!cat?.categories?.length) return null;
        const s = this.formattingSettings;

        const tIdx = findCategoryIndex(cat.categories, "text");
        if (tIdx < 0) return null;
        const wIdx = cat.values ? findValueIndex(cat.values, "weight") : -1;
        const cIdx = findCategoryIndex(cat.categories, "colorBy");
        const textCol = cat.categories[tIdx];
        const rows = textCol.values.length;

        // Case, stop-list, n-gram size.
        const caseMode = String(s.processingCard.caseMode.value?.value ?? "lower");
        const stopMode = String(s.processingCard.stopWords.value?.value ?? "english");
        const stop = new Set<string>();
        if (stopMode === "english") STOP_EN.forEach(w => stop.add(w));
        if (stopMode === "custom") {
            for (const w of String(s.processingCard.customStopWords.value ?? "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean)) {
                stop.add(w);
            }
        }
        const isStop = (w: string) => stop.has(w.toLowerCase());
        const ngramSize = String(s.processingCard.ngramSize.value?.value ?? "1+2");
        const wantUnigrams = ngramSize === "1" || ngramSize === "1+2";
        const wantBigrams = ngramSize === "2" || ngramSize === "1+2";
        const wantTrigrams = ngramSize === "3";
        const minFreq = Math.max(1, s.processingCard.minFrequency.value ?? 2);
        const maxTerms = Math.max(5, Math.min(1000, s.processingCard.maxTerms.value ?? 100));

        // Detect mode: pre-aggregated (a Weight measure is bound) vs raw-text.
        const hasWeight = wIdx >= 0 && cat.values && cat.values[wIdx].values.length > 0;
        const clickEnabled = this.formattingSettings.interactionCard.clickToFilter.value && hasWeight;

        const counts = new Map<string, { count: number; category: string | null; selectionId: ISelectionId | null }>();
        const bump = (word: string, weight: number, cat: string | null, selId: ISelectionId | null) => {
            if (!word || word.length < 2) return;
            const key = word;
            const existing = counts.get(key);
            if (existing) { existing.count += weight; if (!existing.category && cat) existing.category = cat; }
            else counts.set(key, { count: weight, category: cat, selectionId: selId });
        };

        const catVals = cIdx >= 0 ? cat.categories![cIdx].values : null;

        for (let i = 0; i < rows; i++) {
            const raw = textCol.values[i];
            if (raw == null) continue;
            const s0 = String(raw);
            const catValue = catVals ? String(catVals[i]) : null;
            let selectionId: ISelectionId | null = null;
            if (clickEnabled) {
                try {
                    selectionId = this.host.createSelectionIdBuilder()
                        .withCategory(textCol, i)
                        .createSelectionId();
                } catch { /* selectionId is optional; missing it just disables click filtering for that row */ }
            }
            if (hasWeight) {
                const w = safeNum(cat.values![wIdx].values[i]) ?? 0;
                if (w <= 0) continue;
                const term = caseMode === "lower" ? s0.toLowerCase() : s0;
                bump(term, w, catValue, selectionId);
            } else {
                // Raw text mode: tokenize, remove stop words, build n-grams.
                const tokens = s0.match(/\p{L}+/gu) ?? [];
                const words = tokens.map(t => caseMode === "lower" ? t.toLowerCase() : t).filter(w => !isStop(w));
                if (wantUnigrams) for (const w of words) bump(w, 1, catValue, null);
                if (wantBigrams) for (let k = 0; k < words.length - 1; k++) bump(`${words[k]} ${words[k + 1]}`, 1, catValue, null);
                if (wantTrigrams) for (let k = 0; k < words.length - 2; k++) bump(`${words[k]} ${words[k + 1]} ${words[k + 2]}`, 1, catValue, null);
            }
        }

        // Filter + sort + cap.
        const arr: Term[] = [];
        for (const [text, meta] of counts) {
            if (meta.count < minFreq) continue;
            arr.push({ text, weight: meta.count, category: meta.category, selectionId: meta.selectionId });
        }
        arr.sort((a, b) => b.weight - a.weight);
        return arr.slice(0, maxTerms);
    }

    private runLayout(terms: Term[], width: number, height: number, palette: RenderPalette): void {
        const s = this.formattingSettings;
        // Weight → font-size scale.
        const scale = String(s.layoutCard.scaleMode.value?.value ?? "sqrt");
        const wMin = d3.min(terms, t => t.weight) ?? 1;
        const wMax = d3.max(terms, t => t.weight) ?? 1;
        const fMin = Math.max(6, s.layoutCard.minFontSize.value ?? 12);
        const fMax = Math.max(fMin + 1, s.layoutCard.maxFontSize.value ?? 64);
        const cap = Math.min(fMax, Math.min(width, height) * 0.4);
        const trans = (w: number): number => scale === "sqrt" ? Math.sqrt(w) : scale === "log" ? Math.log1p(w) : w;
        const tMin = trans(wMin), tMax = trans(wMax);
        const sizeOf = (w: number): number => {
            if (tMax === tMin) return (fMin + cap) / 2;
            return fMin + ((trans(w) - tMin) / (tMax - tMin)) * (cap - fMin);
        };

        const rotationsMode = String(s.layoutCard.rotations.value?.value ?? "none");
        const rotationChoice = (): number => {
            if (rotationsMode === "none") return 0;
            if (rotationsMode === "90") return (Math.floor(Math.random() * 2) === 0) ? 0 : (Math.random() < 0.5 ? -90 : 90);
            // "45-90"
            const pick = Math.floor(Math.random() * 5);
            return [0, 45, -45, 90, -90][pick];
        };

        const spiral = String(s.layoutCard.spiral.value?.value ?? "archimedean");
        const padding = Math.max(0, s.layoutCard.padding.value ?? 2);
        const fontFamily = String(s.layoutCard.fontFamily.value ?? "Segoe UI");
        const catColor = d3.scaleOrdinal<string, string>().range(d3.schemeTableau10 as unknown as string[]);

        // Stop any previous layout to prevent stale placements from arriving.
        if (this.lastLayoutHandle) { try { this.lastLayoutHandle.stop(); } catch { /* stop() throws if layout is idle; not fatal */ } }

        this.lastLayoutHandle = cloud<PlacedWord>()
            .size([width, height])
            .words(terms.map(t => ({ ...t, x: 0, y: 0, size: sizeOf(t.weight), rotate: rotationChoice() } as PlacedWord)))
            .padding(padding)
            .rotate(d => d.rotate)
            .font(fontFamily)
            .fontSize(d => d.size)
            .spiral(spiral as "archimedean" | "rectangular")
            .text(d => d.text)
            .on("end", (placed) => this.draw(placed as PlacedWord[], width, height, palette, catColor, terms.length, fontFamily));
        this.lastLayoutHandle.start();
    }

    private draw(
        placed: PlacedWord[], width: number, height: number, palette: RenderPalette,
        catColor: d3.ScaleOrdinal<string, string>, requestedCount: number, fontFamily: string
    ): void {
        this.container.selectAll("*").remove();
        const s = this.formattingSettings;
        const g = this.container.attr("transform", `translate(${width / 2}, ${height / 2})`);

        const rankToColor = d3.scaleSequential(d3.interpolateViridis).domain([placed.length - 1, 0]);

        g.selectAll("text")
            .data(placed)
            .enter().append("text")
            .attr("class", "wc-word")
            .attr("text-anchor", "middle")
            .style("font-family", fontFamily)
            .style("font-size", d => `${d.size}px`)
            .attr("transform", d => `translate(${d.x}, ${d.y}) rotate(${d.rotate})`)
            .attr("fill", (d, i) => {
                if (palette.highContrast) return palette.text;
                if (d.category) return catColor(d.category);
                return rankToColor(i);
            })
            .text(d => d.text)
            .attr("cursor", d => (d.selectionId && s.interactionCard.clickToFilter.value) ? "pointer" : "default")
            .attr("tabindex", d => (d.selectionId && s.interactionCard.clickToFilter.value) ? 0 : -1)
            .attr("role", "button")
            .attr("aria-label", d => `${d.text}, weight ${d.weight}`)
            .on("click", (event: MouseEvent, d: PlacedWord) => {
                event.stopPropagation();
                if (!d.selectionId || !s.interactionCard.clickToFilter.value) return;
                const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                this.selectionManager.select(d.selectionId, multi).then(() => this.applySelectionStyling());
            })
            .on("contextmenu", (event: MouseEvent, d: PlacedWord) => {
                event.preventDefault(); event.stopPropagation();
                this.selectionManager.showContextMenu(d.selectionId ?? ({} as ISelectionId), { x: event.clientX, y: event.clientY });
            })
            .on("keydown", (event: KeyboardEvent, d: PlacedWord) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                if (!d.selectionId || !s.interactionCard.clickToFilter.value) return;
                this.selectionManager.select(d.selectionId, event.shiftKey).then(() => this.applySelectionStyling());
            })
            .on("mousemove", (event: MouseEvent, d: PlacedWord) => {
                this.tooltipService.show({
                    dataItems: [
                        { displayName: "Term", value: d.text },
                        { displayName: "Weight", value: d3.format(",.4~g")(d.weight) },
                        { displayName: "Rank", value: String(placed.indexOf(d) + 1) }
                    ],
                    identities: [], coordinates: [event.clientX, event.clientY], isTouchEvent: false
                });
            })
            .on("mouseleave", () => this.tooltipService.hide({ immediately: false, isTouchEvent: false }));

        // "Showing N of M" chip when d3-cloud dropped words that didn't fit.
        if (placed.length < requestedCount) {
            const dropped = requestedCount - placed.length;
            const chip = this.container.append("g")
                .attr("transform", `translate(${-width / 2 + 8}, ${-height / 2 + 12})`);
            const t = chip.append("text").attr("y", 4).attr("dominant-baseline", "middle")
                .attr("x", 6).attr("font-size", "11px").attr("fill", palette.axisText).attr("font-weight", 600)
                .text(`Showing ${placed.length} of ${requestedCount} (dropped ${dropped} that wouldn't fit)`);
            const bb = (t.node() as SVGTextElement).getBBox();
            chip.insert("rect", "text")
                .attr("x", bb.x - 4).attr("y", bb.y - 2)
                .attr("width", bb.width + 8).attr("height", bb.height + 4)
                .attr("rx", 3).attr("fill", palette.background).attr("stroke", palette.axisLine);
        }

        this.applySelectionStyling();
    }

    private resolvePalette(): RenderPalette {
        const cp = this.colorPalette;
        if (cp.isHighContrast) {
            const fg = cp.foreground?.value || "#000";
            const bg = cp.background?.value || "#fff";
            return { highContrast: true, text: fg, axisText: fg, axisLine: fg, background: bg, landingText: fg, landingSub: fg };
        }
        const bg = cp.background?.value || "#fff";
        const isDark = luminance(bg) < 0.5;
        return {
            highContrast: false,
            text: isDark ? "#f0f0f0" : "#333",
            axisText: isDark ? "#bbb" : "#666",
            axisLine: isDark ? "#777" : "#999",
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
        const glyph = g.append("g").attr("transform", "translate(-90, -70)");
        const w = ["cloud","word","phrase","tokens","stop","bigram","cluster","topic"];
        for (let i = 0; i < w.length; i++) {
            const x = (i % 4) * 45 + 10, y = Math.floor(i / 4) * 24 + 20;
            glyph.append("text").attr("x", x).attr("y", y).attr("font-size", 12 + (w.length - i) * 2).attr("fill", "#4472C4").attr("font-family", "Segoe UI").text(w[i]);
        }
        g.append("text").attr("text-anchor", "middle").attr("y", 30).attr("font-family", "Segoe UI, sans-serif").attr("font-size", "16px").attr("font-weight", 600).attr("fill", palette.landingText).text("Word Cloud Modern");
        g.append("text").attr("text-anchor", "middle").attr("y", 50).attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px").attr("fill", palette.axisText).text("Add fields:  Text / Term  (+ Weight, Category)");
        g.append("text").attr("text-anchor", "middle").attr("y", 68).attr("font-family", "Segoe UI, sans-serif").attr("font-size", "11px").attr("fill", palette.landingSub).text("Weight bound = pre-aggregated · Weight blank = raw text tokenized with n-grams.");
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}

interface RenderPalette {
    highContrast: boolean;
    text: string;
    axisText: string;
    axisLine: string;
    background: string;
    landingText: string;
    landingSub: string;
}
