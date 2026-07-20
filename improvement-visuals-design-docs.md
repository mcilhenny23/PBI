# Power BI "Improvement Play" Visuals — Claude Code Handoff Documents

Companion to `visual-design-docs.md` (the fifteen unbroached visuals). These twelve target **existing visuals with proven demand and known deficiencies** — abandoned Microsoft visuals, native visuals with structural ceilings, and paid visuals with free-tier gaps. The negative reviews and feature-request threads of the incumbents are the requirements docs.

All conventions from the unbroached set apply (see Reference Architecture in `visual-design-docs.md`): TypeScript + D3 v7, modern Formatting Model API, `privileges: []`, rendering lifecycle events, `findValueIndex`/`safeNum` helpers, empty-dataView handling, non-empty author metadata.

Ordered by risk-adjusted priority (recommendation ranking from the strategy discussion), then by remaining ease.

---

## Visual 16: Multi-Measure Waterfall / Bridge Chart

**Priority: 1 · Demand: 5/5 · Est. build: 2–3 days · Incumbent: native waterfall (single-measure only), Inforiver (paid)**

### The gap
Native waterfall decomposes one measure across one category. The core finance use case — Actual → Price effect → Volume effect → Mix effect → Budget — is a *multi-measure bridge*, and it's impossible natively. Users build painful DAX ladders or buy Inforiver largely for this one chart. No free visual does it well.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "steps",     "kind": "Grouping", "displayName": "Bridge Steps",  "description": "Ordered step names (Actual, Price, Volume, Mix, Budget…)" },
    { "name": "value",     "kind": "Measure",  "displayName": "Value",         "description": "Delta per step, or absolute for anchor steps" },
    { "name": "stepType",  "kind": "Grouping", "displayName": "Step Type",     "description": "Optional: 'anchor' | 'delta' | 'subtotal' per step (defaults inferred)" },
    { "name": "category",  "kind": "Grouping", "displayName": "Breakdown",     "description": "Optional: sub-bars within each step (stacked deltas)" }
]
```

**DataViewMapping:** `categorical`. Steps as the category, value as measure. If `stepType` is not bound, infer: first and last steps = anchors (absolute), middle = deltas.

**Alternate mode — multi-measure input:** If the user binds multiple measures instead of a steps column, treat each measure as one step in field order. Detect: `values.length > 1 && no steps category`. This is the natural way finance users will try it (drag Actual, Price Var, Vol Var, Budget in order), so support both.

### Format Pane

**Card: Bridge Structure**
- `firstStepIsAnchor` — ToggleSwitch, default true.
- `lastStepIsAnchor` — ToggleSwitch, default true.
- `showSubtotals` — ToggleSwitch, default false. Insert running-subtotal bars at steps flagged as subtotal.
- `sortMode` — ItemDropdown: "data-order" | "ascending" | "descending" (delta magnitude). Default "data-order".

**Card: Bars**
- `increaseColor` — ColorPicker, default `#2ca02c`.
- `decreaseColor` — ColorPicker, default `#d62728`.
- `anchorColor` — ColorPicker, default `#4472C4`.
- `subtotalColor` — ColorPicker, default `#7f7f7f`.
- `barPadding` — NumUpDown, default 20 (% of band).

**Card: Connectors**
- `showConnectors` — ToggleSwitch, default true. Horizontal lines linking bar tops.
- `connectorColor` — ColorPicker, default `#999999`.
- `connectorStyle` — ItemDropdown: "solid" | "dashed". Default "dashed".

**Card: Labels**
- `showValueLabels` — ToggleSwitch, default true.
- `labelPosition` — ItemDropdown: "outside" | "inside" | "auto". Default "auto".
- `showDeltaSign` — ToggleSwitch, default true (+/− prefixes on delta bars).
- `showPercentOfStart` — ToggleSwitch, default false. Secondary label: delta as % of first anchor.
- `fontSize` — NumUpDown, default 11.
- `valueFormat` — leverage the measure's own format string from the dataView (do not reinvent formatting; use `powerbi-visuals-utils-formattingutils` valueFormatter).

**Card: Axis** — standard (showYAxis, showGridlines, fontSize).

### Rendering

