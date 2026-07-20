"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * DFG — what the map measures and how it's laid out.
 */
class DfgCard extends FormattingSettingsCard {
    edgeMetric = new formattingSettings.ItemDropdown({
        name: "edgeMetric",
        displayName: "Edge metric",
        description: "What edge thickness represents",
        items: [
            { value: "frequency", displayName: "Frequency" },
            { value: "mean-duration", displayName: "Mean duration" },
            { value: "total-value", displayName: "Total value" }
        ],
        value: { value: "frequency", displayName: "Frequency" }
    });

    frequencyThreshold = new formattingSettings.NumUpDown({
        name: "frequencyThreshold",
        displayName: "Min edge frequency",
        description: "Prune rare transitions — the fastest way to simplify a spaghetti map",
        value: 0
    });

    layoutDirection = new formattingSettings.ItemDropdown({
        name: "layoutDirection",
        displayName: "Layout direction",
        items: [
            { value: "LR", displayName: "Left to right" },
            { value: "TB", displayName: "Top to bottom" }
        ],
        value: { value: "LR", displayName: "Left to right" }
    });

    showLoops = new formattingSettings.ToggleSwitch({
        name: "showLoops",
        displayName: "Show self-loops",
        description: "Activity repeating immediately (rework)",
        value: true
    });

    name: string = "dfg";
    displayName: string = "Process Map";
    slices: Array<FormattingSettingsSlice> = [
        this.edgeMetric,
        this.frequencyThreshold,
        this.layoutDirection,
        this.showLoops
    ];
}

/**
 * Variant Explorer — the ranked path list beside the map.
 */
class VariantsCard extends FormattingSettingsCard {
    showVariants = new formattingSettings.ToggleSwitch({
        name: "showVariants",
        displayName: "Show variant panel",
        value: true
    });

    variantCount = new formattingSettings.NumUpDown({
        name: "variantCount",
        displayName: "Variants to list",
        value: 10
    });

    variantPanelWidth = new formattingSettings.NumUpDown({
        name: "variantPanelWidth",
        displayName: "Panel width (%)",
        value: 30
    });

    name: string = "variants";
    displayName: string = "Variant Explorer";
    slices: Array<FormattingSettingsSlice> = [
        this.showVariants,
        this.variantCount,
        this.variantPanelWidth
    ];
}

/**
 * Node Appearance.
 */
class NodesCard extends FormattingSettingsCard {
    nodeColor = new formattingSettings.ColorPicker({
        name: "nodeColor",
        displayName: "Node color",
        value: { value: "#4682B4" }
    });

    nodeMinWidth = new formattingSettings.NumUpDown({
        name: "nodeMinWidth",
        displayName: "Min node width",
        value: 80
    });

    nodeFontSize = new formattingSettings.NumUpDown({
        name: "nodeFontSize",
        displayName: "Node font size",
        value: 12
    });

    showFrequencyLabel = new formattingSettings.ToggleSwitch({
        name: "showFrequencyLabel",
        displayName: "Show frequency in node",
        value: true
    });

    name: string = "nodes";
    displayName: string = "Node Appearance";
    slices: Array<FormattingSettingsSlice> = [
        this.nodeColor,
        this.nodeMinWidth,
        this.nodeFontSize,
        this.showFrequencyLabel
    ];
}

/**
 * Edge Appearance.
 */
class EdgesCard extends FormattingSettingsCard {
    edgeColor = new formattingSettings.ColorPicker({
        name: "edgeColor",
        displayName: "Edge color",
        value: { value: "#999999" }
    });

    edgeMinWidth = new formattingSettings.NumUpDown({
        name: "edgeMinWidth",
        displayName: "Min edge width",
        value: 1
    });

    edgeMaxWidth = new formattingSettings.NumUpDown({
        name: "edgeMaxWidth",
        displayName: "Max edge width",
        value: 8
    });

    showEdgeLabel = new formattingSettings.ToggleSwitch({
        name: "showEdgeLabel",
        displayName: "Show edge labels",
        value: true
    });

    name: string = "edges";
    displayName: string = "Edge Appearance";
    slices: Array<FormattingSettingsSlice> = [
        this.edgeColor,
        this.edgeMinWidth,
        this.edgeMaxWidth,
        this.showEdgeLabel
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    dfgCard = new DfgCard();
    variantsCard = new VariantsCard();
    nodesCard = new NodesCard();
    edgesCard = new EdgesCard();
    cards = [this.dfgCard, this.variantsCard, this.nodesCard, this.edgesCard];
}
