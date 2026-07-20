"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * Template — how the schematic itself is drawn.
 */
class TemplateCard extends FormattingSettingsCard {
    defaultFillColor = new formattingSettings.ColorPicker({
        name: "defaultFillColor",
        displayName: "Default fill",
        description: "Used for shapes whose template gives no fill",
        value: { value: "#cccccc" }
    });

    showElementIds = new formattingSettings.ToggleSwitch({
        name: "showElementIds",
        displayName: "Show element IDs",
        description: "Debug overlay — labels every bindable shape with its id",
        value: false
    });

    showRejectedNote = new formattingSettings.ToggleSwitch({
        name: "showRejectedNote",
        displayName: "Report dropped elements",
        description: "Show a note listing template elements the allow-list refused",
        value: true
    });

    name: string = "template";
    displayName: string = "Template";
    slices: Array<FormattingSettingsSlice> = [
        this.defaultFillColor,
        this.showElementIds,
        this.showRejectedNote
    ];
}

/**
 * Value Mapping — how a bound value becomes a visual property.
 */
class ValueMappingCard extends FormattingSettingsCard {
    valueLow = new formattingSettings.NumUpDown({
        name: "valueLow",
        displayName: "Value low",
        value: 0
    });

    valueHigh = new formattingSettings.NumUpDown({
        name: "valueHigh",
        displayName: "Value high",
        value: 100
    });

    colorLow = new formattingSettings.ColorPicker({
        name: "colorLow",
        displayName: "Low color",
        value: { value: "#d73027" }
    });

    colorHigh = new formattingSettings.ColorPicker({
        name: "colorHigh",
        displayName: "High color",
        value: { value: "#1a9850" }
    });

    bindingMode = new formattingSettings.ItemDropdown({
        name: "bindingMode",
        displayName: "Bind value to",
        description: "Fill level makes a tank fill up; the others recolor, fade, rotate or relabel the shape",
        items: [
            { value: "fill-level", displayName: "Fill level" },
            { value: "color", displayName: "Color" },
            { value: "opacity", displayName: "Opacity" },
            { value: "rotation", displayName: "Rotation" },
            { value: "text", displayName: "Text" }
        ],
        value: { value: "fill-level", displayName: "Fill level" }
    });

    name: string = "valueMapping";
    displayName: string = "Value Mapping";
    slices: Array<FormattingSettingsSlice> = [
        this.valueLow,
        this.valueHigh,
        this.colorLow,
        this.colorHigh,
        this.bindingMode
    ];
}

/**
 * Animation — flow along pipes and alarm blinking.
 */
class AnimationCard extends FormattingSettingsCard {
    flowAnimation = new formattingSettings.ToggleSwitch({
        name: "flowAnimation",
        displayName: "Animate flow",
        description: "Marches a dashed pattern along shapes whose id starts with \"pipe\"",
        value: false
    });

    flowSpeed = new formattingSettings.NumUpDown({
        name: "flowSpeed",
        displayName: "Flow speed",
        value: 50
    });

    blinkOnAlarm = new formattingSettings.ToggleSwitch({
        name: "blinkOnAlarm",
        displayName: "Blink on alarm",
        value: false
    });

    alarmThreshold = new formattingSettings.NumUpDown({
        name: "alarmThreshold",
        displayName: "Alarm threshold",
        value: 90
    });

    name: string = "animation";
    displayName: string = "Animation";
    slices: Array<FormattingSettingsSlice> = [
        this.flowAnimation,
        this.flowSpeed,
        this.blinkOnAlarm,
        this.alarmThreshold
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    templateCard = new TemplateCard();
    valueMappingCard = new ValueMappingCard();
    animationCard = new AnimationCard();
    cards = [this.templateCard, this.valueMappingCard, this.animationCard];
}
