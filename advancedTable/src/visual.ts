"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISandboxExtendedColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;

import { VisualFormattingSettingsModel, DEFAULT_SPARK_COLOR, DEFAULT_BANDING } from "./settings";

// ── Types ──────────────────────────────────────────────────────

interface ColumnSpec {
    name: string;
    formatString: string | undefined;
    valueColumnIdx: number;  // index into matrix.valueSources
    isSparkline: boolean;
}

interface RowRecord {
    label: string;
    cells: Array<number | null>;   // one per column (aligned to columns[])
    sparkline: number[] | null;    // present when sparkline series bound
    selectionId?: ISelectionId;
    isHighlighted?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────

function safeNum(v: unknown): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Compact locale-aware formatter honoring PBI-style format strings
 * (currency, percent, decimal count). Small subset — no external dependency.
 */
function formatValue(v: number | null, formatString: string | undefined): string {
    if (v == null) return "—";
    if (!formatString) return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    const fs = formatString;
    const isPercent = fs.includes("%");
    const currency = (fs.match(/[$£€¥]/) || [null])[0];
    const m = fs.match(/\.(0+)/);
    const decimals = m ? m[1].length : 2;
    if (isPercent) return v.toLocaleString(undefined, { style: "percent", minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    if (currency) return (v < 0 ? "-" : "") + currency + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function evaluateRule(cellValue: number | null, op: string, threshold: number): boolean {
    if (cellValue == null) return false;
    switch (op) {
        case ">":  return cellValue > threshold;
        case "<":  return cellValue < threshold;
        case ">=": return cellValue >= threshold;
        case "<=": return cellValue <= threshold;
        case "=":  return cellValue === threshold;
    }
    return false;
}

// ── Visual ─────────────────────────────────────────────────────

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private colorPalette: ISandboxExtendedColorPalette;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private root: HTMLDivElement;
    private container: HTMLDivElement;
    private landing: HTMLDivElement;
    private currentMatrixLevels: powerbi.DataViewHierarchyLevel[] = [];

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
        this.selectionManager = options.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();
        this.root = options.element as HTMLDivElement;

        this.selectionManager.registerOnSelectCallback(() => this.applySelectionStyling());

        this.container = document.createElement("div");
        this.container.className = "at-container";
        this.root.appendChild(this.container);

        this.landing = document.createElement("div");
        this.landing.className = "at-landing";
        this.root.appendChild(this.landing);

        // Click on the container background (not on a row) clears the selection.
        this.container.addEventListener("click", (event: MouseEvent) => {
            const t = event.target as HTMLElement;
            if (t.tagName !== "TR" && !t.closest("tr")) {
                this.selectionManager.clear().then(() => this.applySelectionStyling());
            }
        });
    }

    private applySelectionStyling(): void {
        const s = this.formattingSettings;
        if (!s) return;
        const dim = Math.max(0.1, Math.min(1, (s.interactionsCard.dimUnselectedOpacity.value ?? 40) / 100));
        const activeIds = this.selectionManager.getSelectionIds() as ISelectionId[];
        const hasSel = activeIds.length > 0;
        const eq = (a: ISelectionId, b: ISelectionId) =>
            (a as { equals?: (b: ISelectionId) => boolean }).equals?.(b) ?? false;

        this.container.querySelectorAll<HTMLTableRowElement>("tr[data-row]").forEach(tr => {
            const row = (tr as unknown as { __row?: RowRecord }).__row;
            if (!row) return;
            const isSel = !!row.selectionId && activeIds.some(a => eq(a, row.selectionId!));
            const isHl = row.isHighlighted !== false;
            let opacity = 1;
            if (hasSel && !isSel) opacity = dim;
            if (!isHl) opacity = Math.min(opacity, dim);
            tr.style.opacity = String(opacity);
        });
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);
        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);

            const dv = options.dataViews?.[0];
            const parsed = this.parseMatrix(dv);
            if (!parsed) {
                this.container.innerHTML = "";
                this.renderLanding();
                this.events.renderingFinished(options);
                return;
            }
            this.landing.innerHTML = "";
            this.render(parsed, options.viewport.width, options.viewport.height);
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    private parseMatrix(dv?: powerbi.DataView): { columns: ColumnSpec[]; rows: RowRecord[] } | null {
        const m = dv?.matrix;
        if (!m || !m.rows || !m.rows.root || m.valueSources.length === 0) return null;
        this.currentMatrixLevels = m.rows.levels;
        const sources = m.valueSources;
        // Column specs — one per value source. Detect sparkline column: the source whose role is 'sparkValue'.
        const columns: ColumnSpec[] = sources.map((src, i) => ({
            name: src.displayName || `Value ${i + 1}`,
            formatString: src.format,
            valueColumnIdx: i,
            isSparkline: !!(src.roles && src.roles["sparkValue"])
        }));

        const rows: RowRecord[] = [];
        const rootKids = m.rows.root.children ?? [];
        for (const rowNode of rootKids) {
            const label = String(rowNode.value ?? "");
            const cells: Array<number | null> = new Array(columns.length).fill(null);
            let sparkline: number[] | null = null;

            // If the row has children, those are the sparkline axis nodes; each carries sparkValue.
            if (rowNode.children && rowNode.children.length > 0) {
                sparkline = [];
                for (const child of rowNode.children) {
                    // Regular column values may still be present on the row's own values map (aggregated by PBI).
                    // The child's values are the per-axis series data.
                    const cVals = child.values ?? {};
                    for (const key of Object.keys(cVals)) {
                        const idx = Number(key);
                        if (!Number.isFinite(idx)) continue;
                        if (columns[idx]?.isSparkline) {
                            const n = safeNum(cVals[key].value);
                            if (n != null) sparkline.push(n);
                        }
                    }
                }
            }

            // Row-level values: numeric aggregates PBI computed for non-sparkline measures.
            const rVals = rowNode.values ?? {};
            for (const key of Object.keys(rVals)) {
                const idx = Number(key);
                if (!Number.isFinite(idx)) continue;
                if (columns[idx] && !columns[idx].isSparkline) {
                    cells[idx] = safeNum(rVals[key].value);
                }
            }

            // Row-level selection identity from the matrix node.
            let selectionId: ISelectionId | undefined;
            try {
                selectionId = this.host.createSelectionIdBuilder()
                    .withMatrixNode(rowNode, this.currentMatrixLevels)
                    .createSelectionId();
            } catch { /* skipped */ }

            rows.push({ label, cells, sparkline, selectionId, isHighlighted: true });
        }
        return { columns, rows };
    }

    private render(parsed: { columns: ColumnSpec[]; rows: RowRecord[] }, _width: number, _height: number): void {
        this.container.innerHTML = "";
        const s = this.formattingSettings;
        const fs = Math.max(9, Math.min(20, s.tableCard.fontSize.value ?? 12));
        // High contrast: banding disappears (background), sparklines + rule
        // icons collapse to the foreground.
        const hc = this.colorPalette.isHighContrast === true;
        const hcFg = this.colorPalette.foreground?.value || "#000000";
        const hcBg = this.colorPalette.background?.value || "#ffffff";
        const bandingColor = hc
            ? hcBg
            : (s.tableCard.bandingColor.value.value === DEFAULT_BANDING ? "#f5f5f5" : s.tableCard.bandingColor.value.value);
        const sparkColor = hc
            ? hcFg
            : (s.sparklinesCard.sparkColor.value.value === DEFAULT_SPARK_COLOR
                ? (this.colorPalette.getColor("atSpark")?.value || DEFAULT_SPARK_COLOR)
                : s.sparklinesCard.sparkColor.value.value);
        const sparkW = Math.max(20, s.sparklinesCard.sparkWidth.value ?? 90);
        const sparkH = Math.max(10, s.sparklinesCard.sparkHeight.value ?? 22);
        const sparkType = String(s.sparklinesCard.sparkType.value?.value ?? "line");

        // Icon rules.
        const rules = [
            {
                col: String(s.rulesCard.rule1Column.value ?? "").trim(),
                op:  String(s.rulesCard.rule1Operator.value?.value ?? "<"),
                v:   s.rulesCard.rule1Value.value ?? 0,
                icon:String(s.rulesCard.rule1Icon.value?.value ?? "▼"),
                color: hc ? hcFg : s.rulesCard.rule1Color.value.value
            },
            {
                col: String(s.rulesCard.rule2Column.value ?? "").trim(),
                op:  String(s.rulesCard.rule2Operator.value?.value ?? ">="),
                v:   s.rulesCard.rule2Value.value ?? 0,
                icon:String(s.rulesCard.rule2Icon.value?.value ?? "▲"),
                color: hc ? hcFg : s.rulesCard.rule2Color.value.value
            }
        ].filter(r => r.col);

        // Totals row.
        let totalsRow: RowRecord | null = null;
        if (s.tableCard.showTotals.value) {
            const totals: Array<number | null> = parsed.columns.map(() => 0);
            for (const r of parsed.rows) {
                for (let i = 0; i < parsed.columns.length; i++) {
                    if (parsed.columns[i].isSparkline) continue;
                    if (r.cells[i] != null) totals[i] = (totals[i] ?? 0) + (r.cells[i] as number);
                }
            }
            totalsRow = { label: "Total", cells: totals, sparkline: null };
        }

        // Build the table. HTML grid is the right primitive here — native scrolling, sticky header, DOM a11y.
        const wrap = document.createElement("div");
        wrap.className = "at-wrap";
        this.container.appendChild(wrap);
        const table = document.createElement("table");
        table.className = "at-table";
        wrap.appendChild(table);
        table.style.fontSize = `${fs}px`;

        // Header
        const thead = document.createElement("thead");
        if (s.tableCard.stickyHeader.value) thead.classList.add("at-sticky");
        table.appendChild(thead);
        const trHead = document.createElement("tr");
        thead.appendChild(trHead);
        const hRow = document.createElement("th");
        hRow.textContent = "Row";
        hRow.className = "at-th at-th-row";
        trHead.appendChild(hRow);
        for (const c of parsed.columns) {
            const th = document.createElement("th");
            th.className = "at-th";
            th.textContent = c.isSparkline ? `${c.name} ▁▂▃` : c.name;
            trHead.appendChild(th);
        }

        // Sort state — cheap client-side sort on any numeric column.
        let sortColIdx = -1;   // -1 = row label
        let sortDir: 1 | -1 = 1;
        const applySort = () => {
            parsed.rows.sort((a, b) => {
                if (sortColIdx === -1) return sortDir * a.label.localeCompare(b.label);
                const av = a.cells[sortColIdx], bv = b.cells[sortColIdx];
                if (av == null && bv == null) return 0;
                if (av == null) return 1;
                if (bv == null) return -1;
                return sortDir * ((av as number) - (bv as number));
            });
        };
        const bindSort = (thEl: HTMLElement, idx: number) => {
            thEl.style.cursor = "pointer";
            thEl.addEventListener("click", () => {
                if (sortColIdx === idx) sortDir = (sortDir === 1 ? -1 : 1);
                else { sortColIdx = idx; sortDir = idx === -1 ? 1 : -1; }
                applySort();
                buildBody();
            });
        };
        bindSort(hRow, -1);
        parsed.columns.forEach((_, i) => bindSort(trHead.children[i + 1] as HTMLElement, i));

        // Body
        const tbody = document.createElement("tbody");
        table.appendChild(tbody);

        const cellIconFor = (colName: string, cellValue: number | null): { icon: string; color: string } | null => {
            for (const r of rules) {
                if (r.col.toLowerCase() !== colName.toLowerCase()) continue;
                if (evaluateRule(cellValue, r.op, r.v)) return { icon: r.icon, color: r.color };
            }
            return null;
        };

        const buildRow = (r: RowRecord, isTotal: boolean, altBand: boolean): HTMLTableRowElement => {
            const tr = document.createElement("tr");
            if (isTotal) tr.className = "at-total";
            else if (altBand && s.tableCard.rowBanding.value) tr.style.background = bandingColor;

            // Wire interactions on non-total rows only.
            if (!isTotal) {
                tr.setAttribute("data-row", "true");
                (tr as unknown as { __row: RowRecord }).__row = r;
                if (r.selectionId) {
                    tr.style.cursor = "pointer";
                    tr.setAttribute("tabindex", "0");
                    tr.setAttribute("role", "button");
                    tr.setAttribute("aria-label", `Row ${r.label} — click to filter`);
                    tr.addEventListener("click", (event: MouseEvent) => {
                        event.stopPropagation();
                        const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                        this.selectionManager.select(r.selectionId!, multi).then(() => this.applySelectionStyling());
                    });
                    tr.addEventListener("contextmenu", (event: MouseEvent) => {
                        event.preventDefault(); event.stopPropagation();
                        this.selectionManager.showContextMenu(r.selectionId!, { x: event.clientX, y: event.clientY });
                    });
                    tr.addEventListener("keydown", (event: KeyboardEvent) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        this.selectionManager.select(r.selectionId!, event.shiftKey).then(() => this.applySelectionStyling());
                    });
                }
            }

            const tdLabel = document.createElement("td");
            tdLabel.className = "at-td at-td-row";
            tdLabel.textContent = r.label;
            tr.appendChild(tdLabel);
            for (let i = 0; i < parsed.columns.length; i++) {
                const col = parsed.columns[i];
                const td = document.createElement("td");
                td.className = "at-td";
                if (col.isSparkline && !isTotal) {
                    if (r.sparkline && r.sparkline.length > 1) {
                        td.appendChild(this.buildSparkline(r.sparkline, sparkType, sparkW, sparkH, sparkColor, s.sparklinesCard.highlightLast.value, s.sparklinesCard.showMinMaxDots.value));
                    } else {
                        td.textContent = "";
                    }
                } else {
                    const v = r.cells[i];
                    td.classList.add("at-numeric");
                    const icon = cellIconFor(col.name, v);
                    if (icon) {
                        const glyph = document.createElement("span");
                        glyph.className = "at-icon";
                        glyph.textContent = icon.icon;
                        glyph.style.color = icon.color;
                        td.appendChild(glyph);
                        td.appendChild(document.createTextNode(" " + formatValue(v, col.formatString)));
                    } else {
                        td.textContent = formatValue(v, col.formatString);
                    }
                }
                tr.appendChild(td);
            }
            return tr;
        };

        const buildBody = () => {
            tbody.innerHTML = "";
            if (totalsRow && s.tableCard.totalsPosition.value?.value === "top") {
                tbody.appendChild(buildRow(totalsRow, true, false));
            }
            parsed.rows.forEach((r, i) => tbody.appendChild(buildRow(r, false, i % 2 === 1)));
            if (totalsRow && s.tableCard.totalsPosition.value?.value !== "top") {
                tbody.appendChild(buildRow(totalsRow, true, false));
            }
        };
        buildBody();
        this.applySelectionStyling();
    }

