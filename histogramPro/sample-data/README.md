# Histogram Pro — Sample Data

## `normal-10k.csv`

10,000 draws from N(50, 10). One row per observation.

**Field mapping**
- `Id` → **Observation Key** (keeps every row a separate observation)
- `Value` → **Values**

## `two-groups-10k.csv`

5,000 draws each from N(35, 8) and N(55, 6). Bimodal composite distribution — a good showcase for overlay / stack / facet group modes.

**Field mapping**
- `Id` → **Observation Key**
- `Group` → **Compare Groups**
- `Value` → **Values**

## Toggles worth trying

- **Binning → Bin method**: cycle through FD, Sturges, Scott, Manual — bin count changes visibly.
- **Binning → Show bin-width slider**: drag the handle under the axis to explore bin sensitivity. Release persists to the manual width.
- **Density → Show KDE density curve** on: red smooth curve overlays the bars.
- **Annotations → Fit normal N(μ,σ) overlay**: dashed comparison line — on the two-groups sample it visibly deviates from the actual bimodal shape.
- **Bars → Group mode → Overlay / Facet / Stack** (with the two-groups sample).

## Interactions

- **Click a bin** to filter every other visual on the page by every observation whose value falls in that bin. Ctrl / Shift-click to add multiple bins.
- **Right-click** for the Power BI context menu.
- **Click empty space** to clear.
- **Interactions → Unselected opacity** controls how much non-selected bins fade. The same dimming applies when *another* visual filters this histogram.
- Cross-filter is enabled only for the **Overlay** group mode in v1; Facet and Stack modes get selection support in a future update.
