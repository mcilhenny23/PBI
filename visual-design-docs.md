# Power BI Custom Visuals — Claude Code Handoff Documents

Fifteen novel visuals, ordered by implementation ease (easiest first). Each document is self-contained: Claude Code should be able to scaffold, build, and package each visual from only its section below plus the Reference Architecture at the end.

**Build command for every visual:** `pbiviz new <projectName>`, then replace `capabilities.json`, `src/settings.ts`, `src/visual.ts`, `style/visual.less`, and `pbiviz.json`. Run `npx pbiviz package` to produce the `.pbiviz`.

**Conventions across all visuals:**
- TypeScript, D3 v7 (included in scaffold by default)
- Modern Formatting Model API (`FormattingSettingsService` / cards / slices)
- `privileges: []` in capabilities.json (no external access — certification safe)
- `events.renderingStarted()` at top of `update()`, `renderingFinished()` at bottom, `renderingFailed()` in catch
- Author name/email in `pbiviz.json` must be non-empty or build fails
- Every visual must handle: empty dataView, null/NaN values mid-series, tiny viewport, single data point
- `findValueIndex()` helper (see Reference Architecture) to locate data role columns by name

---

## Visual 01: Icon Arrays

**Ease: 20/20 · Demand: 3/5 · Est. build: 2–4 hours**

### Purpose
Medical risk communication / frequency framing. "17 of 100 people…" as a grid of icons where a proportion are highlighted. Decades of evidence it beats percentages for lay comprehension. Does not exist in any BI tool.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "value",    "kind": "Measure",  "displayName": "Value",    "description": "Count or proportion to highlight" },
    { "name": "total",    "kind": "Measure",  "displayName": "Total",    "description": "Denominator (default 100 if omitted)" },
    { "name": "category", "kind": "Grouping", "displayName": "Category", "description": "Optional — for multi-color segmented arrays" }
]
```

**DataViewMapping:** `categorical`. Categories optional; if absent, treat as single-segment.

### Format Pane

**Card: Array Layout**
- `gridColumns` — NumUpDown, default 10. Columns in the grid.
- `gridRows` — NumUpDown, default 10. Rows. Total icons = rows × columns.
- `fillOrder` — ItemDropdown: "row" | "column" | "random". Direction to fill highlighted icons.
- `iconShape` — ItemDropdown: "person" | "circle" | "square" | "heart". Bundled SVG paths.

**Card: Appearance**
- `highlightColor` — ColorPicker, default `#E74C3C`.
- `baseColor` — ColorPicker, default `#E0E0E0`.
- `iconSize` — NumUpDown, default 80 (% of available cell size).
- `iconSpacing` — NumUpDown, default 4 (px gap between icons).
- `showLabel` — ToggleSwitch, default true. Shows "17 of 100" below the grid.
- `labelFontSize` — NumUpDown, default 14.

### Rendering

**Algorithm:** Trivially compute `highlightCount = round(value / total * gridRows * gridColumns)`. If category grouping is present, allocate proportionally across segments (each segment gets its own color, filled in order).

**Renderer:** SVG. Create `gridRows × gridColumns` icon elements. Each icon is an SVG `<path>` or `<circle>` placed at grid position `(col * cellW, row * cellH)`. First `highlightCount` icons get `highlightColor`, rest get `baseColor`.

**Bundled icon paths** (define as string constants in a separate `icons.ts`):
- Person: simplified standing figure (~20 path commands)
- Circle: `<circle>`
- Square: `<rect>`
- Heart: standard heart bezier

**Edge cases:**
- Value > Total → clamp to total, all icons highlighted.
- Value < 0 → clamp to 0.
- No value field → show all icons in base color.
- Category with multiple segments → fill sequentially, each segment in its own color (use Power BI color palette `host.colorPalette.getColor()`).

### Test Cases
1. Value=17, Total=100, 10×10 grid → 17 colored icons.
2. Value=0.42 (proportion), Total omitted → treat as 42 of 100.
3. Three categories summing to 100 → three colors filling sequentially.
4. Resize to 50×50px → icons shrink, no overflow.
5. Empty data → blank canvas, no error.

### Certification Notes
Pure SVG, no external resources. Icon paths bundled as string constants. Trivially certifiable.

---

## Visual 02: Ternary Plot

**Ease: 20/20 · Demand: 2/5 · Est. build: 3–5 hours**

### Purpose
Three-component composition data plotted in an equilateral triangle. Standard in geology, materials science, soil science, chemistry. Absent from both Power BI and Tableau.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "componentA", "kind": "Measure", "displayName": "Component A" },
    { "name": "componentB", "kind": "Measure", "displayName": "Component B" },
    { "name": "componentC", "kind": "Measure", "displayName": "Component C" },
    { "name": "pointLabel",  "kind": "Grouping", "displayName": "Label",       "description": "Point label (optional)" },
    { "name": "colorBy",     "kind": "Measure",  "displayName": "Color Value", "description": "Optional continuous color encoding" },
    { "name": "sizeBy",      "kind": "Measure",  "displayName": "Size Value",  "description": "Optional size encoding" }
]
```

**DataViewMapping:** `categorical` with `pointLabel` as optional category.

### Format Pane

**Card: Triangle**
- `showGridlines` — ToggleSwitch, default true. Internal triangle gridlines at 10% intervals.
- `gridlineCount` — NumUpDown, default 10. Number of divisions per side.
- `axisLabelA/B/C` — TextInput (or just use the measure display names from the dataView).
- `normalizeValues` — ToggleSwitch, default true. Auto-normalize A+B+C to sum=1.

**Card: Points**
- `pointRadius` — NumUpDown, default 5.
- `pointColor` — ColorPicker, default `#4682B4`.
- `pointOpacity` — NumUpDown, default 80.
- `showLabels` — ToggleSwitch, default false.
- `labelFontSize` — NumUpDown, default 10.

**Card: Color Scale** (visible only when `colorBy` is bound)
- `colorScaleLow` — ColorPicker, default `#ffffcc`.
- `colorScaleHigh` — ColorPicker, default `#006837`.

### Rendering

**Algorithm — Barycentric to Cartesian:**
Given normalized components (a, b, c) where a+b+c=1:
```
// Equilateral triangle with vertices at:
// A = top = (width/2, margin)
// B = bottom-left = (margin, height-margin)  
// C = bottom-right = (width-margin, height-margin)
x = 0.5 * (2*b + c) / (a + b + c)
y = (sqrt(3)/2) * c / (a + b + c)
// Then scale to pixel coordinates within the triangle bounds
```

If `normalizeValues` is on, divide each component by the row sum. If off, reject rows where sum ≠ 1 (within tolerance).

**Renderer:** SVG.
1. Draw the equilateral triangle outline (three `<line>` elements or a `<polygon>`).
2. Draw gridlines: for each division, connect corresponding points on each pair of sides.
3. Draw axis labels at each vertex (A top, B bottom-left, C bottom-right).
4. Draw tick labels along each side at grid intervals.
5. Plot data points as `<circle>` elements at computed (x, y).
6. If `colorBy` is bound, apply a `d3.scaleLinear` color interpolation.
7. If `sizeBy` is bound, apply a `d3.scaleSqrt` radius mapping.

**Edge cases:**
- Negative component values → clamp to 0.
- All three components = 0 for a row → skip that point.
- Only two components provided (C missing) → derive C = 1 - A - B if normalize is on.

### Test Cases
1. Three soil samples with sand/silt/clay percentages → points inside triangle.
2. A point at (1, 0, 0) → renders exactly at vertex A.
3. Color-by pH value → gradient from yellow to green.
4. 500 points → performance stays smooth (SVG circles).
5. Non-normalized values (e.g. 30, 50, 20) with normalize=on → same as (0.3, 0.5, 0.2).

### Certification Notes
Pure math, pure SVG. No dependencies beyond D3. Trivially certifiable.

---

## Visual 03: Quantile Dotplot

**Ease: 19/20 · Demand: 3/5 · Est. build: 3–5 hours**

### Purpose
Represent a distribution as 20–100 discrete dots so a reader can literally count risk. Proven better than error bars for lay decision-making (Kay, Hullman et al.). Zero competition in BI.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "samples",  "kind": "Measure",  "displayName": "Sample Values", "description": "Raw sample values from which to compute quantiles" },
    { "name": "category", "kind": "Grouping", "displayName": "Category",      "description": "Optional grouping — produces side-by-side dotplots" }
]
```

**DataViewMapping:** `categorical`. If no category, treat as single group. The `samples` measure will have one value per row — the visual computes quantiles from these.

**Alternative mode (precomputed quantiles):** If the user provides exactly N values where N matches dotCount, treat them as precomputed quantile values directly. Detect this by checking if row count equals `dotCount` setting.

### Format Pane

**Card: Dotplot**
- `dotCount` — NumUpDown, default 20. Number of dots (= number of quantiles). Common values: 20, 50, 100.
- `dotRadius` — NumUpDown, default 6.
- `dotColor` — ColorPicker, default `#4682B4`.
- `dotOpacity` — NumUpDown, default 85.
- `orientation` — ItemDropdown: "horizontal" | "vertical". Axis direction.

