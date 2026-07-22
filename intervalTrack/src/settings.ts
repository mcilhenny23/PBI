"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Tracks — lane geometry and how overlapping intervals are packed.
 */
class TracksCard extends FormattingSettingsCard {
    trackHeight = new formattingSettings.NumUpDown({
        name: "trackHeight",
        displayName: "Lane height",
        description: "Pixel height of each sub-lane within a track",
        value: 24
    });

    trackGap = new formattingSettings.NumUpDown({
        name: "trackGap",
        displayName: "Track gap",
        value: 8
    });

    trackLabelWidth = new formattingSettings.NumUpDown({
        name: "trackLabelWidth",
        displayName: "Track label width",
        value: 100
    });

    trackLabelFontSize = new formattingSettings.NumUpDown({
        name: "trackLabelFontSize",
        displayName: "Track label font size",
        value: 12
    });

    packingMode = new formattingSettings.ItemDropdown({
        name: "packingMode",
        displayName: "Packing",
        description: "Stack packs overlapping intervals into collision-free lanes",
        items: [
            { value: "stack", displayName: "Stack (collision-free lanes)" },
            { value: "overlap", displayName: "Overlap (single row)" },
            { value: "collapse", displayName: "Collapse (single row, clipped)" }
        ],
        value: { value: "stack", displayName: "Stack (collision-free lanes)" }
    });

    name: string = "tracks";
    displayName: string = "Tracks";
    slices: Array<FormattingSettingsSlice> = [
        this.trackHeight,
        this.trackGap,
        this.trackLabelWidth,
        this.trackLabelFontSize,
        this.packingMode
    ];
}

/**
 * Intervals — bar appearance, labels and point-event markers.
 */
class IntervalsCard extends FormattingSettingsCard {
    intervalHeight = new formattingSettings.NumUpDown({
        name: "intervalHeight",
        displayName: "Bar height",
        value: 18
    });

    intervalRadius = new formattingSettings.NumUpDown({
        name: "intervalRadius",
        displayName: "Corner radius",
        value: 3
    });

    intervalOpacity = new formattingSettings.NumUpDown({
        name: "intervalOpacity",
        displayName: "Bar opacity (%)",
        value: 85
    });

    showLabels = new formattingSettings.ToggleSwitch({
        name: "showLabels",
        displayName: "Show labels",
        description: "Text inside intervals that are wide enough to fit it",
        value: true
    });

    labelFontSize = new formattingSettings.NumUpDown({
        name: "labelFontSize",
        displayName: "Label font size",
        value: 10
    });

    pointEventRadius = new formattingSettings.NumUpDown({
        name: "pointEventRadius",
        displayName: "Point event radius",
        description: "Marker size for rows with no End value",
        value: 4
    });

    name: string = "intervals";
    displayName: string = "Intervals";
    slices: Array<FormattingSettingsSlice> = [
        this.intervalHeight,
        this.intervalRadius,
        this.intervalOpacity,
        this.showLabels,
        this.labelFontSize,
        this.pointEventRadius
    ];
}

/**
 * Axis & Zoom.
 */
class AxisCard extends FormattingSettingsCard {
    showAxis = new formattingSettings.ToggleSwitch({
        name: "showAxis",
        displayName: "Show axis",
        value: true
    });

    axisFontSize = new formattingSettings.NumUpDown({
        name: "axisFontSize",
        displayName: "Axis font size",
        value: 11
    });

    enableZoom = new formattingSettings.ToggleSwitch({
        name: "enableZoom",
        displayName: "Enable zoom & pan",
        description: "Mouse wheel zooms the time axis; drag pans",
        value: true
    });

    name: string = "axis";
    displayName: string = "Axis & Zoom";
    slices: Array<FormattingSettingsSlice> = [
        this.showAxis,
        this.axisFontSize,
        this.enableZoom
    ];
}

/**
 * Density — per-lane utilisation statistics computed over the visible window.
 * Turns a picture into a set of numbers: how much of the time each track was
 * covered by intervals, how many events landed, and how long they typically
 * ran. Reactive to zoom, so scoping a window updates the stats live.
 */
class DensityCard extends FormattingSettingsCard {
    showDensity = new formattingSettings.ToggleSwitch({
        name: "showDensity",
        displayName: "Show per-lane density",
        description: "Adds a stats column on the right of each track showing coverage %, event count and mean duration for the visible time window.",
        value: false
    });

    densityWidth = new formattingSettings.NumUpDown({
        name: "densityWidth",
        displayName: "Stats column width (px)",
        value: 120
    });

    showConcurrency = new formattingSettings.ToggleSwitch({
        name: "showConcurrency",
        displayName: "Show concurrency ribbon",
        description: "Adds a strip along the top plotting the number of overlapping intervals across all tracks at each point in time — a fast read on resource contention.",
        value: false
    });

    concurrencyHeight = new formattingSettings.NumUpDown({
        name: "concurrencyHeight",
        displayName: "Concurrency ribbon height (px)",
        value: 28
    });

    concurrencyColor = new formattingSettings.ColorPicker({
        name: "concurrencyColor",
        displayName: "Concurrency color",
        value: { value: "#4682B4" }
    });

    name: string = "density";
    displayName: string = "Density";
    slices: Array<FormattingSettingsSlice> = [
        this.showDensity,
        this.densityWidth,
        this.showConcurrency,
        this.concurrencyHeight,
        this.concurrencyColor
    ];
}

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "When another visual filters this chart, non-highlighted intervals fade to this opacity.",
        value: 25
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    tracksCard = new TracksCard();
    intervalsCard = new IntervalsCard();
    densityCard = new DensityCard();
    axisCard = new AxisCard();
    interactionsCard = new InteractionsCard();
    cards = [this.tracksCard, this.intervalsCard, this.densityCard, this.axisCard, this.interactionsCard];
}
