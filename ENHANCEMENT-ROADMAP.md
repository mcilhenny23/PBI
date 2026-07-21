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
- **▶ Reticle / shot-field overlay** *(B)* — group dies into reticle fields. Defects very often align to reticle boundaries, and without the grid that pattern is invisible.
- **▶ Zonal yield statistics** *(C)* — yield by centre/mid/edge as numbers. The zone rings exist; the numbers don't.
- **○ Wafer-to-wafer diff** — pick two wafers, show only what changed.
- **○ Bin Pareto** — ranked bin counts beside the map.
- **○ Radial/angular trend** — yield vs radius and vs angle, to separate spin-coat from edge-handling issues.

## 2. Matrix Profile — anomaly & pattern discovery

- **✅ Salience gate + focus control** — suppresses findings that don't stand apart (see `open-review-items`).
- **✅ Multi-length (pan-matrix) profile** *(D)* — the window length `m` is the one parameter and users genuinely don't know it. **Window length → Multi-length (scan & suggest)** scans a geometric range of lengths, draws the profile strip as a heatmap (X = position, Y = length, bright = no match), and suggests a length by strongest normalized contrast. Suggests m=107 on the ECG (truth 100) and m=99 on the pump (truth 60) — both within 2×. Capped at 3,000 points and cached, since the scan is O(lengths × n²).
- **▶ Regime change / semantic segmentation** *(B)* — the arc-curve (FLUSS) extension answers "when did behaviour *change*?", which motifs and discords don't.
- **○ Chains** — evolving patterns that drift over time.
- **○ Annotation vector** — bias the profile to ignore known-uninteresting shapes.
- **○ Export found motifs** back into the model as a column.

## 3. Spectrogram — vibration & acoustics

- **✅ Order tracking** *(B)* — bind an **RPM** column and switch **Order Tracking → Y axis** to Orders. For each frame the y-axis is rescaled by `RPM/60` (per-frame mean RPM, computed at render time from the cached FFT), so a component at order *o* sits at row *o* regardless of shaft speed. Verified on the run-up sample: the 1×, 3× and 5.5× bands smear as curved diagonals in Hz mode and collapse to flat lines in Orders mode. Alarm bands are re-read as orders when the mode is on, so a "vibration above 3×" alarm survives a run-up unchanged. Order-marker lines (comma-separated list) overlay each requested order for eyeballing.
- **▶ Harmonic cursors** *(B)* — mark 1×, 2×, 3× of a fundamental. This is literally how analysts diagnose faults.
- **▶ Band-power trending** *(C)* — energy in a frequency band over time, which is the metric alarms are actually built on.
- **○ Peak hold / averaging** — settle a noisy display.
- **○ Waterfall (3D) view** — the alternative conventional presentation.
- **○ Envelope / demodulation** — the standard bearing-fault technique.

## 4. DFG / Process Map — process mining

- **▶ Conformance checking** *(B)* — compare the discovered process against a reference model and highlight deviations. **The #1 commercial process-mining capability**, and this visual is close to it.
- **▶ Rework & loop metrics** *(C)* — rework rate, self-loop counts, rework cost as figures.
- **▶ Variant selection → cross-filter the report** — variant clicking exists but only filters *within* the visual.
- **○ Performance overlay** — bottleneck highlighting by duration (partly available via edge metric).
- **○ Case duration distribution** per variant.
- **○ Activity filtering** — hide activities, not just rare edges.

## 5. Storyline — entity migration

- **▶ Aggregate flow mode** *(A)* — today it's one line per entity, capping it around 50. Customer-segment migration means 10,000 entities. Band thickness = cohort count turns this from "team changes" into customer analytics. **Large applicability jump.**
- **▶ Group-order optimisation** — band order is currently fixed (documented limitation); a move between non-adjacent bands still crosses the ones between.
- **○ Entity bundling** — collapse similar trajectories.
- **○ Event annotations** — mark reorganisations or campaigns on the time axis.

## 6. HOPs — animated uncertainty

- **▶ Accept ensembles as rows** *(A)* — the ensemble currently must arrive as multiple measure *columns*. Almost all Monte Carlo output is rows with a draw id. This single change makes the visual work against data people already have. **Known limitation from build time.**
- **○ Static / animated toggle** — pair with the Fan Chart so one report can show both.
- **○ Frame scrubber** — step through outcomes manually.
- **○ Speed tied to variance** — faster flicker where uncertainty is wider.

## 7. Ternary Plot — composition

- **▶ Classification-region overlays** *(B)* — USDA soil-texture triangle, QAPF for rocks, phase fields. A bare triangle is markedly less useful than one carrying the standard boundaries.
- **○ Density contours** — for hundreds of points.
- **○ Per-group convex hulls / centroids**.
- **○ Tie-lines and mixing paths** — materials science.

## 8. Adjacency Matrix — networks

- **▶ Bipartite mode** *(A)* — rows ≠ columns (people × projects, customers × products). Currently the matrix is a single node set; bipartite is a large class of real problems.
- **○ Node metrics panel** *(C)* — degree, betweenness, clustering coefficient — makes it analysis rather than display.
- **○ Alternative seriation** — spectral ordering, optimal leaf ordering.
- **○ Matrix diff** — period over period.

## 9. Interval Track — timelines

- **▶ Per-track utilisation statistics** *(C)* — uptime %, MTBF, count of state entries. Turns a picture into a metric.
- **○ Rollup when zoomed out** — "% time in state" rather than density bands.
- **○ Conflict / overlap detection** — double-booking, resource contention.
- **○ Now-line and live window** for operational dashboards.

## 10. Event Sequence Bundles — journey analysis

- **▶ Time-scaled columns** *(A)* — steps are currently equal width; real analysis needs actual elapsed time between events.
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
