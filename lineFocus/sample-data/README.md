# Line Focus — Sample Data

## `gdp-40-series.csv`

40 fake country GDP-like series over 12 quarters (2024 Q1 – 2026 Q4). Tall (long) shape — one row per Quarter × Country.

**Field mapping**
- `Quarter` → **Axis**
- `Country` → **Series**
- `Value` → **Value**

With 40 series bound, every line as a distinct color is unreadable — the incumbent's spaghetti failure mode. **Line Focus**' answer:

- **Focus → Hover** (default): all series render in light gray; hovering the chart spotlights whichever series is nearest the cursor. Instantly readable.
- **Focus → Click to pin**: click adds a series to a persistent focus set; click again to unpin. Set survives report reload.
- **Focus → Top-N** with `topN = 5`: automatically highlights the five countries with the highest final value.
- **Focus → Focus (0/1) measure**: bind a DAX flag measure (returns 1 for selected series, 0 otherwise) so a slicer or button controls the focused set. Direct downstream integration with report state.

Push **Fallback / Trellis threshold** to 30 (below 40) to trigger small-multiples fallback — every series gets its own mini-panel with a ghosted context, on a shared Y-scale.
