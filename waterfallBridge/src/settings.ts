"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

export const DEFAULT_INCREASE_COLOR = "#2ca02c";
export const DEFAULT_DECREASE_COLOR = "#d62728";
export const DEFAULT_ANCHOR_COLOR   = "#4472C4";
export const DEFAULT_SUBTOTAL_COLOR = "#7f7f7f";
export const DEFAULT_CONNECTOR_COLOR = "#999999";
export const DEFAULT_BAR_BORDER_COLOR = "#333333";
export const DEFAULT_LABEL_COLOR = "#2a2a2a";

class StructureCard extends FormattingSettingsCard {
    firstStepIsAnchor = new formattingSettings.ToggleSwitch({
        name: "firstStepIsAnchor",
        displayName: "First step is anchor",
        description: "Render the first step as an absolute value (Actual) rather than a delta.",
        value: true
    });
    lastStepIsAnchor = new formattingSettings.ToggleSwitch({
        name: "lastStepIsAnchor",
        displayName: "Last step is anchor",
        description: "Render the last step as an absolute value (Budget / Target).",
        value: true
    });
    showSubtotals = new formattingSettings.ToggleSwitch({
        name: "showSubtotals",
        displayName: "Show subtotals",
        description: "Draw a running-total bar wherever Step Type = 'subtotal'.",
        value: false
    });
    sortMode = new formattingSettings.ItemDropdown({
        name: "sortMode",
        displayName: "Sort deltas",
        items: [
            { value: "data-order", displayName: "Data order" },
            { value: "ascending",  displayName: "Ascending (delta)" },
            { value: "descending", displayName: "Descending (delta)" }
        ],
        value: { value: "data-order", displayName: "Data order" }
    });

    name: string = "structure";
    displayName: string = "Bridge Structure";
    slices: Array<FormattingSettingsSlice> = [
        this.firstStepIsAnchor, this.lastStepIsAnchor, this.showSubtotals, this.sortMode
    ];
}

class BarsCard extends FormattingSettingsCard {
    increaseColor = new formattingSettings.ColorPicker({
        name: "increaseColor", displayName: "Increase color",
        value: { value: DEFAULT_INCREASE_COLOR }
    });
    decreaseColor = new formattingSettings.ColorPicker({
        name: "decreaseColor", displayName: "Decrease color",
        value: { value: DEFAULT_DECREASE_COLOR }
    });
    anchorColor = new formattingSettings.ColorPicker({
        name: "anchorColor", displayName: "Anchor color",
        value: { value: DEFAULT_ANCHOR_COLOR }
    });
    subtotalColor = new formattingSettings.ColorPicker({
        name: "subtotalColor", displayName: "Subtotal color",
        value: { value: DEFAULT_SUBTOTAL_COLOR }
    });
    barPadding = new formattingSettings.NumUpDown({
        name: "barPadding", displayName: "Bar padding (%)",
        description: "Gap between bars as a percentage of the step band.",
        value: 20
    });
    cornerRadius = new formattingSettings.NumUpDown({
        name: "cornerRadius", displayName: "Corner radius (px)",
        description: "Round the bar corners. 0 = square.",
        value: 2
    });
    barBorderWidth = new formattingSettings.NumUpDown({
        name: "barBorderWidth", displayName: "Bar border width (px)",
        description: "Stroke around each bar. 0 = no border.",
        value: 0
    });
    barBorderColor = new formattingSettings.ColorPicker({
        name: "barBorderColor", displayName: "Bar border color",
        value: { value: DEFAULT_BAR_BORDER_COLOR }
    });

    name: string = "bars";
    displayName: string = "Bars";
    slices: Array<FormattingSettingsSlice> = [
        this.increaseColor, this.decreaseColor, this.anchorColor, this.subtotalColor,
        this.barPadding, this.cornerRadius, this.barBorderWidth, this.barBorderColor
    ];
}

class ConnectorsCard extends FormattingSettingsCard {
    showConnectors = new formattingSettings.ToggleSwitch({
        name: "showConnectors", displayName: "Show connectors", value: true
    });
    connectorColor = new formattingSettings.ColorPicker({
        name: "connectorColor", displayName: "Connector color",
        value: { value: DEFAULT_CONNECTOR_COLOR }
    });
    connectorStyle = new formattingSettings.ItemDropdown({
        name: "connectorStyle", displayName: "Connector style",
        items: [
            { value: "solid",  displayName: "Solid" },
            { value: "dashed", displayName: "Dashed" }
        ],
        value: { value: "dashed", displayName: "Dashed" }
    });

    name: string = "connectors";
    displayName: string = "Connectors";
    slices: Array<FormattingSettingsSlice> = [
        this.showConnectors, this.connectorColor, this.connectorStyle
    ];
}

