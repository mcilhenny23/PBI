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
 * Order Tracking — rescales the frequency axis by shaft RPM so a fixed-order
 * component (1×, 3×, 5.5× etc.) stays at the same row across the image, even
 * as the machine speeds up or slows down. Without this a run-up smears every
 * band diagonally and diagnosis becomes eyeballing slopes.
 */
class OrderTrackingCard extends FormattingSettingsCard {
    axisMode = new formattingSettings.ItemDropdown({
        name: "axisMode",
        displayName: "Y axis",
        description: "Orders requires the RPM well and Axis → Sample rate. Order o at time t is sampled from the spectrum at o × RPM / 60 Hz.",
        items: [
            { value: "hz", displayName: "Hz (fixed frequency)" },
            { value: "orders", displayName: "Orders (multiples of shaft speed)" }
        ],
        value: { value: "hz", displayName: "Hz (fixed frequency)" }
    });

    maxOrder = new formattingSettings.NumUpDown({
        name: "maxOrder",
        displayName: "Max order to display",
        description: "Capped internally by Nyquist at the lowest RPM in the range, so no bogus band shows above the machine's actual reach.",
        value: 10
    });

    showOrderMarkers = new formattingSettings.ToggleSwitch({
        name: "showOrderMarkers",
        displayName: "Show order marker lines",
        value: true
    });

    orderMarkerList = new formattingSettings.TextInput({
        name: "orderMarkerList",
        displayName: "Order markers",
        description: "Comma-separated orders to mark with a dashed line (e.g. 1, 3, 5.5)",
        value: "1, 2, 3",
        placeholder: "1, 3, 5.5"
    });

    name: string = "orderTracking";
    displayName: string = "Order Tracking";
    slices: Array<FormattingSettingsSlice> = [
        this.axisMode,
        this.maxOrder,
        this.showOrderMarkers,
        this.orderMarkerList
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

    // Units are stored explicitly so a Hz-defined band doesn't silently
    // reinterpret as orders (or vice-versa) when the user flips the Y axis.
    alarmBand1Units = new formattingSettings.ItemDropdown({
        name: "alarmBand1Units",
        displayName: "Band units",
        description: "Interprets Low/High as Hz or orders. The band only renders when it matches the current Y axis.",
        items: [
            { value: "hz", displayName: "Hz" },
            { value: "orders", displayName: "Orders" }
        ],
        value: { value: "hz", displayName: "Hz" }
    });

    alarmBand1Low = new formattingSettings.NumUpDown({
        name: "alarmBand1Low",
        displayName: "Band low",
        value: 100
    });

    alarmBand1High = new formattingSettings.NumUpDown({
        name: "alarmBand1High",
        displayName: "Band high",
        value: 200
    });

    alarmBand1Color = new formattingSettings.ColorPicker({
        name: "alarmBand1Color",
        displayName: "Band color",
        value: { value: "#ff0000" }
    });

    // ── Band-power trend ─────────────────────────────────────────
    // Turn the band into a time series: energy inside [low, high] per frame,
    // drawn as a strip below the spectrogram. This is the number vibration
    // alarms actually watch — the heatmap shows the fault, the trend line
    // tells you when it crossed the limit.
    showBandTrend = new formattingSettings.ToggleSwitch({
        name: "showBandTrend",
        displayName: "Show band-power trend",
        description: "Adds a strip below the spectrogram plotting energy inside the band over time.",
        value: false
    });

    bandStat = new formattingSettings.ItemDropdown({
        name: "bandStat",
        displayName: "Band-power statistic",
        description: "RMS-dB is what condition-monitoring alarms use. Peak-in-band tracks the tallest single component; sum tracks total energy.",
        items: [
            { value: "rmsDb", displayName: "RMS (dB)" },
            { value: "peak", displayName: "Peak magnitude in band" },
            { value: "sum", displayName: "Sum of magnitudes" }
        ],
        value: { value: "rmsDb", displayName: "RMS (dB)" }
    });

    bandThreshold = new formattingSettings.NumUpDown({
        name: "bandThreshold",
        displayName: "Alarm threshold",
        description: "Draws a horizontal line at this level and highlights frames whose band-power crosses it. Leave blank to disable.",
        value: null
    });

    name: string = "alarmBands";
    displayName: string = "Alarm Bands";
    slices: Array<FormattingSettingsSlice> = [
        this.showAlarmBands,
        this.alarmBand1Units,
        this.alarmBand1Low,
        this.alarmBand1High,
        this.alarmBand1Color,
        this.showBandTrend,
        this.bandStat,
        this.bandThreshold
    ];
}

/**
 * Harmonic Cursors — dashed lines at integer multiples of a fundamental
 * frequency. The core diagnostic move in vibration analysis: put the cursor
 * on a peak, then check whether partner peaks land on 2×, 3×, 4× — if they
 * do the peaks share a source, if they don't they don't.
 *
 * Hz mode only; Orders mode's order-markers list already covers this and a
 * fixed-Hz line would smear across orders anyway.
 */
class HarmonicCursorsCard extends FormattingSettingsCard {
    showHarmonics = new formattingSettings.ToggleSwitch({
        name: "showHarmonics",
        displayName: "Show harmonic cursors",
        description: "Hz mode only. Orders mode uses Order Tracking → Order markers instead.",
        value: false
    });

    fundamentalHz = new formattingSettings.NumUpDown({
        name: "fundamentalHz",
        displayName: "Fundamental (Hz)",
        description: "Frequency to anchor the cursors on. Set to the Hz of a peak you're investigating and watch whether other peaks fall on the multiples.",
        value: 0
    });

    harmonicCount = new formattingSettings.NumUpDown({
        name: "harmonicCount",
        displayName: "Harmonics to draw",
        description: "How many multiples (2×, 3×, …) beyond the fundamental. The fundamental itself is always drawn.",
        value: 5
    });

    harmonicColor = new formattingSettings.ColorPicker({
        name: "harmonicColor",
        displayName: "Cursor color",
        value: { value: "#ff9500" }
    });

    showLabels = new formattingSettings.ToggleSwitch({
        name: "showLabels",
        displayName: "Show n× labels",
        value: true
    });

    name: string = "harmonicCursors";
    displayName: string = "Harmonic Cursors";
    slices: Array<FormattingSettingsSlice> = [
        this.showHarmonics,
        this.fundamentalHz,
        this.harmonicCount,
        this.harmonicColor,
        this.showLabels
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

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "The spectrogram dims when another visual filters the chart.",
        value: 30
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    fftCard = new FftCard();
    orderTrackingCard = new OrderTrackingCard();
    displayCard = new DisplayCard();
    alarmBandsCard = new AlarmBandsCard();
    harmonicCursorsCard = new HarmonicCursorsCard();
    axisCard = new AxisCard();
    interactionsCard = new InteractionsCard();
    cards = [this.fftCard, this.orderTrackingCard, this.displayCard, this.alarmBandsCard, this.harmonicCursorsCard, this.axisCard, this.interactionsCard];
}
