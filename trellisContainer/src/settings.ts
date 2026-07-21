"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

class GridCard extends FormattingSettingsCard {
    columns = new formattingSettings.NumUpDown({
        name: "columns", displayName: "Columns (0 = auto)", value: 0
    });
    panelOrder = new formattingSettings.ItemDropdown({
        name: "panelOrder", displayName: "Panel order",
        items: [
            { value: "value-desc",   displayName: "By panel total desc" },
            { value: "value-asc",    displayName: "By panel total asc" },
            { value: "alphabetical", displayName: "Alphabetical" }
        ],
        value: { value: "value-desc", displayName: "By panel total desc" }
    });
    panelPadding = new formattingSettings.NumUpDown({ name: "panelPadding", displayName: "Panel padding (px)", value: 8 });
    showPanelTitles = new formattingSettings.ToggleSwitch({ name: "showPanelTitles", displayName: "Show panel titles", value: true });
    titleFontSize = new formattingSettings.NumUpDown({ name: "titleFontSize", displayName: "Title font size", value: 11 });

    name = "grid";
    displayName = "Grid";
    slices: Array<FormattingSettingsSlice> = [this.columns, this.panelOrder, this.panelPadding, this.showPanelTitles, this.titleFontSize];
}

class ScalesCard extends FormattingSettingsCard {
    yScaleMode = new formattingSettings.ItemDropdown({
        name: "yScaleMode", displayName: "Y scale",
        items: [
            { value: "shared",             displayName: "Shared" },
            { value: "free",               displayName: "Free" },
            { value: "shared-within-row",  displayName: "Shared within row" }
        ],
        value: { value: "shared", displayName: "Shared" }
    });
    xScaleMode = new formattingSettings.ItemDropdown({
        name: "xScaleMode", displayName: "X scale",
        items: [
            { value: "shared", displayName: "Shared" },
            { value: "free",   displayName: "Free" }
        ],
        value: { value: "shared", displayName: "Shared" }
    });
    showYAxisEvery = new formattingSettings.ItemDropdown({
        name: "showYAxisEvery", displayName: "Show Y axis on",
        items: [
            { value: "all-panels",   displayName: "Every panel" },
            { value: "first-column", displayName: "First column only" },
            { value: "none",         displayName: "None" }
        ],
        value: { value: "first-column", displayName: "First column only" }
    });

    name = "scales";
    displayName = "Scales";
    slices: Array<FormattingSettingsSlice> = [this.yScaleMode, this.xScaleMode, this.showYAxisEvery];
}

class ChartCard extends FormattingSettingsCard {
    chartType = new formattingSettings.ItemDropdown({
        name: "chartType", displayName: "Chart type",
        items: [
            { value: "line",    displayName: "Line" },
            { value: "bar",     displayName: "Bar" },
            { value: "area",    displayName: "Area" },
            { value: "scatter", displayName: "Scatter" }
        ],
        value: { value: "line", displayName: "Line" }
    });
    curveType = new formattingSettings.ItemDropdown({
        name: "curveType", displayName: "Line/area curve",
        items: [
            { value: "linear",   displayName: "Linear" },
            { value: "monotone", displayName: "Smooth (monotone)" },
            { value: "step",     displayName: "Step" }
        ],
        value: { value: "monotone", displayName: "Smooth (monotone)" }
    });
    pointSize = new formattingSettings.NumUpDown({ name: "pointSize", displayName: "Scatter point size", value: 3 });
    barPadding = new formattingSettings.NumUpDown({ name: "barPadding", displayName: "Bar padding (%)", value: 20 });

    name = "chart";
    displayName = "Chart";
    slices: Array<FormattingSettingsSlice> = [this.chartType, this.curveType, this.pointSize, this.barPadding];
}

class HighlightsCard extends FormattingSettingsCard {
    benchmarkPanel = new formattingSettings.TextInput({
        name: "benchmarkPanel", displayName: "Benchmark panel name",
        description: "Draw this panel's series as a ghosted reference in every panel.",
        placeholder: "e.g. 'All Stores Avg'",
        value: ""
    });
    name = "highlights";
    displayName = "Highlights";
    slices: Array<FormattingSettingsSlice> = [this.benchmarkPanel];
}

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "Non-selected panels fade to this opacity when any selection is active.",
        value: 30
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    gridCard = new GridCard();
    scalesCard = new ScalesCard();
    chartCard = new ChartCard();
    highlightsCard = new HighlightsCard();
    interactionsCard = new InteractionsCard();
    cards = [this.gridCard, this.scalesCard, this.chartCard, this.highlightsCard, this.interactionsCard];
}