**Algorithm:**
1. Parse steps in order. Compute running cumulative: anchors reset the cumulative to their absolute value; deltas add to it; subtotals render the current cumulative.
2. Validate: if last step is an anchor, check `|cumulative_before_last − last_anchor| < tolerance`; if mismatch, render a small "unexplained variance" warning chip with the residual (this is a beloved Inforiver feature — finance users want to *see* when a bridge doesn't tie out).
3. Bars: `d3.scaleBand` for steps, `d3.scaleLinear` for value. Delta bars float: y from `cumulative_before` to `cumulative_after`. Color by direction/type.
4. Connectors: horizontal dashed line from each bar's ending level to the next bar's starting edge.
5. If `category` breakdown is bound, each delta bar becomes a mini-stack of sub-deltas (same sign stacking; mixed-sign within one step renders as two stacks around the step's start level).

**Renderer:** SVG throughout — step counts are small (<30). Use the shared visual skeleton.

**Label auto-placement:** "auto" = outside if bar height < label height × 1.5, else inside. Clamp outside labels within the plot area.

### Edge cases
- All-delta input with no anchors → start cumulative at 0.
- A zero delta → render a thin tick + connector so the step is visible.
- Negative anchor values → supported; axis must handle negative domain.
- Breakdown category with 20+ members in one step → cap visible sub-bars at 10, aggregate rest into "Other."

### Test Cases
1. Actual 100 → Price +12 → Volume −5 → Mix +3 → Budget 110 → ties out, no warning.
2. Same but Budget bound as 115 → "unexplained +5" chip renders.
3. Multi-measure mode: 5 measures dragged in order → same bridge, no steps column.
4. Subtotal after step 3 → gray running-total bar inserted.
5. Sort by delta magnitude descending → anchors pinned at ends, deltas reordered.

### Certification Notes
Pure SVG/computation. Use `powerbi-visuals-utils-formattingutils` (Microsoft's own package, audit-friendly) for number formatting. Trivially certifiable.

---

## Visual 17: Modern Sankey

**Priority: 2 · Demand: 5/5 · Est. build: 4–6 days · Incumbent: Microsoft Sankey (frozen), paid alternatives**

### The gap
The Microsoft Sankey ranks high on AppSource via the badge but is frozen: no cycle support, label collisions, no node reordering, weak color control, breaks on complex flows. Sankey demand is the largest of any "improvement" category.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "source",  "kind": "Grouping", "displayName": "Source" },
    { "name": "target",  "kind": "Grouping", "displayName": "Target" },
    { "name": "weight",  "kind": "Measure",  "displayName": "Weight" },
    { "name": "linkColorBy", "kind": "Grouping", "displayName": "Link Category", "description": "Optional link color grouping" }
]
```

**DataViewMapping:** `categorical` (edge list). Multi-level flows come from rows chaining source→target across levels — infer levels topologically, do not require a level column.

### Format Pane

**Card: Layout**
- `nodeWidth` — NumUpDown, default 18.
- `nodePadding` — NumUpDown, default 12.
- `iterations` — NumUpDown, default 32. Relaxation passes for node placement.
- `nodeAlignment` — ItemDropdown: "justify" | "left" | "right" | "center". Default "justify".
- `enableDragReorder` — ToggleSwitch, default true. Drag nodes vertically; persist order via objects (persistProperties).

**Card: Cycles**
- `cycleHandling` — ItemDropdown: "route-back" | "duplicate-node" | "drop". Default "route-back". Route-back renders reverse links as arcs sweeping around; duplicate-node splits a cycling node into "X" and "X (return)".
- `cycleLinkColor` — ColorPicker, default `#d62728`.

**Card: Nodes**
- `nodeColorMode` — ItemDropdown: "palette" | "single" | "by-level". Default "palette" (host.colorPalette per node name).
- `nodeColor` — ColorPicker (single mode), default `#4472C4`.
- `nodeBorderColor` / `nodeBorderWidth`.

**Card: Links**
- `linkOpacity` — NumUpDown, default 40.
- `linkColorMode` — ItemDropdown: "source" | "target" | "gradient" | "category". Default "gradient" (SVG linearGradient from source node color to target node color — the modern look the incumbent lacks).
- `hoverHighlight` — ToggleSwitch, default true. Hover a node → highlight all connected links, dim others.

**Card: Labels**
- `labelPosition` — ItemDropdown: "auto" | "inside" | "outside". Auto = outside for edge columns, inside-adjacent otherwise, with collision nudging.
- `showValues` — ToggleSwitch, default true (value appended to node label).
- `fontSize`, `maxLabelLength` (truncate + full name in tooltip).

### Rendering

**Algorithm:**
1. **Cycle detection first:** Build the directed graph; find strongly connected components (Tarjan, ~60 lines pure TS). Edges inside an SCC are cycle edges — set them aside per `cycleHandling`.
2. **Layout on the acyclic remainder:** Use `d3-sankey` (npm `d3-sankey@0.12`, tiny, pure JS, audit-friendly) for node/link placement on the DAG.
3. **Re-inject cycle links:** route-back mode renders reserved edges as cubic paths sweeping below/above the diagram back to the earlier column; width still ∝ weight; colored `cycleLinkColor`.
4. **Drag reorder:** `d3.drag` on nodes constrained to Y within their column; on drop, re-run link path computation only (not full layout) and persist node order (array of node names) via `host.persistProperties` so order survives reload. **Persisted properties are the mechanism** — add a hidden object `nodeOrder` in capabilities.
5. **Label collision:** after layout, sweep labels per column; if overlap, nudge alternately outward and shrink font one step before truncating.

**Renderer:** SVG. Links as `d3.sankeyLinkHorizontal()` paths; gradients defined per-link in `<defs>`.

### Edge cases
- Self-loop (source = target) → render as a small loop arc on the node, or drop with warning per cycleHandling.
- Disconnected subgraphs → lay out stacked vertically.
- Node appearing as both source-only and target-only under the same name → same node (name-keyed).
- Long chains (8+ levels) → horizontal scroll is NOT available; compress nodeWidth and warn below a threshold.
- Weight ≤ 0 → drop the link, count them, show one aggregate notice.

### Test Cases
1. Classic 3-level energy flow → matches d3-sankey reference output.
2. Flow with A→B→C→A cycle → red return arc, no crash (the incumbent's headline failure).
3. Drag node B above A → order persists after report reload.
4. 60 nodes / 200 links → labels resolve without overlap.
5. Gradient link mode → each ribbon fades source-color → target-color.

### Additional Dependencies
```json
"d3-sankey": "0.12.3", "@types/d3-sankey": "0.12.x"
```

### Certification Notes
d3-sankey is small and well-known. Tarjan SCC in pure TS. `persistProperties` is a standard host API, cert-safe. Certifiable.

---

## Visual 18: Gantt with Dependencies & Critical Path

**Priority: 3 · Demand: 5/5 · Est. build: 4–6 days · Incumbent: Microsoft Gantt (most-complained-about), xViz/MAQ/Inforiver (paid)**

### The gap
The Microsoft Gantt lacks real dependency arrows, milestone rendering is weak, and there's no critical-path highlighting — the three features every reviewer asks for. Paid vendors prove willingness-to-pay. Reuses the interval-track machinery from Visual 08.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "task",        "kind": "Grouping", "displayName": "Task" },
    { "name": "parent",      "kind": "Grouping", "displayName": "Parent Task",   "description": "Optional — builds the WBS hierarchy" },
    { "name": "start",       "kind": "Grouping", "displayName": "Start Date" },
    { "name": "end",         "kind": "Grouping", "displayName": "End Date" },
    { "name": "progress",    "kind": "Measure",  "displayName": "% Complete",    "description": "0–1 or 0–100, auto-detected" },
    { "name": "predecessors","kind": "Grouping", "displayName": "Predecessors",  "description": "Comma-separated task names or IDs (FS assumed; 'X:SS', 'X:FF' supported)" },
    { "name": "milestone",   "kind": "Grouping", "displayName": "Is Milestone",  "description": "Optional boolean" },
    { "name": "category",    "kind": "Grouping", "displayName": "Category",      "description": "Bar color grouping (workstream, owner…)" }
]
```

**DataViewMapping:** `table`, `window: { count: 30000 }`.

### Format Pane

**Card: Timeline**
- `timeGranularity` — ItemDropdown: "auto" | "day" | "week" | "month" | "quarter". Header band rendering.
- `showTodayLine` — ToggleSwitch, default true; `todayLineColor` default `#d62728`.
- `enableZoom` — ToggleSwitch, default true (wheel zoom + drag pan on time axis, same d3.zoom pattern as Interval-Track Viewer).

**Card: Bars**
- `barHeight` — NumUpDown, default 18; `rowPadding` default 8; `cornerRadius` default 3.
- `showProgress` — ToggleSwitch, default true (darker inner bar at progress %).
- `milestoneShape` — ItemDropdown: "diamond" | "circle" | "flag". Default "diamond".

**Card: Dependencies**
- `showDependencies` — ToggleSwitch, default true.
- `arrowColor` — ColorPicker, default `#7f7f7f`; `arrowWidth` default 1.5.
- `routingStyle` — ItemDropdown: "orthogonal" | "curved". Default "orthogonal" (elbow routing like MS Project).

**Card: Critical Path**
- `showCriticalPath` — ToggleSwitch, default false.
- `criticalColor` — ColorPicker, default `#d62728`. Applied to bars AND arrows on the critical path.
- `slackThreshold` — NumUpDown, default 0. Tasks with total float ≤ threshold (days) count as critical.

**Card: Hierarchy / Labels**
- `showHierarchy` — ToggleSwitch, default true. Indented WBS with expand/collapse chevrons; summary bars (thin brackets spanning children).
- `taskLabelWidth` — NumUpDown, default 160; `fontSize` default 11.

### Rendering

**Algorithm:**
1. **Parse tasks**; resolve parent → tree; compute summary spans (min child start, max child end).
2. **Parse dependency strings:** split on comma; each token = task ref + optional `:SS|:FF|:SF` suffix (default FS). Unresolvable refs → collect into a single warning chip.
3. **Critical path — standard CPM:**
   - Forward pass: earliest start/finish per task respecting dependency type lags.
   - Backward pass: latest start/finish from project end.
   - Total float = LS − ES. Float ≤ slackThreshold → critical.
   - Cycles in dependencies → detect (DFS), break with warning, exclude from CPM.
4. **Row layout:** hierarchy order (depth-first), one row per task; virtualize rows outside the visible Y window when task count > 500.
5. **Arrows:** orthogonal routing — exit predecessor's right edge (FS), elbow down/up in the row gap, enter successor's left edge; offset parallel arrows in the same channel to avoid overlap. Arrowhead as a small triangle marker.
6. **Render:** Canvas for bars when >500 tasks, else SVG (reuse the Interval-Track hybrid pattern); SVG always for arrows, labels, header.

### Edge cases
- Missing end date → render as milestone at start.
- Progress > 1 → treat as percentage (divide by 100).
- Child dates outside parent span → summary bar covers the true union; flag inconsistency subtly.
- Dependency on a collapsed task → arrow targets the visible ancestor's summary bar.
- Circular dependencies → warning chip lists the cycle; CPM skips it.

### Test Cases
1. 20-task project, FS chains → arrows route cleanly, no crossings through bars.
2. Critical path on → the zero-float chain turns red end-to-end.
3. Collapse a phase → children hide, arrows re-target the summary bar.
4. SS dependency → arrow exits predecessor's LEFT edge to successor's left edge.
5. 2,000 tasks → Canvas mode, scroll + zoom stay smooth.

### Certification Notes
CPM is pure TS. No new dependencies (reuse d3.zoom). Certifiable. Comment the CPM passes for the reviewer.

---

## Visual 19: WebGL Scatter / Density Chart

**Priority: 4 · Demand: 4/5 · Est. build: 5–8 days · Incumbent: native scatter (silently samples ~10k+ points)**

### The gap
Native scatter samples large datasets without making it obvious, eroding trust in outlier analysis. A visual that renders 500k+ points honestly — density shading zoomed out, individual points zoomed in — is a *capability* gap, not polish. Folds in the hexbin idea as a mode.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "x",        "kind": "Measure",  "displayName": "X" },
    { "name": "y",        "kind": "Measure",  "displayName": "Y" },
    { "name": "colorBy",  "kind": "Grouping", "displayName": "Legend",     "description": "Categorical color (≤12 classes)" },
    { "name": "sizeBy",   "kind": "Measure",  "displayName": "Size" },
    { "name": "tooltipFields", "kind": "Grouping", "displayName": "Details", "description": "Extra tooltip fields" }
]
```

**DataViewMapping:** `categorical` or `table`; request the maximum row window (`window: { count: 30000 }` per segment — and implement **fetchMoreData()**: set `"supportsMoreData": true`-style segmented loading via `dataViewMappings` window + `host.fetchMoreData()` loop to accumulate beyond 30k. This API is the key to honest large-N rendering; show a progress chip while segments load).

### Format Pane

**Card: Mode**
- `renderMode` — ItemDropdown: "auto" | "points" | "density" | "hexbin". Auto: points when visible-N < 20k, density above.
- `autoThreshold` — NumUpDown, default 20000.

**Card: Points**
- `pointSize` — NumUpDown, default 3; `pointOpacity` default 60 (alpha-blending IS the density cue at mid scales).

**Card: Density / Hexbin**
- `colorRamp` — ItemDropdown: "viridis" | "inferno" | "blues" | "turbo".
- `intensityScale` — "linear" | "log" | "sqrt", default "log".
- `hexRadius` — NumUpDown, default 12 (px, hexbin mode).

**Card: Axes & Zoom** — standard axes + `enableZoom` (d3.zoom, both axes), `showSampleWarningBadge` ToggleSwitch default true (badge shows "n = 412,304 (all points rendered)" — the honesty feature).

### Rendering

**Approach:** Raw **WebGL2** with a hand-rolled point renderer (~250 lines: one buffer of xy pairs, one of color indices; a point-sprite vertex/fragment shader pair). Do NOT pull deck.gl/regl — dependency audit cost outweighs convenience at this scope.

1. On data load, pack Float32Array buffers once; upload to GPU.
2. On zoom/pan, update the projection uniform only — no re-upload. 60fps at 1M points is routine for point sprites.
3. **Density mode:** render points to an offscreen float framebuffer with additive blending, then a second pass maps accumulated density → color ramp. (Two small shaders; classic technique.)
4. **Hexbin mode:** CPU-side binning with `d3-hexbin` (tiny, pure JS) into hex centers + counts, rendered as WebGL instanced hexes or an SVG layer when bins < 2k.
5. **Picking (tooltips/selection):** color-picking pass — render point IDs to an offscreen buffer, read the pixel under the cursor. Standard, certifiable, no spatial index needed.
6. SVG overlay: axes, legend, badge, selection rectangle.
7. **WebGL context loss:** listen for `webglcontextlost`/`restored`; rebuild buffers on restore; fall back to Canvas 2D (points only, capped 50k, with a notice) if WebGL is unavailable.

### Edge cases
- N < 1,000 → plain SVG mode entirely (better selection/a11y).
- NaN/null coords → drop, count, report in badge.
- All points identical → jitter option? No — render one point, badge notes overlap count.
- Log-scale request on data with ≤0 values → clamp with notice.

### Test Cases
1. 500k random-normal points → density mode, smooth zoom.
2. Zoom into a 5k-point neighborhood → auto-switches to individual points.
3. Hover a point at 300k N → correct tooltip via color-picking.
4. Category legend with 8 classes → distinct colors in both modes.
5. WebGL blocked (forced) → Canvas fallback + notice.

### Additional Dependencies
```json
"d3-hexbin": "0.2.2"
```

### Certification Notes
Hand-rolled WebGL is certifiable — reviewers read shaders like any source. Keep shaders as inline commented template strings (no dynamic shader generation — that pattern-matches to dynamic code execution). fetchMoreData is a standard host API. No external access.

---

## Visual 20: Line Chart with Focus (Many-Series)

**Priority: 5 · Demand: 4/5 · Est. build: 2–3 days · Incumbent: native line chart (spaghetti past ~10 series)**

### The gap
The known-good idiom for many series — all-gray context, hover-to-focus with direct labeling — exists as a Tableau hack and in dataviz blogs, but no PBI visual is built around it.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "axis",   "kind": "Grouping", "displayName": "Axis" },
    { "name": "series", "kind": "Grouping", "displayName": "Series" },
    { "name": "value",  "kind": "Measure",  "displayName": "Value" },
    { "name": "focusFlag", "kind": "Measure", "displayName": "Focus (0/1)", "description": "Optional measure: series with 1 are permanently focused (DAX-drivable)" }
]
```

