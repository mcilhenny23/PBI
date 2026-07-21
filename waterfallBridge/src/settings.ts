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

    name: string = "bars";
    displayName: string = "Bars";
    slices: Array<FormattingSettingsSlice> = [
        this.increaseColor, this.decreaseColor, this.anchorColor, this.subtotalColor, this.barPadding
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

    name: string = "labels";
    displayName: string = "Labels";
    slices: Array<FormattingSettingsSlice> = [
        this.showValueLabels, this.labelPosition, this.showDeltaSign, this.showPercentOfStart, this.fontSize
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

    name: string = "axis";
    displayName: string = "Axis";
    slices: Array<FormattingSettingsSlice> = [
        this.showYAxis, this.showGridlines, this.fontSize
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    structureCard   = new StructureCard();
    barsCard        = new BarsCard();
    connectorsCard  = new ConnectorsCard();
    labelsCard      = new LabelsCard();
    axisCard        = new AxisCard();
    cards = [this.structureCard, this.barsCard, this.connectorsCard, this.labelsCard, this.axisCard];
}
