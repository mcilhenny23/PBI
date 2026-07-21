"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

export const DEFAULT_BAR_COLOR    = "#4472C4";
export const DEFAULT_DENSITY_COLOR = "#d62728";

class BinningCard extends FormattingSettingsCard {
    binMethod = new formattingSettings.ItemDropdown({
        name: "binMethod", displayName: "Bin method",
        items: [
            { value: "fd",      displayName: "Freedman-Diaconis" },
            { value: "sturges", displayName: "Sturges" },
            { value: "scott",   displayName: "Scott" },
            { value: "manual",  displayName: "Manual" }
        ],
        value: { value: "fd", displayName: "Freedman-Diaconis" }
    });
    manualBinWidth = new formattingSettings.NumUpDown({
        name: "manualBinWidth", displayName: "Manual bin width", value: 1
    });
    showBinSlider = new formattingSettings.ToggleSwitch({
        name: "showBinSlider", displayName: "Show bin-width slider",
        description: "A draggable handle under the axis that live-adjusts the manual bin width.",
        value: true
    });
    niceBoundaries = new formattingSettings.ToggleSwitch({
        name: "niceBoundaries", displayName: "Snap bin edges to round numbers", value: true
    });

    name = "binning";
    displayName = "Binning";
    slices: Array<FormattingSettingsSlice> = [this.binMethod, this.manualBinWidth, this.showBinSlider, this.niceBoundaries];
}

class DensityCard extends FormattingSettingsCard {
    showDensity = new formattingSettings.ToggleSwitch({
        name: "showDensity", displayName: "Show KDE density curve", value: false
    });
    densityColor = new formattingSettings.ColorPicker({
        name: "densityColor", displayName: "Density curve color", value: { value: DEFAULT_DENSITY_COLOR }
    });
    densityWidth = new formattingSettings.NumUpDown({ name: "densityWidth", displayName: "Density curve width", value: 2 });
    bandwidthScale = new formattingSettings.NumUpDown({
        name: "bandwidthScale", displayName: "Bandwidth scale (%)",
        description: "100% = Silverman's rule of thumb; lower = jagged, higher = smoother.",
        value: 100
    });

    name = "density";
    displayName = "Density Overlay";
    slices: Array<FormattingSettingsSlice> = [this.showDensity, this.densityColor, this.densityWidth, this.bandwidthScale];
}

class BarsCard extends FormattingSettingsCard {
    barColor = new formattingSettings.ColorPicker({
        name: "barColor", displayName: "Bar color", value: { value: DEFAULT_BAR_COLOR }
    });
    barOpacity = new formattingSettings.NumUpDown({ name: "barOpacity", displayName: "Bar opacity (%)", value: 75 });
    groupMode = new formattingSettings.ItemDropdown({
        name: "groupMode", displayName: "Group mode",
        items: [
            { value: "overlay", displayName: "Overlay (transparent)" },
            { value: "facet",   displayName: "Facet (mini-multiples)" },
            { value: "stack",   displayName: "Stack" }
        ],
        value: { value: "overlay", displayName: "Overlay (transparent)" }
    });
    yMode = new formattingSettings.ItemDropdown({
        name: "yMode", displayName: "Y axis",
        items: [
            { value: "count",     displayName: "Count" },
            { value: "frequency", displayName: "Relative frequency" },
            { value: "density",   displayName: "Density (normalized)" }
        ],
        value: { value: "count", displayName: "Count" }
    });

    name = "bars";
    displayName = "Bars / Groups";
    slices: Array<FormattingSettingsSlice> = [this.barColor, this.barOpacity, this.groupMode, this.yMode];
}

class AnnotationsCard extends FormattingSettingsCard {
    showMeanLine = new formattingSettings.ToggleSwitch({ name: "showMeanLine", displayName: "Show mean line", value: false });
    showMedianLine = new formattingSettings.ToggleSwitch({ name: "showMedianLine", displayName: "Show median line", value: false });
    showNormalOverlay = new formattingSettings.ToggleSwitch({ name: "showNormalOverlay", displayName: "Fit normal N(μ,σ) overlay", value: false });

    name = "annotations";
    displayName = "Annotations";
    slices: Array<FormattingSettingsSlice> = [this.showMeanLine, this.showMedianLine, this.showNormalOverlay];
}

/** Hidden object — persisted manual bin width. Written when the slider is released. */
class ManualBinCard extends FormattingSettingsCard {
    width = new formattingSettings.NumUpDown({ name: "width", displayName: "Manual bin width", value: 0 });
    name = "manualBin";
    displayName = "Manual Bin (persisted)";
    slices: Array<FormattingSettingsSlice> = [this.width];
}

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "Non-selected bins fade to this opacity when a bin is selected or another visual filters this histogram.",
        value: 25
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    binningCard = new BinningCard();
    densityCard = new DensityCard();
    barsCard = new BarsCard();
    annotationsCard = new AnnotationsCard();
    manualBinCard = new ManualBinCard();
    interactionsCard = new InteractionsCard();
    cards = [this.binningCard, this.densityCard, this.barsCard, this.annotationsCard, this.manualBinCard, this.interactionsCard];
}