**DataViewMapping:** `categorical` with series grouping.

### Format Pane

**Card: Focus Behavior**
- `contextColor` — ColorPicker, default `#d9d9d9`; `contextOpacity` default 60; `contextWidth` default 1.
- `focusWidth` — NumUpDown, default 2.5.
- `focusMode` — ItemDropdown: "hover" | "click-pin" | "top-n" | "flag-measure". Default "hover". click-pin: click toggles a series into the focused set (multi); top-n focuses the N series with highest final value; flag-measure uses `focusFlag`.
- `topN` — NumUpDown, default 3.
- `focusColorMode` — "palette" | "single"; default palette.

**Card: Direct Labels**
- `showEndLabels` — ToggleSwitch, default true. Focused series labeled at line end, collision-nudged; context series unlabeled.
- `fontSize` default 11; `labelValue` ToggleSwitch default true (append last value).

**Card: Fallback Modes**
- `smallMultiplesThreshold` — NumUpDown, default 0 (off). If series count exceeds it, render a trellis of mini line charts instead (shared scales toggle).
- `curveType` — the standard interpolation dropdown.

**Card: Axes** — standard.

### Rendering
1. One `<path>` per series in a context layer (gray), focused series re-drawn in a focus layer on top with palette colors.
2. Hover detection via an invisible Voronoi/quadtree overlay (`d3.quadtree` nearest-point within radius) — NOT per-path mouse events, which fail on thin lines.
3. Direct labels: end-of-line, greedy vertical collision nudging; leader line if nudged > 8px.
4. Pinned set persists in-session (component state); persist across sessions via persistProperties (same mechanism as Sankey node order).
5. Small-multiples fallback: reuse one render function per panel; ragged grid; shared or free Y per toggle.

