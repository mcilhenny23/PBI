"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Animation — frame rate, number of pre-drawn frames, hover pause, and trails.
 */
class AnimationCard extends FormattingSettingsCard {
    frameRate = new formattingSettings.NumUpDown({
        name: "frameRate",
        displayName: "Frame rate (fps)",
        description: "Outcomes shown per second (1–15)",
        value: 4
    });

    frameCount = new formattingSettings.NumUpDown({
        name: "frameCount",
        displayName: "Frame count",
        description: "Number of pre-drawn outcome frames in the loop",
        value: 50
    });

    pauseOnHover = new formattingSettings.ToggleSwitch({
        name: "pauseOnHover",
        displayName: "Pause on hover",
        value: true
    });

    showTrail = new formattingSettings.ToggleSwitch({
        name: "showTrail",
        displayName: "Show trail",
        description: "Ghost the previous few frames at low opacity",
        value: false
    });

    trailCount = new formattingSettings.NumUpDown({
        name: "trailCount",
        displayName: "Trail length",
        value: 3
    });

    trailOpacity = new formattingSettings.NumUpDown({
        name: "trailOpacity",
        displayName: "Trail opacity (%)",
        value: 15
    });

    name: string = "animation";
    displayName: string = "Animation";
    slices: Array<FormattingSettingsSlice> = [
        this.frameRate,
        this.frameCount,
        this.pauseOnHover,
        this.showTrail,
        this.trailCount,
        this.trailOpacity
    ];
}

/**
 * Lines — outcome and actuals styling, plus curve interpolation.
 */
class LinesCard extends FormattingSettingsCard {
    outcomeColor = new formattingSettings.ColorPicker({
        name: "outcomeColor",
        displayName: "Outcome color",
        value: { value: "#4682B4" }
    });

    outcomeWidth = new formattingSettings.NumUpDown({
        name: "outcomeWidth",
        displayName: "Outcome width",
        value: 2
    });

    actualsColor = new formattingSettings.ColorPicker({
        name: "actualsColor",
        displayName: "Actuals color",
        value: { value: "#333333" }
    });

    actualsWidth = new formattingSettings.NumUpDown({
        name: "actualsWidth",
        displayName: "Actuals width",
        value: 2.5
    });

    curveType = new formattingSettings.ItemDropdown({
        name: "curveType",
        displayName: "Curve interpolation",
        items: [
            { value: "linear", displayName: "Linear" },
            { value: "monotone", displayName: "Smooth (monotone)" },
            { value: "basis", displayName: "Smooth (basis)" },
            { value: "step", displayName: "Step" }
        ],
        value: { value: "monotone", displayName: "Smooth (monotone)" }
    });

    name: string = "lines";
    displayName: string = "Lines";
    slices: Array<FormattingSettingsSlice> = [
        this.outcomeColor,
        this.outcomeWidth,
        this.actualsColor,
        this.actualsWidth,
        this.curveType
    ];
}

/**
 * Axes — same controls as the Fan Chart.
 */
class AxesCard extends FormattingSettingsCard {
    showXAxis = new formattingSettings.ToggleSwitch({
        name: "showXAxis",
        displayName: "Show X axis",
        value: true
    });

    showYAxis = new formattingSettings.ToggleSwitch({
        name: "showYAxis",
        displayName: "Show Y axis",
        value: true
    });

    showGridlines = new formattingSettings.ToggleSwitch({
        name: "showGridlines",
        displayName: "Show gridlines",
        value: true
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Axis font size",
        value: 11
    });

    name: string = "axes";
    displayName: string = "Axes";
    slices: Array<FormattingSettingsSlice> = [
        this.showXAxis,
        this.showYAxis,
        this.showGridlines,
        this.fontSize
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    animationCard = new AnimationCard();
    linesCard = new LinesCard();
    axesCard = new AxesCard();
    cards = [this.animationCard, this.linesCard, this.axesCard];
}
