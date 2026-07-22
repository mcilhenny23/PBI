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

    showZoneStats = new formattingSettings.ToggleSwitch({
        name: "showZoneStats",
        displayName: "Show per-zone yield",
        description: "Prints yield % and die count in each ring — turns the geometric overlay into the actual centre / mid / edge yield report.",
        value: false
    });

    zoneStatFormat = new formattingSettings.ItemDropdown({
        name: "zoneStatFormat",
        displayName: "Yield statistic",
        items: [
            { value: "yield", displayName: "Yield % (pass rate)" },
            { value: "fail", displayName: "Fail % (defect rate)" },
            { value: "count", displayName: "Die counts (pass/total)" }
        ],
        value: { value: "yield", displayName: "Yield % (pass rate)" }
    });

    zoneStatColor = new formattingSettings.ColorPicker({
        name: "zoneStatColor",
        displayName: "Yield text color",
        value: { value: "#111111" }
    });

    name: string = "zones";
    displayName: string = "Zone Overlay";
    slices: Array<FormattingSettingsSlice> = [
        this.showZones,
        this.zoneCount,
        this.zoneLineColor,
        this.zoneLineOpacity,
        this.showZoneStats,
        this.zoneStatFormat,
        this.zoneStatColor
    ];
}

/**
 * Reticle Overlay — the exposed area of one photolithography step. A wafer is
 * built by stepping the reticle across the surface in a grid of "shots", each
 * shot exposing an m × n block of dies. Any defect tied to reticle damage or
 * contamination repeats at exactly the reticle period, so overlaying the
 * reticle grid on the die map turns "why do these dies keep failing" into a
 * one-glance visual.
 *
 * Also aggregates per-reticle bad-die rates when asked, so a bad shot is
 * highlighted by fill, not just outlined.
 */
class ReticleCard extends FormattingSettingsCard {
    showReticle = new formattingSettings.ToggleSwitch({
        name: "showReticle",
        displayName: "Show reticle grid",
        description: "Overlays the reticle-shot boundaries on the die map. Set Size to the number of dies per reticle shot in X and Y.",
        value: false
    });

    reticleSizeX = new formattingSettings.NumUpDown({
        name: "reticleSizeX",
        displayName: "Dies per reticle (X)",
        description: "How many dies wide one reticle exposure covers.",
        value: 2
    });

    reticleSizeY = new formattingSettings.NumUpDown({
        name: "reticleSizeY",
        displayName: "Dies per reticle (Y)",
        description: "How many dies tall one reticle exposure covers.",
        value: 2
    });

    reticleOffsetX = new formattingSettings.NumUpDown({
        name: "reticleOffsetX",
        displayName: "X offset (dies)",
        description: "Shift the grid by this many dies so the reticle boundary lands where it actually sat on the stepper.",
        value: 0
    });

    reticleOffsetY = new formattingSettings.NumUpDown({
        name: "reticleOffsetY",
        displayName: "Y offset (dies)",
        value: 0
    });

    reticleColor = new formattingSettings.ColorPicker({
        name: "reticleColor",
        displayName: "Reticle line color",
        value: { value: "#111111" }
    });

    reticleLineWidth = new formattingSettings.NumUpDown({
        name: "reticleLineWidth",
        displayName: "Reticle line width",
        value: 1.5
    });

    reticleLineOpacity = new formattingSettings.NumUpDown({
        name: "reticleLineOpacity",
        displayName: "Reticle line opacity (%)",
        value: 70
    });

    highlightBadReticles = new formattingSettings.ToggleSwitch({
        name: "highlightBadReticles",
        displayName: "Highlight bad reticles",
        description: "Tint each reticle shot by its fail rate — a reticle whose fail rate is well above the wafer average glows, so a repeating defect at the shot period jumps out even before you count the dies.",
        value: false
    });

    reticleFailThreshold = new formattingSettings.NumUpDown({
        name: "reticleFailThreshold",
        displayName: "Highlight threshold (× wafer avg)",
        description: "A reticle is tinted when its fail rate is at least this multiple of the wafer's overall fail rate. Default 1.5× catches meaningfully-bad shots without every mildly-noisy one lighting up.",
        value: 1.5
    });

    passBinReticle = new formattingSettings.TextInput({
        name: "passBinReticle",
        displayName: "Passing bin (for fail rate)",
        description: "Bin value that counts as good. Leave blank to reuse Wafer → Passing bin name (also auto-detects the most common bin).",
        value: "",
        placeholder: "auto"
    });

    name: string = "reticle";
    displayName: string = "Reticle Overlay";
    slices: Array<FormattingSettingsSlice> = [
        this.showReticle,
        this.reticleSizeX,
        this.reticleSizeY,
        this.reticleOffsetX,
        this.reticleOffsetY,
        this.reticleColor,
        this.reticleLineWidth,
        this.reticleLineOpacity,
        this.highlightBadReticles,
        this.reticleFailThreshold,
        this.passBinReticle
    ];
}

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "When another visual filters this wafer map, non-highlighted dies fade to this opacity.",
        value: 25
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    waferCard = new WaferCard();
    dieAppearanceCard = new DieAppearanceCard();
    colorScaleCard = new ColorScaleCard();
    zonesCard = new ZonesCard();
    reticleCard = new ReticleCard();
    interactionsCard = new InteractionsCard();
    cards = [this.waferCard, this.dieAppearanceCard, this.colorScaleCard, this.zonesCard, this.reticleCard, this.interactionsCard];
}
