# Decomp Tree Pro — Sample Data

## `sales-breakdown.csv`

Region × Product × Segment with a Sales measure and a Margin measure (some negative).

**Field mapping**
- `Sales` → **Analyze**
- `Margin` → **Secondary Measure**
- `Region`, `Product`, `Segment` → **Explain By** (in that order)

## Try these

- **Nodes → Bar color mode → Conditional vs threshold**, Threshold = 100. Nodes with Sales ≥ 100 turn green, below turn red.
- **Nodes → Secondary source → % of parent**: bars show the share each child takes from its parent.
- **Nodes → Secondary source → Bound Secondary measure**: shows the Margin value (green/red conditional highlights below-target margins).
- **Sorting → Custom per level** with `Region: North, South, East, West; Product: Widgets, Gadgets`.
- **Expansion → Default expansion path** = `Region:West>Product:Gadgets`. Reload the report — the tree opens straight to West/Gadgets.

## Click behavior

Click any node to expand — the tree walks down using whichever level you're currently at (Region → Product → Segment in order). Clicking a node at a shallower level truncates the deeper path.

## Interactions

Clicking a node does **two** things:
1. Expands the tree along that path (existing behavior).
2. Cross-filters every other visual on the page to that node's slice (Region:West, or Region:West × Product:Gadgets, or the full leaf path).

Additional:
- **Ctrl / Shift-click** to add to the selection instead of replacing.
- **Right-click** for the Power BI context menu (drill through, include / exclude).
- **Click empty space** to clear the selection (the expansion path stays).
- Non-selected sibling nodes fade to **Interactions → Unselected opacity**. The same dimming applies when *another* visual filters this tree.
