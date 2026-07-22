# Wafer Map — Sample Data

Two datasets. Import a CSV in Power BI Desktop (**Home → Get data → Text/CSV**),
drop the **Wafer Map** visual on the canvas, then bind the fields below.

Field wells:

| Well             | Kind    | Meaning                                                  |
|------------------|---------|----------------------------------------------------------|
| **Die X**        | Grouping | Die column index — set to **Don't summarize**            |
| **Die Y**        | Grouping | Die row index — set to **Don't summarize**               |
| **Bin / Status** | Grouping | Pass/fail or bin code (Categorical color mode)           |
| **Value**        | Measure | Continuous measure (Continuous color mode)               |
| **Wafer ID**     | Grouping | Optional — renders small multiples, one mini wafer each  |

> **Important:** `DieX` and `DieY` must arrive as *groupings*, not aggregates.
> After dragging them in, open each field's dropdown and choose **Don't
> summarize** so every die comes through as its own row.

Dies whose grid position falls outside the wafer radius are culled
automatically, so a plain rectangular grid renders as a proper circular wafer.

---

## 1 · Single wafer — bin map with defect signatures

**File:** `01-wafer-single.csv` (584 dies on a 28 × 28 grid, 5 bin codes, 75.9% yield)

- **Die X** ← `DieX`  (Don't summarize)
- **Die Y** ← `DieY`  (Don't summarize)
- **Bin / Status** ← `Bin`

→ A circular wafer colored by bin. Three classic failure signatures are baked
into the data and should be visible at a glance:

| Signature | What you'll see |
|---|---|
| **Edge Fail** | A ring of failures around the wafer rim |
| **Scratch** | A diagonal line of failures across the die grid |
| **Gross Fail** | A small cluster at wafer center |
| **Param Fail** | Scattered random singles |

**Continuous mode:** switch *Die Appearance → Color mode* to **Continuous
(value)** and bind **Value** ← `Parametric`. The radial red→yellow→green
gradient shows the parametric roll-off from wafer center to edge — the other
half of real yield analysis.

**Suggested format:** Zone Overlay on with Zone count 3 to see the
center / mid / edge rings; Edge exclusion 1–2 to drop the outermost dies.

---

## 2 · Wafer lot — small multiples

**File:** `02-wafer-lot.csv` (4 wafers × ~584 dies = 2,336 rows)

- **Wafer ID** ← `WaferID`
- **Die X** ← `DieX`, **Die Y** ← `DieY`  (both Don't summarize)
- **Bin / Status** ← `Bin`

→ A 2 × 2 grid of mini wafer maps, each with a different failure signature
(`W-1042` edge ring, `W-1043` center cluster, `W-1044` scratch, `W-1045` a
mid-radius ring). Comparing signatures across a lot is exactly how yield
engineers localize a process problem.

### Stacked (composite) mode — the systematic-vs-random question

Set **Wafer → Multiple wafers** to **Stacked (composite)**.

Instead of four pictures to eyeball, all wafers collapse into **one** map where
each die is coloured by the **share of wafers that failed at that position**.
The logic is simple and it's the core of yield engineering:

- A defect landing in the **same place on many wafers** is **systematic** — a
  process, tooling or reticle problem. It stays bright when stacked.
- A defect that **moves around** is **random**. It averages out and fades.

On this lot the split comes out as:

| Failed on | Dies | Reading |
|---|---:|---|
| 4 of 4 wafers (100%) | 8 | **systematic** — persistent across the lot |
| 3 of 4 (75%) | 18 | strongly recurring |
| 2 of 4 (50%) | 51 | partly recurring |
| 1 of 4 (25%) | 234 | random noise |
| 0 of 4 | 273 | always good |

**Passing bin** is auto-detected as the most common bin (`Pass` here). Override
it in **Wafer → Passing bin name** if your log uses a different convention.

**Composite metric** can instead be **Mean value**, which averages the bound
Value measure per die position across wafers — useful for parametric drift
rather than pass/fail.

Hovering a die reports *how many wafers* contributed and how many failed, so a
100% built from 2 wafers isn't mistaken for one built from 25.

---

## Reticle overlay — is the defect from a bad shot?

**File:** `03-wafer-reticle.csv` (single wafer, 540 dies, deliberate
reticle-aligned defects)

- **Die X / Die Y / Bin / Value** ← as above
- **Reticle Overlay → Show reticle grid** on
- **Dies per reticle (X)** = **4**
- **Dies per reticle (Y)** = **4**
- **Highlight bad reticles** on

The wafer was seeded with two reticle-aligned bad shots:

| Shot | Dies | Fail rate | vs wafer avg |
|---|---:|---:|---:|
| (3, 2) — dies X 12–15, Y 8–11  | 16 | **88%** | 7.75× |
| (5, 5) — dies X 20–23, Y 20–23 | 15 | **60%** | 5.31× |

Wafer average is 11.3%. With the default 1.5× threshold both shots glow
red immediately — a repeating-defect signature that a plain colour map
buries in edge failures and background noise. In semiconductor terms this
is the "is my reticle contaminated?" question, and it's now a two-toggle
answer.

Lower the threshold to **1.0×** to see every shot with even slightly
above-average fail rate (edge-heavy corners will light up too — that's a
different failure mode, not a reticle problem, so a threshold of 1.5× is a
better default). Small shots (2–3 dies at the wafer edge) can trip the
threshold with two failing dies — raise **Dies per reticle** to match your
actual step size before reading too much into corner shots.

**Reticle offset** shifts the whole grid — set it to 1 in either direction
to test alignment; the highlights on (3,2) and (5,5) will move off and the
apparent "bad shots" will scatter, confirming they're aligned to shot
boundaries at offset 0, not to some other periodic feature.

- **Edge exclusion** — 1, 2, 3… peels rings off the wafer edge.
- **Zone overlay** — concentric rings for center/mid/edge yield analysis.
  Turn on **Show per-zone yield** to print the actual yield % (or fail %,
  or die count) inside each ring. Verified on `01-wafer-single.csv` with
  three zones: **center 65.0% · mid 93.9% · edge 73.0%** — the mid ring is
  healthy, the edge is the classic exclusion-ring pattern, and the small
  centre reading (60 dies, 21 fails) points to a genuine centre-of-wafer
  defect that the map's colours make visible but the number lets you
  quote.
- **Notch position** — bottom / top / left / right orientation marker.
- **Die gap & border** — set gap 0 and border 0 for a dense continuous map,
  or gap 1–2 to see individual dies.
- **Wafer shape → Rectangle** — for panel-level or non-circular substrates.
- Hover any die for its coordinates, bin and value.