**Card: Threshold**
- `showThreshold` — ToggleSwitch, default false.
- `thresholdValue` — NumUpDown, default 0. The reference line.
- `thresholdColor` — ColorPicker, default `#E74C3C`.
- `showCountAnnotation` — ToggleSwitch, default true. "X of Y dots below threshold."

**Card: Axis**
- `showAxis` — ToggleSwitch, default true.
- `fontSize` — NumUpDown, default 11.

### Rendering

**Algorithm:**

1. **Compute quantiles:** Sort the sample values. For `dotCount` = N, compute quantile values at positions `(i + 0.5) / N` for i in `[0, N)` using `d3.quantileSorted()`.

2. **Bin the quantile values:** Create bins along the value axis. Each bin's width should be ~ `(max - min) / (N * 0.4)` (tunable). Assign each quantile dot to its bin.

3. **Stack dots within each bin:** Within each bin, stack dots vertically (Wilkinson dot-plot style). The first dot sits on the axis; subsequent dots in the same bin stack above it.

4. **Render:** SVG circles at computed positions. Draw the value axis. If threshold is on, draw a vertical (or horizontal) reference line and annotate the count.

**Renderer:** SVG. Scale: `d3.scaleLinear` for the value axis; dot positions computed manually.

**Wilkinson dot-packing simplified:** For each bin, count how many dots fall in it. Place them in a column: y-position = bin_center, x-positions stacked at `dotRadius * 2 * stackIndex`. This is the simple version; the full Wilkinson algorithm does overlap-free packing with variable bin widths, but the simple column-stack is sufficient for a first version.

### Edge cases
- Fewer samples than dotCount → use sample count as dot count.
- All identical values → all dots stack in one column.
- Single sample → one dot at that value.
- Category grouping → compute separate dotplots per category, arranged as small multiples or side-by-side.

### Test Cases
1. 1000 normally-distributed samples, dotCount=20 → bell-curve-shaped dot stack.
2. Bimodal distribution → two clusters of dots.
3. Threshold at 0, ~30% of dots below → annotation reads "6 of 20 below 0."
4. DotCount=100 with narrow viewport → dots shrink to fit.
5. Five categories → five side-by-side dotplots.

### Certification Notes
Pure computation (sorting + quantile calculation). No external access. Trivially certifiable.

---

## Visual 04: Fan Chart

**Ease: 19/20 · Demand: 4/5 · Est. build: 3–5 hours**

### Purpose
Central-bank-style forecast fan with nested prediction bands. Already built as a reference implementation — see the `fanChart/` project directory.

### Reference Implementation
This visual has been fully implemented and compiled. Use the existing `fanChart/` project as the canonical implementation. The source files are:
- `capabilities.json` — 8 data roles (axis + central + actuals + 3 upper/lower band pairs)
- `src/settings.ts` — 2 format cards (Fan Appearance + Axes)
- `src/visual.ts` — ~200 lines of D3 area rendering
- `style/visual.less` — minimal styles

**To rebuild:** `npm install && npx pbiviz package`

**Key patterns to replicate in other visuals:**
- `findValueIndex()` helper for locating data role columns
- `safeNum()` helper for null/NaN-safe numeric parsing
- Band rendering: outermost first (most transparent), innermost on top
- Curve factory selector for interpolation options
- Gridlines rendered before data, axes rendered after

### Enhancement backlog (v1.1)
- Tooltips on hover showing exact band values at each time point
- Landing page with instructions when no data bound
- Cross-highlight support
- Theme-aware colors via `host.colorPalette`

---

## Visual 05: Hypothetical Outcome Plots (HOPs)

**Ease: 17/20 · Demand: 3/5 · Est. build: 4–6 hours**

### Purpose
Animate independent draws from a distribution instead of showing a static interval. The reader sees uncertainty as motion/flicker. Compelling for forecasts where every ML prediction ships with an interval nobody renders well.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "axis",    "kind": "Grouping", "displayName": "Axis",           "description": "X axis (time, category)" },
    { "name": "samples", "kind": "Measure",  "displayName": "Sample Values",  "description": "Sample draws — each row is one observation. If multiple measures, each is a draw." },
    { "name": "actuals", "kind": "Measure",  "displayName": "Actuals",        "description": "Historical actuals line (optional)" }
]
```

**DataViewMapping:** `categorical`. This visual has two operating modes:

**Mode A — Single value column, many rows per axis category:** The visual groups by axis, collects all sample values per category, and on each animation frame draws one value per category to form a plausible outcome line.

**Mode B — Multiple measure columns:** Each measure column is a pre-drawn ensemble member (e.g. model run 1, model run 2, ...). On each frame, the visual shows one randomly-selected column as a line.

Auto-detect: if there's one `samples` measure, use Mode A. If multiple measures are bound, use Mode B.

### Format Pane

**Card: Animation**
- `frameRate` — NumUpDown, default 4 (frames per second). Range 1–15.
- `frameCount` — NumUpDown, default 50. Number of pre-drawn outcome frames.
- `pauseOnHover` — ToggleSwitch, default true.
- `showTrail` — ToggleSwitch, default false. Ghost previous N frames at low opacity.
- `trailCount` — NumUpDown, default 3. Number of trailing ghosts (when showTrail=on).
- `trailOpacity` — NumUpDown, default 15. Opacity of trails (%).

**Card: Lines**
- `outcomeColor` — ColorPicker, default `#4682B4`.
- `outcomeWidth` — NumUpDown, default 2.
- `actualsColor` — ColorPicker, default `#333333`.
- `actualsWidth` — NumUpDown, default 2.5.
- `curveType` — ItemDropdown: "linear" | "monotone" | "basis" | "step".

**Card: Axes**
- Same as Fan Chart (showXAxis, showYAxis, showGridlines, fontSize).

### Rendering

**Algorithm:**

1. **Pre-generate frames:** At `update()` time, generate `frameCount` outcome paths:
   - Mode A: for each frame, randomly sample one value per axis category from that category's pool.
   - Mode B: for each frame, randomly select one measure column.
   Store as an array of `{category, value}[]` arrays.

2. **Animation loop:** Use `requestAnimationFrame` with a frame-rate limiter (track elapsed time, only advance when `elapsed >= 1000/frameRate`). On each frame:
   - Update the "current outcome" line path.
   - If `showTrail`, maintain a circular buffer of previous frame paths, render each at decreasing opacity.

3. **Lifecycle management — critical:** 
   - Start the animation loop in `update()`.
   - Cancel any existing loop (`cancelAnimationFrame`) before starting a new one.
   - If the visual is destroyed or hidden, stop the loop. Use `document.addEventListener('visibilitychange')` and clean up in `destroy()` if implementing `IVisual.destroy`.
   - On hover (if `pauseOnHover`), set a flag that skips frame advancement.

**Renderer:** SVG. One persistent `<path>` for the current outcome, plus `trailCount` persistent ghost `<path>` elements. Update `d` attributes on each frame — no DOM creation/destruction in the hot loop.

### Edge cases
- Only one data point per category → single dot that jumps vertically.
- Actuals line ends partway → draw actuals only where non-null.
- frameRate = 1 → slow pulse, one outcome per second.
- Tiny viewport → suppress axis labels but keep animation running.

### Test Cases
1. Normal distribution samples, 12 months → smooth animated line bobbing around a center.
2. High-variance distribution → wild swings frame-to-frame.
3. Pause on hover → line freezes, resumes on mouseout.
4. Trail mode with 3 ghosts → current line + 3 fading prior lines.
5. Resize during animation → scales adjust, animation continues without restart.

### Certification Notes
Animation loop must be properly managed (no leaked intervals). Reviewers will check for runaway `requestAnimationFrame` / `setInterval`. Always cancel before starting a new loop. No external access. Certifiable.

---

## Visual 06: Wafer Map

**Ease: 17/20 · Demand: 3/5 · Est. build: 4–6 hours**

