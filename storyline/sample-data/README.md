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
