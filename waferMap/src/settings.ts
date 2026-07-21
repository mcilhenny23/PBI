"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Wafer — outline shape, notch and edge exclusion.
 */
class WaferCard extends FormattingSettingsCard {
    waferShape = new formattingSettings.ItemDropdown({
        name: "waferShape",
        displayName: "Wafer shape",
        items: [
            { value: "circle", displayName: "Circle" },
            { value: "rectangle", displayName: "Rectangle" }
        ],
        value: { value: "circle", displayName: "Circle" }
    });

    notchPosition = new formattingSettings.ItemDropdown({
        name: "notchPosition",
        displayName: "Notch position",
        items: [
            { value: "bottom", displayName: "Bottom" },
            { value: "top", displayName: "Top" },
            { value: "left", displayName: "Left" },
            { value: "right", displayName: "Right" }
        ],
        value: { value: "bottom", displayName: "Bottom" }
    });

    edgeExclusion = new formattingSettings.NumUpDown({
        name: "edgeExclusion",
        displayName: "Edge exclusion",
        description: "Number of die rings to hide at the wafer edge",
        value: 0
    });

    showNotch = new formattingSettings.ToggleSwitch({
        name: "showNotch",
        displayName: "Show notch",
        value: true
    });

    multiWaferMode = new formattingSettings.ItemDropdown({
        name: "multiWaferMode",
        displayName: "Multiple wafers",
        description: "Small multiples shows each wafer separately. Stacked overlays every wafer into one composite map — random defects average out and systematic spatial signatures stay bright, which is how a repeating process problem is found.",
        items: [
            { value: "small-multiples", displayName: "Small multiples" },
            { value: "stacked", displayName: "Stacked (composite)" }
        ],
        value: { value: "small-multiples", displayName: "Small multiples" }
    });

    stackedMetric = new formattingSettings.ItemDropdown({
        name: "stackedMetric",
        displayName: "Composite metric",
        description: "What each die shows once wafers are stacked",
        items: [
            { value: "fail-rate", displayName: "Fail rate (% of wafers failing here)" },
            { value: "mean-value", displayName: "Mean value" }
        ],
        value: { value: "fail-rate", displayName: "Fail rate (% of wafers failing here)" }
    });

    passBin = new formattingSettings.TextInput({
        name: "passBin",
        displayName: "Passing bin name",
        description: "Which Bin value counts as good. Leave blank to auto-detect the most common bin.",
        value: "",
        placeholder: "auto"
    });

    name: string = "wafer";
    displayName: string = "Wafer";
    slices: Array<FormattingSettingsSlice> = [
        this.waferShape,
        this.notchPosition,
        this.edgeExclusion,
        this.showNotch,
        this.multiWaferMode,
        this.stackedMetric,
        this.passBin
    ];
}

/**
 * Die Appearance — spacing, borders and how dies are colored.
 */
class DieAppearanceCard extends FormattingSettingsCard {
    dieGap = new formattingSettings.NumUpDown({
        name: "dieGap",
        displayName: "Die gap (px)",
        value: 1
    });

    dieBorderColor = new formattingSettings.ColorPicker({
        name: "dieBorderColor",
        displayName: "Die border color",
        value: { value: "#cccccc" }
    });

    dieBorderWidth = new formattingSettings.NumUpDown({
        name: "dieBorderWidth",
        displayName: "Die border width",
        value: 0
    });

    colorMode = new formattingSettings.ItemDropdown({
        name: "colorMode",
        displayName: "Color mode",
        items: [
            { value: "categorical", displayName: "Categorical (bin)" },
            { value: "continuous", displayName: "Continuous (value)" }
        ],
        value: { value: "categorical", displayName: "Categorical (bin)" }
    });

    name: string = "dieAppearance";
    displayName: string = "Die Appearance";
    slices: Array<FormattingSettingsSlice> = [
        this.dieGap,
        this.dieBorderColor,
        this.dieBorderWidth,
        this.colorMode
    ];
}

/**
 * Color Scale — three-stop gradient used in Continuous mode.
 */
class ColorScaleCard extends FormattingSettingsCard {
    colorScaleLow = new formattingSettings.ColorPicker({
        name: "colorScaleLow",
        displayName: "Low color",
        value: { value: "#d73027" }
    });

    colorScaleMid = new formattingSettings.ColorPicker({
        name: "colorScaleMid",
        displayName: "Mid color",
        value: { value: "#ffffbf" }
    });

    colorScaleHigh = new formattingSettings.ColorPicker({
        name: "colorScaleHigh",
        displayName: "High color",
        value: { value: "#1a9850" }
    });

    name: string = "colorScale";
    displayName: string = "Color Scale";
    slices: Array<FormattingSettingsSlice> = [
        this.colorScaleLow,
        this.colorScaleMid,
        this.colorScaleHigh
    ];
}

/**
 * Zone Overlay — concentric radial rings for center/mid/edge analysis.
 */
class ZonesCard extends FormattingSettingsCard {
    showZones = new formattingSettings.ToggleSwitch({
        name: "showZones",
        displayName: "Show zones",
        value: false
    });

    zoneCount = new formattingSettings.NumUpDown({
        name: "zoneCount",
        displayName: "Zone count",
        description: "Concentric ring zones (center / mid / edge)",
        value: 3
    });

    zoneLineColor = new formattingSettings.ColorPicker({
        name: "zoneLineColor",
        displayName: "Zone line color",
        value: { value: "#000000" }
    });

    zoneLineOpacity = new formattingSettings.NumUpDown({
        name: "zoneLineOpacity",
        displayName: "Zone line opacity (%)",
        value: 40
    });

    name: string = "zones";
    displayName: string = "Zone Overlay";
    slices: Array<FormattingSettingsSlice> = [
        this.showZones,
        this.zoneCount,
        this.zoneLineColor,
        this.zoneLineOpacity
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    waferCard = new WaferCard();
    dieAppearanceCard = new DieAppearanceCard();
    colorScaleCard = new ColorScaleCard();
    zonesCard = new ZonesCard();
    cards = [this.waferCard, this.dieAppearanceCard, this.colorScaleCard, this.zonesCard];
}