### Purpose
Semiconductor yield visualization. Die-level pass/fail or bin code across a circular wafer with optional radial-zone analysis. Massive well-funded industry, ancient yield software, no BI visual exists.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "dieX",    "kind": "Grouping", "displayName": "Die X",     "description": "Column index of the die" },
    { "name": "dieY",    "kind": "Grouping", "displayName": "Die Y",     "description": "Row index of the die" },
    { "name": "binCode", "kind": "Grouping", "displayName": "Bin / Status", "description": "Pass/fail, bin code, or category" },
    { "name": "value",   "kind": "Measure",  "displayName": "Value",     "description": "Optional continuous measure (yield, resistance, etc.)" },
    { "name": "waferID", "kind": "Grouping", "displayName": "Wafer ID",  "description": "Optional — for small-multiples across wafers" }
]
```

**DataViewMapping:** `categorical` with `dieX` + `dieY` as categories. Row count = dies per wafer (typically 200–2000), well within `dataReduction` limits.

### Format Pane

**Card: Wafer**
- `waferShape` — ItemDropdown: "circle" | "rectangle". Default "circle".
- `notchPosition` — ItemDropdown: "bottom" | "top" | "left" | "right". Default "bottom".
- `edgeExclusion` — NumUpDown, default 0. Number of die rows to exclude at wafer edge.
- `showNotch` — ToggleSwitch, default true.

**Card: Die Appearance**
- `dieGap` — NumUpDown, default 1. Pixels between dies.
- `dieBorderColor` — ColorPicker, default `#cccccc`.
- `dieBorderWidth` — NumUpDown, default 0.
- `colorMode` — ItemDropdown: "categorical" (use binCode colors) | "continuous" (use value gradient).

**Card: Color Scale** (continuous mode)
- `colorScaleLow` — ColorPicker, default `#d73027`.
- `colorScaleMid` — ColorPicker, default `#ffffbf`.
- `colorScaleHigh` — ColorPicker, default `#1a9850`.

**Card: Zone Overlay**
- `showZones` — ToggleSwitch, default false.
- `zoneCount` — NumUpDown, default 3. Concentric ring zones (center / mid / edge).
- `zoneLineColor` — ColorPicker, default `#000000`.
- `zoneLineOpacity` — NumUpDown, default 40.

### Rendering

**Algorithm:**

1. Parse die grid: find the extent of dieX and dieY values. Compute cell size from viewport and grid dimensions.
2. Compute wafer center and radius from the grid extent.
3. For each die, compute pixel position. If `waferShape` = circle, cull dies whose center falls outside the wafer radius (minus edge exclusion).
4. Color each die by binCode (categorical) or value (continuous scale).
5. If `showZones`, draw concentric circles at `radius * (i/zoneCount)`.
6. Draw notch indicator (small triangle or flat at the edge).

**Renderer:** Use **Canvas** if die count > 500 (common); SVG for < 500. The switch threshold can be hardcoded. For Canvas, draw `fillRect` for each die, then overlay zone circles and notch with SVG or Canvas arcs.

**Practical Canvas approach:** Create a `<canvas>` element sized to the viewport. On `update()`, clear and redraw all dies as filled rectangles. Overlay a `<svg>` on top (absolute positioned) for the zone circles and notch — SVG handles the vector overlays cleanly while Canvas handles the die density.

### Edge cases
- Non-contiguous die coordinates (gaps in the grid) → leave empty cells.
- Single die → renders as one colored cell.
- No binCode or value → all dies in default gray.
- Very large wafer (2000+ dies) → Canvas handles this fine.

### Test Cases
1. Standard 200mm wafer, ~600 dies, 5 bin codes → colored die map in a circle.
2. Edge exclusion = 2 → outermost 2 rings of dies hidden.
3. Continuous value mode → gradient from red (low yield) to green (high yield).
4. Zone overlay with 3 rings → visible center/mid/edge boundaries.
5. Small-multiples: 4 wafers → 2×2 grid of mini wafer maps.

### Certification Notes
Canvas + SVG hybrid is fine for certification. No external resources. Safe.

---

## Visual 07: Adjacency Matrix Network View

**Ease: 15/20 · Demand: 3/5 · Est. build: 1–2 days**

### Purpose
The alternative to node-link network diagrams that actually scales. Rows and columns are nodes; cell intensity = edge weight. Reorder rows/columns by clustering to reveal community structure. Bertin described this in 1967; it still doesn't exist in any BI tool.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "source", "kind": "Grouping", "displayName": "Source Node" },
    { "name": "target", "kind": "Grouping", "displayName": "Target Node" },
    { "name": "weight", "kind": "Measure",  "displayName": "Weight",      "description": "Edge weight / intensity" }
]
```

**DataViewMapping:** `categorical` with source + target as categories. Each row is an edge. The visual builds the adjacency matrix client-side.

### Format Pane

**Card: Matrix**
- `seriation` — ItemDropdown: "none" | "alphabetical" | "cluster" | "degree". Default "cluster". Row/column ordering strategy.
- `symmetric` — ToggleSwitch, default true. If true, mirror upper/lower triangle.
- `cellShape` — ItemDropdown: "square" | "circle". Default "square".
- `showDiagonal` — ToggleSwitch, default true.

**Card: Color**
- `colorRampLow` — ColorPicker, default `#f7f7f7`.
- `colorRampHigh` — ColorPicker, default `#2166ac`.
- `colorScale` — ItemDropdown: "linear" | "log" | "sqrt". Default "linear".

**Card: Labels**
- `showLabels` — ToggleSwitch, default true.
- `labelFontSize` — NumUpDown, default 10.
- `maxLabelLength` — NumUpDown, default 20. Truncate long node names.
- `labelPosition` — ItemDropdown: "outside" | "inside". Default "outside".

**Card: Cluster Boundaries**
- `showClusterBoundaries` — ToggleSwitch, default true. Draw lines between clusters (only when seriation = "cluster").
- `clusterBoundaryColor` — ColorPicker, default `#333333`.

### Rendering

**Algorithm:**

1. **Build the matrix:** Extract unique nodes from source ∪ target. Create an N×N matrix initialized to 0. For each edge row, set `matrix[sourceIdx][targetIdx] = weight`. If `symmetric`, also set `matrix[targetIdx][sourceIdx] = weight`.

2. **Seriation (row/column reordering):**
   - "none" / "alphabetical" — sort nodes by name.
   - "degree" — sort by node degree (sum of edge weights).
   - "cluster" — **hierarchical clustering on the adjacency vectors:**
     a. Treat each row of the matrix as a feature vector.
     b. Compute pairwise distances (Euclidean or cosine).
     c. Build a dendrogram via agglomerative clustering (average linkage).
     d. Extract leaf order from the dendrogram (optimal leaf ordering if feasible; simple DFS order otherwise).
     This is the most valuable seriation method — it groups densely-connected nodes together, revealing block-diagonal structure.

   **Implementation notes for clustering:** Implement a simple agglomerative clustering in pure TypeScript. For N nodes, the distance matrix is N×N; for N < 500 this is fast. For N > 500, fall back to degree ordering. Libraries like `ml-hclust` exist but add audit burden — a ~100-line agglomerative routine is cleaner for certification.

3. **Render:** **Canvas** for the cells (N×N cells can be thousands), SVG overlay for labels and cluster boundaries.
   - Compute cell size = `min(plotW, plotH) / N`.
   - For each cell, draw a filled rect (or circle) with color from `d3.scaleLinear/Log/Sqrt` mapped to weight.
   - Draw row/column labels in SVG at the margins.
   - If cluster boundaries are on, identify where the cluster ordering changes group and draw separating lines.

**Level-of-detail:** If `cellSize < 3px`, hide labels. If `N > 200`, force Canvas mode regardless.

