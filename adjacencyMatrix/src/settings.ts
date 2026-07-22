"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Matrix — row/column ordering and cell geometry.
 */
class MatrixCard extends FormattingSettingsCard {
    matrixMode = new formattingSettings.ItemDropdown({
        name: "matrixMode",
        displayName: "Matrix mode",
        description: "Unipartite treats sources and targets as one node set — the standard adjacency view. Bipartite treats them as two disjoint sets (people × projects, customers × products, students × courses) and draws a rectangular matrix without a diagonal or symmetry.",
        items: [
            { value: "unipartite", displayName: "Unipartite (one node set)" },
            { value: "bipartite", displayName: "Bipartite (rows ≠ columns)" }
        ],
        value: { value: "unipartite", displayName: "Unipartite (one node set)" }
    });

    seriation = new formattingSettings.ItemDropdown({
        name: "seriation",
        displayName: "Row / column order",
        description: "Cluster groups densely-connected nodes together, revealing block-diagonal structure",
        items: [
            { value: "cluster", displayName: "Cluster (hierarchical)" },
            { value: "degree", displayName: "Degree" },
            { value: "alphabetical", displayName: "Alphabetical" },
            { value: "none", displayName: "None (data order)" }
        ],
        value: { value: "cluster", displayName: "Cluster (hierarchical)" }
    });

    symmetric = new formattingSettings.ToggleSwitch({
        name: "symmetric",
        displayName: "Symmetric",
        description: "Mirror edges into both triangles (undirected network)",
        value: true
    });

    cellShape = new formattingSettings.ItemDropdown({
        name: "cellShape",
        displayName: "Cell shape",
        items: [
            { value: "square", displayName: "Square" },
            { value: "circle", displayName: "Circle" }
        ],
        value: { value: "square", displayName: "Square" }
    });

    showDiagonal = new formattingSettings.ToggleSwitch({
        name: "showDiagonal",
        displayName: "Show diagonal",
        description: "Self-loops (source = target)",
        value: true
    });

    name: string = "matrix";
    displayName: string = "Matrix";
    slices: Array<FormattingSettingsSlice> = [
        this.matrixMode,
        this.seriation,
        this.symmetric,
        this.cellShape,
        this.showDiagonal
    ];
}

/**
 * Color — weight ramp and its scale transform.
 */
class ColorCard extends FormattingSettingsCard {
    colorRampLow = new formattingSettings.ColorPicker({
        name: "colorRampLow",
        displayName: "Low color",
        value: { value: "#f7f7f7" }
    });

    colorRampHigh = new formattingSettings.ColorPicker({
        name: "colorRampHigh",
        displayName: "High color",
        value: { value: "#2166ac" }
    });

    colorScale = new formattingSettings.ItemDropdown({
        name: "colorScale",
        displayName: "Scale",
        description: "Log or square root discriminate better on heavy-tailed weights",
        items: [
            { value: "linear", displayName: "Linear" },
            { value: "log", displayName: "Log" },
            { value: "sqrt", displayName: "Square root" }
        ],
        value: { value: "linear", displayName: "Linear" }
    });

    name: string = "color";
    displayName: string = "Color";
    slices: Array<FormattingSettingsSlice> = [
        this.colorRampLow,
        this.colorRampHigh,
        this.colorScale
    ];
}

/**
 * Labels — node names along the margins.
 */
class LabelsCard extends FormattingSettingsCard {
    showLabels = new formattingSettings.ToggleSwitch({
        name: "showLabels",
        displayName: "Show labels",
        value: true
    });

    labelFontSize = new formattingSettings.NumUpDown({
        name: "labelFontSize",
        displayName: "Label font size",
        value: 10
    });

    maxLabelLength = new formattingSettings.NumUpDown({
        name: "maxLabelLength",
        displayName: "Max label length",
        description: "Truncate long node names to this many characters",
        value: 20
    });

    labelPosition = new formattingSettings.ItemDropdown({
        name: "labelPosition",
        displayName: "Label position",
        items: [
            { value: "outside", displayName: "Outside" },
            { value: "inside", displayName: "Inside" }
        ],
        value: { value: "outside", displayName: "Outside" }
    });

    name: string = "labels";
    displayName: string = "Labels";
    slices: Array<FormattingSettingsSlice> = [
        this.showLabels,
        this.labelFontSize,
        this.maxLabelLength,
        this.labelPosition
    ];
}

/**
 * Cluster Boundaries — separators between communities (cluster seriation only).
 */
class ClustersCard extends FormattingSettingsCard {
    showClusterBoundaries = new formattingSettings.ToggleSwitch({
        name: "showClusterBoundaries",
        displayName: "Show cluster boundaries",
        value: true
    });

    clusterBoundaryColor = new formattingSettings.ColorPicker({
        name: "clusterBoundaryColor",
        displayName: "Boundary color",
        value: { value: "#333333" }
    });

    name: string = "clusters";
    displayName: string = "Cluster Boundaries";
    slices: Array<FormattingSettingsSlice> = [
        this.showClusterBoundaries,
        this.clusterBoundaryColor
    ];
}

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "When another visual filters this matrix, non-highlighted cells fade to this opacity.",
        value: 25
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    matrixCard = new MatrixCard();
    colorCard = new ColorCard();
    labelsCard = new LabelsCard();
    clustersCard = new ClustersCard();
    interactionsCard = new InteractionsCard();
    cards = [this.matrixCard, this.colorCard, this.labelsCard, this.clustersCard, this.interactionsCard];
}
