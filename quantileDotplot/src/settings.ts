"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Dotplot — number of dots, marker appearance and orientation.
 */
class DotplotCard extends FormattingSettingsCard {
    dotCount = new formattingSettings.NumUpDown({
        name: "dotCount",
        displayName: "Dot count",
        description: "Number of dots = number of quantiles. Common values: 20, 50, 100.",
        value: 20
    });

    dotRadius = new formattingSettings.NumUpDown({
        name: "dotRadius",
        displayName: "Dot radius",
        value: 6
    });

    dotColor = new formattingSettings.ColorPicker({
        name: "dotColor",
        displayName: "Dot color",
        value: { value: "#4682B4" }
    });

    dotOpacity = new formattingSettings.NumUpDown({
        name: "dotOpacity",
        displayName: "Dot opacity (%)",
        value: 85
    });

    orientation = new formattingSettings.ItemDropdown({
        name: "orientation",
        displayName: "Orientation",
        items: [
            { value: "horizontal", displayName: "Horizontal" },
            { value: "vertical", displayName: "Vertical" }
        ],
        value: { value: "horizontal", displayName: "Horizontal" }
    });

    name: string = "dotplot";
    displayName: string = "Dotplot";
    slices: Array<FormattingSettingsSlice> = [
        this.dotCount,
        this.dotRadius,
        this.dotColor,
        this.dotOpacity,
        this.orientation
    ];
}

/**
 * Threshold — reference line and "X of Y below" annotation.
 */
class ThresholdCard extends FormattingSettingsCard {
    showThreshold = new formattingSettings.ToggleSwitch({
        name: "showThreshold",
        displayName: "Show threshold",
        value: false
    });

    thresholdValue = new formattingSettings.NumUpDown({
        name: "thresholdValue",
        displayName: "Threshold value",
        value: 0
    });

    thresholdColor = new formattingSettings.ColorPicker({
        name: "thresholdColor",
        displayName: "Threshold color",
        value: { value: "#E74C3C" }
    });

    showCountAnnotation = new formattingSettings.ToggleSwitch({
        name: "showCountAnnotation",
        displayName: "Show count annotation",
        description: "Shows \"X of Y dots below threshold\"",
        value: true
    });

    name: string = "threshold";
    displayName: string = "Threshold";
    slices: Array<FormattingSettingsSlice> = [
        this.showThreshold,
        this.thresholdValue,
        this.thresholdColor,
        this.showCountAnnotation
    ];
}

/**
 * Axis — value axis visibility and font size.
 */
class AxisCard extends FormattingSettingsCard {
    showAxis = new formattingSettings.ToggleSwitch({
        name: "showAxis",
        displayName: "Show axis",
        value: true
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Font size",
        value: 11
    });

    name: string = "axis";
    displayName: string = "Axis";
    slices: Array<FormattingSettingsSlice> = [
        this.showAxis,
        this.fontSize
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    dotplotCard = new DotplotCard();
    thresholdCard = new ThresholdCard();
    axisCard = new AxisCard();
    cards = [this.dotplotCard, this.thresholdCard, this.axisCard];
}