### Edge cases
- Self-loops (source = target) → show on the diagonal.
- Directed network (symmetric = off) → full matrix, not mirrored.
- Missing edges → cell stays at `colorRampLow` (weight = 0).
- Single node → 1×1 matrix (degenerate but shouldn't crash).

### Test Cases
1. 20-node social network → clear block-diagonal structure with cluster seriation.
2. 100 nodes → Canvas render, labels visible at sufficient viewport size.
3. Directed graph (symmetric off) → asymmetric matrix.
4. Log color scale on heavy-tailed weights → better visual discrimination.
5. Alphabetical vs. cluster ordering toggle → same data, different structure revealed.

### Certification Notes
All computation is pure TypeScript (clustering, matrix construction). Canvas + SVG overlay. No external resources. Certifiable.

---

## Visual 08: Interval-Track Viewer

**Ease: 13/20 · Demand: 4/5 · Est. build: 2–3 days**

### Purpose
The genome-browser idiom generalized: stacked horizontal tracks of intervals and point events on a shared zoomable axis. Machine-state timelines, shift schedules, log events, outage windows, order lifecycles. "Gantt for dense analytical data." Nothing in either platform handles thousands of intervals gracefully. The most broadly reusable primitive on the list.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "track",    "kind": "Grouping", "displayName": "Track / Lane", "description": "Groups intervals into horizontal tracks" },
    { "name": "start",    "kind": "Grouping", "displayName": "Start",        "description": "Interval start (time or numeric)" },
    { "name": "end",      "kind": "Grouping", "displayName": "End",          "description": "Interval end (omit for point events)" },
    { "name": "label",    "kind": "Grouping", "displayName": "Label",        "description": "Text label for the interval (optional)" },
    { "name": "category", "kind": "Grouping", "displayName": "Category",     "description": "Color category (optional)" },
    { "name": "value",    "kind": "Measure",  "displayName": "Value",        "description": "Optional numeric value for intensity encoding" }
]
```

**DataViewMapping:** `table` (need row-level access to start/end per interval). Set `dataReductionAlgorithm: { window: { count: 30000 } }`.

### Format Pane

**Card: Tracks**
- `trackHeight` — NumUpDown, default 24. Pixel height per sub-lane within a track.
- `trackGap` — NumUpDown, default 8. Gap between tracks.
- `trackLabelWidth` — NumUpDown, default 100. Left margin for track labels.
- `trackLabelFontSize` — NumUpDown, default 12.
- `packingMode` — ItemDropdown: "stack" | "overlap" | "collapse". Default "stack". Stack = collision-free lane packing; overlap = all on one row with transparency; collapse = one row, clip.

**Card: Intervals**
- `intervalHeight` — NumUpDown, default 18. Height of interval bars.
- `intervalRadius` — NumUpDown, default 3. Corner radius.
- `intervalOpacity` — NumUpDown, default 85.
- `showLabels` — ToggleSwitch, default true. Text inside intervals.
- `labelFontSize` — NumUpDown, default 10.
- `pointEventRadius` — NumUpDown, default 4. For events without an end time.

**Card: Axis & Zoom**
- `showAxis` — ToggleSwitch, default true.
- `axisFontSize` — NumUpDown, default 11.
- `enableZoom` — ToggleSwitch, default true. Mouse wheel zoom + drag pan on the time axis.

### Rendering

**Algorithm:**

1. **Parse intervals:** From the table dataView, extract each row as `{track, start, end, label, category, value}`. Parse start/end as dates (if Date type) or numbers.

2. **Sort and group by track:** Group intervals by track name. Within each track, sort by start time.

3. **Lane packing (when packingMode = "stack"):** For each track, use a greedy interval-scheduling algorithm:
   - Maintain an array of lanes, each tracking the latest end time.
   - For each interval (sorted by start), assign to the first lane where `interval.start >= lane.latestEnd`. If no lane fits, create a new lane.
   - This gives collision-free stacking with minimal lane count.

4. **Scales:**
   - X: `d3.scaleTime` (or `d3.scaleLinear`) from the global min(start) to max(end).
   - Y: computed from track heights + lane counts + gaps.

5. **Zoom/Pan:** Use `d3.zoom()` bound to the X scale only (lock Y). On zoom, recompute visible window, re-filter intervals to the visible range, redraw.

6. **Virtualization:** Only render intervals that overlap the visible X window. For 30k intervals, this is essential — the visible set is typically <500 at any zoom level.

**Renderer:** **Canvas** for interval bars (density demands it), **SVG overlay** for labels, axis, and hover highlights. The Canvas layer draws filled rounded-rects for intervals, diamonds for point events. The SVG layer handles text (Canvas text is blurry at non-integer coordinates) and interaction targets.

**Point events:** If `end` is null/missing for a row, render as a diamond or circle at the `start` position.

### Edge cases
- Overlapping intervals in "overlap" mode → render with transparency, darker where overlapping.
- Zero-duration intervals (start = end) → treat as point events.
- All intervals in one track → single tall track with many lanes.
- Zoom out fully → all intervals visible, may become sub-pixel → switch to density rendering (colored band per track).
- Date vs. numeric start/end → detect from dataView column type, use appropriate scale.

### Test Cases
1. Machine states (running/idle/fault) across 5 machines, 1 week → 5 tracks, colored by state.
2. 10,000 log events → Canvas performance holds, zoom to explore.
3. Mixed intervals and point events → bars and diamonds coexist.
4. Zoom into one hour of a 30-day view → smooth transition, only relevant intervals render.
5. Single track with 200 overlapping shifts → stack mode produces ~5 lanes.

### Certification Notes
`d3.zoom()` is standard and audit-safe. Canvas + SVG layering is clean. No external resources. Certifiable, though the reviewer may spend more time reading the virtualization logic.

---

## Visual 09: Spectrogram

**Ease: 13/20 · Demand: 4/5 · Est. build: 2–3 days**

### Purpose
Vibration/acoustic signal → time×frequency×magnitude heatmap via sliding-window FFT. Serves the entire predictive-maintenance / condition-monitoring space. Currently requires MATLAB or specialized vibration software.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "timeIndex", "kind": "Grouping", "displayName": "Time / Sample Index", "description": "Ordered sample position" },
    { "name": "amplitude", "kind": "Measure",  "displayName": "Amplitude",           "description": "Signal amplitude at each sample" },
    { "name": "sensor",    "kind": "Grouping", "displayName": "Sensor",              "description": "Optional — small-multiples per sensor" }
]
```

**DataViewMapping:** `categorical`, ordered by `timeIndex`. Data reduction: `top: { count: 30000 }`.

### Format Pane

**Card: FFT Settings**
- `windowSize` — ItemDropdown: "64" | "128" | "256" | "512" | "1024" | "2048". Default "256". Powers of 2 for radix-2 FFT.
- `overlapPercent` — NumUpDown, default 50. Window overlap (0–90%).
- `windowFunction` — ItemDropdown: "hann" | "hamming" | "blackman" | "rectangular". Default "hann".

**Card: Display**
- `frequencyScale` — ItemDropdown: "linear" | "log". Default "linear".
- `magnitudeScale` — ItemDropdown: "linear" | "dB". Default "dB". dB = `20 * log10(magnitude)`.
- `colorRamp` — ItemDropdown: "viridis" | "inferno" | "magma" | "plasma" | "turbo". Default "viridis".
- `minMagnitude` — NumUpDown, default -80. Floor for dB scale (clamp below this).
- `maxMagnitude` — NumUpDown, default 0. Ceiling for dB scale.

**Card: Alarm Bands**
- `showAlarmBands` — ToggleSwitch, default false.
- `alarmBand1Low` — NumUpDown (Hz). Low frequency of alarm band.
- `alarmBand1High` — NumUpDown (Hz). High frequency of alarm band.
- `alarmBand1Color` — ColorPicker, default `#ff000040` (semi-transparent red).

**Card: Axis**
- `showTimeAxis` — ToggleSwitch, default true.
- `showFreqAxis` — ToggleSwitch, default true.
- `sampleRate` — NumUpDown, default 1000. Samples per second (needed to compute Hz scale).
- `fontSize` — NumUpDown, default 11.

### Rendering

**Algorithm:**

1. **Extract signal:** Read amplitude values in timeIndex order as a flat `Float64Array`.

2. **Apply window function:** For each sliding window of `windowSize` samples, with `overlapPercent` overlap:
   a. Multiply by the selected window function (Hann, Hamming, Blackman, or rectangular).
   b. This produces `numWindows = floor((signalLength - windowSize) / hopSize) + 1` windows, where `hopSize = windowSize * (1 - overlapPercent/100)`.

3. **FFT each window:** Use a pure-TypeScript radix-2 FFT implementation. Output: `windowSize/2 + 1` complex values per window. Compute magnitude = `sqrt(re² + im²)`.

4. **Build the spectrogram matrix:** `numWindows` columns × `(windowSize/2 + 1)` rows. Each cell = magnitude (or `20*log10(magnitude)` for dB).

5. **Render on Canvas:** Map each cell to a pixel (or small rectangle) colored by the magnitude via the selected color ramp (use D3 `d3.interpolateViridis` etc.).

**FFT implementation:** Implement Cooley-Tukey radix-2 DIT in pure TypeScript (~40 lines). Do NOT use WASM or external FFT libraries — a simple in-place butterfly FFT is fast enough for N≤2048 windows and keeps the certification audit trivial.

```typescript
// Pseudocode for in-place radix-2 FFT
function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    // Bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { swap(re, i, j); swap(im, i, j); }
    }
    // Butterfly stages
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len;
        const wRe = Math.cos(ang), wIm = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let curRe = 1, curIm = 0;
            for (let j = 0; j < len / 2; j++) {
                const uRe = re[i+j], uIm = im[i+j];
                const vRe = re[i+j+len/2]*curRe - im[i+j+len/2]*curIm;
                const vIm = re[i+j+len/2]*curIm + im[i+j+len/2]*curRe;
                re[i+j] = uRe + vRe; im[i+j] = uIm + vIm;
                re[i+j+len/2] = uRe - vRe; im[i+j+len/2] = uIm - vIm;
                const tmpRe = curRe*wRe - curIm*wIm;
                curIm = curRe*wIm + curIm*wRe;
                curRe = tmpRe;
            }
        }
    }
}
```

