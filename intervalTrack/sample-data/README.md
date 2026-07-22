# Interval Track Viewer — Sample Data

Two datasets. Import a CSV in Power BI Desktop (**Home → Get data → Text/CSV**),
drop the **Interval Track Viewer** on the canvas, then bind the fields below.

Field wells:

| Well            | Kind    | Meaning                                                    |
|-----------------|---------|------------------------------------------------------------|
| **Track / Lane**| Grouping | Splits intervals into horizontal tracks                    |
| **Start**       | Grouping | Interval start (date/time or numeric) — **Don't summarize** |
| **End**         | Grouping | Interval end — **Don't summarize**. Blank → point event     |
| **Label**       | Grouping | Optional text drawn inside the bar                          |
| **Category**    | Grouping | Optional color category                                     |
| **Value**       | Measure | Optional numeric                                            |

> **Important:** set `Start` and `End` to **Don't summarize** so each row keeps
> its own timestamps. Power BI will otherwise aggregate them to one row.

**Interaction:** scroll to zoom the time axis, drag to pan. Only intervals
overlapping the visible window are drawn, so zooming stays smooth even on tens
of thousands of rows.

---

## 1 · Machine states — the canonical use case

**File:** `01-machine-states.csv` (5 machines, 234 state intervals + 35 alarms, one week)

- **Track / Lane** ← `Machine`
- **Start** ← `Start`, **End** ← `End`  (both Don't summarize)
- **Category** ← `State`
- **Label** ← `Label`

→ Five tracks, one per machine, colored by state (Running / Idle / Fault /
Maintenance). The 35 alarm rows have a **blank End**, so they render as
**diamond point-event markers** on the same tracks — intervals and instants
coexisting on one timeline is the whole point of the idiom.

**Suggested format:** Lane height 24, bar height 18, labels on. Zoom into a
single shift to watch labels appear as bars get wide enough to hold them.

---

## 2 · Service log — density and virtualization

**File:** `02-service-log.csv` (6,000 events across 8 services, one week)

- **Track / Lane** ← `Service`
- **Start** ← `Start`, **End** ← `End`
- **Category** ← `Kind`

→ Zoomed out, the sub-second events collapse into **density bands** per service
(bars clamp to a 1px minimum, so thousands of them read as intensity). Zoom in
and individual `request` / `slow-query` / `retry` / `timeout` bars separate out.
About 8% of rows are errors with no End — they stay visible as point markers at
every zoom level.

This is the dataset for checking the virtualization claim: pan and zoom feel the
same at 6,000 rows as at 200, because only the visible window is ever drawn.

---

## Lane density — putting numbers on the picture

**Density → Show per-lane density** adds a column on the right of the plot
showing, per track, coverage % (fraction of the visible time span occupied
by intervals), event count and mean duration. **Reactive to zoom** — scoping
the window updates the stats live.

Verified on `01-machine-states.csv` at full zoom:

| Machine | Events | Coverage | Mean duration |
|---|---:|---:|---:|
| Press-01 | 54 | 100% | 218 min |
| Press-02 | 54 | 100% | 209 min |
| Lathe-07 | 57 | 100% | 205 min |
| Mill-03  | 50 | 100% | 239 min |
| Oven-12  | 54 | 100% | 205 min |

All five machines tile the full window (state logs by construction), so the
utility of coverage % shows when you **zoom to a subset** — restrict to
Friday afternoon and coverage will still be 100% but the state mix changes,
and Alarm point-event counts drop into single digits. Union coverage is
computed with a merged-interval sweep so overlapping bars never double-count.

**Density → Show concurrency ribbon** adds a strip along the top plotting
the number of intervals active at each point in time, across all tracks.
On the machine dataset it saturates at 5 (all machines always active), but
on `02-service-log.csv` it spikes visibly during request bursts — a
one-glance read on contention that beats counting bars by eye.

Both features skip point events (Alarm rows with no End) for coverage /
concurrency but still count them in the event count. That matches the
intuition — an alarm is an instant, not a stretch of time — but the alarm
still shows up as one of the day's things that happened.

---

## Things to try

- **Packing** — *Stack* packs overlapping intervals into collision-free lanes
  (a track grows taller as it needs more lanes). *Overlap* forces everything
  onto one row with transparency so pile-ups darken. *Collapse* clips to one row.
- **Zoom** — scroll in on one hour of the week, then drag to pan along it.
  Turn **Enable zoom & pan** off to pin the view for a report page.
- **Track label width** — 0 hides labels and gives the timeline full width.
- Hover any bar for start, end, duration, category and label.
