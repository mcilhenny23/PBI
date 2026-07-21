# Chord Modern — Sample Data

## `region-migration.csv`

Bidirectional flows between six regions.

**Field mapping**
- `Source` → **Source**
- `Target` → **Target**
- `Weight` → **Weight**

## Toggles worth trying

- **Chord → Directed = true**: ribbons become arrowed, source arc thick / target arc tapered. Shows imbalanced flows (e.g. Europe → Asia vs Asia → Europe).
- **Chord → Hover behavior = Isolate**: hovering a region hides every ribbon not touching it — great for focus.
- **Gradients → Gradient-fill ribbons = true** (default): each ribbon fades from source color to target color.
- **Arcs → Label mode = Horizontal**: force all labels upright — easier reading with < 12 groups.