**Window functions:**
```typescript
function hann(i: number, N: number): number { return 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1))); }
function hamming(i: number, N: number): number { return 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (N - 1)); }
function blackman(i: number, N: number): number {
    return 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (N - 1));
}
```

**Renderer:** Canvas. `putImageData()` for the spectrogram cells. SVG overlay for axes and alarm band rectangles.

### Edge cases
- Signal shorter than windowSize → no spectrogram, show message "Insufficient data."
- All-zero signal → flat spectrogram at minimum magnitude.
- Very long signal (30k samples) → may produce hundreds of windows; Canvas handles it.
- No sampleRate set → label frequency axis as "bins" not Hz.

### Test Cases
1. Pure 440Hz sine wave → single bright horizontal line at 440Hz.
2. Chirp signal (frequency sweeps up) → diagonal bright line.
3. White noise → uniform spectrogram.
4. dB vs. linear scale toggle → dramatic difference in visual contrast.
5. Alarm band overlay at 100–200Hz → red rectangle overlaid on the spectrogram.

### Certification Notes
Pure TypeScript FFT, no WASM, no external resources. Canvas rendering. Certifiable. The FFT implementation should be well-commented for the reviewer.

---

## Visual 10: Matrix Profile

**Ease: 13/20 · Demand: 4/5 · Est. build: 2–3 days**

### Purpose
Anomaly discovery in time series via the UCR matrix profile algorithm. Finds motifs (repeated patterns) and discords (anomalies) with near-zero parameter tuning. Renders the profile beneath the series with highlighted motif/discord spans. Gives BI users genuine anomaly *discovery*, not just threshold alerts.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "timeIndex", "kind": "Grouping", "displayName": "Time / Index" },
    { "name": "value",     "kind": "Measure",  "displayName": "Value" }
]
```

**DataViewMapping:** `categorical`, ordered by timeIndex. `dataReduction: { top: { count: 30000 } }`.

### Format Pane

**Card: Matrix Profile**
- `windowLength` — NumUpDown, default 50. Subsequence length m. This is the only real parameter.
- `motifCount` — NumUpDown, default 3. Number of top motif pairs to highlight.
- `discordCount` — NumUpDown, default 3. Number of top discords to highlight.
- `exclusionZone` — NumUpDown, default 50. Percentage of window length to use as exclusion zone (default = m/2, expressed as % of m).

**Card: Display**
- `profileHeight` — NumUpDown, default 30. Height of the profile strip as % of total visual height.
- `motifColor` — ColorPicker, default `#2ca02c`.
- `discordColor` — ColorPicker, default `#d62728`.
- `seriesColor` — ColorPicker, default `#1f77b4`.
- `profileColor` — ColorPicker, default `#7f7f7f`.
- `showMotifConnectors` — ToggleSwitch, default true. Draw arcs connecting motif pairs.
- `highlightOpacity` — NumUpDown, default 30.

**Card: Axis**
- `showAxis` — ToggleSwitch, default true.
- `fontSize` — NumUpDown, default 11.

### Rendering

**Algorithm — STOMP (Scalable Time series Ordered-search Matrix Profile):**

This is the core computation. STOMP computes the matrix profile in O(n² ) time using the dot-product update trick. For a BI visual with n ≤ 30k and m ~ 50-200, this is feasible in-browser (a few seconds).

Implementation outline:
1. Compute the z-normalized dot product of the first subsequence against all others using FFT (or direct computation for simplicity — direct is O(nm) but with small m is often faster than FFT overhead for n < 10k).
2. For each subsequent subsequence, update the dot products incrementally.
3. Track the minimum distance and its index for each position → this is the matrix profile (MP) and matrix profile index (MPI).
4. **Motifs:** Find the position with the smallest MP value (and its MPI partner). Exclude the zone around both, repeat for `motifCount`.
5. **Discords:** Find the position with the largest MP value. Exclude zone, repeat for `discordCount`.

**Simplified approach for v1:** If full STOMP is too complex for a first pass, implement the naive O(n²m) approach with z-normalization:
```
for each i in [0, n-m]:
    for each j in [i + exclusionZone, n-m]:
        dist = znormEuclidean(series[i:i+m], series[j:j+m])
        if dist < MP[i]: MP[i] = dist; MPI[i] = j
        if dist < MP[j]: MP[j] = dist; MPI[j] = i
```
This is O(n²m) but for n=5000, m=50, it's ~1.25 billion operations — too slow. Use the STOMP QT trick or limit to n < 5000 for the naive version.

**Recommended approach:** Implement STOMP with the mass() function (Mueen's Algorithm for Similarity Search) which uses FFT for each query:
```
function mass(query: Float64Array, series: Float64Array): Float64Array {
    // Returns the distance profile of query against all subsequences of series
    // Uses dot product via FFT, then converts to z-normalized Euclidean distance
}
```
The FFT routine is already needed for the Spectrogram visual, so share the implementation.

**Renderer:** SVG (two panels).

**Top panel (series + highlights):** 
- Draw the time series as a `d3.line` path.
- For each motif pair, draw highlighted rectangles over the two matched subsequences in `motifColor` with `highlightOpacity`.
- For each discord, draw a highlighted rectangle in `discordColor`.
- If `showMotifConnectors`, draw an arc from the center of each motif to its pair.

**Bottom panel (matrix profile strip):**
- Draw the profile as an area chart (or line), height-mapped, with the profile color.
- Shared X axis between the two panels.

### Edge cases
- Series shorter than windowLength → show message "Series too short for window length m."
- Constant series → all distances = 0, everything is a motif.
- windowLength = 1 → degenerate, show warning.
- Very long series (>10k) → show progress indicator or limit to first 10k with warning.

### Test Cases
1. Synthetic series with a repeated pattern → motif pair highlighted at both occurrences.
2. Series with one spike → discord highlighted at the spike.
3. ECG-like periodic signal → many motifs, no strong discords.
4. Random walk → no clear motifs, discords at extreme excursions.
5. windowLength slider change → profile recomputes, highlights shift.

### Certification Notes
All computation in pure TypeScript. Share FFT implementation with Spectrogram. No external resources. Certifiable, but the reviewer will spend time reading the STOMP algorithm — comment it well.

---

## Visual 11: Order Book / Market-Depth Heatmap

**Ease: 12/20 · Demand: 3/5 · Est. build: 2–3 days**

### Purpose
Bookmap-style price-level liquidity over time as a density heatmap. Exists only in trading platforms, never in BI. Treasury and energy-trading desks that already use Power BI for portfolio analytics have no way to visualize market microstructure.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "time",       "kind": "Grouping", "displayName": "Time",        "description": "Timestamp" },
    { "name": "priceLevel", "kind": "Grouping", "displayName": "Price Level", "description": "Price or price bucket" },
    { "name": "size",       "kind": "Measure",  "displayName": "Size / Liquidity", "description": "Order book depth at this price/time" },
    { "name": "trades",     "kind": "Measure",  "displayName": "Trade Volume",     "description": "Optional — executed trades overlay" }
]
```

**DataViewMapping:** `categorical` with time + priceLevel as dual categories. This produces a matrix-like structure. Alternatively, use `table` mapping and pivot client-side. Row count = time_steps × price_levels — can be large; set `dataReduction: { top: { count: 30000 } }`.

### Format Pane

**Card: Heatmap**
- `colorRamp` — ItemDropdown: "viridis" | "inferno" | "blues" | "greens" | "oranges". Default "blues".
- `intensityScale` — ItemDropdown: "linear" | "log" | "sqrt". Default "log".
- `cellInterpolation` — ItemDropdown: "nearest" | "bilinear". Default "nearest".

**Card: Trade Overlay**
- `showTrades` — ToggleSwitch, default true.
- `tradeColor` — ColorPicker, default `#ffffff`.
- `tradeMinRadius` — NumUpDown, default 2.
- `tradeMaxRadius` — NumUpDown, default 12.

**Card: Reference Lines**
- `showBestBid` — ToggleSwitch, default false.
- `bestBidColor` — ColorPicker, default `#00cc00`.
- `showBestAsk` — ToggleSwitch, default false.
- `bestAskColor` — ColorPicker, default `#cc0000`.

**Card: Axes**
- Standard axis controls (show, font size).

### Rendering

