"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

export const DEFAULT_NODE_COLOR   = "#4472C4";
export const DEFAULT_BORDER_COLOR = "#333333";
export const DEFAULT_CYCLE_COLOR  = "#d62728";

class LayoutCard extends FormattingSettingsCard {
    nodeWidth = new formattingSettings.NumUpDown({ name: "nodeWidth", displayName: "Node width", value: 18 });
    nodePadding = new formattingSettings.NumUpDown({ name: "nodePadding", displayName: "Node vertical padding", value: 12 });
    iterations = new formattingSettings.NumUpDown({ name: "iterations", displayName: "Relaxation iterations", value: 32 });
    nodeAlignment = new formattingSettings.ItemDropdown({
        name: "nodeAlignment", displayName: "Node alignment",
        items: [
            { value: "justify", displayName: "Justify" },
            { value: "left",    displayName: "Left" },
            { value: "right",   displayName: "Right" },
            { value: "center",  displayName: "Center" }
        ],
        value: { value: "justify", displayName: "Justify" }
    });
    enableDragReorder = new formattingSettings.ToggleSwitch({
        name: "enableDragReorder", displayName: "Enable drag-to-reorder", value: true
    });

    name = "layout";
    displayName = "Layout";
    slices: Array<FormattingSettingsSlice> = [this.nodeWidth, this.nodePadding, this.iterations, this.nodeAlignment, this.enableDragReorder];
}

class CyclesCard extends FormattingSettingsCard {
    cycleHandling = new formattingSettings.ItemDropdown({
        name: "cycleHandling", displayName: "Cycle handling",
        items: [
            { value: "route-back",     displayName: "Route back (arc)" },
            { value: "duplicate-node", displayName: "Duplicate node" },
            { value: "drop",           displayName: "Drop cycle edges" }
        ],
        value: { value: "route-back", displayName: "Route back (arc)" }
    });
    cycleLinkColor = new formattingSettings.ColorPicker({
        name: "cycleLinkColor", displayName: "Cycle link color",
        value: { value: DEFAULT_CYCLE_COLOR }
    });

    name = "cycles";
    displayName = "Cycles";
    slices: Array<FormattingSettingsSlice> = [this.cycleHandling, this.cycleLinkColor];
}

class NodesCard extends FormattingSettingsCard {
    nodeColorMode = new formattingSettings.ItemDropdown({
        name: "nodeColorMode", displayName: "Node color mode",
        items: [
            { value: "palette",  displayName: "Palette (per node)" },
            { value: "single",   displayName: "Single color" },
            { value: "by-level", displayName: "By level" }
        ],
        value: { value: "palette", displayName: "Palette (per node)" }
    });
    nodeColor = new formattingSettings.ColorPicker({
        name: "nodeColor", displayName: "Node color (single mode)",
        value: { value: DEFAULT_NODE_COLOR }
    });
    nodeBorderColor = new formattingSettings.ColorPicker({
        name: "nodeBorderColor", displayName: "Node border color",
        value: { value: DEFAULT_BORDER_COLOR }
    });
    nodeBorderWidth = new formattingSettings.NumUpDown({
        name: "nodeBorderWidth", displayName: "Node border width", value: 0
    });

    name = "nodes";
    displayName = "Nodes";
    slices: Array<FormattingSettingsSlice> = [this.nodeColorMode, this.nodeColor, this.nodeBorderColor, this.nodeBorderWidth];
}

class LinksCard extends FormattingSettingsCard {
    linkOpacity = new formattingSettings.NumUpDown({
        name: "linkOpacity", displayName: "Link opacity (%)", value: 40
    });
    linkColorMode = new formattingSettings.ItemDropdown({
        name: "linkColorMode", displayName: "Link color mode",
        items: [
            { value: "source",   displayName: "Match source" },
            { value: "target",   displayName: "Match target" },
            { value: "gradient", displayName: "Source → target gradient" },
            { value: "category", displayName: "By link category" }
        ],
        value: { value: "gradient", displayName: "Source → target gradient" }
    });
    hoverHighlight = new formattingSettings.ToggleSwitch({
        name: "hoverHighlight", displayName: "Hover highlights connected", value: true
    });

    name = "links";
    displayName = "Links";
    slices: Array<FormattingSettingsSlice> = [this.linkOpacity, this.linkColorMode, this.hoverHighlight];
}

class LabelsCard extends FormattingSettingsCard {
    labelPosition = new formattingSettings.ItemDropdown({
        name: "labelPosition", displayName: "Label position",
        items: [
            { value: "auto",    displayName: "Auto" },
            { value: "inside",  displayName: "Inside" },
            { value: "outside", displayName: "Outside" }
        ],
        value: { value: "auto", displayName: "Auto" }
    });
    showValues = new formattingSettings.ToggleSwitch({
        name: "showValues", displayName: "Append value to label", value: true
    });
    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize", displayName: "Font size", value: 11
    });
    maxLabelLength = new formattingSettings.NumUpDown({
        name: "maxLabelLength", displayName: "Max label chars (truncate)", value: 24
    });

    name = "labels";
    displayName = "Labels";
    slices: Array<FormattingSettingsSlice> = [this.labelPosition, this.showValues, this.fontSize, this.maxLabelLength];
}

/**
 * Hidden object — stores the user's dragged node order so it survives reload.
 * Not surfaced as a card in the format pane.
 */
class NodeOrderCard extends FormattingSettingsCard {
    order = new formattingSettings.TextInput({
        name: "order", displayName: "Node order", placeholder: "",
        value: ""
    });

    name = "nodeOrder";
    displayName = "Node order (persisted)";
    slices: Array<FormattingSettingsSlice> = [this.order];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    layoutCard = new LayoutCard();
    cyclesCard = new CyclesCard();
    nodesCard  = new NodesCard();
    linksCard  = new LinksCard();
    labelsCard = new LabelsCard();
    nodeOrderCard = new NodeOrderCard();
    cards = [this.layoutCard, this.cyclesCard, this.nodesCard, this.linksCard, this.labelsCard, this.nodeOrderCard];
}