class LabelsCard extends FormattingSettingsCard {
    showValueLabels = new formattingSettings.ToggleSwitch({
        name: "showValueLabels", displayName: "Show value labels", value: true
    });
    labelPosition = new formattingSettings.ItemDropdown({
        name: "labelPosition", displayName: "Label position",
        items: [
            { value: "outside", displayName: "Outside" },
            { value: "inside",  displayName: "Inside" },
            { value: "auto",    displayName: "Auto" }
        ],
        value: { value: "auto", displayName: "Auto" }
    });
    showDeltaSign = new formattingSettings.ToggleSwitch({
        name: "showDeltaSign", displayName: "Show +/− prefix on deltas", value: true
    });
    showPercentOfStart = new formattingSettings.ToggleSwitch({
        name: "showPercentOfStart",
        displayName: "Show % of first anchor",
        description: "Secondary label under the primary: delta as % of the first anchor value.",
        value: false
    });
    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize", displayName: "Font size", value: 11
    });
    labelBold = new formattingSettings.ToggleSwitch({
        name: "labelBold", displayName: "Bold", value: false
    });
    labelItalic = new formattingSettings.ToggleSwitch({
        name: "labelItalic", displayName: "Italic", value: false
    });
    labelColor = new formattingSettings.ColorPicker({
        name: "labelColor", displayName: "Label color",
        description: "Applied to outside labels. Inside labels stay white for contrast against the bar fill.",
        value: { value: DEFAULT_LABEL_COLOR }
    });

    name: string = "labels";
    displayName: string = "Labels";
    slices: Array<FormattingSettingsSlice> = [
        this.showValueLabels, this.labelPosition, this.showDeltaSign, this.showPercentOfStart,
        this.fontSize, this.labelBold, this.labelItalic, this.labelColor
    ];
}

class AxisCard extends FormattingSettingsCard {
    showYAxis = new formattingSettings.ToggleSwitch({
        name: "showYAxis", displayName: "Show Y axis", value: true
    });
    showGridlines = new formattingSettings.ToggleSwitch({
        name: "showGridlines", displayName: "Show gridlines", value: true
    });
    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize", displayName: "Axis font size", value: 11
    });
    includeZero = new formattingSettings.ToggleSwitch({
        name: "includeZero", displayName: "Force axis to include zero",
        description: "Extends the auto Y domain to always include 0. Useful for currency/count bridges.",
        value: true
    });

    // Blank = auto. Pinning these lets several bridges share one scale.
    yMinOverride = new formattingSettings.NumUpDown({
        name: "yMinOverride", displayName: "Y min (blank = auto)",
        description: "Pins the bottom of the Y axis. Ignored unless it is below the Y max.",
        value: null
    });
    yMaxOverride = new formattingSettings.NumUpDown({
        name: "yMaxOverride", displayName: "Y max (blank = auto)",
        description: "Pins the top of the Y axis. Ignored unless it is above the Y min.",
        value: null
    });

    name: string = "axis";
    displayName: string = "Axis";
    slices: Array<FormattingSettingsSlice> = [
        this.showYAxis, this.showGridlines, this.fontSize, this.includeZero,
        this.yMinOverride, this.yMaxOverride
    ];
}

class LegendCard extends FormattingSettingsCard {
    showLegend = new formattingSettings.ToggleSwitch({
        name: "showLegend",
        displayName: "Show legend",
        description: "Displays the breakdown categories (only when a Breakdown field is bound).",
        value: true
    });
    legendPosition = new formattingSettings.ItemDropdown({
        name: "legendPosition", displayName: "Position",
        items: [
            { value: "top",    displayName: "Top" },
            { value: "right",  displayName: "Right" },
            { value: "bottom", displayName: "Bottom" },
            { value: "left",   displayName: "Left" }
        ],
        value: { value: "top", displayName: "Top" }
    });
    legendFontSize = new formattingSettings.NumUpDown({
        name: "legendFontSize", displayName: "Legend font size", value: 10
    });

    name: string = "legend";
    displayName: string = "Legend";
    slices: Array<FormattingSettingsSlice> = [this.showLegend, this.legendPosition, this.legendFontSize];
}

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "When another visual filters this chart, non-highlighted bars fade to this opacity.",
        value: 25
    });

    name: string = "interactions";
    displayName: string = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    structureCard    = new StructureCard();
    barsCard         = new BarsCard();
    connectorsCard   = new ConnectorsCard();
    labelsCard       = new LabelsCard();
    axisCard         = new AxisCard();
    legendCard       = new LegendCard();
    interactionsCard = new InteractionsCard();
    cards = [
        this.structureCard, this.barsCard, this.connectorsCard, this.labelsCard,
        this.axisCard, this.legendCard, this.interactionsCard
    ];
}

