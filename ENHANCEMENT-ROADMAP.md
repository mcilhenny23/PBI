# Enhancement Roadmap — the 15 novel visuals

What each visual could become, judged against how practitioners in its domain
actually work. This is **capability extension**, not platform-compliance work
(selection, context menus, format strings and accessibility are tracked
separately — see *Cross-cutting gaps* at the end).

Status key: **✅ built** · **▶ next** · **○ possible**

Four themes recur:

| Theme | Meaning |
|---|---|
| **A. Input shape** | The visual is capable but accepts only one data layout, locking out most real datasets. |
| **B. Domain overlay** | A reference model or standard turns a generic chart into a domain instrument. |
| **C. Metrics as numbers** | Practitioners need the figure, not only the picture. |
| **D. Less guesswork** | Removing the "what do I set this parameter to?" barrier. |

---

## 1. Wafer Map — semiconductor yield

- **✅ Stacked (composite) mode** *(B, C)* — overlays every wafer into one map showing fail rate per die position. Random defects average out; systematic signatures stay bright. Verified on the sample lot: 8 dies fail on all 4 wafers (systematic) vs 234 failing on exactly one (noise).
- **✅ Reticle / shot-field overlay** *(B)* — new **Reticle Overlay** card with X/Y shot size, X/Y offset, colour, opacity and a **Highlight bad reticles** toggle that tints every shot whose fail rate is ≥ threshold × wafer average (default 1.5×). Auto-detects the passing bin from the log or reuses **Wafer → Passing bin name**. Verified on a seeded 540-die sample with two planted bad shots: shot (3,2) at 88% fail rate (7.75× avg) and shot (5,5) at 60% (5.31×) both glow immediately at the default threshold. Repeating-defect signatures the plain colour map buries in edge noise now surface in one glance.
- **✅ Zonal yield statistics** *(C)* — **Zone Overlay → Show per-zone yield** prints the yield % (or fail %, or die count) inside each ring, so the geometric overlay reads as the actual centre / mid / edge yield report. Each die is bucketed by its normalized radial distance from the wafer centre; text label sits at the top of its ring with white halo so it reads on any die colour. Skipped in stacked composite mode because the coloured die itself is the fail-rate, so the ring number would double-count. Verified on 01-wafer-single with 3 zones: centre 65.0%, mid 93.9%, edge 73.0% — the mid ring is healthy, edge is classic exclusion-ring pattern, centre is a genuine small-sample defect worth chasing.
- **○ Wafer-to-wafer diff** — pick two wafers, show only what changed.
- **○ Bin Pareto** — ranked bin counts beside the map.
- **○ Radial/angular trend** — yield vs radius and vs angle, to separate spin-coat from edge-handling issues.

## 2. Matrix Profile — anomaly & pattern discovery

- **✅ Salience gate + focus control** — suppresses findings that don't stand apart (see `open-review-items`).
- **✅ Multi-length (pan-matrix) profile** *(D)* — the window length `m` is the one parameter and users genuinely don't know it. **Window length → Multi-length (scan & suggest)** scans a geometric range of lengths, draws the profile strip as a heatmap (X = position, Y = length, bright = no match), and suggests a length by strongest normalized contrast. Suggests m=107 on the ECG (truth 100) and m=99 on the pump (truth 60) — both within 2×. Capped at 3,000 points and cached, since the scan is O(lengths × n²).
- **✅ Regime change / semantic segmentation (FLUSS)** *(B)* — new **Regime Segmentation** card. Uses the matrix-profile indices to build the corrected arc curve; regime boundaries are its lowest minima. O(n) after STOMP so no extra compute cost worth caching. Boundary picker peels one whole valley per iteration (walk from the min outward until CAC recovers above 0.7, capped at 10% of n) with an admission cutoff of 0.15 — real regime dips are ≤0.1 while shoulders sit at 0.2–0.4, so this draws the line cleanly. Verified on a synthetic 3-regime signal (freq₁ | freq₂ | noise, boundaries at 1000 and 2000): picks exactly those 2 boundaries at positions 971 and 1958, both within 1.5m of truth. Boundaries render as dashed vertical lines through both series and profile panels; optional CAC overlay on the profile strip shows the underlying curve.
- **○ Chains** — evolving patterns that drift over time.
- **○ Annotation vector** — bias the profile to ignore known-uninteresting shapes.
- **○ Export found motifs** back into the model as a column.

