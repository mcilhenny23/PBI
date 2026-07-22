"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Aggregation — how sequences are merged and trimmed.
 */
class AggregationCard extends FormattingSettingsCard {
    minBundleSupport = new formattingSettings.NumUpDown({
        name: "minBundleSupport",
        displayName: "Min bundle support",
        description: "Branches carrying fewer cases than this are dropped. Rare one-off paths are most of the distinct behaviour and fray the diagram into noise.",
        value: 5
    });

    maxDepth = new formattingSettings.NumUpDown({
        name: "maxDepth",
        displayName: "Max sequence depth",
        description: "How many events into each case to follow",
        value: 10
    });

    alignmentAnchor = new formattingSettings.ItemDropdown({
        name: "alignmentAnchor",
        displayName: "Align on",
        description: "Selected event splits the diagram: what led up to it grows left, what followed grows right",
        items: [
            { value: "first-event", displayName: "First event" },
            { value: "last-event", displayName: "Last event" },
            { value: "selected", displayName: "Selected event" }
        ],
        value: { value: "first-event", displayName: "First event" }
    });

    anchorEvent = new formattingSettings.TextInput({
        name: "anchorEvent",
        displayName: "Anchor event",
        description: "Event name to align on, when Align on = Selected event",
        value: "",
        placeholder: "e.g. Diagnosis"
    });

    name: string = "aggregation";
    displayName: string = "Aggregation";
    slices: Array<FormattingSettingsSlice> = [
        this.minBundleSupport,
        this.maxDepth,
        this.alignmentAnchor,
        this.anchorEvent
    ];
}

/**
 * Appearance.
 */
class AppearanceCard extends FormattingSettingsCard {
    bundleOpacity = new formattingSettings.NumUpDown({
        name: "bundleOpacity",
        displayName: "Bundle opacity (%)",
        value: 60
    });

    minBandWidth = new formattingSettings.NumUpDown({
        name: "minBandWidth",
        displayName: "Min band thickness",
        description: "Floor so a thin bundle stays visible",
        value: 2
    });

    maxBandWidth = new formattingSettings.NumUpDown({
        name: "maxBandWidth",
        displayName: "Block width",
        description: "Width of each event block",
        value: 40
    });

    showCaseCounts = new formattingSettings.ToggleSwitch({
        name: "showCaseCounts",
        displayName: "Show case counts",
        value: true
    });

    colorBy = new formattingSettings.ItemDropdown({
        name: "colorBy",
        displayName: "Color by",
        items: [
            { value: "event-type", displayName: "Event type" },
            { value: "event-category", displayName: "Event category" },
            { value: "uniform", displayName: "Uniform" }
        ],
        value: { value: "event-type", displayName: "Event type" }
    });

    name: string = "appearance";
    displayName: string = "Appearance";
    slices: Array<FormattingSettingsSlice> = [
        this.bundleOpacity,
        this.minBandWidth,
        this.maxBandWidth,
        this.showCaseCounts,
        this.colorBy
    ];
}

/**
 * Layout.
 */
class LayoutCard extends FormattingSettingsCard {
    orientation = new formattingSettings.ItemDropdown({
        name: "orientation",
        displayName: "Orientation",
        items: [
            { value: "horizontal", displayName: "Horizontal" },
            { value: "vertical", displayName: "Vertical" }
        ],
        value: { value: "horizontal", displayName: "Horizontal" }
    });

    gapBetweenSteps = new formattingSettings.NumUpDown({
        name: "gapBetweenSteps",
        displayName: "Gap between steps",
        value: 60
    });

    timeScaledColumns = new formattingSettings.ToggleSwitch({
        name: "timeScaledColumns",
        displayName: "Time-scaled columns",
        description: "Position each column by the median elapsed time from the anchor, so a slow step reads as wide and a fast one narrow. Requires the Timestamp field. Falls back to equal-width columns silently when timestamps aren't usable.",
        value: false
    });

    showTimeAxis = new formattingSettings.ToggleSwitch({
        name: "showTimeAxis",
        displayName: "Show time axis (scaled mode)",
        description: "Prints an elapsed-time axis at the bottom when time-scaled columns are on.",
        value: true
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Font size",
        value: 11
    });

    name: string = "layout";
    displayName: string = "Layout";
    slices: Array<FormattingSettingsSlice> = [
        this.orientation,
        this.gapBetweenSteps,
        this.timeScaledColumns,
        this.showTimeAxis,
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
    aggregationCard = new AggregationCard();
    appearanceCard = new AppearanceCard();
    layoutCard = new LayoutCard();
    interactionsCard = new InteractionsCard();
    cards = [this.aggregationCard, this.appearanceCard, this.layoutCard, this.interactionsCard];
}