### Edge cases
- 200+ series → context layer batches into a single path per series still (SVG fine to ~500 paths); above that, context layer to Canvas.
- Series with one point → dot, labeled.
- Nulls mid-series → `defined()` gaps.

### Test Cases
1. 40 country GDP series → gray field, hover highlights + direct label.
2. Click-pin three series → survive mouseout; palette colors.
3. top-n = 5 → auto-focus the top five by final value.
4. focusFlag measure from a slicer-driven DAX → report-controlled focus.
5. 150 series with threshold 100 → trellis fallback.

### Certification Notes
Pure D3/SVG (+ optional Canvas context layer). Certifiable trivially.

---

## Visual 21: Indoor / Floor-Plan Map

**Priority: 6 · Demand: 4/5 · Est. build: 3–4 days · Incumbent: abandoned Synoptic Panel; nothing native**

### The gap
Every PBI map assumes Earth lat/long. Warehouses, factory floors, offices, stadiums need "points/heat on an image." Simpler sibling of the SCADA visual: image underlay + coordinate overlay, no element binding, no SVG injection.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "x",       "kind": "Measure",  "displayName": "X",  "description": "In image coordinate units" },
    { "name": "y",       "kind": "Measure",  "displayName": "Y" },
    { "name": "label",   "kind": "Grouping", "displayName": "Label" },
    { "name": "colorBy", "kind": "Grouping", "displayName": "Category" },
    { "name": "value",   "kind": "Measure",  "displayName": "Value", "description": "Size or heat intensity" },
    { "name": "imageData", "kind": "Grouping", "displayName": "Floor Plan (base64)", "description": "Single-row column containing a base64 PNG/JPEG data URI" }
]
```

**Image input:** base64 data-URI in a one-row column (same pattern as SCADA's SVG input; avoids WebAccess). Render via `<image href="data:image/png;base64,...">` inside the SVG — a data URI is not network access. Validate the prefix strictly (`data:image/png;base64,` or `data:image/jpeg;base64,`) and reject anything else, especially `data:image/svg+xml` (that would reopen the markup-injection problem — raster only).

### Format Pane

**Card: Image**
- `coordinateSystem` — ItemDropdown: "top-left origin" | "bottom-left origin". Default top-left.
- `imageWidth` / `imageHeight` — NumUpDown: the coordinate-space extents that x/y are expressed in (defaults to natural image size).
- `imageOpacity` — NumUpDown, default 100.

**Card: Overlay Mode**
- `overlayMode` — ItemDropdown: "points" | "heat" | "both". Default "points".
- Points: `pointRadius`, `pointOpacity`, palette by `colorBy`, size by `value` (scaleSqrt).
- Heat: Gaussian splat per point weighted by `value` onto an offscreen Canvas, color-ramped (reuse density technique from Visual 19, Canvas 2D version); `heatRadius` default 30, `heatOpacity` default 70, `colorRamp` dropdown.

**Card: Zoom** — `enableZoom` default true (d3.zoom on a wrapping `<g>`; image and overlay transform together).

**Card: Labels** — show on hover | always | never; fontSize.

### Rendering
1. Decode/validate the data URI; place as SVG `<image>` sized to the viewport preserving aspect (letterbox).
2. Build the coordinate transform: data (x, y) in image units → screen px, flipping Y if bottom-left origin.
3. Points layer: SVG circles (typical N here is hundreds, SVG is fine). Heat layer: offscreen Canvas composited under the points, above the image.
4. Standard quadtree hover for tooltips.

### Edge cases
- No image bound → render overlay on a plain grid background with a hint message (still useful).
- Points outside image bounds → clamp options: "clip" (default) or "show" toggle.
- Huge base64 (>2MB) → warn; still render.

### Test Cases
1. Warehouse PNG + 300 pick locations colored by zone → points land correctly.
2. Bottom-left origin CAD export → Y flip correct.
3. Heat mode on incident counts → hotspots visible over the plan.
4. Zoom into one aisle → image and points stay registered.
5. SVG data URI supplied → rejected with clear message.

### Certification Notes
Raster-only data URIs, strict prefix validation, no markup injection, no network. Certifiable — and materially simpler to defend than SCADA.

---

## Visual 22: Decomposition Tree Pro

**Priority: 7 · Demand: 3/5 · Est. build: 4–6 days · Incumbent: native decomp tree (good but locked)**

### The gap
Native decomposition tree can't: custom-sort within a level, conditionally format nodes, show two measures at once (value + % of parent), or lock an analyst-defined expansion path into a saved report state. All are documented feature requests.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "value",     "kind": "Measure",  "displayName": "Analyze" },
    { "name": "secondary", "kind": "Measure",  "displayName": "Secondary Measure", "description": "Shown beside primary (e.g. % of parent auto-mode if empty)" },
    { "name": "levels",    "kind": "Grouping", "displayName": "Explain By", "description": "Multiple grouping fields; expansion order = user clicks" }
]
```

