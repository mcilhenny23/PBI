# Storyline Chart — Sample Data

Import the CSV in Power BI Desktop (**Home → Get data → Text/CSV**), drop the
**Storyline Chart** on the canvas, then bind the fields below.

Field wells:

| Well          | Kind    | Meaning                                                  |
|---------------|---------|----------------------------------------------------------|
| **Entity**    | Grouping | One line per entity                                      |
| **Time Step** | Grouping | Discrete time points — one column per value              |
| **Group**     | Grouping | Which group the entity belonged to **at that time step** |

The data shape is one row per **entity per time step**, naming the group it was
in then. The visual builds the entity × time × group tensor itself.

---

## Team composition over eight quarters

**File:** `01-team-moves.csv` (16 people, 8 quarters, 117 rows)

- **Entity** ← `Person`
- **Time Step** ← `Quarter`
- **Group** ← `Team`

Four teams — Platform, Data, Design, Growth — and a deliberately legible story:

| Pattern | Who | What you'll see |
|---|---|---|
| **Stayers** | Ana, Cara, Dev, Finn, Gia, Iris, Jon, Lena | Flat lines running the full width inside one band |
| **Switchers** | Ben (→ Data), Elle (→ Design), Hugo (→ Growth), Kai (→ Platform) | Lines that sweep from one band into another and stay |
| **Joiners** | Milo (Q3), Nia (Q1 '24) | Lines that start mid-chart |
| **Leavers** | Omar (after Q1 '24), Pia | Lines that stop before the right edge |
| **Both** | Pia | Moves Growth → Data, then leaves entirely |

Five team switches in total, so the crossings are visible but not a hairball.

---

## Things to try

- **Ordering → Minimize crossings vs Alphabetical.** Watch **Ben** and **Kai**.
  Alphabetically, Ben ends at the *top* of Data and Kai at the *bottom* of
  Platform — both as far as possible from the team they came from. With the
  barycentre sweep, Ben moves to the *bottom* of Data and Kai to the *top* of
  Platform, each hugging the edge nearest its origin, which shortens the
  crossing.

  > **Scope of the heuristic:** the sweep reorders entities *within* each band.
  > Band order itself is held stable (alphabetical, or by size) so the layout
  > doesn't jump around between renders. A move between two non-adjacent bands
  > therefore still traverses the ones in between — reordering the bands
  > themselves is the full StoryFlow optimization and isn't implemented here.
- **Line tension** — 0 gives angular, Sankey-like joins; 100 gives smooth
  weaving. 50 is a good middle.
- **Color by → Group** — a line changes color as it moves, which makes
  destination obvious at the cost of losing per-person identity.
- **Hover any line** to dim the rest and read that person's full path
  (`2023-Q1: Growth → 2023-Q4: Data`) in the tooltip.
- **Entity gap / group gap** — tighten for many entities, loosen for few.

> With 50+ entities the chart gets dense by nature; hover-to-focus is what
> keeps it readable, so leave **Highlight on hover** on.

---

## Aggregate mode — for population-sized data

**Layout → Flow mode → Aggregate (Sankey ribbons)** collapses the entity
lines into one thick band per group at each time step, sized by member
count, with ribbons showing the transitions between them. Same input; the
visual counts instead of tracking each person.

Verified on this sample: 16 entities across eight quarters produce **96
stayed, 5 moved, 2 dropped, 2 joined** transitions across the 7 adjacent
pairs — a **5% churn rate**, which the top-right summary strip reports.
Each ribbon's tooltip surfaces the actual (from-group, to-group, count).

On this dataset the entity mode is the more compelling view because there
are so few movers. Aggregate mode earns its keep once you're past ~50
entities — the point at which the individual-line view is a hairball and
the group-level totals become the readable summary. Tune **Pixels per
entity** (default 4) if your populations are much larger than 16 and the
tallest slice overflows the viewport (the visual auto-compresses, but a
lower unit height keeps the ribbons distinguishable).

**Reading the layout:**

- **Node rectangles** (small verticals at each time step) are the group
  bands. Height ∝ count. Hover for count and share.
- **Ribbons** connect a source band's sub-stripe to a target band's
  sub-stripe. Same-group ribbons (stayed) get a lighter fill so the eye
  can pick out cross-group ones (moved) at a glance.
- **Sub-stripes** within a source band are ordered by their target's
  vertical position at the next time step, and vice versa — that's Sankey
  stacking, which minimises ribbon crossings without a full optimiser.
- **End counts** are printed just outside the first and last time steps,
  so a quarter-to-quarter comparison is one glance away.
