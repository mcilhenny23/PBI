"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Layout — spacing and how entities are ordered within each time slice.
 */
class LayoutCard extends FormattingSettingsCard {
    flowMode = new formattingSettings.ItemDropdown({
        name: "flowMode",
        displayName: "Flow mode",
        description: "Entity draws one line per person — best for narratives with a small cast. Aggregate draws one thick band per group with ribbons for transitions between them — best when the entity count is too high to read line by line.",
        items: [
            { value: "entity", displayName: "Entity (one line per person)" },
            { value: "aggregate", displayName: "Aggregate (Sankey ribbons)" }
        ],
        value: { value: "entity", displayName: "Entity (one line per person)" }
    });

    unitHeight = new formattingSettings.NumUpDown({
        name: "unitHeight",
        displayName: "Pixels per entity (aggregate)",
        description: "Aggregate mode only. Height of one entity's contribution to a group band; scale down for large populations.",
        value: 4
    });

    lineTension = new formattingSettings.NumUpDown({
        name: "lineTension",
        displayName: "Line tension",
        description: "0 = angular joins, 100 = very smooth weaving",
        value: 50
    });

    groupGap = new formattingSettings.NumUpDown({
        name: "groupGap",
        displayName: "Group gap",
        description: "Vertical gap between group bands",
        value: 20
    });

    entityGap = new formattingSettings.NumUpDown({
        name: "entityGap",
        displayName: "Entity gap",
        description: "Vertical gap between entities inside a group",
        value: 4
    });

    orderingStrategy = new formattingSettings.ItemDropdown({
        name: "orderingStrategy",
        displayName: "Ordering",
        description: "Minimize crossings runs a barycentre sweep so lines cross as little as possible",
        items: [
            { value: "minimize-crossings", displayName: "Minimize crossings" },
            { value: "alphabetical", displayName: "Alphabetical" },
            { value: "group-size", displayName: "Group size" }
        ],
        value: { value: "minimize-crossings", displayName: "Minimize crossings" }
    });

    name: string = "layout";
    displayName: string = "Layout";
    slices: Array<FormattingSettingsSlice> = [
        this.flowMode,
        this.unitHeight,
        this.lineTension,
        this.groupGap,
        this.entityGap,
        this.orderingStrategy
    ];
}

/**
 * Appearance — line styling and the hover-focus behaviour.
 */
class AppearanceCard extends FormattingSettingsCard {
    lineWidth = new formattingSettings.NumUpDown({
        name: "lineWidth",
        displayName: "Line width",
        value: 2
    });

    lineOpacity = new formattingSettings.NumUpDown({
        name: "lineOpacity",
        displayName: "Line opacity (%)",
        value: 70
    });

    highlightOnHover = new formattingSettings.ToggleSwitch({
        name: "highlightOnHover",
        displayName: "Highlight on hover",
        description: "Hovering one entity dims every other trajectory",
        value: true
    });

    highlightOpacity = new formattingSettings.NumUpDown({
        name: "highlightOpacity",
        displayName: "Highlight opacity (%)",
        value: 100
    });

    dimOpacity = new formattingSettings.NumUpDown({
        name: "dimOpacity",
        displayName: "Dim opacity (%)",
        value: 15
    });

    colorBy = new formattingSettings.ItemDropdown({
        name: "colorBy",
        displayName: "Color by",
        description: "Entity gives each line its own color; Group recolors a line as it moves",
        items: [
            { value: "entity", displayName: "Entity" },
            { value: "group", displayName: "Group" }
        ],
        value: { value: "entity", displayName: "Entity" }
    });

    name: string = "appearance";
    displayName: string = "Appearance";
    slices: Array<FormattingSettingsSlice> = [
        this.lineWidth,
        this.lineOpacity,
        this.highlightOnHover,
        this.highlightOpacity,
        this.dimOpacity,
        this.colorBy
    ];
}

/**
 * Labels.
 */
class LabelsCard extends FormattingSettingsCard {
    showEntityLabels = new formattingSettings.ToggleSwitch({
        name: "showEntityLabels",
        displayName: "Show entity labels",
        description: "At each line's last time step",
        value: true
    });

    showGroupLabels = new formattingSettings.ToggleSwitch({
        name: "showGroupLabels",
        displayName: "Show group labels",
        value: true
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Font size",
        value: 11
    });

    name: string = "labels";
    displayName: string = "Labels";
    slices: Array<FormattingSettingsSlice> = [
        this.showEntityLabels,
        this.showGroupLabels,
        this.fontSize
    ];
}

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "The plot dims when another visual filters the chart.",
        value: 30
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    layoutCard = new LayoutCard();
    appearanceCard = new AppearanceCard();
    labelsCard = new LabelsCard();
    interactionsCard = new InteractionsCard();
    cards = [this.layoutCard, this.appearanceCard, this.labelsCard, this.interactionsCard];
}
