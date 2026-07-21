"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

export const DEFAULT_CONTEXT_COLOR = "#d9d9d9";
export const DEFAULT_FOCUS_COLOR   = "#4472C4";

class FocusCard extends FormattingSettingsCard {
    focusMode = new formattingSettings.ItemDropdown({
        name: "focusMode", displayName: "Focus mode",
        items: [
            { value: "hover",        displayName: "Hover" },
            { value: "click-pin",    displayName: "Click to pin" },
            { value: "top-n",        displayName: "Top-N (final value)" },
            { value: "flag-measure", displayName: "Focus (0/1) measure" }
        ],
        value: { value: "hover", displayName: "Hover" }
    });
    topN = new formattingSettings.NumUpDown({ name: "topN", displayName: "Top-N count", value: 3 });
    contextColor = new formattingSettings.ColorPicker({ name: "contextColor", displayName: "Context color", value: { value: DEFAULT_CONTEXT_COLOR } });
    contextOpacity = new formattingSettings.NumUpDown({ name: "contextOpacity", displayName: "Context opacity (%)", value: 60 });
    contextWidth = new formattingSettings.NumUpDown({ name: "contextWidth", displayName: "Context line width", value: 1 });
    focusWidth = new formattingSettings.NumUpDown({ name: "focusWidth", displayName: "Focus line width", value: 2.5 });
    focusColorMode = new formattingSettings.ItemDropdown({
        name: "focusColorMode", displayName: "Focus color mode",
        items: [
            { value: "palette", displayName: "Palette (per series)" },
            { value: "single",  displayName: "Single color" }
        ],
        value: { value: "palette", displayName: "Palette (per series)" }
    });
    focusColor = new formattingSettings.ColorPicker({ name: "focusColor", displayName: "Focus color (single mode)", value: { value: DEFAULT_FOCUS_COLOR } });

    name = "focus";
    displayName = "Focus";
    slices: Array<FormattingSettingsSlice> = [
        this.focusMode, this.topN, this.contextColor, this.contextOpacity, this.contextWidth,
        this.focusWidth, this.focusColorMode, this.focusColor
    ];
}

class LabelsCard extends FormattingSettingsCard {
    showEndLabels = new formattingSettings.ToggleSwitch({ name: "showEndLabels", displayName: "Show end labels", value: true });
    fontSize = new formattingSettings.NumUpDown({ name: "fontSize", displayName: "Font size", value: 11 });
    labelValue = new formattingSettings.ToggleSwitch({ name: "labelValue", displayName: "Append last value", value: true });

    name = "labels";
    displayName = "Direct Labels";
    slices: Array<FormattingSettingsSlice> = [this.showEndLabels, this.fontSize, this.labelValue];
}

class FallbackCard extends FormattingSettingsCard {
    smallMultiplesThreshold = new formattingSettings.NumUpDown({
        name: "smallMultiplesThreshold",
        displayName: "Trellis fallback threshold (series)",
        description: "When series count exceeds this, fall back to a trellis of mini charts. 0 disables.",
        value: 0
    });
    curveType = new formattingSettings.ItemDropdown({
        name: "curveType", displayName: "Curve interpolation",
        items: [
            { value: "linear",   displayName: "Linear" },
            { value: "monotone", displayName: "Smooth (monotone)" },
            { value: "basis",    displayName: "Smooth (basis)" },
            { value: "step",     displayName: "Step" }
        ],
        value: { value: "monotone", displayName: "Smooth (monotone)" }
    });

    name = "fallback";
    displayName = "Fallback / Curve";
    slices: Array<FormattingSettingsSlice> = [this.smallMultiplesThreshold, this.curveType];
}

class AxesCard extends FormattingSettingsCard {
    showAxes = new formattingSettings.ToggleSwitch({ name: "showAxes", displayName: "Show axes", value: true });
    showGridlines = new formattingSettings.ToggleSwitch({ name: "showGridlines", displayName: "Show gridlines", value: true });
    fontSize = new formattingSettings.NumUpDown({ name: "fontSize", displayName: "Axis font size", value: 11 });

    name = "axes";
    displayName = "Axes";
    slices: Array<FormattingSettingsSlice> = [this.showAxes, this.showGridlines, this.fontSize];
}

/** Hidden object — pinned series names (comma-separated) so click-pin survives reload. */
class PinnedSeriesCard extends FormattingSettingsCard {
    pinned = new formattingSettings.TextInput({ name: "pinned", displayName: "Pinned", placeholder: "", value: "" });

    name = "pinnedSeries";
    displayName = "Pinned Series";
    slices: Array<FormattingSettingsSlice> = [this.pinned];
}

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "When any selection is active, non-selected series fade to this opacity.",
        value: 20
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    focusCard = new FocusCard();
    labelsCard = new LabelsCard();
    fallbackCard = new FallbackCard();
    axesCard = new AxesCard();
    pinnedCard = new PinnedSeriesCard();
    interactionsCard = new InteractionsCard();
    cards = [this.focusCard, this.labelsCard, this.fallbackCard, this.axesCard, this.interactionsCard, this.pinnedCard];
}
