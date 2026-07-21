"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Matrix Profile — the algorithm parameters. Window length is the only one
 * that really matters.
 */
class ProfileCard extends FormattingSettingsCard {
    windowMode = new formattingSettings.ItemDropdown({
        name: "windowMode",
        displayName: "Window length",
        description: "Fixed uses the length below. Multi-length scans a range of lengths at once, draws the result as a heatmap, and suggests a length — use it when you don't know what to set.",
        items: [
            { value: "fixed", displayName: "Fixed" },
            { value: "multi", displayName: "Multi-length (scan & suggest)" }
        ],
        value: { value: "fixed", displayName: "Fixed" }
    });

    windowLength = new formattingSettings.NumUpDown({
        name: "windowLength",
        displayName: "Window length (m)",
        description: "Length of the pattern to look for, in samples. The one parameter that matters — set it to roughly the duration of the shape you care about.",
        value: 50
    });

    lengthSteps = new formattingSettings.NumUpDown({
        name: "lengthSteps",
        displayName: "Lengths to scan",
        description: "How many window lengths the multi-length scan tries, spaced geometrically. Cost grows linearly with this.",
        value: 12
    });

    minWindow = new formattingSettings.NumUpDown({
        name: "minWindow",
        displayName: "Shortest length (blank = auto)",
        value: null
    });

    maxWindow = new formattingSettings.NumUpDown({
        name: "maxWindow",
        displayName: "Longest length (blank = auto)",
        description: "Capped so at least ten windows fit — a profile built from a handful of windows is statistically meaningless.",
        value: null
    });

    motifCount = new formattingSettings.NumUpDown({
        name: "motifCount",
        displayName: "Motifs to highlight",
        description: "Top repeated-pattern pairs",
        value: 3
    });

    discordCount = new formattingSettings.NumUpDown({
        name: "discordCount",
        displayName: "Discords to highlight",
        description: "Top anomalies — subsequences with no close match anywhere",
        value: 3
    });

    exclusionZone = new formattingSettings.NumUpDown({
        name: "exclusionZone",
        displayName: "Exclusion zone (% of m)",
        description: "Suppresses trivial matches — a window always resembles itself shifted by one sample",
        value: 50
    });

    highlightMode = new formattingSettings.ItemDropdown({
        name: "highlightMode",
        displayName: "Highlight",
        description: "Auto shows only findings that genuinely stand out — most series support motifs or discords, not both. The other options show the top-N regardless.",
        items: [
            { value: "auto", displayName: "Auto (only what stands out)" },
            { value: "motifs", displayName: "Motifs only" },
            { value: "discords", displayName: "Discords only" },
            { value: "both", displayName: "Both (unfiltered)" }
        ],
        value: { value: "auto", displayName: "Auto (only what stands out)" }
    });

    minSalience = new formattingSettings.NumUpDown({
        name: "minSalience",
        displayName: "Salience threshold",
        description: "In Auto mode, how far a finding must stand apart from the next-best candidates (in robust σ) to be highlighted. Lower to see weaker findings.",
        value: 1
    });

    name: string = "profile";
    displayName: string = "Matrix Profile";
    slices: Array<FormattingSettingsSlice> = [
        this.windowMode,
        this.windowLength,
        this.lengthSteps,
        this.minWindow,
        this.maxWindow,
        this.motifCount,
        this.discordCount,
        this.exclusionZone,
        this.highlightMode,
        this.minSalience
    ];
}

/**
 * Display — panel split and colors.
 */
class DisplayCard extends FormattingSettingsCard {
    profileHeight = new formattingSettings.NumUpDown({
        name: "profileHeight",
        displayName: "Profile strip height (%)",
        description: "Share of the visual given to the profile strip beneath the series",
        value: 30
    });

    seriesColor = new formattingSettings.ColorPicker({
        name: "seriesColor",
        displayName: "Series color",
        value: { value: "#1f77b4" }
    });

    profileColor = new formattingSettings.ColorPicker({
        name: "profileColor",
        displayName: "Profile color",
        value: { value: "#7f7f7f" }
    });

    motifColor = new formattingSettings.ColorPicker({
        name: "motifColor",
        displayName: "Motif color",
        value: { value: "#2ca02c" }
    });

    discordColor = new formattingSettings.ColorPicker({
        name: "discordColor",
        displayName: "Discord color",
        value: { value: "#d62728" }
    });

    showMotifConnectors = new formattingSettings.ToggleSwitch({
        name: "showMotifConnectors",
        displayName: "Show motif connectors",
        description: "Arcs joining each motif to its matching occurrence",
        value: true
    });

    highlightOpacity = new formattingSettings.NumUpDown({
        name: "highlightOpacity",
        displayName: "Highlight opacity (%)",
        value: 30
    });

    name: string = "display";
    displayName: string = "Display";
    slices: Array<FormattingSettingsSlice> = [
        this.profileHeight,
        this.seriesColor,
        this.profileColor,
        this.motifColor,
        this.discordColor,
        this.showMotifConnectors,
        this.highlightOpacity
    ];
}

/**
 * Axis.
 */
class AxisCard extends FormattingSettingsCard {
    showAxis = new formattingSettings.ToggleSwitch({
        name: "showAxis",
        displayName: "Show axis",
        value: true
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Font size",
        value: 11
    });

    name: string = "axis";
    displayName: string = "Axis";
    slices: Array<FormattingSettingsSlice> = [
        this.showAxis,
        this.fontSize
    ];
}

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "The plot dims when another visual filters the chart.",
        value: 30
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    profileCard = new ProfileCard();
    displayCard = new DisplayCard();
    axisCard = new AxisCard();
    interactionsCard = new InteractionsCard();
    cards = [this.profileCard, this.displayCard, this.axisCard, this.interactionsCard];
}
