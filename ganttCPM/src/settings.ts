"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

export const DEFAULT_TODAY_COLOR    = "#d62728";
export const DEFAULT_ARROW_COLOR    = "#7f7f7f";
export const DEFAULT_CRITICAL_COLOR = "#d62728";

class TimelineCard extends FormattingSettingsCard {
    timeGranularity = new formattingSettings.ItemDropdown({
        name: "timeGranularity", displayName: "Time granularity",
        items: [
            { value: "auto",    displayName: "Auto" },
            { value: "day",     displayName: "Day" },
            { value: "week",    displayName: "Week" },
            { value: "month",   displayName: "Month" },
            { value: "quarter", displayName: "Quarter" }
        ],
        value: { value: "auto", displayName: "Auto" }
    });
    showTodayLine = new formattingSettings.ToggleSwitch({
        name: "showTodayLine", displayName: "Show today line", value: true
    });
    todayLineColor = new formattingSettings.ColorPicker({
        name: "todayLineColor", displayName: "Today line color",
        value: { value: DEFAULT_TODAY_COLOR }
    });

    name = "timeline";
    displayName = "Timeline";
    slices: Array<FormattingSettingsSlice> = [this.timeGranularity, this.showTodayLine, this.todayLineColor];
}

class BarsCard extends FormattingSettingsCard {
    barHeight = new formattingSettings.NumUpDown({ name: "barHeight", displayName: "Bar height", value: 18 });
    rowPadding = new formattingSettings.NumUpDown({ name: "rowPadding", displayName: "Row padding", value: 8 });
    cornerRadius = new formattingSettings.NumUpDown({ name: "cornerRadius", displayName: "Corner radius", value: 3 });
    showProgress = new formattingSettings.ToggleSwitch({
        name: "showProgress", displayName: "Show progress fill", value: true
    });
    milestoneShape = new formattingSettings.ItemDropdown({
        name: "milestoneShape", displayName: "Milestone shape",
        items: [
            { value: "diamond", displayName: "Diamond" },
            { value: "circle",  displayName: "Circle" },
            { value: "flag",    displayName: "Flag" }
        ],
        value: { value: "diamond", displayName: "Diamond" }
    });

    name = "bars";
    displayName = "Bars";
    slices: Array<FormattingSettingsSlice> = [this.barHeight, this.rowPadding, this.cornerRadius, this.showProgress, this.milestoneShape];
}

class DependenciesCard extends FormattingSettingsCard {
    showDependencies = new formattingSettings.ToggleSwitch({
        name: "showDependencies", displayName: "Show dependency arrows", value: true
    });
    arrowColor = new formattingSettings.ColorPicker({
        name: "arrowColor", displayName: "Arrow color",
        value: { value: DEFAULT_ARROW_COLOR }
    });
    arrowWidth = new formattingSettings.NumUpDown({ name: "arrowWidth", displayName: "Arrow width", value: 1.5 });
    routingStyle = new formattingSettings.ItemDropdown({
        name: "routingStyle", displayName: "Arrow routing",
        items: [
            { value: "orthogonal", displayName: "Orthogonal" },
            { value: "curved",     displayName: "Curved" }
        ],
        value: { value: "orthogonal", displayName: "Orthogonal" }
    });

    name = "dependencies";
    displayName = "Dependencies";
    slices: Array<FormattingSettingsSlice> = [this.showDependencies, this.arrowColor, this.arrowWidth, this.routingStyle];
}

class CriticalCard extends FormattingSettingsCard {
    showCriticalPath = new formattingSettings.ToggleSwitch({
        name: "showCriticalPath", displayName: "Highlight critical path", value: false
    });
    criticalColor = new formattingSettings.ColorPicker({
        name: "criticalColor", displayName: "Critical color",
        value: { value: DEFAULT_CRITICAL_COLOR }
    });
    slackThreshold = new formattingSettings.NumUpDown({
        name: "slackThreshold", displayName: "Slack threshold (days)",
        description: "Tasks whose total float is ≤ this many days count as critical.",
        value: 0
    });

    name = "critical";
    displayName = "Critical Path";
    slices: Array<FormattingSettingsSlice> = [this.showCriticalPath, this.criticalColor, this.slackThreshold];
}

class HierarchyCard extends FormattingSettingsCard {
    showHierarchy = new formattingSettings.ToggleSwitch({
        name: "showHierarchy", displayName: "Show WBS hierarchy", value: true
    });
    taskLabelWidth = new formattingSettings.NumUpDown({
        name: "taskLabelWidth", displayName: "Task-name column width (px)", value: 200
    });
    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize", displayName: "Font size", value: 11
    });

    name = "hierarchy";
    displayName = "Hierarchy / Labels";
    slices: Array<FormattingSettingsSlice> = [this.showHierarchy, this.taskLabelWidth, this.fontSize];
}

class InteractionsCard extends FormattingSettingsCard {
    dimUnselectedOpacity = new formattingSettings.NumUpDown({
        name: "dimUnselectedOpacity",
        displayName: "Unselected opacity (%)",
        description: "When another visual filters this chart, non-highlighted tasks fade to this opacity.",
        value: 25
    });
    name = "interactions";
    displayName = "Interactions";
    slices: Array<FormattingSettingsSlice> = [this.dimUnselectedOpacity];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    timelineCard = new TimelineCard();
    barsCard = new BarsCard();
    dependenciesCard = new DependenciesCard();
    criticalCard = new CriticalCard();
    hierarchyCard = new HierarchyCard();
    interactionsCard = new InteractionsCard();
    cards = [this.timelineCard, this.barsCard, this.dependenciesCard, this.criticalCard, this.hierarchyCard, this.interactionsCard];
}
