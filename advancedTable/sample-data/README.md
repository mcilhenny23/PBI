# Advanced Table — Sample Data

## `product-monthly.csv`

Long-format: 10 products × 12 months of Revenue, plus Units / ASP / Margin repeated per row (so Power BI can aggregate them either way).

**Field mapping**
- `Product` → **Rows**
- `Revenue`, `Units`, `ASP` (as Average), `Margin` (as Average) → **Values**
- `Month` → **Sparkline Axis**
- `Revenue` (bind again) → **Sparkline Value**

Power BI will aggregate the numeric columns; make sure ASP and Margin are set to Average, Revenue and Units to Sum.

## Toggles worth trying

- **Sparklines → Sparkline type = Line, Highlight last point = on**: the last-value dot immediately reads the current-period position.
- **Sparklines → Sparkline type = Win / Loss** with the Margin column bound to sparkValue: months with positive margin are green bars up, losses are red bars down.
- **Icon Rules → Rule 1**: measure `Margin`, operator `<`, threshold `0`, icon ▼, red. Loss months prefix the value with a red triangle.
- **Icon Rules → Rule 2**: measure `Margin`, operator `>=`, threshold `0.2`, icon ▲, green. High-margin products stand out immediately.
- **Table → Show totals row** with **Totals position = Bottom** for the totals footer.

Column headers are click-sortable.

## Interactions

- **Click any row** to filter every other visual on the page by that product. Ctrl / Shift-click to add.
- **Right-click** for the Power BI context menu.
- **Click empty space** (below the last row) to clear.
- **Tab / Enter / Space** for keyboard-driven selection.
- **Interactions → Unselected opacity** controls how much non-selected rows fade. The same dimming applies when *another* visual filters this table.