**Algorithm:**
1. Pivot the data into a 2D matrix: rows = price levels (sorted), columns = time steps (sorted). Cell value = size/liquidity.
2. Normalize values and map through the color ramp + intensity scale.
3. Render as a Canvas heatmap (each cell = a small filled rectangle).
4. Overlay trade markers as circles with radius proportional to trade volume.
5. If best-bid/ask lines are enabled, identify the best bid (highest price with nonzero size on the buy side) and best ask (lowest price with nonzero size on the sell side) at each time step, and draw them as lines.

**Renderer:** Canvas for the heatmap, SVG overlay for trade markers, reference lines, and axes.

### Edge cases
- Sparse matrix (most cells empty) → default to 0 intensity.
- Single time step → one column of price levels.
- Very wide price range → consider auto-binning prices into buckets.

### Test Cases
1. 1-hour order book snapshot, 200 price levels × 60 time steps → clear liquidity heat pattern.
2. Log scale on heavy-tailed liquidity → better discrimination of thin vs. thick levels.
3. Trade overlay → white dots of varying size showing where trades executed.
4. Best bid/ask lines → green and red lines tracking the spread.

### Certification Notes
Canvas + SVG. No external resources. Certifiable.

---

## Visual 12: Storyline Chart

**Ease: 12/20 · Demand: 3/5 · Est. build: 3–5 days**

### Purpose
The xkcd movie-narrative idiom formalized as StoryFlow. Entities are lines that weave between groups over time. Org changes, customer-segment migration, team composition, political coalition shifts.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "entity",   "kind": "Grouping", "displayName": "Entity",    "description": "One line per entity (person, customer, etc.)" },
    { "name": "timeStep", "kind": "Grouping", "displayName": "Time Step", "description": "Discrete time points (columns)" },
    { "name": "group",    "kind": "Grouping", "displayName": "Group",     "description": "Which group the entity belongs to at this time" }
]
```

**DataViewMapping:** `table` — each row is (entity, timeStep, group). The visual builds the full entity×time×group tensor client-side.

### Format Pane

**Card: Layout**
- `lineTension` — NumUpDown, default 50. Bézier curve tension (0=angular, 100=very smooth).
- `groupGap` — NumUpDown, default 20. Vertical gap between groups at each time slice.
- `entityGap` — NumUpDown, default 4. Vertical gap between entities within a group.
- `orderingStrategy` — ItemDropdown: "minimize-crossings" | "alphabetical" | "group-size". Default "minimize-crossings".

**Card: Appearance**
- `lineWidth` — NumUpDown, default 2.
- `lineOpacity` — NumUpDown, default 70.
- `highlightOnHover` — ToggleSwitch, default true. Highlight one entity's full trajectory on hover.
- `highlightOpacity` — NumUpDown, default 100.
- `dimOpacity` — NumUpDown, default 15. Opacity of non-highlighted lines during hover.
- `colorBy` — ItemDropdown: "entity" | "group". Default "entity".

**Card: Labels**
- `showEntityLabels` — ToggleSwitch, default true. At the rightmost time step.
- `showGroupLabels` — ToggleSwitch, default true. Background labels behind each group band.
- `fontSize` — NumUpDown, default 11.

### Rendering

**Algorithm — the hard part:**

1. **Build the data model:** For each time step, determine which entities are in which groups. An entity can change groups between time steps (that's the whole point).

2. **Ordering within time slices:** At each time step, entities within a group need a vertical position. The challenge is minimizing crossings of lines between adjacent time steps — this is a variant of the layered graph crossing minimization problem.

   **Simplified approach (recommended for v1):**
   - **Barycenter heuristic:** For each time step (left to right), order entities within each group by the average (barycenter) of their positions in the previous time step. Entities staying in the same group maintain their relative order; entities switching groups get inserted at the barycenter position.
   - Run 2–3 forward and backward passes (sweep left-to-right, then right-to-left) to iteratively improve.
   - This is the standard approach from Sugiyama-style layered layout and works well in practice.

   **Full StoryFlow optimization:** The paper describes a more sophisticated ILP-based approach with alignment and compaction phases. This is a v2 enhancement, not necessary for a functional first version.

3. **Compute positions:** After ordering, assign Y coordinates: groups are stacked with `groupGap` between them, entities within a group are stacked with `entityGap`.

4. **Draw curves:** For each entity, draw a path through its positions at each time step using Bézier curves (cubic, with control points at `±lineTension` horizontally from each time step).

**Renderer:** SVG. The path count = number of entities, which is typically <100 for this type of visualization. SVG handles it.

**Hover interaction:** On mouseover of any path, set that path's opacity to `highlightOpacity` and all others to `dimOpacity`. On mouseout, restore all to `lineOpacity`.

### Edge cases
- Entity appears/disappears mid-timeline → start/end the line at that time step (fade in/out).
- Entity not in any group at a time step → skip that time step, bridge the gap.
- Single time step → no lines, just grouped dots.
- 50+ entities → lines get dense; the dim-on-hover interaction becomes essential.

### Test Cases
1. 10 senators switching between 3 parties over 6 sessions → storyline with visible migration.
2. Employees moving between teams over quarters → org-change visualization.
3. Entity disappears in step 3, reappears in step 5 → line has a gap or dashed bridge.
4. Hover on one entity → that entity's trajectory highlighted, all others dim.
5. Alphabetical vs. minimize-crossings toggle → same data, different visual clarity.

### Certification Notes
All computation is pure TypeScript (sorting, barycenter heuristic). SVG rendering. No external resources. Certifiable.

---

## Visual 13: Directly-Follows Graph / Variant Explorer

**Ease: 10/20 · Demand: 5/5 · Est. build: 5–8 days**

### Purpose
Process mining's core visualization. An event log becomes a process map: nodes are activities, edges are "directly-follows" transitions weighted by frequency or duration. The variant explorer shows the top-N distinct path permutations. Celonis built a multi-billion-dollar company on essentially this picture. Neither Power BI nor Tableau has anything like it, despite event-log data being universal.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "caseId",    "kind": "Grouping", "displayName": "Case ID",    "description": "The case/instance identifier" },
    { "name": "activity",  "kind": "Grouping", "displayName": "Activity",   "description": "The event/step name" },
    { "name": "timestamp", "kind": "Grouping", "displayName": "Timestamp",  "description": "Orders events within a case" },
    { "name": "resource",  "kind": "Grouping", "displayName": "Resource",   "description": "Optional — who performed the activity" },
    { "name": "value",     "kind": "Measure",  "displayName": "Value",      "description": "Optional — cost or duration to weight edges" }
]
```

**DataViewMapping:** `table`. This is the crux difficulty — you need row-level events, and Power BI's `dataReduction` caps table rows. Set `window: { count: 30000 }`. For logs with more rows, the visual must surface a warning that data is truncated.

### Format Pane

**Card: DFG**
- `edgeMetric` — ItemDropdown: "frequency" | "mean-duration" | "total-value". Default "frequency".
- `frequencyThreshold` — NumUpDown, default 0. Minimum edge frequency to display (prune rare transitions).
- `layoutDirection` — ItemDropdown: "TB" (top-bottom) | "LR" (left-right). Default "LR".
- `showLoops` — ToggleSwitch, default true. Self-referencing edges (activity → same activity).

**Card: Variant Explorer**
- `showVariants` — ToggleSwitch, default true.
- `variantCount` — NumUpDown, default 10. Top-N variants to show.
- `variantPanelWidth` — NumUpDown, default 30. % of visual width for the variant list.

**Card: Node Appearance**
- `nodeColor` — ColorPicker, default `#4682B4`.
- `nodeMinWidth` — NumUpDown, default 80.
- `nodeFontSize` — NumUpDown, default 12.
- `showFrequencyLabel` — ToggleSwitch, default true. Frequency count inside nodes.

**Card: Edge Appearance**
- `edgeColor` — ColorPicker, default `#999999`.
- `edgeMinWidth` — NumUpDown, default 1.
- `edgeMaxWidth` — NumUpDown, default 8.
- `showEdgeLabel` — ToggleSwitch, default true. Metric value on edges.

### Rendering

**Algorithm — multi-step pipeline:**

1. **Reconstruct sequences:** From the table rows, group by `caseId`. Within each case, sort events by `timestamp`. This gives ordered sequences of activities per case.

2. **Build the Directly-Follows Graph:**
   - For each case's event sequence, count transitions: `activity[i] → activity[i+1]`.
   - Aggregate across all cases: `dfg[source][target] = { count, totalDuration, totalValue }`.
   - Count activity frequencies: `activityFreq[activity] = count of occurrences`.

3. **Prune:** Remove edges below `frequencyThreshold`.

