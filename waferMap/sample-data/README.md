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

---

## Things to try

- **Edge exclusion** — 1, 2, 3… peels rings off the wafer edge.
- **Zone overlay** — concentric rings for center/mid/edge yield analysis.
- **Notch position** — bottom / top / left / right orientation marker.
- **Die gap & border** — set gap 0 and border 0 for a dense continuous map,
  or gap 1–2 to see individual dies.
- **Wafer shape → Rectangle** — for panel-level or non-circular substrates.
- Hover any die for its coordinates, bin and value.
