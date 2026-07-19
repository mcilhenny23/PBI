"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Array Layout — grid dimensions, fill direction and icon shape.
 */
class LayoutCard extends FormattingSettingsCard {
    gridColumns = new formattingSettings.NumUpDown({
        name: "gridColumns",
        displayName: "Columns",
        description: "Number of columns in the grid",
        value: 10
    });

    gridRows = new formattingSettings.NumUpDown({
        name: "gridRows",
        displayName: "Rows",
        description: "Number of rows. Total icons = rows × columns.",
        value: 10
    });

    fillOrder = new formattingSettings.ItemDropdown({
        name: "fillOrder",
        displayName: "Fill order",
        items: [
            { value: "row", displayName: "Row by row" },
            { value: "column", displayName: "Column by column" },
            { value: "random", displayName: "Random" }
        ],
        value: { value: "row", displayName: "Row by row" }
    });

    iconShape = new formattingSettings.ItemDropdown({
        name: "iconShape",
        displayName: "Icon shape",
        items: [
            { value: "person", displayName: "Person" },
            { value: "circle", displayName: "Circle" },
            { value: "square", displayName: "Square" },
            { value: "heart", displayName: "Heart" }
        ],
        value: { value: "person", displayName: "Person" }
    });

    name: string = "layout";
    displayName: string = "Array Layout";
    slices: Array<FormattingSettingsSlice> = [
        this.gridColumns,
        this.gridRows,
        this.fillOrder,
        this.iconShape
    ];
}

/**
 * Appearance — colors, sizing, and the "X of Y" caption.
 */
class AppearanceCard extends FormattingSettingsCard {
    highlightColor = new formattingSettings.ColorPicker({
        name: "highlightColor",
        displayName: "Highlight color",
        description: "Color of the highlighted icons (single-category mode)",
        value: { value: "#E74C3C" }
    });

    baseColor = new formattingSettings.ColorPicker({
        name: "baseColor",
        displayName: "Base color",
        description: "Color of the un-highlighted icons",
        value: { value: "#E0E0E0" }
    });

    iconSize = new formattingSettings.NumUpDown({
        name: "iconSize",
        displayName: "Icon size (%)",
        description: "Icon size as a percentage of the available cell",
        value: 80
    });

    iconSpacing = new formattingSettings.NumUpDown({
        name: "iconSpacing",
        displayName: "Icon spacing (px)",
        description: "Gap between icons in pixels",
        value: 4
    });

    showLabel = new formattingSettings.ToggleSwitch({
        name: "showLabel",
        displayName: "Show caption",
        description: "Show the \"X of Y\" caption below the grid",
        value: true
    });

    labelFontSize = new formattingSettings.NumUpDown({
        name: "labelFontSize",
        displayName: "Caption font size",
        value: 14
    });

    name: string = "appearance";
    displayName: string = "Appearance";
    slices: Array<FormattingSettingsSlice> = [
        this.highlightColor,
        this.baseColor,
        this.iconSize,
        this.iconSpacing,
        this.showLabel,
        this.labelFontSize
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    layoutCard = new LayoutCard();
    appearanceCard = new AppearanceCard();
    cards = [this.layoutCard, this.appearanceCard];
}
