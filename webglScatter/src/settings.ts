"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

class ModeCard extends FormattingSettingsCard {
    renderMode = new formattingSettings.ItemDropdown({
        name: "renderMode", displayName: "Render mode",
        items: [
            { value: "auto",    displayName: "Auto (points ↔ density)" },
            { value: "points",  displayName: "Points" },
            { value: "density", displayName: "Density" },
            { value: "hexbin",  displayName: "Hexbin" }
        ],
        value: { value: "auto", displayName: "Auto (points ↔ density)" }
    });
    autoThreshold = new formattingSettings.NumUpDown({
        name: "autoThreshold", displayName: "Auto threshold (points → density)",
        value: 20000
    });
    name = "mode";
    displayName = "Rendering Mode";
    slices: Array<FormattingSettingsSlice> = [this.renderMode, this.autoThreshold];
}

class PointsCard extends FormattingSettingsCard {
    pointSize = new formattingSettings.NumUpDown({ name: "pointSize", displayName: "Point size (px)", value: 3 });
    pointOpacity = new formattingSettings.NumUpDown({ name: "pointOpacity", displayName: "Point opacity (%)", value: 60 });
    name = "points";
    displayName = "Points";
    slices: Array<FormattingSettingsSlice> = [this.pointSize, this.pointOpacity];
}

class DensityCard extends FormattingSettingsCard {
    colorRamp = new formattingSettings.ItemDropdown({
        name: "colorRamp", displayName: "Color ramp",
        items: [
            { value: "viridis", displayName: "Viridis" },
            { value: "inferno", displayName: "Inferno" },
            { value: "blues",   displayName: "Blues" },
            { value: "turbo",   displayName: "Turbo" }
        ],
        value: { value: "viridis", displayName: "Viridis" }
    });
    intensityScale = new formattingSettings.ItemDropdown({
        name: "intensityScale", displayName: "Intensity scale",
        items: [
            { value: "linear", displayName: "Linear" },
            { value: "log",    displayName: "Log" },
            { value: "sqrt",   displayName: "Sqrt" }
        ],
        value: { value: "log", displayName: "Log" }
    });
    hexRadius = new formattingSettings.NumUpDown({
        name: "hexRadius", displayName: "Hex radius (px, hexbin mode)", value: 12
    });
    name = "densityCard";
    displayName = "Density / Hexbin";
    slices: Array<FormattingSettingsSlice> = [this.colorRamp, this.intensityScale, this.hexRadius];
}

class AxesCard extends FormattingSettingsCard {
    showAxes = new formattingSettings.ToggleSwitch({ name: "showAxes", displayName: "Show axes", value: true });
    fontSize = new formattingSettings.NumUpDown({ name: "fontSize", displayName: "Axis font size", value: 11 });
    showSampleWarningBadge = new formattingSettings.ToggleSwitch({
        name: "showSampleWarningBadge",
        displayName: "Show sample-honesty badge",
        description: "Displays 'n = X (all points rendered)' — the whole point of this visual.",
        value: true
    });
    name = "axes";
    displayName = "Axes";
    slices: Array<FormattingSettingsSlice> = [this.showAxes, this.fontSize, this.showSampleWarningBadge];
}

class InteractionsCard extends FormattingSettingsCard {
    selectionMode = new formattingSettings.ItemDropdown({
        name: "selectionMode", displayName: "Selection mode",
        items: [
            { value: "off",   displayName: "Off" },
            { value: "brush", displayName: "Brush (drag a rectangle)" },
            { value: "click", displayName: "Click nearest point" }
        ],
        value: { value: "brush", displayName: "Brush (drag a rectangle)" }
    });
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "Points outside the brush (or non-highlighted by another visual) fade to this opacity.",
        value: 15
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.selectionMode, this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    modeCard = new ModeCard();
    pointsCard = new PointsCard();
    densityCard = new DensityCard();
    axesCard = new AxesCard();
    interactionsCard = new InteractionsCard();
    cards = [this.modeCard, this.pointsCard, this.densityCard, this.axesCard, this.interactionsCard];
}