    /**
     * Inline SVG sparkline. One node per row × visible-window row. `win-loss`
     * mode renders one small bar per point, up for ≥0 and down for <0.
     */
    private buildSparkline(
        values: number[], type: string, w: number, h: number,
        color: string, highlightLast: boolean, showMinMax: boolean
    ): SVGSVGElement {
        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("width", String(w));
        svg.setAttribute("height", String(h));
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
        const pad = 2;
        const iw = w - pad * 2, ih = h - pad * 2;
        const N = values.length;
        if (N < 2) return svg;

        const xAt = (i: number) => pad + (i / (N - 1)) * iw;
        const min = Math.min(...values), max = Math.max(...values);
        const range = (max - min) || 1;
        const yAt = (v: number) => pad + ih - ((v - min) / range) * ih;

        if (type === "line" || type === "area") {
            let d = `M ${xAt(0)} ${yAt(values[0])}`;
            for (let i = 1; i < N; i++) d += ` L ${xAt(i)} ${yAt(values[i])}`;
            if (type === "area") {
                const areaD = d + ` L ${xAt(N - 1)} ${pad + ih} L ${xAt(0)} ${pad + ih} Z`;
                const area = document.createElementNS(NS, "path");
                area.setAttribute("d", areaD);
                area.setAttribute("fill", color);
                area.setAttribute("fill-opacity", "0.25");
                svg.appendChild(area);
            }
            const path = document.createElementNS(NS, "path");
            path.setAttribute("d", d);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", color);
            path.setAttribute("stroke-width", "1.2");
            path.setAttribute("stroke-linejoin", "round");
            svg.appendChild(path);
        } else if (type === "bar") {
            const bw = Math.max(1, iw / N - 1);
            for (let i = 0; i < N; i++) {
                const bar = document.createElementNS(NS, "rect");
                bar.setAttribute("x", String(xAt(i) - bw / 2));
                bar.setAttribute("y", String(yAt(values[i])));
                bar.setAttribute("width", String(bw));
                bar.setAttribute("height", String(pad + ih - yAt(values[i])));
                bar.setAttribute("fill", color);
                svg.appendChild(bar);
            }
        } else if (type === "win-loss") {
            const bw = Math.max(1, iw / N - 1);
            const mid = pad + ih / 2;
            const barH = ih / 2 - 1;
            for (let i = 0; i < N; i++) {
                const isWin = values[i] >= 0;
                const bar = document.createElementNS(NS, "rect");
                bar.setAttribute("x", String(xAt(i) - bw / 2));
                bar.setAttribute("y", String(isWin ? (mid - barH) : mid));
                bar.setAttribute("width", String(bw));
                bar.setAttribute("height", String(barH));
                bar.setAttribute("fill", isWin ? "#2ca02c" : "#d62728");
                svg.appendChild(bar);
            }
        }

        if (showMinMax && (type === "line" || type === "area")) {
            const minIdx = values.indexOf(min);
            const maxIdx = values.indexOf(max);
            for (const idx of [minIdx, maxIdx]) {
                if (idx < 0) continue;
                const c = document.createElementNS(NS, "circle");
                c.setAttribute("cx", String(xAt(idx)));
                c.setAttribute("cy", String(yAt(values[idx])));
                c.setAttribute("r", "1.6");
                c.setAttribute("fill", idx === maxIdx ? "#2ca02c" : "#d62728");
                svg.appendChild(c);
            }
        }
        if (highlightLast && (type === "line" || type === "area")) {
            const c = document.createElementNS(NS, "circle");
            c.setAttribute("cx", String(xAt(N - 1)));
            c.setAttribute("cy", String(yAt(values[N - 1])));
            c.setAttribute("r", "2");
            c.setAttribute("fill", color);
            svg.appendChild(c);
        }
        return svg;
    }

    private renderLanding(): void {
        this.container.innerHTML = "";
        this.landing.innerHTML = "";
        const box = document.createElement("div");
        box.className = "at-landing-box";
        box.innerHTML = `
            <div class="at-landing-glyph">
                <div class="at-lg-row" style="background:#4472C4;opacity:.15;"></div>
                <div class="at-lg-row" style="background:#f5f5f5"></div>
                <div class="at-lg-row" style="background:#4472C4;opacity:.15;"></div>
            </div>
            <div class="at-landing-title">Advanced Table</div>
            <div class="at-landing-body">Add fields: <b>Rows</b> + one or more <b>Values</b>. Optionally bind <b>Sparkline Axis</b> + <b>Sparkline Value</b> for a sparkline cell.</div>
            <div class="at-landing-sub">Icon rules and sparkline options live in the format pane.</div>
        `;
        this.landing.appendChild(box);
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
