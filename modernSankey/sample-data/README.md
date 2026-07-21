# Modern Sankey — Sample Data

Three ready-to-drop datasets. In Power BI Desktop:
`Get Data → Text/CSV → pick a file → Load`, then drop `Source`, `Target`, `Weight` into the visual's field wells.

## 1. `energy-flow.csv` — the classic multi-level flow

Sources → Electricity → Sectors → End uses. Chained rows make a 4-level Sankey without a level column. This is the canonical Sankey use case and mirrors d3-sankey's reference example.

## 2. `cyclic-workflow.csv` — cycles

Kanban-style workflow with backwards flow (Review → In Progress, Blocked ↔ In Progress, Done → Backlog). The incumbent MS Sankey crashes on this shape. Try each **Cycle Handling** mode:

- **Route back (arc)** — reverse edges sweep below the diagram in red.
- **Duplicate node** — cycling targets are renamed to `X (return)` and shown as a new column.
- **Drop cycle edges** — reverse edges are removed; a valid DAG remains.

## 3. `customer-funnel.csv` — attrition funnel

Visitor → outcome cascade. Every drop-out (Bounced, Dormant, Free Only, Churned) is a real node so the total weight is preserved end-to-end.

## Tips

- Weight ≤ 0 rows are dropped silently.
- **Drag any node** vertically to reorder it within its column. The new order is persisted via `persistProperties` and survives report reload.
- To reset a persisted order, clear **Node order (persisted) → Node order** in the format pane.

## Interactions

- **Click a node** to filter every other visual on the page by every row touching it. Ctrl-click / Shift-click to add to the selection.
- **Click a ribbon** to filter by that specific flow only.
- **Right-click** either for the Power BI context menu (drill-through, include / exclude).
- **Click empty space** to clear the selection.
- Focus a node with `Tab`, press `Enter` or `Space` to select it via the keyboard.
- **Interactions → Click a node to select**: "All connected links" selects both incoming and outgoing rows; "Outgoing only" filters the current node → downstream; "Incoming only" filters upstream → the current node.
- **Interactions → Unselected opacity**: how much non-selected nodes / links fade when any selection is active. The same dimming applies when *another* visual filters this chart.
