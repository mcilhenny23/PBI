"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Triangle — gridlines, normalization and axis titles.
 */
class TriangleCard extends FormattingSettingsCard {
    showGridlines = new formattingSettings.ToggleSwitch({
        name: "showGridlines",
        displayName: "Show gridlines",
        value: true
    });

    gridlineCount = new formattingSettings.NumUpDown({
        name: "gridlineCount",
        displayName: "Gridline divisions",
        description: "Number of divisions per side (e.g. 10 → gridlines every 10%)",
        value: 10
    });

    normalizeValues = new formattingSettings.ToggleSwitch({
        name: "normalizeValues",
        displayName: "Normalize (A+B+C = 1)",
        description: "Auto-scale each row so the three components sum to 1. When off, rows whose components don't already sum to 1 are skipped.",
        value: true
    });

    axisLabelA = new formattingSettings.TextInput({
        name: "axisLabelA",
        displayName: "Axis A title",
        description: "Overrides the Component A measure name (top vertex)",
        value: "",
        placeholder: "Component A"
    });

    axisLabelB = new formattingSettings.TextInput({
        name: "axisLabelB",
        displayName: "Axis B title",
        description: "Overrides the Component B measure name (bottom-left vertex)",
        value: "",
        placeholder: "Component B"
    });

    axisLabelC = new formattingSettings.TextInput({
        name: "axisLabelC",
        displayName: "Axis C title",
        description: "Overrides the Component C measure name (bottom-right vertex)",
        value: "",
        placeholder: "Component C"
    });

    name: string = "triangle";
    displayName: string = "Triangle";
    slices: Array<FormattingSettingsSlice> = [
        this.showGridlines,
        this.gridlineCount,
        this.normalizeValues,
        this.axisLabelA,
        this.axisLabelB,
        this.axisLabelC
    ];
}

/**
 * Points — marker appearance and labels.
 */
class PointsCard extends FormattingSettingsCard {
    pointRadius = new formattingSettings.NumUpDown({
        name: "pointRadius",
        displayName: "Point radius",
        value: 5
    });

    pointColor = new formattingSettings.ColorPicker({
        name: "pointColor",
        displayName: "Point color",
        description: "Used when no Color Value is bound",
        value: { value: "#4682B4" }
    });

    pointOpacity = new formattingSettings.NumUpDown({
        name: "pointOpacity",
        displayName: "Point opacity (%)",
        value: 80
    });

    showLabels = new formattingSettings.ToggleSwitch({
        name: "showLabels",
        displayName: "Show point labels",
        value: false
    });

    labelFontSize = new formattingSettings.NumUpDown({
        name: "labelFontSize",
        displayName: "Label font size",
        value: 10
    });

    name: string = "points";
    displayName: string = "Points";
    slices: Array<FormattingSettingsSlice> = [
        this.pointRadius,
        this.pointColor,
        this.pointOpacity,
        this.showLabels,
        this.labelFontSize
    ];
}

/**
 * Color Scale — gradient endpoints, applied when a Color Value is bound.
 */
class ColorScaleCard extends FormattingSettingsCard {
    colorScaleLow = new formattingSettings.ColorPicker({
        name: "colorScaleLow",
        displayName: "Low color",
        value: { value: "#ffffcc" }
    });

    colorScaleHigh = new formattingSettings.ColorPicker({
        name: "colorScaleHigh",
        displayName: "High color",
        value: { value: "#006837" }
    });

    name: string = "colorScale";
    displayName: string = "Color Scale";
    slices: Array<FormattingSettingsSlice> = [
        this.colorScaleLow,
        this.colorScaleHigh
    ];
}

/**
 * Classification Overlay — draws a domain classification scheme (USDA soil
 * texture etc.) as polygons over the triangle. Every point then inherits
 * a class name from the region it falls in and the shape of the cloud
 * reads as domain knowledge, not just coordinates.
 */
class ClassificationCard extends FormattingSettingsCard {
    showScheme = new formattingSettings.ToggleSwitch({
        name: "showScheme",
        displayName: "Show classification regions",
        description: "Overlays a domain classification (e.g. USDA soil-texture triangle) as coloured polygons. Bind the components to match the scheme's expected vertex assignment or the regions won't line up with the data.",
        value: false
    });

    schemeId = new formattingSettings.ItemDropdown({
        name: "schemeId",
        displayName: "Scheme",
        items: [
            { value: "usda-soil", displayName: "USDA soil texture (A=Clay, B=Sand, C=Silt)" }
        ],
        value: { value: "usda-soil", displayName: "USDA soil texture (A=Clay, B=Sand, C=Silt)" }
    });

    regionOpacity = new formattingSettings.NumUpDown({
        name: "regionOpacity",
        displayName: "Region fill opacity (%)",
        value: 18
    });

    regionStroke = new formattingSettings.ColorPicker({
        name: "regionStroke",
        displayName: "Region outline color",
        value: { value: "#666666" }
    });

    showRegionLabels = new formattingSettings.ToggleSwitch({
        name: "showRegionLabels",
        displayName: "Show region labels",
        value: true
    });

    name: string = "classification";
    displayName: string = "Classification Overlay";
    slices: Array<FormattingSettingsSlice> = [
        this.showScheme,
        this.schemeId,
        this.regionOpacity,
        this.regionStroke,
        this.showRegionLabels
    ];
}

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "Non-selected points fade to this opacity.",
        value: 25
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    triangleCard = new TriangleCard();
    classificationCard = new ClassificationCard();
    pointsCard = new PointsCard();
    colorScaleCard = new ColorScaleCard();
    interactionsCard = new InteractionsCard();
    cards = [this.triangleCard, this.classificationCard, this.pointsCard, this.colorScaleCard, this.interactionsCard];
}
