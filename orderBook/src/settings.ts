"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Heatmap — how liquidity is colored.
 */
class HeatmapCard extends FormattingSettingsCard {
    colorRamp = new formattingSettings.ItemDropdown({
        name: "colorRamp",
        displayName: "Color ramp",
        items: [
            { value: "blues", displayName: "Blues" },
            { value: "viridis", displayName: "Viridis" },
            { value: "inferno", displayName: "Inferno" },
            { value: "greens", displayName: "Greens" },
            { value: "oranges", displayName: "Oranges" }
        ],
        value: { value: "blues", displayName: "Blues" }
    });

    intensityScale = new formattingSettings.ItemDropdown({
        name: "intensityScale",
        displayName: "Intensity scale",
        description: "Book depth is heavy-tailed — a few levels hold most of the size. Log keeps thin levels visible.",
        items: [
            { value: "log", displayName: "Log" },
            { value: "sqrt", displayName: "Square root" },
            { value: "linear", displayName: "Linear" }
        ],
        value: { value: "log", displayName: "Log" }
    });

    cellInterpolation = new formattingSettings.ItemDropdown({
        name: "cellInterpolation",
        displayName: "Cell interpolation",
        description: "Nearest keeps crisp cell edges; bilinear smooths between levels",
        items: [
            { value: "nearest", displayName: "Nearest" },
            { value: "bilinear", displayName: "Bilinear" }
        ],
        value: { value: "nearest", displayName: "Nearest" }
    });

    name: string = "heatmap";
    displayName: string = "Heatmap";
    slices: Array<FormattingSettingsSlice> = [
        this.colorRamp,
        this.intensityScale,
        this.cellInterpolation
    ];
}

/**
 * Trade Overlay — executed prints on top of the book.
 */
class TradeOverlayCard extends FormattingSettingsCard {
    showTrades = new formattingSettings.ToggleSwitch({
        name: "showTrades",
        displayName: "Show trades",
        value: true
    });

    tradeColor = new formattingSettings.ColorPicker({
        name: "tradeColor",
        displayName: "Trade color",
        value: { value: "#ffffff" }
    });

    tradeMinRadius = new formattingSettings.NumUpDown({
        name: "tradeMinRadius",
        displayName: "Min radius",
        value: 2
    });

    tradeMaxRadius = new formattingSettings.NumUpDown({
        name: "tradeMaxRadius",
        displayName: "Max radius",
        value: 12
    });

    name: string = "tradeOverlay";
    displayName: string = "Trade Overlay";
    slices: Array<FormattingSettingsSlice> = [
        this.showTrades,
        this.tradeColor,
        this.tradeMinRadius,
        this.tradeMaxRadius
    ];
}

/**
 * Reference Lines — best bid / best ask, tracking the spread.
 */
class ReferenceLinesCard extends FormattingSettingsCard {
    showBestBid = new formattingSettings.ToggleSwitch({
        name: "showBestBid",
        displayName: "Show best bid",
        description: "Requires signed sizes (negative = bid)",
        value: false
    });

    bestBidColor = new formattingSettings.ColorPicker({
        name: "bestBidColor",
        displayName: "Best bid color",
        value: { value: "#00cc00" }
    });

    showBestAsk = new formattingSettings.ToggleSwitch({
        name: "showBestAsk",
        displayName: "Show best ask",
        description: "Requires signed sizes (positive = ask)",
        value: false
    });

    bestAskColor = new formattingSettings.ColorPicker({
        name: "bestAskColor",
        displayName: "Best ask color",
        value: { value: "#cc0000" }
    });

    name: string = "referenceLines";
    displayName: string = "Reference Lines";
    slices: Array<FormattingSettingsSlice> = [
        this.showBestBid,
        this.bestBidColor,
        this.showBestAsk,
        this.bestAskColor
    ];
}

/**
 * Axes.
 */
class AxesCard extends FormattingSettingsCard {
    showTimeAxis = new formattingSettings.ToggleSwitch({
        name: "showTimeAxis",
        displayName: "Show time axis",
        value: true
    });

    showPriceAxis = new formattingSettings.ToggleSwitch({
        name: "showPriceAxis",
        displayName: "Show price axis",
        value: true
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Font size",
        value: 11
    });

    name: string = "axes";
    displayName: string = "Axes";
    slices: Array<FormattingSettingsSlice> = [
        this.showTimeAxis,
        this.showPriceAxis,
        this.fontSize
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    heatmapCard = new HeatmapCard();
    tradeOverlayCard = new TradeOverlayCard();
    referenceLinesCard = new ReferenceLinesCard();
    axesCard = new AxesCard();
    cards = [this.heatmapCard, this.tradeOverlayCard, this.referenceLinesCard, this.axesCard];
}
