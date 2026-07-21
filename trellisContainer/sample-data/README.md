# Trellis Container — Sample Data

## `store-revenue.csv`

12 stores × 12 months of fake seasonal revenue, plus a 13th "All Stores Avg" panel intended for the benchmark overlay.

**Field mapping**
- `Store` → **Small Multiple By**
- `Month` → **Axis**
- `Revenue` → **Value**

## Toggles worth trying

- **Scales → Y scale → Shared**: every panel uses the same Y range. Honest for cross-store comparisons.
- **Scales → Y scale → Free**: each panel scales to itself. Shows per-store shape.
- **Scales → Y scale → Shared within row**: rows share, columns are free. Balance between the two.
- **Highlights → Benchmark panel** = `All Stores Avg`: the average curve is dashed-ghosted onto every other panel for one-glance comparisons.
- **Chart → Chart type = Bar** with `Barpadding = 20`: same panels rendered as bar charts.

## Interactions

- **Click any panel** to filter every other visual on the page by that store. Ctrl / Shift-click to add.
- **Right-click** for the Power BI context menu.
- **Click empty space** to clear.
- **Tab / Enter / Space** for keyboard-driven selection.
- **Interactions → Unselected opacity** controls how much non-selected panels fade. The same dimming applies when *another* visual filters the trellis.
