# Event Sequence Bundles — Sample Data

Import the CSV in Power BI Desktop (**Home → Get data → Text/CSV**), drop the
**Event Sequence Bundles** visual on the canvas, then bind the fields below.

Field wells:

| Well                | Kind    | Meaning                                        |
|---------------------|---------|------------------------------------------------|
| **Case ID**         | Grouping | The journey identifier                        |
| **Event**           | Grouping | Event type / name                             |
| **Timestamp**       | Grouping | Orders events in a case — **Don't summarize** |
| **Event Category**  | Grouping | Optional — used when coloring by category     |

Cases that behave alike share a thick trunk; the diagram only splits where
paths genuinely diverge. Unlike a process map, **temporal order is preserved** —
step 3 is always step 3.

---

## Emergency department journeys — 800 patients

**File:** `01-er-journeys.csv` (5,177 events, 11 distinct paths)

- **Case ID** ← `PatientID`
- **Event** ← `Event`
- **Timestamp** ← `Timestamp`  (Don't summarize)
- **Event Category** ← `Category`  *(optional — Clinical vs Administrative)*

Every patient starts `Registration → Triage`, so the first two columns are a
single solid trunk. The fraying starts at step 3:

| Path | Cases |
|---|------:|
| Registration → Triage → Exam → Test → Diagnose → Treat → **Discharge** | 261 (32.6%) |
| …no Test: Exam → Diagnose → Treat → Discharge | 157 (19.6%) |
| …ending in **Admit** rather than Discharge | 93 (11.6%) |
| …with a **repeated Test** before diagnosis | 89 (11.1%) |
| …Diagnose → Discharge with no treatment | 68 (8.5%) |
| **LWBS** — left without being seen, straight after Triage | ~48 |

---

## The feature to try: align on a mid-sequence event

Set **Aggregation → Align on** to **Selected event** and type `Diagnose` into
**Anchor event**.

The diagram now splits at that column: everything that *led up to* diagnosis
grows leftward, everything that *followed* grows rightward, all sharing one
aligned spine. That answers a different question from the default view — not
"what do journeys look like?" but "what happens either side of this moment?"

750 of the 800 patients reach a diagnosis; the 50 LWBS cases have no such event
and the visual reports how many it excluded rather than dropping them silently.

---

## Time-scaled columns — where is the actual wait?

Turn on **Layout → Time-scaled columns**. Each column now sits at the median
elapsed time from the anchor across every case that reached that depth,
instead of one-column-per-step. A slow step reads as *wide*, a fast one as
*narrow*. The bottleneck jumps out.

Verified on this file (aligned on the first event, Registration):

| Depth | Cases | Median elapsed | vs step 1 |
|---:|---:|---:|---:|
| 1 (Triage) | 800 | 15.2 min | 1.0× |
| 2 | 800 | **81.5 min** | **5.4×** |
| 3 | 750 | 1.9 h | 7.4× |
| 4 | 750 | 2.8 h | 11.0× |
| 5 | 679 | 3.5 h | 14.0× |
| 6 | 509 | 4.7 h | 18.5× |
| 7 | 89  | 5.2 h | 20.6× |

Registration → Triage takes ~15 minutes. **Triage → the next step
(Doctor/Assessment) takes another 66 minutes** — that gap is 5.4× wider
than the first step and is what a time-scaled chart plants right in
front of the reader. The equal-width layout hides it entirely.

A **time axis** underneath prints `anchor`, `+15m`, `+82m`, `+1.9h`, … so
the reader can trace back exact durations. Falls back silently to
equal-width when the Timestamp field isn't bound.

---

## Things to try

- **Min bundle support** — the key control. At 5 you see the long tail; raise
  it to 60 and only the major routes survive. Pruned cases are counted in the
  note under the header, never hidden.
- **Max sequence depth** — follow only the first N events of each case.
- **Align on → Last event** — right-aligns everything and reads backwards from
  the outcome, which groups journeys by how they *ended*.
- **Color by → Event category** — collapses to Clinical vs Administrative, so
  you can see how much of a journey is care versus paperwork.
- **Orientation → Vertical** — for tall, narrow report placements.
- Hover any block for its case count, share, the path that reached it, and how
  many cases **end there**.
