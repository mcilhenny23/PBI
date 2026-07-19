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

## Things to try

- **Normalize** off — with the soil data (sums = 100, not 1) the points vanish;
  turn it back on, or divide the columns by 100 first. This demonstrates the
  sum-to-1 rule.
- **Drop Component C** — bind only Sand and Silt with Normalize on; Clay is
  derived as the remainder (1 − Sand − Silt).
- **Gridline divisions** — try 5, 10, or 20.
- **Color Scale** card — change the low/high colors of the gradient.
- Hover any point for the exact raw values and their percentages.