4. **Layout — Layered DAG (Sugiyama-style):**
   Use the **dagre** library for the layout. dagre is the standard JS library for layered directed graph layout. It handles:
   - Layer assignment (activities assigned to horizontal/vertical layers)
   - Crossing minimization between layers
   - Node positioning within layers
   - Edge routing (including back-edges for loops)
   
   **dagre installation:** `npm install dagre @types/dagre`. dagre is pure JavaScript, ~50KB, well-audited, and commonly used in certified visuals.

   ```typescript
   import * as dagre from 'dagre';
   
   const g = new dagre.graphlib.Graph();
   g.setGraph({ rankdir: layoutDirection, ranksep: 60, nodesep: 40 });
   g.setDefaultEdgeLabel(() => ({}));
   
   // Add nodes
   for (const [activity, freq] of activityFreqs) {
       g.setNode(activity, { label: activity, width: nodeWidth, height: 40 });
   }
   // Add edges
   for (const [source, targets] of dfgEntries) {
       for (const [target, metrics] of targets) {
           g.setEdge(source, target, { weight: metrics.count });
       }
   }
   
   dagre.layout(g);
   // Read node/edge positions from g.node(id).x, g.node(id).y, g.edge(e).points
   ```

5. **Render the DFG:** SVG.
   - Nodes: rounded rectangles with activity name and frequency label.
   - Edges: paths following dagre's computed points, with arrowheads. Width ∝ edge metric. Color can also encode metric.
   - Self-loops: rendered as circular arcs from a node back to itself.

6. **Build variants:**
   - Hash each case's activity sequence (join with "→" as separator).
   - Group by hash, count cases per variant.
   - Sort by count descending, take top N.

7. **Render the Variant Explorer panel:**
   - Left panel showing ranked variants as horizontal traces.
   - Each variant: colored activity chips in sequence, with case count and percentage.
   - Clicking a variant filters the DFG to show only edges from those cases (re-weight the DFG with the filtered subset).

**Interaction — variant-DFG linking:**
When a variant is clicked:
- Recompute DFG metrics using only cases matching that variant.
- Visually highlight the corresponding path in the DFG (bolder edges, dimmed non-path edges).
- Show the variant's case count and percentage.

### Edge cases
- Cases with only one event → no transitions, activity appears as isolated node.
- Very long cases (50+ events) → many transitions, DFG gets dense. Frequency threshold is essential.
- Duplicate timestamps within a case → order is ambiguous; sort secondarily by activity name and warn.
- Data truncation (>30k rows) → show a warning bar: "Showing N of M events. Results may be incomplete."
- Activities with very long names → truncate in nodes, show full name in tooltip.

### Test Cases
1. Standard purchase-order log (create → approve → send → receive → pay) → clean linear DFG with thickness ∝ volume.
2. Log with rework loops (approve → reject → resubmit → approve) → visible back-edges.
3. Frequency threshold = 5 → prune rare paths, simplify the graph.
4. Click top variant → DFG highlights that specific path.
5. 20 unique activities, 5000 cases → performance holds with dagre layout.

### Additional Dependencies
```json
"dependencies": {
    "dagre": "0.8.5",
    "@types/dagre": "0.7.52"
}
```

### Certification Notes
dagre is pure JS, well-known, auditable. No external access. The sequence-reconstruction logic should be clearly commented for the reviewer. Data truncation warning is important — don't silently drop data. Certifiable.

---

## Visual 14: Event Sequence Bundles (EventFlow-style)

**Ease: 9/20 · Demand: 3/5 · Est. build: 5–8 days**

### Purpose
UMD HCIL EventFlow. Align thousands of point-event timelines, aggregate common sub-sequences into bundles, show where paths converge and diverge. Where the DFG abstracts away time, this preserves temporal ordering and shows aggregate flow as a Sankey-like tree.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "caseId",     "kind": "Grouping", "displayName": "Case ID" },
    { "name": "event",      "kind": "Grouping", "displayName": "Event",          "description": "Event type / name" },
    { "name": "timestamp",  "kind": "Grouping", "displayName": "Timestamp" },
    { "name": "eventCategory", "kind": "Grouping", "displayName": "Event Category", "description": "Optional — for coloring" }
]
```

**DataViewMapping:** `table`. Same row-limit caveats as the DFG visual.

### Format Pane

**Card: Aggregation**
- `minBundleSupport` — NumUpDown, default 5. Minimum number of cases for a bundle to be shown.
- `maxDepth` — NumUpDown, default 10. Maximum number of events in a sequence to consider.
- `alignmentAnchor` — ItemDropdown: "first-event" | "last-event" | "selected" (let user pick an event type to align on). Default "first-event".

**Card: Appearance**
- `bundleOpacity` — NumUpDown, default 60.
- `minBandWidth` — NumUpDown, default 2. Minimum pixel width for a bundle.
- `maxBandWidth` — NumUpDown, default 40. Band width ∝ case count.
- `showCaseCounts` — ToggleSwitch, default true.
- `colorBy` — ItemDropdown: "event-type" | "event-category" | "uniform". Default "event-type".

**Card: Layout**
- `orientation` — ItemDropdown: "horizontal" | "vertical". Default "horizontal".
- `gapBetweenSteps` — NumUpDown, default 60. Pixel gap between event columns.

**Card: Axis**
- Standard axis controls.

### Rendering

**Algorithm — this is the hard part (no off-the-shelf library):**

1. **Reconstruct and align sequences:** Same as DFG step 1 (group by caseId, sort by timestamp). Then align: shift all sequences so the anchor event occurs at position 0.

2. **Build prefix tree:**
   - Starting from the aligned sequences, build a prefix tree (trie).
   - Each node represents an event at a position in the sequence.
   - Each node stores: event name, case count, children (next events).
   - Merge children with the same event name.

3. **Prune by support:** Remove branches where case count < `minBundleSupport`. Redistribute cases to a "other" catch-all or simply drop them.

4. **Layout as a flow diagram:**
   - Each level of the trie = one column (event position).
   - At each column, nodes are stacked vertically, height ∝ case count.
   - Between columns, draw flow bands (like Sankey links) from parent to children, width ∝ case count.
   - The flow bands split at divergence points (where a parent has multiple children).

5. **Rendering:** SVG. Use `d3.area()` with custom interpolation to draw the flow bands as smooth curves between columns. Each node = a labeled block. The overall structure looks like a horizontal Sankey where columns are event positions.

### Edge cases
- All cases have the same sequence → one thick bundle, no divergence.
- Every case is unique → the tree is very wide, prune aggressively.
- Cases of widely varying lengths → longer cases extend further right; handle gracefully (don't force all to same length).
- Alignment by a mid-sequence event → events before the anchor go left, after go right.

### Test Cases
1. 1000 patient journeys through ER (triage → exam → test → diagnose → treat → discharge) → clear main path with branches.
2. minBundleSupport = 50 → only major paths shown.
3. Align by "diagnosis" event → events before and after visible.
4. Color by event category → clinical vs. administrative events distinguished.
5. Very diverse event set (50 unique events) → tree fans wide, pruning essential.

### Certification Notes
All computation in pure TypeScript (trie construction, layout). SVG rendering. No external resources. Certifiable. The reviewer will need to understand the prefix-tree and flow-layout code — comment generously.

---

## Visual 15: SCADA / Synoptic Mimic Diagram

**Ease: 8/20 · Demand: 4/5 · Est. build: 1–2 weeks**

### Purpose
A schematic editor (or SVG import) where shapes bind to live measures — tank levels, valve states, animated flow. Industrial HMI software charges heavily for this; BI users hack it with workarounds. Ship as **free and uncertified** (see discussion in prior session — certification requires the re-render-from-geometry architecture which adds significant scope).

### Data Roles

```jsonc
"dataRoles": [
    { "name": "elementId", "kind": "Grouping", "displayName": "Element ID",  "description": "Matches SVG element id or data-tag attribute" },
    { "name": "value",     "kind": "Measure",  "displayName": "Value",       "description": "Drives fill, color, text, or animation" },
    { "name": "state",     "kind": "Grouping", "displayName": "State",       "description": "Optional discrete state (on/off, open/closed)" }
]
```

**Additional input:** The visual accepts an **SVG file** as a configuration parameter (pasted as a text property or loaded from a URL — but URL loading would require `WebAccess` privilege, so for the uncertified version, accept SVG as a base64-encoded property or as a text blob in a hidden data column).

**Practical SVG input approach:** Add a data role:
```jsonc
{ "name": "svgContent", "kind": "Grouping", "displayName": "SVG Template", "description": "Paste SVG content as a column value (one row)" }
```
The user puts their SVG string into a single-row table column. Hacky but avoids the certification nightmare of file import.

### Format Pane

**Card: Template**
- `defaultFillColor` — ColorPicker, default `#cccccc`.
- `showElementIds` — ToggleSwitch, default false. Debug mode — overlay element IDs on the schematic.

