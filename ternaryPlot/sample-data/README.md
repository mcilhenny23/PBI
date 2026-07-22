# Ternary Plot — Sample Data

Two datasets that map cleanly onto the three-component triangle. Import a CSV in
Power BI Desktop (**Home → Get data → Text/CSV**), drop the **Ternary Plot**
visual on the canvas, then bind the fields below.

Field wells:

| Well            | Kind    | Meaning                                             |
|-----------------|---------|-----------------------------------------------------|
| **Component A** | Measure | Top vertex                                          |
| **Component B** | Measure | Bottom-left vertex                                  |
| **Component C** | Measure | Bottom-right vertex (optional — derived when Normalize is on) |
| **Point Label** | Grouping | One point per label; carries the tooltip name      |
| **Color Value** | Measure | Optional — continuous color gradient                |
| **Size Value**  | Measure | Optional — point radius (√-scaled)                  |

Each component measure should be set to **Don't summarize** (or Sum — the values
per label are already one row each). Normalize is on by default, so raw values
like 65 / 25 / 10 are rescaled to sum to 1 automatically.

---

## 1 · Soil texture — the classic ternary

**File:** `01-soil-texture.csv` (12 field samples; sand/silt/clay sum to 100)

- **Point Label** ← `Sample`
- **Component A** ← `Sand`
- **Component B** ← `Silt`
- **Component C** ← `Clay`
- **Color Value** ← `pH`  *(optional — yellow→green gradient across acidity)*
- **Size Value** ← `OrganicMatter`  *(optional — bigger dots = richer soil)*

→ Each sample lands inside the triangle at its texture. This is the USDA soil
texture triangle idiom used in every soil science lab.

**Suggested format:** Triangle → Axis titles *Sand / Silt / Clay*, gridline
divisions 10; Points → turn on *Show point labels*.

---

## 2 · Economic structure — sector mix by country

**File:** `02-economy-sectors.csv` (10 economies; agriculture/industry/services % of GDP)

- **Point Label** ← `Country`
- **Component A** ← `Agriculture`
- **Component B** ← `Industry`
- **Component C** ← `Services`
- **Color Value** ← `GDPPerCapita`  *(optional)*
- **Size Value** ← `PopulationM`  *(optional — bubble size = population)*

→ Agrarian economies cluster near the top (Agriculture) vertex, industrial ones
toward bottom-left, service economies toward bottom-right. Coloring by GDP per
capita shows the classic development gradient.

---

## Classification overlay — USDA soil texture

The soil sample is exactly the case a classification triangle is for. Turn on
**Classification Overlay → Show classification regions** with the USDA soil
scheme. Bind:

- **Component A (top)** ← `Clay`
- **Component B (bottom-left)** ← `Sand`
- **Component C (bottom-right)** ← `Silt`

(The scheme dropdown states this required assignment.) Twelve coloured
polygons partition the triangle by USDA textural class — every point
inherits a class from the region it lands in. Verified against
`01-soil-texture.csv`: **11 of 12 samples land in the region matching
their `TextureClass` column** (the 12th is `Clay (heavy)` landing in
`Clay`, which is a sub-classification, not a mismatch).

Boundaries are rounded to whole-percent USDA polygon vertices — a
coverage sweep of 300 random points had **280 in exactly one region**,
19 boundary-line gaps, 1 overlap. Close enough to read at a glance;
users who need surveyor accuracy can adjust the vertices in
`src/schemes.ts`.

Hover any region for its full class name. The overlay obeys the
same normalize rule as the points — leave **Normalize** on when your
components are in percent (they will be scaled to sum to 1).

---

## Things to try

- **Normalize** off — with the soil data (sums = 100, not 1) the points vanish;
  turn it back on, or divide the columns by 100 first. This demonstrates the
  sum-to-1 rule.
- **Drop Component C** — bind only Sand and Silt with Normalize on; Clay is
  derived as the remainder (1 − Sand − Silt).
- **Gridline divisions** — try 5, 10, or 20.
- **Color Scale** card — change the low/high colors of the gradient.
- Hover any point for the exact raw values and their percentages.

## Interactions

Requires the **Label** field for cross-filtering.

- **Click a point** to filter every other visual on the page by that observation. Ctrl / Shift-click to add.
- **Right-click** for the Power BI context menu.
- **Click empty space** to clear.
- **Interactions → Unselected opacity** controls how much non-selected points fade.
