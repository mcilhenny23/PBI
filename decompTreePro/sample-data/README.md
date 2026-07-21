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
