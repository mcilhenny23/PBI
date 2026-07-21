"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

class ChordCard extends FormattingSettingsCard {
    directed = new formattingSettings.ToggleSwitch({
        name: "directed", displayName: "Directed (asymmetric ribbons)", value: false
    });
    padAngle = new formattingSettings.NumUpDown({ name: "padAngle", displayName: "Group padding (degrees)", value: 3 });
    sortGroups = new formattingSettings.ItemDropdown({
        name: "sortGroups", displayName: "Sort groups",
        items: [
            { value: "size-desc",    displayName: "Size descending" },
            { value: "alphabetical", displayName: "Alphabetical" },
            { value: "data-order",   displayName: "Data order" }
        ],
        value: { value: "size-desc", displayName: "Size descending" }
    });
    ribbonOpacity = new formattingSettings.NumUpDown({ name: "ribbonOpacity", displayName: "Ribbon opacity (%)", value: 65 });
    hoverMode = new formattingSettings.ItemDropdown({
        name: "hoverMode", displayName: "Hover behavior",
        items: [
            { value: "highlight-connected", displayName: "Highlight connected" },
            { value: "isolate",             displayName: "Isolate (hide others)" }
        ],
        value: { value: "highlight-connected", displayName: "Highlight connected" }
    });

    name = "chord";
    displayName = "Chord";
    slices: Array<FormattingSettingsSlice> = [this.directed, this.padAngle, this.sortGroups, this.ribbonOpacity, this.hoverMode];
}

class ArcsCard extends FormattingSettingsCard {
    arcThickness = new formattingSettings.NumUpDown({ name: "arcThickness", displayName: "Arc thickness (px)", value: 14 });
    labelMode = new formattingSettings.ItemDropdown({
        name: "labelMode", displayName: "Label mode",
        items: [
            { value: "radial",     displayName: "Radial" },
            { value: "horizontal", displayName: "Horizontal" },
            { value: "hidden",     displayName: "Hidden" }
        ],
        value: { value: "radial", displayName: "Radial" }
    });
    minLabelAngle = new formattingSettings.NumUpDown({
        name: "minLabelAngle", displayName: "Min arc angle to label (degrees)", value: 4
    });
    fontSize = new formattingSettings.NumUpDown({ name: "fontSize", displayName: "Font size", value: 11 });

    name = "arcs";
    displayName = "Arcs & Labels";
    slices: Array<FormattingSettingsSlice> = [this.arcThickness, this.labelMode, this.minLabelAngle, this.fontSize];
}

class GradientsCard extends FormattingSettingsCard {
    gradientRibbons = new formattingSettings.ToggleSwitch({
        name: "gradientRibbons", displayName: "Gradient-fill ribbons (source → target)", value: true
    });
    name = "gradients";
    displayName = "Gradients";
    slices: Array<FormattingSettingsSlice> = [this.gradientRibbons];
}

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "Non-touched arcs and ribbons fade to this opacity when a selection is active.",
        value: 20
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    chordCard = new ChordCard();
    arcsCard = new ArcsCard();
    gradientsCard = new GradientsCard();
    interactionsCard = new InteractionsCard();
    cards = [this.chordCard, this.arcsCard, this.gradientsCard, this.interactionsCard];
}