**Card: Value Mapping**
- `valueLow` — NumUpDown, default 0. Low end of value range.
- `valueHigh` — NumUpDown, default 100. High end of value range.
- `colorLow` — ColorPicker, default `#ff0000`.
- `colorHigh` — ColorPicker, default `#00ff00`.
- `animationMode` — ItemDropdown: "fill" | "fill-level" | "color" | "opacity" | "rotation" | "text". Default "fill-level". How values map to visual properties.

**Card: Animation**
- `flowAnimation` — ToggleSwitch, default false. Animate dashed lines along pipes.
- `flowSpeed` — NumUpDown, default 50.
- `blinkOnAlarm` — ToggleSwitch, default false. Blink elements when value exceeds threshold.
- `alarmThreshold` — NumUpDown, default 90.

### Rendering

**Algorithm:**

1. **Parse the SVG template:** Extract the SVG string from the data column. Parse with `DOMParser` as `image/svg+xml`.

2. **Sanitize (for uncertified version, use DOMPurify):**
   ```typescript
   import DOMPurify from 'dompurify';
   const clean = DOMPurify.sanitize(rawSvg, {
       USE_PROFILES: { svg: true, svgFilters: true },
       ADD_TAGS: ['use'],
       FORBID_TAGS: ['script', 'foreignObject'],
       FORBID_ATTR: ['onload', 'onclick', 'onmouseover', 'onerror']
   });
   ```
   Add `dompurify` as a dependency: `npm install dompurify @types/dompurify`.

3. **Insert the sanitized SVG** into the visual's container. Scale it to fit the viewport (use `viewBox` manipulation).

4. **Bind data to elements:** For each row in the data (elementId → value/state), find the matching SVG element by `id` attribute. Apply the animation mode:
   - **fill-level:** Set a `clip-path` rectangle whose height = `value / valueHigh * elementHeight`. This makes a tank "fill up."
   - **color:** Interpolate between `colorLow` and `colorHigh` based on value. Apply as `fill`.
   - **opacity:** Map value to opacity range.
   - **rotation:** Map value to rotation degrees (for gauges, dials).
   - **text:** Set the element's `textContent` to the formatted value.

5. **Flow animation:** For pipe elements (identified by a naming convention like `id="pipe-*"`), set `stroke-dasharray` and animate `stroke-dashoffset` via CSS animation or `requestAnimationFrame`.

6. **Alarm blink:** For elements where value > threshold, toggle visibility on a timer.

### Additional Dependencies
```json
"dependencies": {
    "dompurify": "3.x",
    "@types/dompurify": "3.x"
}
```

### Edge cases
- SVG with no matching element IDs → schematic renders but nothing animates.
- Malformed SVG → DOMPurify handles gracefully (returns empty or stripped).
- Very large SVG (>1MB) → may slow rendering; consider warning.
- Element IDs with special characters → querySelector needs escaping.

### Test Cases
1. Simple tank farm SVG with 3 tanks → fill levels respond to data.
2. Valve elements with on/off state → green/red color change.
3. Pipe elements → dashed flow animation along pipe paths.
4. Temperature sensor text elements → numeric values update live.
5. Alarm threshold exceeded → element blinks.

### Certification Notes
**THIS VISUAL IS DESIGNED TO SHIP UNCERTIFIED.** The SVG injection (even with DOMPurify) will not pass Microsoft's certification audit. For a certified version, replace DOMPurify injection with the parse-extract-rerender architecture (parse SVG → extract geometry into an internal model → render clean SVG from the model, never injecting user markup). This is a significant architectural change — plan as a v2 if demand warrants.

`privileges` in capabilities.json stays as `[]` — even uncertified, the visual doesn't need external access.

---

## Reference Architecture

### Shared patterns across all visuals

**Project scaffold command:**
```bash
pbiviz new <visualName>
cd <visualName>
# Replace: capabilities.json, src/settings.ts, src/visual.ts, style/visual.less, pbiviz.json
# Add any additional npm deps
npm install
npx pbiviz package
```

**pbiviz.json template:**
```json
{
    "visual": {
        "name": "<camelCaseName>",
        "displayName": "<Human Name>",
        "guid": "<auto-generated-keep-stable>",
        "visualClassName": "Visual",
        "version": "1.0.0.0",
        "description": "<AppSource description>",
        "supportUrl": "https://github.com/<you>/<repo>",
        "gitHubUrl": "https://github.com/<you>/<repo>"
    },
    "apiVersion": "5.3.0",
    "author": { "name": "<Your Name>", "email": "<your@email.com>" },
    "assets": { "icon": "assets/icon.png" },
    "style": "style/visual.less",
    "capabilities": "capabilities.json",
    "version": "1.0.0.0"
}
```

**Shared helper — findValueIndex:**
```typescript
function findValueIndex(values: powerbi.DataViewValueColumns, roleName: string): number {
    for (let i = 0; i < values.length; i++) {
        if (values[i].source.roles && values[i].source.roles[roleName]) return i;
    }
    return -1;
}
```

**Shared helper — safeNum:**
```typescript
function safeNum(v: powerbi.PrimitiveValue): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
```

**Visual class skeleton:**
```typescript
import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";
import { VisualFormattingSettingsModel } from "./settings";

export class Visual implements powerbi.extensibility.visual.IVisual {
    private events: powerbi.extensibility.IVisualEventService;
    private host: powerbi.extensibility.visual.IVisualHost;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private container: d3.Selection<SVGGElement, unknown, null, undefined>;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private margin = { top: 16, right: 24, bottom: 36, left: 52 };

    constructor(options: powerbi.extensibility.visual.VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.formattingSettingsService = new FormattingSettingsService();
        this.svg = d3.select(options.element).append("svg").classed("visual-root", true);
        this.container = this.svg.append("g").classed("visual-container", true);
    }

    public update(options: powerbi.extensibility.visual.VisualUpdateOptions) {
        this.events.renderingStarted(options);
        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews?.[0]);

            const width = options.viewport.width;
            const height = options.viewport.height;
            this.svg.attr("width", width).attr("height", height);
            this.container.attr("transform",
                `translate(${this.margin.left},${this.margin.top})`);

            const dataView = options.dataViews?.[0];
            if (!dataView?.categorical?.categories?.[0]?.values?.length) {
                this.container.selectAll("*").remove();
                this.events.renderingFinished(options);
                return;
            }

            // ── Parse data ──
            // ── Build scales ──
            // ── Render ──

            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
```

**TypeScript gotchas discovered during fan chart build:**
1. `ItemDropdown` `.value.value` is typed as `EnumMemberValue` which includes `number`. Cast to `String()` when passing to functions expecting `string`.
2. `NumUpDown` validator options use `ValidatorType` const enum (`Min = 0, Max = 1, Required = 2`). Simpler to just omit validators and handle range clamping in `update()`.
3. Author name and email in `pbiviz.json` **must be non-empty** or `pbiviz package` hard-fails.
4. If `pbiviz.json` apiVersion doesn't match the installed `powerbi-visuals-api` package version, the CLI auto-installs the specified version with a warning. Pin `"~5.3.0"` in `package.json` to match.

**Shared FFT implementation (for Spectrogram and Matrix Profile):**
Extract the FFT code into a shared `src/fft.ts` module that both visuals can import. The radix-2 Cooley-Tukey implementation is ~40 lines (see Spectrogram section for the full pseudocode).

### Build order recommendation

Dispatch in this order. Each builds on confidence from the prior:

1. **Icon Arrays** (2–4 hours) — simplest possible visual, validates the full pbiviz pipeline.
2. **Ternary Plot** (3–5 hours) — introduces coordinate transforms.
3. **Quantile Dotplot** (3–5 hours) — introduces algorithmic data processing (quantile computation + dot packing).
4. **Fan Chart** (already built) — reference implementation.
5. **HOPs** (4–6 hours) — introduces animation lifecycle management.
6. **Wafer Map** (4–6 hours) — introduces Canvas/SVG hybrid rendering.
7. **Adjacency Matrix** (1–2 days) — introduces agglomerative clustering algorithm.
8. **Interval-Track Viewer** (2–3 days) — introduces zoom/pan + virtualization.
9. **Spectrogram** (2–3 days) — introduces FFT + Canvas heatmap.
10. **Matrix Profile** (2–3 days) — reuses FFT, adds STOMP algorithm.
11. **Order Book Heatmap** (2–3 days) — Canvas density + data pivoting.
12. **Storyline Chart** (3–5 days) — crossing-minimization layout.
13. **DFG / Variant Explorer** (5–8 days) — dagre dependency + sequence reconstruction + dual-view.
14. **Event Sequence Bundles** (5–8 days) — prefix tree + flow layout (no library).
15. **SCADA Mimic** (1–2 weeks) — SVG import + sanitization + animation.
