"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

class ImageCard extends FormattingSettingsCard {
    coordinateSystem = new formattingSettings.ItemDropdown({
        name: "coordinateSystem", displayName: "Coordinate origin",
        items: [
            { value: "top-left",    displayName: "Top-left (screen)" },
            { value: "bottom-left", displayName: "Bottom-left (CAD)" }
        ],
        value: { value: "top-left", displayName: "Top-left (screen)" }
    });
    imageWidth = new formattingSettings.NumUpDown({
        name: "imageWidth", displayName: "Image width (coord units)",
        description: "The X extent your point coordinates use. Blank = natural image width.",
        value: 0
    });
    imageHeight = new formattingSettings.NumUpDown({
        name: "imageHeight", displayName: "Image height (coord units)",
        description: "The Y extent your point coordinates use. Blank = natural image height.",
        value: 0
    });
    imageOpacity = new formattingSettings.NumUpDown({
        name: "imageOpacity", displayName: "Image opacity (%)", value: 100
    });

    name = "image";
    displayName = "Image";
    slices: Array<FormattingSettingsSlice> = [this.coordinateSystem, this.imageWidth, this.imageHeight, this.imageOpacity];
}

class OverlayCard extends FormattingSettingsCard {
    overlayMode = new formattingSettings.ItemDropdown({
        name: "overlayMode", displayName: "Overlay",
        items: [
            { value: "points", displayName: "Points" },
            { value: "heat",   displayName: "Heat" },
            { value: "both",   displayName: "Both" }
        ],
        value: { value: "points", displayName: "Points" }
    });
    pointRadius = new formattingSettings.NumUpDown({ name: "pointRadius", displayName: "Point radius (px)", value: 5 });
    pointOpacity = new formattingSettings.NumUpDown({ name: "pointOpacity", displayName: "Point opacity (%)", value: 90 });
    heatRadius = new formattingSettings.NumUpDown({ name: "heatRadius", displayName: "Heat radius (px)", value: 30 });
    heatOpacity = new formattingSettings.NumUpDown({ name: "heatOpacity", displayName: "Heat opacity (%)", value: 70 });
    colorRamp = new formattingSettings.ItemDropdown({
        name: "colorRamp", displayName: "Heat color ramp",
        items: [
            { value: "viridis", displayName: "Viridis" },
            { value: "inferno", displayName: "Inferno" },
            { value: "blues",   displayName: "Blues" },
            { value: "turbo",   displayName: "Turbo" }
        ],
        value: { value: "inferno", displayName: "Inferno" }
    });

    name = "overlay";
    displayName = "Overlay";
    slices: Array<FormattingSettingsSlice> = [this.overlayMode, this.pointRadius, this.pointOpacity, this.heatRadius, this.heatOpacity, this.colorRamp];
}

class LabelsCard extends FormattingSettingsCard {
    labelMode = new formattingSettings.ItemDropdown({
        name: "labelMode", displayName: "Label mode",
        items: [
            { value: "hover",  displayName: "On hover" },
            { value: "always", displayName: "Always" },
            { value: "never",  displayName: "Never" }
        ],
        value: { value: "hover", displayName: "On hover" }
    });
    fontSize = new formattingSettings.NumUpDown({ name: "fontSize", displayName: "Font size", value: 11 });
    name = "labels";
    displayName = "Labels";
    slices: Array<FormattingSettingsSlice> = [this.labelMode, this.fontSize];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    imageCard = new ImageCard();
    overlayCard = new OverlayCard();
    labelsCard = new LabelsCard();
    cards = [this.imageCard, this.overlayCard, this.labelsCard];
}
