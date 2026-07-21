"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

export const DEFAULT_SPARK_COLOR = "#4472C4";
export const DEFAULT_RULE_COLOR  = "#d62728";
export const DEFAULT_BANDING     = "#f5f5f5";

class SparklinesCard extends FormattingSettingsCard {
    sparkType = new formattingSettings.ItemDropdown({
        name: "sparkType", displayName: "Sparkline type",
        items: [
            { value: "line",     displayName: "Line" },
            { value: "bar",      displayName: "Bar" },
            { value: "area",     displayName: "Area" },
            { value: "win-loss", displayName: "Win / Loss" }
        ],
        value: { value: "line", displayName: "Line" }
    });
    sparkWidth = new formattingSettings.NumUpDown({ name: "sparkWidth", displayName: "Sparkline width (px)", value: 90 });
    sparkHeight = new formattingSettings.NumUpDown({ name: "sparkHeight", displayName: "Sparkline height (px)", value: 22 });
    sparkColor = new formattingSettings.ColorPicker({ name: "sparkColor", displayName: "Sparkline color", value: { value: DEFAULT_SPARK_COLOR } });
    highlightLast = new formattingSettings.ToggleSwitch({ name: "highlightLast", displayName: "Highlight last point", value: true });
    showMinMaxDots = new formattingSettings.ToggleSwitch({ name: "showMinMaxDots", displayName: "Show min / max dots", value: false });

    name = "sparklines";
    displayName = "Sparklines";
    slices: Array<FormattingSettingsSlice> = [this.sparkType, this.sparkWidth, this.sparkHeight, this.sparkColor, this.highlightLast, this.showMinMaxDots];
}

class RulesCard extends FormattingSettingsCard {
    rule1Column = new formattingSettings.TextInput({ name: "rule1Column", displayName: "Rule 1 — measure name", placeholder: "e.g. Margin", value: "" });
    rule1Operator = new formattingSettings.ItemDropdown({
        name: "rule1Operator", displayName: "Rule 1 — operator",
        items: [
            { value: ">",  displayName: ">" },
            { value: "<",  displayName: "<" },
            { value: ">=", displayName: "≥" },
            { value: "<=", displayName: "≤" },
            { value: "=",  displayName: "=" }
        ],
        value: { value: "<", displayName: "<" }
    });
    rule1Value = new formattingSettings.NumUpDown({ name: "rule1Value", displayName: "Rule 1 — threshold", value: 0 });
    rule1Icon = new formattingSettings.ItemDropdown({
        name: "rule1Icon", displayName: "Rule 1 — icon",
        items: [
            { value: "▲", displayName: "Up ▲" },
            { value: "▼", displayName: "Down ▼" },
            { value: "●", displayName: "Dot ●" },
            { value: "■", displayName: "Square ■" },
            { value: "✓", displayName: "Check ✓" },
            { value: "✗", displayName: "Cross ✗" }
        ],
        value: { value: "▼", displayName: "Down ▼" }
    });
    rule1Color = new formattingSettings.ColorPicker({ name: "rule1Color", displayName: "Rule 1 — color", value: { value: DEFAULT_RULE_COLOR } });

    rule2Column = new formattingSettings.TextInput({ name: "rule2Column", displayName: "Rule 2 — measure name", placeholder: "(optional)", value: "" });
    rule2Operator = new formattingSettings.ItemDropdown({
        name: "rule2Operator", displayName: "Rule 2 — operator",
        items: [
            { value: ">",  displayName: ">" },
            { value: "<",  displayName: "<" },
            { value: ">=", displayName: "≥" },
            { value: "<=", displayName: "≤" },
            { value: "=",  displayName: "=" }
        ],
        value: { value: ">=", displayName: "≥" }
    });
    rule2Value = new formattingSettings.NumUpDown({ name: "rule2Value", displayName: "Rule 2 — threshold", value: 0 });
    rule2Icon = new formattingSettings.ItemDropdown({
        name: "rule2Icon", displayName: "Rule 2 — icon",
        items: [
            { value: "▲", displayName: "Up ▲" },
            { value: "▼", displayName: "Down ▼" },
            { value: "●", displayName: "Dot ●" },
            { value: "■", displayName: "Square ■" },
            { value: "✓", displayName: "Check ✓" },
            { value: "✗", displayName: "Cross ✗" }
        ],
        value: { value: "▲", displayName: "Up ▲" }
    });
    rule2Color = new formattingSettings.ColorPicker({ name: "rule2Color", displayName: "Rule 2 — color", value: { value: "#2ca02c" } });

    name = "rules";
    displayName = "Icon Rules";
    slices: Array<FormattingSettingsSlice> = [
        this.rule1Column, this.rule1Operator, this.rule1Value, this.rule1Icon, this.rule1Color,
        this.rule2Column, this.rule2Operator, this.rule2Value, this.rule2Icon, this.rule2Color
    ];
}

class TableCard extends FormattingSettingsCard {
    showTotals = new formattingSettings.ToggleSwitch({ name: "showTotals", displayName: "Show totals row", value: true });
    totalsPosition = new formattingSettings.ItemDropdown({
        name: "totalsPosition", displayName: "Totals position",
        items: [{ value: "top", displayName: "Top" }, { value: "bottom", displayName: "Bottom" }],
        value: { value: "bottom", displayName: "Bottom" }
    });
    fontSize = new formattingSettings.NumUpDown({ name: "fontSize", displayName: "Font size", value: 12 });
    rowBanding = new formattingSettings.ToggleSwitch({ name: "rowBanding", displayName: "Row banding", value: true });
    bandingColor = new formattingSettings.ColorPicker({ name: "bandingColor", displayName: "Banding color", value: { value: DEFAULT_BANDING } });
    stickyHeader = new formattingSettings.ToggleSwitch({ name: "stickyHeader", displayName: "Sticky header row", value: true });

    name = "table";
    displayName = "Table";
    slices: Array<FormattingSettingsSlice> = [this.showTotals, this.totalsPosition, this.fontSize, this.rowBanding, this.bandingColor, this.stickyHeader];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    sparklinesCard = new SparklinesCard();
    rulesCard = new RulesCard();
    tableCard = new TableCard();
    cards = [this.sparklinesCard, this.rulesCard, this.tableCard];
}
