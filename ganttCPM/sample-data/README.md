# Gantt CPM — Sample Data

Two ready-to-drop datasets. In Power BI Desktop:
`Get Data → Text/CSV → pick a file → Load`. Right-click each **date** column → **Change Type → Date** (Power BI sometimes imports as Text).

## 1. `project-plan.csv` — the full picture

**Field mapping**
- `Task` → **Task**
- `Parent` → **Parent Task** (builds the WBS hierarchy)
- `Start` → **Start Date**
- `End` → **End Date**
- `Progress` → **% Complete** (Sum aggregator, or Don't summarize)
- `Predecessors` → **Predecessors**
- `Milestone` → **Is Milestone**
- `Category` → **Category** (workstream color)

Demonstrates every feature:
- Nested WBS (Discovery / Design / Build / QA phases with children) — click a chevron to collapse
- FS / FF / SS predecessor types with lags (`Backend:FF+2`, `Regression:SS+5`)
- Milestones (Kickoff, Launch) rendered as diamonds
- Category color grouping
- Progress fill on the bars

Turn on **Critical Path → Highlight critical path** and the chain that determines the launch date turns red.

## 2. `simple-fs-chain.csv` — minimal starter

Five tasks, one SS+2 dependency. Bind `Task`, `Start`, `End`, `Progress`, `Predecessors` — proves the CPM out without any hierarchy.

## Predecessor syntax

Comma-separated task names. Each may carry `:TYPE` and `±N` lag in days:
- `A` — FS (default), zero lag
- `A:SS+3` — start-to-start with 3-day lag
- `A:FF-1` — finish-to-finish, 1-day lead
- `A, B:SS, C:FF+2` — three deps in one cell

Unresolvable references are silently ignored (a future warning chip will list them).

## Interactions

- **Click** any task row to filter every other visual on the page by that task. Ctrl-click / Shift-click to add to the selection.
- **Click empty space** to clear.
- **Right-click** for the Power BI context menu (drill through, include / exclude).
- **Tab** to focus a row, **Enter** or **Space** to select it via keyboard.
- **Interactions → Unselected opacity**: when any selection is active, non-selected rows (bars, milestones, progress fills, summary brackets) fade to this value. The same dimming applies when *another* visual filters this chart.
