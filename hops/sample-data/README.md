# Hypothetical Outcome Plots (HOPs) — Sample Data

Import the CSV in Power BI Desktop (**Home → Get data → Text/CSV**), drop the
**Hypothetical Outcome Plots** visual on the canvas, then bind the fields below.

Field wells:

| Well            | Kind    | Meaning                                                       |
|-----------------|---------|--------------------------------------------------------------|
| **Axis**        | Grouping | Time / ordered category (X)                                  |
| **Sample Draws**| Measure | The ensemble — bind **several** measures (one per model run / simulation draw). Each animation frame flickers to a different draw. |
| **Actuals**     | Measure | Optional realized line, drawn solid where present.           |

HOPs shows uncertainty as **motion**: rather than a static band, one plausible
outcome line is drawn at a time and swapped several times per second, so the
spread you'd see in a fan chart is felt as flicker.

---

## Demand ensemble

**File:** `01-demand-ensemble.csv` (12 months; `Actual` for Jan–Jun; `Run01`–`Run10`)

- **Axis** ← `Month`  *(keep the natural month order — sort `Month` by a month-index column if needed)*
- **Sample Draws** ← `Run01`, `Run02`, … `Run10`  *(drag all ten)*
- **Actuals** ← `Actual`  → aggregation **Sum** (one row per month)

→ The dark actuals line covers Jan–Jun; a blue outcome line bobs across the full
year, flickering through the ten model runs a few times per second. The overall
"cloud" the flicker traces is the forecast uncertainty.

**Suggested format:**
- Animation → Frame rate 4 fps, Frame count 50.
- Turn **Show trail** on (Trail length 3) to leave fading ghosts of recent
  frames — this reads well in screenshots and slows the eye down.
- **Pause on hover** is on by default; hover to freeze and read exact draw
  values in the tooltip.

---

## Things to try

- **Frame rate** — 1 fps (slow pulse, easy to track individual outcomes) up to
  15 fps (a shimmering cloud).
- **Show trail** — ghosts the previous N frames; great for static exports.
- **One vs many draws** — bind a single Run to see it fall back to a static
  line; add more to animate. Uncertainty needs an ensemble.
- **Curve interpolation** — Linear vs Smooth (monotone) changes how each
  outcome path is drawn.
