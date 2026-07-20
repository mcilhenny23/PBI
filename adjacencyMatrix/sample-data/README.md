# Adjacency Matrix — Sample Data

Two datasets. Import a CSV in Power BI Desktop (**Home → Get data → Text/CSV**),
drop the **Adjacency Matrix** visual on the canvas, then bind the fields below.

Field wells:

| Well            | Kind    | Meaning                                          |
|-----------------|---------|--------------------------------------------------|
| **Source Node** | Grouping | Edge source — becomes a row/column               |
| **Target Node** | Grouping | Edge target — becomes a row/column               |
| **Weight**      | Measure | Edge intensity (omit → every edge counts as 1)   |

Each row of your table is **one edge**. The visual collects the unique nodes
from Source ∪ Target, builds the N × N matrix client-side, and reorders the rows
and columns so structure becomes visible.

---

## 1 · Team collaboration — community structure

**File:** `01-team-collaboration.csv` (24 people, 58 edges, message counts)

- **Source Node** ← `Source`
- **Target Node** ← `Target`
- **Weight** ← `Messages`

The data has four squads (Platform, Data, Design, Sales) that talk densely
inside the squad and rarely across it — 48 within-squad edges vs 10 across.

**The thing to try:** flip *Matrix → Row / column order* between
**Alphabetical** and **Cluster (hierarchical)**. Same data, completely different
picture:

- **Alphabetical** — dark cells scattered with no pattern.
- **Cluster** — four dark blocks snap onto the diagonal, one per squad, with
  cluster boundary lines drawn between them. That's the community structure the
  clustering found without being told the squads exist.

**Suggested format:** Symmetric on (undirected), cluster boundaries on.

---

## 2 · Process handoffs — directed network

**File:** `02-process-handoffs.csv` (8 process steps, 13 directed handoffs)

- **Source Node** ← `Source`, **Target Node** ← `Target`
- **Weight** ← `Handoffs`

**Turn *Symmetric* off.** The matrix is now asymmetric: cells above the diagonal
are forward flow (Intake → Triage → Review → …) and cells below are rework
loops (Review → Triage, Approve → Review, Support → Triage). Reading the two
triangles separately is how you spot rework in a process.

---

## Things to try

- **Seriation** — Cluster / Degree / Alphabetical / None. Degree puts the
  busiest nodes first; cluster exposes communities.
- **Color scale** — Log or Square root when a few edges dominate; heavy-tailed
  weights are otherwise nearly invisible at the low end.
- **Cell shape** — Square for a dense heatmap, Circle for a sparser look.
- **Show diagonal** — off to suppress self-loops.
- **Labels** — Max label length truncates long node names; labels auto-thin and
  then disappear as cells get small.

> **Performance note:** hierarchical clustering runs for networks up to 400
> nodes. Above that the visual automatically falls back to degree ordering.