**DataViewMapping:** `matrix` — this is the natural fit for hierarchical expansion; use dataView matrix with expansion driven by `host.applyJumpToTarget`? No — simpler: request all bound levels in the matrix and manage expansion client-side, OR use the drill/expand host APIs. **Recommended v1: client-side expansion over a matrix dataView** with all levels; document the cardinality ceiling (product of level cardinalities capped by data reduction — show truncation notice).

### Format Pane

**Card: Nodes**
- `barColorMode` — "single" | "conditional". Conditional: `thresholdValue` + `aboveColor`/`belowColor` (the #1 request — color bars red/green vs target).
- `showSecondary` — ToggleSwitch default true; `secondaryMode` — "measure" | "% of parent" | "% of total".
- `barHeight`, `fontSize`, `maxNodesPerLevel` (default 10, rest into "Other").

**Card: Sorting**
- `sortMode` — "value-desc" | "value-asc" | "alphabetical" | "custom-per-level" (custom exposes a text slice per level: comma-separated order).

**Card: Expansion**
- `defaultExpansion` — TextInput: a saved path like "Region:West>Product:Widgets" auto-expanded on load (persisted via persistProperties when the user clicks "pin this path" in a node context action).
- `connectorStyle` — "curved" | "orthogonal".

### Rendering
1. Tree layout left→right: root node = grand total; each expansion click adds a column of child nodes for the clicked node's chosen level (user picks which "Explain By" field to expand by — render a small level-picker popup on click, mirroring native UX).
2. Nodes: rounded rect, label, primary value bar (width ∝ value within siblings), secondary value text; conditional fill per threshold.
3. Connectors: bezier or elbow from parent right edge to child left edges.
4. Client-side aggregation from the matrix dataView: sum leaf values under each node path.
5. Horizontal scroll within the visual viewport when depth × column width exceeds width (SVG in a clipped scrollable group; wheel = scroll when not zooming).

### Edge cases
- High-cardinality level (10k members) → top `maxNodesPerLevel` by value + "Other (n)".
- Measure that's non-additive (already-aggregated matrix values) → use matrix-provided subtotals, never re-sum leaves when subtotals exist.
- Negative values → bars extend left from a zero baseline within the node.

### Test Cases
1. Sales by Region>Product>Segment, expand three levels → totals tie to card visuals.
2. Conditional color vs target 0 → negative variance nodes red.
3. Custom sort "North,South,East,West" → honored at that level.
4. Pin path, reload report → auto-expanded.
5. 15k-member customer level → top-10 + Other, notice shown.

### Certification Notes
Matrix dataView + persistProperties, all standard. Certifiable. Care in the aggregation comments (subtotal vs leaf-sum) — reviewers check correctness claims.

---

## Visual 23: Small-Multiples Trellis Container

**Priority: 8 · Demand: 4/5 · Est. build: 3–5 days · Incumbent: native small multiples (core charts only, weak scale control)**

### The gap
Native small multiples: no shared-vs-free scale toggle per axis, no per-panel sorting, no ragged-grid control, line/bar/area only via the host chart. A dedicated trellis visual with those controls serves everyone the native feature turned away.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "panel",  "kind": "Grouping", "displayName": "Small Multiple By" },
    { "name": "axis",   "kind": "Grouping", "displayName": "Axis" },
    { "name": "series", "kind": "Grouping", "displayName": "Series (optional)" },
    { "name": "value",  "kind": "Measure",  "displayName": "Value" }
]
```

**DataViewMapping:** `categorical` (panel × axis × series × value).

### Format Pane

**Card: Grid**
- `columns` — NumUpDown, default 0 (auto = ceil(sqrt(n))).
- `panelOrder` — "value-desc" | "value-asc" | "alphabetical" (by panel total).
- `panelPadding`, `showPanelTitles`, `titleFontSize`.

**Card: Scales**
- `yScaleMode` — ItemDropdown: "shared" | "free" | "shared-within-row". THE feature.
- `xScaleMode` — "shared" | "free".
- `showYAxisEvery` — "all-panels" | "first-column" | "none".

**Card: Chart**
- `chartType` — ItemDropdown: "line" | "bar" | "area" | "scatter".
- Standard per-type slices (curve, bar padding, point size), palette by series.

**Card: Highlights**
- `benchmarkPanel` — TextInput: a panel name whose series is ghosted into every other panel as a gray reference (a beloved trellis idiom no product ships).

### Rendering
1. Compute grid; each panel = a `<g>` translated into place; ONE render function draws a panel given its data + scales (chart-type switch inside).
2. Scale computation per yScaleMode: shared = global extent; free = per-panel; shared-within-row = extent per grid row.
3. Panel titles with total value; benchmark ghost drawn first in each panel.
4. Panels beyond ~40 → paginate ("1–40 of 96" pager chip) rather than shrinking into illegibility.

### Edge cases
- One panel → renders as a single chart (degenerate but valid).
- Panels with missing axis categories → align on the union of categories in shared-x mode.
- Mixed-sign values in area mode → fall back to line with notice.

### Test Cases
1. Revenue by month × 24 stores, shared Y → honest cross-store comparison.
2. Same, free Y → per-store shape reading.
3. Benchmark = "All Stores Avg" panel → gray ghost in every panel.
4. 96 panels → paginated.
5. Bar type with series → grouped bars per panel.

### Certification Notes
Pure SVG. Certifiable trivially.

---

## Visual 24: Advanced Table (Sparklines + Icon Rules)

**Priority: 9 · Demand: 5/5 (but scope risk) · Est. build: 4–6 days scoped · Incumbent: native table/matrix; Inforiver (paid)**

### The gap
The most-used visual in every report is the table, and the native one can't put a sparkline or an icon rule in a cell without matrix hacks. **Scope ruthlessly:** sparkline columns + conditional icons + better totals. Explicitly OUT: row formulas, grouped headers, writeback, pagination editing — that's Inforiver's moat and a swamp.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "rows",      "kind": "Grouping", "displayName": "Rows" },
    { "name": "columns",   "kind": "Measure",  "displayName": "Values",          "description": "Regular value columns (multiple)" },
    { "name": "sparkAxis", "kind": "Grouping", "displayName": "Sparkline Axis",  "description": "Time field for sparkline cells" },
    { "name": "sparkValue","kind": "Measure",  "displayName": "Sparkline Value" }
]
```

