# Quantile Dotplot — Sample Data

Two datasets. Import a CSV in Power BI Desktop (**Home → Get data → Text/CSV**),
drop the **Quantile Dotplot** visual on the canvas, then bind the fields below.

Field wells:

| Well               | Kind    | Meaning                                                       |
|--------------------|---------|--------------------------------------------------------------|
| **Sample Values**  | Measure | The value to build the distribution from. Bind **one** measure for a single dotplot, or **several** for side-by-side dotplots (one per measure). |
| **Observation Key**| Grouping | One row per observation — pools the rows into a distribution. |

How it reads the data: the visual collects one value per Observation-Key row,
computes `Dot count` quantiles from that pool, and packs them into a
count-the-dots pile. With 20 dots, each dot represents 5% of outcomes.

---

## 1 · Commute time — the classic "when should I leave?" dotplot

**File:** `01-commute-times.csv` (200 simulated commute times, minutes)

- **Observation Key** ← `RunID`
- **Sample Values** ← `CommuteMinutes`  → set aggregation to **Sum** or
  **Average** (one row per RunID, so it's just the value)

→ 20 dots showing the spread of likely commute times. Turn on **Threshold**
(Threshold card) and set it to `30`: dots below the line stay blue, dots at/above
turn red, and the annotation reads e.g. *"16 of 20 below 30"* — i.e. an 80%
chance of arriving within 30 minutes. This is the Kay et al. transit-arrival
idiom that beats error bars for real decisions.

**Suggested format:** Dot count 20, Dot radius 7, Threshold on at 30.

---

## 2 · Route comparison — side-by-side distributions

**File:** `02-route-comparison.csv` (200 runs; two routes)

- **Observation Key** ← `RunID`
- **Sample Values** ← `RouteA_Express` **and** `RouteB_Local` (drag both)

→ Two dotplots share one value axis (stacked in Horizontal orientation,
side-by-side in Vertical). The Express route is tight and reliable; the Local
route has a long tail of bad days. Each dotplot is colored from the report theme.

**Suggested format:** try **Orientation → Vertical** to stand the two
distributions next to each other like columns.

---

## Things to try

- **Dot count** — 20 (each dot = 5%), 50 (2%), or 100 (1%).
- **Threshold** — move the line and watch the "X of Y below" count update; the
  below-threshold dots recolor so you can literally count the risk.
- **Orientation** — Horizontal (dots stack up over a bottom axis) vs Vertical
  (dots stack rightward over a left axis).
- **Fewer rows than Dot count** — the visual falls back to one dot per row.

## Interactions

- **Click any dotplot group** to filter every other visual on the page by every observation in that group.
- **Ctrl / Shift-click** to add another group to the selection.
- **Right-click** for the Power BI context menu.
- **Click empty space** to clear.
- **Interactions → Unselected opacity** controls how much non-selected groups fade.
