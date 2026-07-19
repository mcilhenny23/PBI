"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Built-in default colors. Exported so the visual can distinguish "user has not
 * picked a color yet" (→ pull from the report theme palette) from an explicit
 * user override (→ honor it). See resolvePalette() in visual.ts.
 */
export const DEFAULT_BAND_COLOR = "#4682B4";
export const DEFAULT_CENTRAL_COLOR = "#1a1a2e";
export const DEFAULT_ACTUALS_COLOR = "#333333";

/**
 * Fan Band Appearance
 */
class FanSettingsCard extends FormattingSettingsCard {
    bandColor = new formattingSettings.ColorPicker({
        name: "bandColor",
        displayName: "Band color",
        description: "Base color for the uncertainty bands (defaults to the report theme)",
        value: { value: DEFAULT_BAND_COLOR }
    });

    centralLineColor = new formattingSettings.ColorPicker({
        name: "centralLineColor",
        displayName: "Central line color",
        value: { value: DEFAULT_CENTRAL_COLOR }
    });

    actualsLineColor = new formattingSettings.ColorPicker({
        name: "actualsLineColor",
        displayName: "Actuals line color",
        value: { value: DEFAULT_ACTUALS_COLOR }
    });

    showCentralLine = new formattingSettings.ToggleSwitch({
        name: "showCentralLine",
        displayName: "Show central estimate line",
        value: true
    });

    bandOpacityOuter = new formattingSettings.NumUpDown({
        name: "bandOpacityOuter",
        displayName: "Outer band opacity",
        description: "Opacity of the outermost band (inner bands scale up from this)",
        value: 15
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

    name: string = "fanSettings";
    displayName: string = "Fan Appearance";
    slices: Array<FormattingSettingsSlice> = [
        this.bandColor,
        this.centralLineColor,
        this.actualsLineColor,
        this.showCentralLine,
        this.bandOpacityOuter,
        this.curveType
    ];
}

/**
 * Axis Settings
 */
class AxisSettingsCard extends FormattingSettingsCard {
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

    name: string = "axisSettings";
    displayName: string = "Axes";
    slices: Array<FormattingSettingsSlice> = [
        this.showXAxis,
        this.showYAxis,
        this.showGridlines,
        this.fontSize
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    fanSettingsCard = new FanSettingsCard();
    axisSettingsCard = new AxisSettingsCard();
    cards = [this.fanSettingsCard, this.axisSettingsCard];
}
