"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

export const DEFAULT_BAR_COLOR   = "#4472C4";
export const DEFAULT_ABOVE_COLOR = "#2ca02c";
export const DEFAULT_BELOW_COLOR = "#d62728";

class NodesCard extends FormattingSettingsCard {
    barColorMode = new formattingSettings.ItemDropdown({
        name: "barColorMode", displayName: "Bar color mode",
        items: [
            { value: "single",      displayName: "Single color" },
            { value: "conditional", displayName: "Conditional vs threshold" }
        ],
        value: { value: "single", displayName: "Single color" }
    });
    barColor = new formattingSettings.ColorPicker({
        name: "barColor", displayName: "Bar color", value: { value: DEFAULT_BAR_COLOR }
    });
    thresholdValue = new formattingSettings.NumUpDown({
        name: "thresholdValue", displayName: "Threshold value",
        description: "Nodes ≥ threshold use Above color; below use Below color.",
        value: 0
    });
    aboveColor = new formattingSettings.ColorPicker({
        name: "aboveColor", displayName: "Above threshold color", value: { value: DEFAULT_ABOVE_COLOR }
    });
    belowColor = new formattingSettings.ColorPicker({
        name: "belowColor", displayName: "Below threshold color", value: { value: DEFAULT_BELOW_COLOR }
    });
    showSecondary = new formattingSettings.ToggleSwitch({
        name: "showSecondary", displayName: "Show secondary value", value: true
    });
    secondaryMode = new formattingSettings.ItemDropdown({
        name: "secondaryMode", displayName: "Secondary source",
        items: [
            { value: "measure",   displayName: "Bound Secondary measure" },
            { value: "pct-parent","displayName": "% of parent" },
            { value: "pct-total", displayName: "% of total" }
        ],
        value: { value: "pct-parent", displayName: "% of parent" }
    });
    barHeight = new formattingSettings.NumUpDown({ name: "barHeight", displayName: "Node height (px)", value: 28 });
    fontSize = new formattingSettings.NumUpDown({ name: "fontSize", displayName: "Font size", value: 11 });
    maxNodesPerLevel = new formattingSettings.NumUpDown({
        name: "maxNodesPerLevel", displayName: "Max nodes per level (rest → Other)", value: 10
    });

    name = "nodes";
    displayName = "Nodes";
    slices: Array<FormattingSettingsSlice> = [
        this.barColorMode, this.barColor, this.thresholdValue, this.aboveColor, this.belowColor,
        this.showSecondary, this.secondaryMode, this.barHeight, this.fontSize, this.maxNodesPerLevel
    ];
}

class SortingCard extends FormattingSettingsCard {
    sortMode = new formattingSettings.ItemDropdown({
        name: "sortMode", displayName: "Sort mode",
        items: [
            { value: "value-desc",       displayName: "Value descending" },
            { value: "value-asc",        displayName: "Value ascending" },
            { value: "alphabetical",     displayName: "Alphabetical" },
            { value: "custom-per-level", displayName: "Custom per level (text below)" }
        ],
        value: { value: "value-desc", displayName: "Value descending" }
    });
    customOrder = new formattingSettings.TextInput({
        name: "customOrder", displayName: "Custom order per level",
        description: "For 'Custom per level' mode. Format: 'LevelName: item1, item2, item3; OtherLevel: a, b, c'",
        placeholder: "Region: North, South, East, West",
        value: ""
    });

    name = "sorting";
    displayName = "Sorting";
    slices: Array<FormattingSettingsSlice> = [this.sortMode, this.customOrder];
}

class ExpansionCard extends FormattingSettingsCard {
    defaultExpansion = new formattingSettings.TextInput({
        name: "defaultExpansion", displayName: "Default expansion path",
        description: "Auto-expanded on load. Format: 'LevelA:ValueA>LevelB:ValueB'.",
        placeholder: "Region:West>Product:Widgets",
        value: ""
    });
    connectorStyle = new formattingSettings.ItemDropdown({
        name: "connectorStyle", displayName: "Connector style",
        items: [
            { value: "curved",     displayName: "Curved" },
            { value: "orthogonal", displayName: "Orthogonal" }
        ],
        value: { value: "curved", displayName: "Curved" }
    });

    name = "expansion";
    displayName = "Expansion";
    slices: Array<FormattingSettingsSlice> = [this.defaultExpansion, this.connectorStyle];
}

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "Sibling nodes fade to this opacity when a node is selected or when another visual filters this chart.",
        value: 30
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    nodesCard = new NodesCard();
    sortingCard = new SortingCard();
    expansionCard = new ExpansionCard();
    interactionsCard = new InteractionsCard();
    cards = [this.nodesCard, this.sortingCard, this.expansionCard, this.interactionsCard];
}