## 3. Spectrogram — vibration & acoustics

- **✅ Order tracking** *(B)* — bind an **RPM** column and switch **Order Tracking → Y axis** to Orders. For each frame the y-axis is rescaled by `RPM/60` (per-frame mean RPM, computed at render time from the cached FFT), so a component at order *o* sits at row *o* regardless of shaft speed. Verified on the run-up sample: the 1×, 3× and 5.5× bands smear as curved diagonals in Hz mode and collapse to flat lines in Orders mode. Alarm bands are re-read as orders when the mode is on, so a "vibration above 3×" alarm survives a run-up unchanged. Order-marker lines (comma-separated list) overlay each requested order for eyeballing.
- **✅ Harmonic cursors** *(B)* — **Harmonic Cursors → Show** + fundamental (Hz) draws a dashed line on the fundamental and integer multiples 2×, 3×, … up to *N* (or Nyquist). Verified against the machine-vibration sample: fundamental=120 has the 1× peak 136× above the halfway-point background and 2× at 27×, while 3× and 4× sit on empty space — the cursor tells you which multiples are real. Tooltip picks up "*k*× fundamental" when the hover cell is within one bin of a multiple. Hz-only by design — Orders mode has its own multiples-of-shaft axis via order markers.
- **✅ Band-power trending** *(C)* — **Alarm Bands → Show band-power trend** adds a strip below the spectrogram plotting a single scalar per frame — RMS-dB, peak-in-band, or sum — over the alarm band. Threshold input draws a dashed line at the alarm level and shades every heatmap column where the band-power crosses it, so the alarm criterion is visible where the fault lives, not just on the trend line. In orders mode the band bounds are re-read as orders and the bins are recomputed per-frame from RPM. Verified on the machine-vibration sample: 380–460 Hz band RMS goes from −33.3 ± 1.3 dB background to −14.2 dB when the fault sweeps in, a 19 dB jump; threshold of −30 dB (bg + 3σ) cleanly separates the fault-in-band frames.
- **✅ Peak hold + mean overlay** — new **Peak Hold** card. Reserves a strip on the right of the heatmap plotting per-row max magnitude across all frames, with an optional dashed mean line. Same colour scaling as the heatmap so a peak at a given colour reads as the same dB. Works in orders mode (per-order peaks/means using the same RPM warp) and Hz mode. Verified on the machine-vibration sample: 120 Hz fundamental peak ≈ mean (gap 0.3 dB — steady-state), 440 Hz fault peak 26.5 dB above mean (transient — the burst the animated map paints over). Peak-mean gap is the diagnostic that turns the strip from decoration to signal-detection.
- **○ Waterfall (3D) view** — the alternative conventional presentation.
- **○ Envelope / demodulation** — the standard bearing-fault technique.

## 4. DFG / Process Map — process mining

