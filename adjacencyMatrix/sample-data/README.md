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

## 3 · People × projects — bipartite mode

**File:** `03-people-projects.csv` (12 people × 8 projects, hours logged)

- **Matrix → Matrix mode → Bipartite (rows ≠ columns)**
- **Source Node** ← `Person`
- **Target Node** ← `Project`
- **Weight** ← `Hours`

A bipartite matrix has two disjoint node sets — people on the rows, projects
on the columns — so a "Person 42" and a "Project 42" never fuse into a single
node the way they would in unipartite mode. The matrix becomes **rectangular**
(rowN × colN, here 12 × 8), the diagonal has no meaning, and row/column
seriation runs independently on each axis.

Twelve people, two implicit teams of six, each mostly staffed on four
projects. Aggregate hours by block:

|                     | Projects 1-4 | Projects 5-8 |
|---------------------|-------------:|-------------:|
| **People 1-6**      | **1391 h**   | 153 h        |
| **People 7-12**     | 151 h        | **1442 h**   |

On-block hours are **9.3× the off-block hours** — a clear block-diagonal
structure. With **Seriation → Cluster** on, both axes reorder independently
and the two blocks separate cleanly into the top-left and bottom-right
corners of the matrix. The rare cross-team hours read as scattered
low-intensity cells against the sparse background.

This is the whole class of "who works on what", "which customers buy which
products", "which students take which courses" problems that unipartite
adjacency can't represent without inventing pseudo-edges. Rectangular
cells auto-cap when one axis is much larger than the other, so the picture
stays legible on very unbalanced datasets.

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
