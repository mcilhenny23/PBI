# Waterfall Bridge — Sample Data

Four ready-to-drop datasets. In Power BI Desktop:
`Get Data → Text/CSV → pick a file → Load`, then drop the columns into the Waterfall Bridge visual's field wells.

## 1. `budget-bridge-single.csv` — the classic

**Field mapping**
- `Step` → **Bridge Steps**
- `Value` → **Value** (Sum) — right-click → *Don't summarize* if the aggregator changes it
- `StepType` → **Step Type**

Bridges Actual FY24 (100) → Price/Volume/Mix/FX deltas → Budget FY25 (110). Ties out — no warning chip.

## 2. `budget-bridge-with-subtotal.csv` — with a running-total marker

Same shape as #1 plus a `Subtotal 1` row (StepType = `subtotal`). Toggle **Bridge Structure → Show subtotals** on to reveal the gray running-total bar. The final anchor is 104 vs a pre-anchor cumulative of 104 — no warning.

Try re-typing the last row's value to 108 to trigger the *"Unexplained +4"* chip.

## 3. `multi-measure-bridge.csv` — no Steps column

Six numeric columns, one row. In Power BI drop **all six** into **Value** in order:
`Actual FY24, Price Var, Volume Var, Mix Var, FX, Budget FY25`. Do **not** bind Bridge Steps.

The visual detects "multiple Value measures + no Steps" and treats each measure as one step in field order. First and last are inferred as anchors (defaults). The natural way finance users try it.

## 4. `breakdown-example.csv` — stacked deltas

Each delta step has a Consumer / Enterprise breakdown row.

**Field mapping**
- `Step` → **Bridge Steps**
- `Category` → **Breakdown**
- `Value` → **Value**
- `StepType` → **Step Type**

Each delta bar becomes a mini-stack of colored sub-deltas summing to the step total.
