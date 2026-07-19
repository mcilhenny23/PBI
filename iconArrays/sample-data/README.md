# Icon Array — Sample Data

Four ready-to-import datasets, each exercising a different mode of the visual.
Import a CSV in Power BI Desktop (**Home → Get data → Text/CSV**), drop the
**Icon Array** visual onto the canvas, then bind the fields as described.

The visual has three field wells:

| Well       | Kind    | Meaning                                                        |
|------------|---------|---------------------------------------------------------------|
| **Value**  | Measure | Count or 0–1 proportion to highlight                          |
| **Total**  | Measure | Denominator (optional; defaults to grid size, or 100)         |
| **Category** | Grouping | Optional — splits the highlight into colored segments        |

Total icons in the grid = **Rows × Columns** (default 10 × 10 = 100).

---

## 1 · Medical risk — single value + total

**File:** `01-medical-risk.csv` (one row: Affected = 17, Cohort = 100)

- **Value** ← `Affected`
- **Total** ← `Cohort`

→ 17 of 100 icons highlighted. Caption reads **"17 of 100 · 17%"**.
This is the classic "17 of 100 people…" frequency-framing pictograph.

**Suggested format:** Array Layout → 10 × 10, Icon shape = *Person*.

---

## 2 · Survey approval — a bare proportion

**File:** `02-survey-proportion.csv` (Proportion = 0.42)

- **Value** ← `Proportion`  (leave Total empty)

→ A value between 0 and 1 with no Total is read as a share of the grid, so
0.42 fills **42 of 100** icons. Caption reads **"42 of 100 · 42%"**.

---

## 3 · Vaccine outcomes — colored segments (aggregated)

**File:** `03-vaccine-outcomes.csv` (3 outcomes summing to 100)

- **Category** ← `Outcome`
- **Value** ← `People`

→ Three colored segments fill the grid in order (82 / 13 / 5), each taking its
color from the report's theme palette. A legend appears beneath the grid.

**Suggested format:** Icon shape = *Person* or *Circle*, 10 × 10 grid.

---

## 4 · Patient cohort — row-level (count measure)

**File:** `04-patients-rowlevel.csv` (100 rows, one patient per row)

The most Power-BI-native shape: let the aggregation do the counting.

- **Category** ← `Outcome`
- **Value** ← `PatientID`  → change its aggregation to **Count** (Value well →
  dropdown → *Count*).

→ Identical result to dataset 3, but driven straight from row-level records —
add a slicer on any other column and the array updates live.

---

## Things to try

- **Fill order** (Array Layout): *Row by row*, *Column by column*, or *Random*.
- **Icon shape**: Person, Circle, Square, Heart.
- **Grid size**: try 20 × 5, or 5 × 5 (25 icons — proportions rescale to fit).
- **Icon size / spacing** and the **Highlight / Base colors** under Appearance.
- Resize the visual very small — icons shrink to fit with no overflow.