- **✅ Conformance checking** *(B)* — **Conformance → Show conformance** compares observed transitions against a reference model. Reference source can be **Manual list** (paste `A -> B` per line/semicolon, with `->`, `→`, or `=>` accepted, and `#`/`//` comments) or **Top variant (auto)** — the most frequent path as a stand-in when no policy is documented. Observed edges are recoloured green/red per conformance; reference edges never observed are overlaid as dashed grey ghost lines between the two nodes (dagre doesn't see them, so toggling never disturbs the layout). Top-right summary reports case fitness, edge fitness, violation count, missing count, and parse errors. Verified on the P2P sample: 49% of 400 cases fully conform, exposing eight violation transitions including the 27-case "approval skipped" control gap and the 46-case "invoice before goods" three-way matching failure.
- **✅ Rework & loop metrics** *(C)* — new **Rework Metrics** card. **Show rework summary** prints "*X%* of *N* cases have rework · *M* re-visits · *K* self-loops · rework cost *V* · top: *Activity* (*n*)" as a single top-of-map line. **Badge repeated activities** puts a ↺ mark on the top-N most-revisited nodes so the reader's eye lands straight on the control that keeps failing. Rework cost sums the bound Value measure on every re-visit event, so an audit-friendly currency figure comes out of the same computation. Verified against the P2P sample: 25% of 400 cases have rework, 145 total re-visits, 14,761 rework cost, top hotspot Approve at 115 extra visits — matching the six-step happy path + reject/revise loop story.
- **✅ Variant selection → cross-filter the report** — row-level `withTable` selection IDs are built at parse time and grouped by caseId in `selectionByCase`. Clicking a variant now gathers every row-selection-id for every case in that variant and calls `selectionManager.select(ids)` — Power BI cross-filters other visuals on the page by those rows. Shift/Ctrl-click adds instead of replaces; clicking the same variant again or hitting **Clear selection** clears both the report filter and the in-visual dim. Verified on P2P sample: variant #1 (happy path) selects 194 cases / 1,164 rows; variant #5 (approval skipped) selects 27 cases / 135 rows — the audit finding drills straight from "here's the shape" to "here are the specific POs".
- **○ Performance overlay** — bottleneck highlighting by duration (partly available via edge metric).
- **○ Case duration distribution** per variant.
- **○ Activity filtering** — hide activities, not just rare edges.

## 5. Storyline — entity migration

- **✅ Aggregate flow mode** *(A)* — **Layout → Flow mode → Aggregate (Sankey ribbons)** collapses per-entity lines into one thick band per group at each time step, sized by member count, with ribbons showing transitions. Sub-stripes within each source/target band are ordered by their partner's vertical position (Sankey stacking) so ribbons cross minimally without a full optimiser. Ribbons tooltip (from, to, count, stayed/moved). Verified on team-moves: 96 stayed, 5 moved, 2 dropped, 2 joined, reported as a 5% churn rate — small on the 16-entity narrative sample by construction; the mode earns its keep once entity counts pass ~50 and the individual-line view becomes a hairball.
- **▶ Group-order optimisation** — band order is currently fixed (documented limitation); a move between non-adjacent bands still crosses the ones between.
- **○ Entity bundling** — collapse similar trajectories.
- **○ Event annotations** — mark reorganisations or campaigns on the time axis.

## 6. HOPs — animated uncertainty

- **✅ Accept ensembles as rows** *(A)* — new **Ensemble ID** grouping role. When bound + a single **Sample Draws** measure, the visual pivots (axis, ensembleId) rows into per-member arrays. Wide-format columns still work with Ensemble ID unbound — the branch is chosen from the bound roles, so existing bindings need no change. Axis order preserved from row-first-seen order (never alphabetical, else "Jan, Feb, Mar" reads as "Apr, Aug, Dec"). Actuals in long form arrive repeated per row and are collapsed to the first non-null seen at each axis point. Verified against the demand-ensemble sample: 120-row long file round-trips exactly to the 12-column wide file, same animation.
- **✅ Fan-chart overlay** — new **Fan Overlay** card. Draws stacked percentile bands (comma-separated, default 50/80/95%) with the median dashed on top, sitting behind the animation. HOPs alone shows *plausible* outcomes; the fan communicates specific probability ranges the report reader can quote. Empirical linear-interpolated quantiles per axis point, skipping points where every member is null. Verified on the demand-ensemble sample: median 99.5 → 114.3 Jan-Dec, 95% band widens 3.2× (classic uncertainty compounding), and 6/6 historical actuals fall inside the 80% band — a calibration check the raw animation can't give.
- **○ Static / animated toggle** — pair with the Fan Chart so one report can show both.
- **○ Frame scrubber** — step through outcomes manually.
- **○ Speed tied to variance** — faster flicker where uncertainty is wider.

## 7. Ternary Plot — composition

- **✅ Classification-region overlays** *(B)* — new **Classification Overlay** card with a pluggable scheme registry (`src/schemes.ts`). Ships with **USDA soil texture** (12 classes). Each region is a polygon of barycentric vertices projected through the visual's `project()`; hover-tooltip names the class + required vertex assignment. Boundaries approximate the NRCS Soil Survey Manual to whole-percent vertices — verified: 11/12 samples in the soil dataset land in the region matching their `TextureClass` column (the 12th is `Clay (heavy)` inside `Clay`, a subclass). Coverage sweep of 300 random points: 280 in exactly one region, 19 boundary gaps, 1 overlap. QAPF for rocks and other schemes add cleanly as new entries in the same registry.
- **○ Density contours** — for hundreds of points.
- **○ Per-group convex hulls / centroids**.
- **○ Tie-lines and mixing paths** — materials science.

## 8. Adjacency Matrix — networks

- **▶ Bipartite mode** *(A)* — rows ≠ columns (people × projects, customers × products). Currently the matrix is a single node set; bipartite is a large class of real problems.
- **○ Node metrics panel** *(C)* — degree, betweenness, clustering coefficient — makes it analysis rather than display.
- **○ Alternative seriation** — spectral ordering, optimal leaf ordering.
- **○ Matrix diff** — period over period.

## 9. Interval Track — timelines

- **✅ Per-track density statistics + concurrency ribbon** *(C)* — new **Density** card. **Show per-lane density** reserves a stats column on the right of every track showing coverage % (union of intervals over visible span), event count and mean duration. Reactive to zoom, so scoping the window updates the stats live. **Show concurrency ribbon** adds a top strip plotting the number of intervals active at each point in time across all tracks — a fast read on contention. Union coverage uses a merged-interval sweep so overlapping bars never double-count, and point events are skipped from coverage but still counted as events. Verified on the machine-states sample: all 5 machines at 100% coverage with 50-57 events and ~200-240 min mean duration; peak concurrency 5 (all machines always active by construction).
- **○ Rollup when zoomed out** — "% time in state" rather than density bands.
- **○ Conflict / overlap detection** — double-booking, resource contention.
- **○ Now-line and live window** for operational dashboards.

## 10. Event Sequence Bundles — journey analysis

- **✅ Time-scaled columns** *(A)* — **Layout → Time-scaled columns** positions each column by the median elapsed time from the anchor across every case that reached that depth. `alignSequences` now carries parallel per-case timestamp arrays; `buildTrie` accepts a per-depth samples collector; `layoutTrie` returns `depthMedianElapsed` (clamped monotone so columns never overtake). Silent fallback to equal-width when Timestamp isn't bound or samples are all zero. Optional time axis prints `anchor`, `+15m`, `+82m`, `+1.9h`, ... under each column. Verified on the ER-journeys sample: Registration → Triage 15 min, Triage → Doctor **82 min (5.4× wider)** — the equal-width chart flattens this into two identical columns, time-scaled makes the bottleneck the widest thing on screen.
- **▶ Outcome colouring** *(C)* — colour bundles by final outcome (recovered / churned / readmitted).
- **○ Sequence search** — "show journeys containing X then Y".
- **○ Cohort comparison** — two populations side by side.

## 11. Order Book — market microstructure

- **○ Volume profile / VWAP sidebar** *(C)* — standard desk furniture.
- **○ Order-book imbalance** metric over time.
- **○ Iceberg / refill detection** — repeated replenishment at a level.
- **○ Footprint mode** — bid vs ask volume per price cell.

## 12. Fan Chart — forecast uncertainty

- **○ Forecast vintages ("fan of fans")** *(A)* — compare successive forecast rounds. Core central-bank practice.
- **○ Backtest calibration overlay** *(C)* — did the 80% band actually contain 80% of outcomes?
- **○ Explicit history/forecast divider** — currently only implied by where actuals stop.
- **○ Asymmetric / skewed bands** — inflation-risk style forecasts aren't symmetric.

## 13. Icon Array — risk communication

- **○ Side-by-side comparison mode** *(A)* — treatment vs control. This is the actual shared-decision-making use case.
- **○ Icon-per-N scaling** — "1 icon = 100 people" with a legend, for large denominators.
- **○ Auto natural-frequency sentence** — "17 out of 100 people like you…".

## 14. Quantile Dotplot — risk comprehension

- **○ Multiple thresholds** with live P(x > t) readout.
- **○ Two-distribution comparison** — before/after, A/B.
- **○ Cumulative mode**.

## 15. Synoptic / SCADA — industrial mimic

- **○ Built-in symbol library** — the adoption blocker is having to paste raw SVG. Tank / valve / pump / pipe primitives would make it usable without an SVG author.
- **○ Alarm priority + acknowledge state**.
- **○ Trend sparkline on elements**.
- **○ Multi-state binding** — discrete state → symbol variant.

---

## Cross-cutting gaps (platform, not capability)

Measured across all 15. Tracked separately because it's compliance work rather
than domain capability, but it is the larger UX gap in absolute terms:

| Capability | Coverage |
|---|---|
| Selection / cross-filter out | 0 / 15 |
| Highlight (respond to filtering in) | 0 / 15 |
| Context menu | 0 / 15 |
| Keyboard navigation | 0 / 15 |
| Respect model format strings | 0 / 15 |
| Display units / decimals | 0 / 15 |
| Font family | 0 / 15 |
| High contrast | 2 / 15 |

`pbiviz` reports **8 missing recommended features** on every original visual.
`waterfallBridge` (improvement set) implements all of them and is the working
reference to port from.

One nuance worth preserving: **selection only makes sense where a mark maps to a
data row.** It fits iconArrays, ternaryPlot, waferMap, adjacencyMatrix,
intervalTrack, storyline, dfgExplorer, eventBundles, orderBook, synoptic. It is
a poor fit for quantileDotplot, hops, spectrogram and matrixProfile, whose marks
are *computed aggregates* — a quantile dot is not a row. Those want
**brush-a-range → filter** instead.

## Performance — ✅ done

Previously all six heavy visuals re-ran their expensive computation inside
`update()`, so **changing a colour re-ran an O(n²) matrix profile, a full FFT
sweep, or a clustering pass.**

Now split compute from render via `src/computeCache.ts` (present in each of the
six). Compute is keyed on a fingerprint of the data **plus only the parameters
that shape it** — never styling — so cosmetic changes re-render from cache.

| Visual | Cached work | Invalidated by |
|---|---|---|
| matrixProfile | STOMP profile, O(n²) | series, window length, exclusion zone |
| spectrogram | sliding-window FFT sweep | signal, window size, overlap, window fn |
| adjacencyMatrix | agglomerative seriation | adjacency matrix contents |
| dfgExplorer | dagre layout | graph shape, node sizing, direction |
| eventBundles | prefix tree build + prune | sequences, depth, support, anchor |
| storyline | barycentre sweep | rows, slot height, group gap, ordering |

**Why a full O(n) fingerprint rather than sampling:** a false cache hit renders
*stale* results, which is a correctness bug, whereas a false miss is merely slow.
Measured at n = 10,000 the fingerprint costs **0.08 ms** against STOMP's ~10⁸
distance evaluations — roughly four orders of magnitude cheaper, so there is no
reason to gamble on a sample.

Verified behaviourally: identical inputs and style-only changes hit; changing a
compute parameter, changing one value by 1e-9, or swapping two values all miss;
20,000 near-identical series produced 20,000 distinct keys with no collisions.

Notable side-effect: in `dfgExplorer` the layout key deliberately excludes the
selected variant, so **clicking a variant no longer re-runs dagre** — it only
re-highlights.