**DataViewMapping:** two mappings — a `matrix` (rows × sparkAxis with sparkValue + column measures as values). Sparkline data comes from the sparkAxis level nested under each row.

### Format Pane

**Card: Sparklines**
- `sparkType` — "line" | "bar" | "area" | "win-loss".
- `sparkWidth` default 90, `sparkHeight` default 22, `sparkColor`, `highlightLast` ToggleSwitch (dot + bold last value), `showMinMaxDots`.

**Card: Icon Rules** (repeat ×3 rule slots)
- `rule1Column` — TextInput (measure display name), `rule1Operator` — ">" | "<" | ">=" | "<=" | "=", `rule1Value` — NumUpDown, `rule1Icon` — "▲" | "▼" | "●" | "■" | "✓" | "✗" (bundled glyphs, not a font fetch), `rule1Color`.

**Card: Table**
- `showTotals` — ToggleSwitch + `totalsPosition` top|bottom; `fontSize`; `rowBanding` toggle + color; `columnWidthMode` — "auto" | "uniform"; `stickyHeader` toggle.

### Rendering
1. HTML table? No — **HTML grid via DOM** is actually the right call here (native scrolling, text ellipsis, accessibility), NOT SVG. `div`-grid with sticky header row. Sparkline cells contain small inline SVGs.
2. Virtualize rows (render visible ± buffer) above 200 rows — standard windowing on the scroll container.
3. Sparklines: one tiny SVG per visible row, drawn from that row's nested sparkAxis series; min/max/last dots per toggles.
4. Icon rules evaluated per cell; icon prepended to the formatted value.
5. Sorting: click header to sort by that measure (client-side over the matrix rows).
6. Use valueFormatter for all numbers (respect model format strings).

### Edge cases
- Rows with no sparkline data → empty spark cell, not a broken one.
- 50+ value columns → horizontal scroll with sticky row-header column.
- Mixed row grouping levels → v1 supports ONE row grouping level (flat); document it. Multi-level = v2.

### Test Cases
1. 500 products × 4 measures + 12-month sparkline → smooth scroll, correct sparks.
2. Icon rule "Margin < 0 → red ▼" → applied.
3. Win-loss sparks on net-flow data → above/below-zero bars.
4. Sort by any measure → instant.
5. Totals row → matches card totals.

### Certification Notes
DOM-based rendering is fully certifiable (plenty of certified table visuals are DOM-based). All glyphs are text characters, no font fetch. Virtualization code commented. Certifiable.

---

## Visual 25: Histogram Pro

**Priority: 10 · Demand: 3/5 · Est. build: 2–3 days · Incumbent: Microsoft histogram (barebones)**

