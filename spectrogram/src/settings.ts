"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * FFT Settings — the transform itself.
 */
class FftCard extends FormattingSettingsCard {
    windowSize = new formattingSettings.ItemDropdown({
        name: "windowSize",
        displayName: "Window size",
        description: "Samples per FFT frame. Larger = finer frequency detail, coarser time detail.",
        items: [
            { value: "64", displayName: "64" },
            { value: "128", displayName: "128" },
            { value: "256", displayName: "256" },
            { value: "512", displayName: "512" },
            { value: "1024", displayName: "1024" },
            { value: "2048", displayName: "2048" }
        ],
        value: { value: "256", displayName: "256" }
    });

    overlapPercent = new formattingSettings.NumUpDown({
        name: "overlapPercent",
        displayName: "Window overlap (%)",
        description: "How much each frame overlaps the previous one (0–90)",
        value: 50
    });

    windowFunction = new formattingSettings.ItemDropdown({
        name: "windowFunction",
        displayName: "Window function",
        description: "Tapers each frame to suppress spectral leakage",
        items: [
            { value: "hann", displayName: "Hann" },
            { value: "hamming", displayName: "Hamming" },
            { value: "blackman", displayName: "Blackman" },
            { value: "rectangular", displayName: "Rectangular" }
        ],
        value: { value: "hann", displayName: "Hann" }
    });

    name: string = "fft";
    displayName: string = "FFT Settings";
    slices: Array<FormattingSettingsSlice> = [
        this.windowSize,
        this.overlapPercent,
        this.windowFunction
    ];
}

/**
 * Display — scales and color mapping.
 */
class DisplayCard extends FormattingSettingsCard {
    frequencyScale = new formattingSettings.ItemDropdown({
        name: "frequencyScale",
        displayName: "Frequency scale",
        items: [
            { value: "linear", displayName: "Linear" },
            { value: "log", displayName: "Log" }
        ],
        value: { value: "linear", displayName: "Linear" }
    });

    magnitudeScale = new formattingSettings.ItemDropdown({
        name: "magnitudeScale",
        displayName: "Magnitude scale",
        description: "dB = 20·log10(magnitude); far better contrast on real signals",
        items: [
            { value: "db", displayName: "dB" },
            { value: "linear", displayName: "Linear" }
        ],
        value: { value: "db", displayName: "dB" }
    });

    colorRamp = new formattingSettings.ItemDropdown({
        name: "colorRamp",
        displayName: "Color ramp",
        items: [
            { value: "viridis", displayName: "Viridis" },
            { value: "inferno", displayName: "Inferno" },
            { value: "magma", displayName: "Magma" },
            { value: "plasma", displayName: "Plasma" },
            { value: "turbo", displayName: "Turbo" }
        ],
        value: { value: "viridis", displayName: "Viridis" }
    });

    minMagnitude = new formattingSettings.NumUpDown({
        name: "minMagnitude",
        displayName: "Min magnitude (dB)",
        description: "Floor for the dB scale — everything below clamps to the darkest color",
        value: -80
    });

    maxMagnitude = new formattingSettings.NumUpDown({
        name: "maxMagnitude",
        displayName: "Max magnitude (dB)",
        value: 0
    });

    name: string = "display";
    displayName: string = "Display";
    slices: Array<FormattingSettingsSlice> = [
        this.frequencyScale,
        this.magnitudeScale,
        this.colorRamp,
        this.minMagnitude,
        this.maxMagnitude
    ];
}

/**
 * Alarm Bands — highlight a frequency range of interest.
 */
class AlarmBandsCard extends FormattingSettingsCard {
    showAlarmBands = new formattingSettings.ToggleSwitch({
        name: "showAlarmBands",
        displayName: "Show alarm band",
        value: false
    });

    alarmBand1Low = new formattingSettings.NumUpDown({
        name: "alarmBand1Low",
        displayName: "Band low (Hz)",
        value: 100
    });

    alarmBand1High = new formattingSettings.NumUpDown({
        name: "alarmBand1High",
        displayName: "Band high (Hz)",
        value: 200
    });

    alarmBand1Color = new formattingSettings.ColorPicker({
        name: "alarmBand1Color",
        displayName: "Band color",
        value: { value: "#ff0000" }
    });

    name: string = "alarmBands";
    displayName: string = "Alarm Bands";
    slices: Array<FormattingSettingsSlice> = [
        this.showAlarmBands,
        this.alarmBand1Low,
        this.alarmBand1High,
        this.alarmBand1Color
    ];
}

/**
 * Axis — units and labels.
 */
class AxisCard extends FormattingSettingsCard {
    showTimeAxis = new formattingSettings.ToggleSwitch({
        name: "showTimeAxis",
        displayName: "Show time axis",
        value: true
    });

    showFreqAxis = new formattingSettings.ToggleSwitch({
        name: "showFreqAxis",
        displayName: "Show frequency axis",
        value: true
    });

    sampleRate = new formattingSettings.NumUpDown({
        name: "sampleRate",
        displayName: "Sample rate (Hz)",
        description: "Needed to label axes in Hz and seconds. Set to 0 to label in bins and frames.",
        value: 1000
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Font size",
        value: 11
    });

    name: string = "axis";
    displayName: string = "Axis";
    slices: Array<FormattingSettingsSlice> = [
        this.showTimeAxis,
        this.showFreqAxis,
        this.sampleRate,
        this.fontSize
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    fftCard = new FftCard();
    displayCard = new DisplayCard();
    alarmBandsCard = new AlarmBandsCard();
    axisCard = new AxisCard();
    cards = [this.fftCard, this.displayCard, this.alarmBandsCard, this.axisCard];
}
