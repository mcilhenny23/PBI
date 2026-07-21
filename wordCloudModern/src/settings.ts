"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

class ProcessingCard extends FormattingSettingsCard {
    ngramSize = new formattingSettings.ItemDropdown({
        name: "ngramSize", displayName: "N-gram size",
        items: [
            { value: "1",   displayName: "Unigrams" },
            { value: "2",   displayName: "Bigrams" },
            { value: "1+2", displayName: "Unigrams + Bigrams" },
            { value: "3",   displayName: "Trigrams" }
        ],
        value: { value: "1+2", displayName: "Unigrams + Bigrams" }
    });
    stopWords = new formattingSettings.ItemDropdown({
        name: "stopWords", displayName: "Stop words",
        items: [
            { value: "english", displayName: "English" },
            { value: "none",    displayName: "None" },
            { value: "custom",  displayName: "Custom" }
        ],
        value: { value: "english", displayName: "English" }
    });
    customStopWords = new formattingSettings.TextInput({
        name: "customStopWords", displayName: "Custom stop words (comma-separated)",
        placeholder: "the, a, of, to, in",
        value: ""
    });
    minFrequency = new formattingSettings.NumUpDown({ name: "minFrequency", displayName: "Minimum frequency", value: 2 });
    maxTerms = new formattingSettings.NumUpDown({ name: "maxTerms", displayName: "Max terms shown", value: 100 });
    caseMode = new formattingSettings.ItemDropdown({
        name: "caseMode", displayName: "Case mode",
        items: [
            { value: "lower",    displayName: "Lowercase" },
            { value: "preserve", displayName: "Preserve case" }
        ],
        value: { value: "lower", displayName: "Lowercase" }
    });

    name = "processing";
    displayName = "Text Processing";
    slices: Array<FormattingSettingsSlice> = [this.ngramSize, this.stopWords, this.customStopWords, this.minFrequency, this.maxTerms, this.caseMode];
}

class LayoutCard extends FormattingSettingsCard {
    spiral = new formattingSettings.ItemDropdown({
        name: "spiral", displayName: "Spiral",
        items: [
            { value: "archimedean", displayName: "Archimedean" },
            { value: "rectangular", displayName: "Rectangular" }
        ],
        value: { value: "archimedean", displayName: "Archimedean" }
    });
    rotations = new formattingSettings.ItemDropdown({
        name: "rotations", displayName: "Rotations",
        items: [
            { value: "none",  displayName: "None" },
            { value: "90",    displayName: "±90°" },
            { value: "45-90", displayName: "±45° and ±90°" }
        ],
        value: { value: "none", displayName: "None" }
    });
    padding = new formattingSettings.NumUpDown({ name: "padding", displayName: "Word padding (px)", value: 2 });
    scaleMode = new formattingSettings.ItemDropdown({
        name: "scaleMode", displayName: "Weight → size scale",
        items: [
            { value: "sqrt",   displayName: "Square root" },
            { value: "log",    displayName: "Logarithmic" },
            { value: "linear", displayName: "Linear" }
        ],
        value: { value: "sqrt", displayName: "Square root" }
    });
    fontFamily = new formattingSettings.TextInput({
        name: "fontFamily", displayName: "Font family",
        placeholder: "Segoe UI",
        value: "Segoe UI"
    });
    minFontSize = new formattingSettings.NumUpDown({ name: "minFontSize", displayName: "Min font size (px)", value: 12 });
    maxFontSize = new formattingSettings.NumUpDown({ name: "maxFontSize", displayName: "Max font size (px)", value: 64 });

    name = "layout";
    displayName = "Layout";
    slices: Array<FormattingSettingsSlice> = [this.spiral, this.rotations, this.padding, this.scaleMode, this.fontFamily, this.minFontSize, this.maxFontSize];
}

class InteractionCard extends FormattingSettingsCard {
    clickToFilter = new formattingSettings.ToggleSwitch({
        name: "clickToFilter", displayName: "Click a word to cross-filter", value: true
    });

    name = "interaction";
    displayName = "Interaction";
    slices: Array<FormattingSettingsSlice> = [this.clickToFilter];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    processingCard = new ProcessingCard();
    layoutCard = new LayoutCard();
    interactionCard = new InteractionCard();
    cards = [this.processingCard, this.layoutCard, this.interactionCard];
}