### The gap
No automatic bin-width selection, no density overlay, no live bin exploration. The killer feature: a draggable bin-width control so analysts explore sensitivity directly.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "values",  "kind": "Measure",  "displayName": "Values" },
    { "name": "groupBy", "kind": "Grouping", "displayName": "Compare Groups", "description": "Optional: overlaid/faceted histograms per group" }
]
```

**DataViewMapping:** `categorical`; values arrive row-level (like quantile dotplot).

### Format Pane

**Card: Binning**
- `binMethod` — ItemDropdown: "freedman-diaconis" | "sturges" | "scott" | "manual". Default freedman-diaconis.
- `manualBinWidth` — NumUpDown (manual mode).
- `showBinSlider` — ToggleSwitch default true: an in-visual drag handle that live-adjusts bin width (writes back to manualBinWidth via persistProperties on release).
- `niceBoundaries` — ToggleSwitch default true (snap bin edges to round numbers).

**Card: Density**
- `showDensity` — ToggleSwitch default false: KDE curve overlay (Gaussian kernel, Silverman bandwidth default; `bandwidthScale` NumUpDown 10–300%).
- `densityColor`, `densityWidth`.

**Card: Bars / Groups**
- `barColor`, `barOpacity`, `groupMode` — "overlay" (semi-transparent) | "facet" (mini-multiples) | "stack".
- `yMode` — "count" | "frequency" | "density" (normalized so density curve and bars share scale).

**Card: Annotations**
- `showMeanLine` / `showMedianLine` toggles + colors; `showNormalOverlay` (fit N(μ,σ), dashed).

### Rendering
1. Bin rules: FD = 2·IQR·n^(−1/3); Sturges = ⌈log2 n⌉+1 bins; Scott = 3.49·σ·n^(−1/3). Compute width, snap if nice.
2. `d3.bin()` with explicit thresholds; bars via scaleLinear.
3. KDE: Gaussian kernel evaluated at ~200 x-points; O(200·n) fine to ~50k values.
4. Bin slider: a small handle under the x-axis; drag → recompute thresholds live (throttled rAF); release → persist.
5. Group overlay: palette colors at reduced opacity; facet mode reuses the trellis panel function pattern.

### Edge cases
- n < 10 → rug plot + notice instead of bins.
- Extreme outliers stretching the domain → optional `clipToPercentile` (0.5–99.5) toggle with notice.
- Identical values → single bar.

### Test Cases
1. 10k normal values → FD binning ≈ textbook; normal overlay matches.
2. Drag slider narrow→wide → live rebinning stays smooth.
3. Two groups overlay → transparent comparison.
4. Density y-mode → KDE and bars share units.
5. Log-normal with clipping on → readable body, notice shown.

### Certification Notes
Pure computation, SVG. persistProperties for the slider. Trivially certifiable.

---

## Visual 26: Word / Phrase Cloud Modern

**Priority: 11 · Demand: 3/5 · Est. build: 2–3 days · Incumbent: Microsoft word cloud (huge installs, ancient)**

### The gap
Poor packing, no n-gram support, weak stop-words, no click-to-filter. Enormous existing install base to siphon.

### Data Roles

```jsonc
"dataRoles": [
    { "name": "text",   "kind": "Grouping", "displayName": "Text / Term" },
    { "name": "weight", "kind": "Measure",  "displayName": "Weight",   "description": "Optional; if absent, term frequency is computed from raw text" },
    { "name": "colorBy","kind": "Grouping", "displayName": "Category" }
]
```

**Two modes:** pre-aggregated (term + weight rows) or raw-text (long text values → visual tokenizes, builds n-grams, counts).

### Format Pane

**Card: Text Processing** (raw mode)
- `ngramSize` — "1" | "2" | "1+2" | "3". Default "1+2" (unigrams + bigrams — bigram support is the differentiator).
- `stopWords` — ItemDropdown "english" | "none" | "custom"; `customStopWords` TextInput (comma-sep). Bundle a standard English stop list as a constant.
- `minFrequency` — NumUpDown default 2; `maxTerms` default 100; `caseMode` — "lower" | "preserve".

**Card: Layout**
- `spiral` — "archimedean" | "rectangular"; `rotations` — "none" | "±90" | "±45/90"; `padding` default 2; `scaleMode` — "sqrt" | "log" | "linear" (weight→font-size).
- `fontFamily` — dropdown of web-safe families (bundled, no font fetch); `minFontSize` / `maxFontSize`.

**Card: Interaction**
- `clickToFilter` — ToggleSwitch default true: clicking a word issues a selection on the term (SelectionManager with selection IDs built per category value — the feature the incumbent lacks that makes a cloud useful in a report).
- `hoverTooltip` — term, count, rank.

### Rendering
1. Raw mode: tokenize (split on non-word, strip punctuation), lower per caseMode, remove stop words, build n-grams, count, take top maxTerms above minFrequency.
2. Layout with `d3-cloud` (npm `d3-cloud@1.2`, the standard Jason Davies layout — small, pure JS). Run layout in a rAF-chunked loop for large term counts to avoid blocking.
3. Render placed words as SVG `<text>`; palette by colorBy or a rank-based ramp.
4. Selection IDs: in pre-aggregated mode, build from the term category (host.createSelectionIdBuilder); raw-text mode → clickToFilter disabled with a notice (no data-model identity to select on).

### Edge cases
- One dominant term → cap max font to 40% of the shorter viewport side.
- Non-Latin scripts → tokenization on Unicode word boundaries (`\p{L}+` with u flag).
- Terms that don't fit → drop least-weighted, note "showing N of M".

### Test Cases
1. Survey comments raw text, 1+2 grams → meaningful bigrams ("customer service") appear.
2. Custom stop words added → removed live.
3. Click "delivery" → cross-filters the report (pre-aggregated mode).
4. 500 candidate terms → layout completes without jank (chunked).
5. Rotations off → all horizontal, tighter packing.

### Additional Dependencies
```json
"d3-cloud": "1.2.7"
```

### Certification Notes
d3-cloud is small/known. Stop-word list bundled. SelectionManager is standard. Certifiable.

---

## Visual 27: Chord Diagram Modern

**Priority: 12 · Demand: 2/5 · Est. build: 2–3 days · Incumbent: abandoned MS chord**

### The gap
Ribbon highlighting, directional gradients, label management, flexible input. Smallest audience of this set but nearly free given the adjacency-matrix work (same edge-list input model).

### Data Roles
Same edge list as Visual 07 (source / target / weight).

### Format Pane

**Card: Chord**
- `directed` — ToggleSwitch default false (directed mode renders asymmetric ribbons with arrowhead taper).
- `padAngle` — NumUpDown default 3 (degrees between groups).
- `sortGroups` — "size-desc" | "alphabetical" | "data-order".
- `ribbonOpacity` default 65; `hoverMode` — "highlight-connected" | "isolate" (isolate hides all non-connected ribbons).

**Card: Arcs & Labels**
- `arcThickness` default 12; palette per group; `labelMode` — "radial" | "horizontal" | "hidden"; auto-hide labels for groups under `minLabelAngle` (default 4°) with tooltip fallback; `fontSize`.

**Card: Gradients**
- `gradientRibbons` — ToggleSwitch default true: each ribbon gets a linearGradient from source arc color to target arc color (the modern look).

### Rendering
1. Build the square matrix from the edge list (reuse Visual 07's builder).
2. `d3.chord()` / `d3.ribbon()` (in core d3, no new dep). Directed mode uses `d3.chordDirected()` + `d3.ribbonArrow()`.
3. Gradients in `<defs>`, one per ribbon, endpoints at the two arc midpoints.
4. Hover: highlight-connected = raise opacity on ribbons touching the hovered arc, dim rest; isolate = display:none the rest.
5. Labels along arc midangles, flipped upright on the left hemisphere.

### Edge cases
- Self-flows (diagonal) → rendered as small self-ribbons (d3 handles).
- >40 groups → labels auto-hide below threshold; suggest matrix visual in a notice (cross-sell your own Visual 07).
- Zero-sum rows → group omitted.

### Test Cases
1. Migration flows between 8 regions → gradient ribbons, hover isolates.
2. Directed trade flows → arrowed ribbons show asymmetry.
3. 50 groups → degrades gracefully, small labels hidden.
4. Self-flow present → diagonal ribbon renders.
5. Sort by size → largest group at 12 o'clock.

### Certification Notes
Core d3 only. Trivially certifiable.

---

## Combined Stack Rank (all 27 visuals)

Ease scored on the same /20 rubric as the unbroached set (render, algorithm, data fit, cert safety). Demand includes the market-validation edge that improvement plays get from incumbent install bases.

| Rank | # | Visual | Type | Ease /20 | Demand | Note |
|---|---|---|---|:--:|:--:|---|
| 1 | 01 | Icon Arrays | New | 20 | 3 | Pipeline validator |
| 2 | 02 | Ternary Plot | New | 20 | 2 | |
| 3 | 03 | Quantile Dotplot | New | 19 | 3 | Uncertainty suite |
| 4 | 04 | Fan Chart | New | 19 | 4 | **Built** |
| 5 | 25 | Histogram Pro | Improve | 18 | 3 | Fastest improvement play |
| 6 | 16 | **Waterfall/Bridge** | Improve | 18 | 5 | **Best ROI on either list** |
| 7 | 20 | Line Focus | Improve | 17 | 4 | |
| 8 | 05 | HOPs | New | 17 | 3 | Uncertainty suite |
| 9 | 06 | Wafer Map | New | 17 | 3 | |
| 10 | 23 | Trellis Container | Improve | 16 | 4 | |
| 11 | 26 | Word Cloud Modern | Improve | 16 | 3 | Biggest install base to siphon |
| 12 | 27 | Chord Modern | Improve | 16 | 2 | Nearly free after #07 |
| 13 | 21 | Indoor Map | Improve | 15 | 4 | SCADA-lite |
| 14 | 07 | Adjacency Matrix | New | 15 | 3 | |
| 15 | 17 | **Modern Sankey** | Improve | 14 | 5 | Biggest demand pool |
| 16 | 24 | Advanced Table | Improve | 13 | 5 | Scope discipline required |
| 17 | 08 | Interval-Track Viewer | New | 13 | 4 | Shared module source |
| 18 | 09 | Spectrogram | New | 13 | 4 | |
| 19 | 10 | Matrix Profile | New | 13 | 4 | |
| 20 | 18 | **Gantt + CPM** | Improve | 12 | 5 | Reuses #08 machinery |
| 21 | 22 | Decomp Tree Pro | Improve | 12 | 3 | |
| 22 | 11 | Order Book Heatmap | New | 12 | 3 | |
| 23 | 12 | Storyline | New | 12 | 3 | |
| 24 | 19 | WebGL Scatter | Improve | 11 | 4 | Capability moat |
| 25 | 13 | DFG / Variant Explorer | New | 10 | 5 | Moonshot |
| 26 | 14 | Event Bundles | New | 9 | 3 | |
| 27 | 15 | SCADA Mimic | New | 8 | 4 | Ship uncertified |

### Shared-module map (build once, use everywhere)

| Module | First built in | Reused by |
|---|---|---|
| Edge-list → matrix builder | 07 Adjacency Matrix | 17 Sankey (pre-processing), 27 Chord |
| Interval lane-packing + zoom/pan + Canvas/SVG hybrid | 08 Interval Tracks | 18 Gantt |
| Radix-2 FFT | 09 Spectrogram | 10 Matrix Profile |
| Canvas density / color-ramp renderer | 06 Wafer Map (simple) → 11 Order Book | 19 WebGL Scatter (density pass concept), 21 Indoor Map heat |
| Layered-DAG layout knowledge (dagre) | 13 DFG | 17 Sankey (conceptual), 14 Event Bundles |
| Trellis panel-render function | 23 Trellis | 25 Histogram facets, 20 Line small-multiples fallback |
| persistProperties patterns | 17 Sankey (node order) | 20 Line (pins), 22 Decomp (paths), 25 Histogram (bin width) |
| Quadtree hover | 20 Line Focus | 19 Scatter (SVG mode), 21 Indoor Map |
| valueFormatter integration | 16 Waterfall | 24 Table, everywhere |

### Recommended portfolio sequencing (revised, both lists merged)

**Wave 1 — pipeline + uncertainty suite (1–2 weeks):** 01, 02, 03, 04(done), 05. Ships a coherent zero-competition suite; certification audit passes trivially.

**Wave 2 — high-demand improvement strikes (2–3 weeks):** 16 Waterfall, 25 Histogram, 20 Line Focus. Three visuals with named incumbent pain and small scope. This wave is where AppSource installs actually start compounding.

**Wave 3 — module builders (3–4 weeks):** 07 Adjacency Matrix → 27 Chord (free rider), 08 Interval Tracks → 18 Gantt, 23 Trellis. Every visual here amortizes into a later one.

**Wave 4 — flagships (as appetite allows):** 17 Sankey, 24 Table (scoped), 09/10 FFT pair, 21 Indoor Map, 26 Word Cloud.

**Wave 5 — moonshots:** 19 WebGL Scatter, 13 DFG/Variants, 14 Event Bundles, 15 SCADA (uncertified).
