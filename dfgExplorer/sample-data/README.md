# Process Map & Variant Explorer — Sample Data

Import the CSV in Power BI Desktop (**Home → Get data → Text/CSV**), drop the
**Process Map & Variant Explorer** on the canvas, then bind the fields below.

Field wells:

| Well          | Kind    | Meaning                                              |
|---------------|---------|------------------------------------------------------|
| **Case ID**   | Grouping | The process instance — one run through the process   |
| **Activity**  | Grouping | The step name — becomes a node on the map            |
| **Timestamp** | Grouping | Orders events within a case — **Don't summarize**    |
| **Resource**  | Grouping | Optional — who performed the step                    |
| **Value**     | Measure | Optional — cost/duration to weight edges             |

The input is a plain **event log**: one row per event. All the process
structure — the map, the loops, the variants — is reconstructed by the visual.

---

## Purchase-to-pay — 400 cases, 2,647 events

**File:** `01-purchase-to-pay.csv`

- **Case ID** ← `CaseID`
- **Activity** ← `Activity`
- **Timestamp** ← `Timestamp`  (Don't summarize)
- **Resource** ← `Resource`  *(optional)*
- **Value** ← `Cost`  *(optional)*

The log contains **7 distinct variants**:

| # | Cases | Path |
|---|------:|------|
| 1 | 194 (48.5%) | Create PO → Approve → Send → Receive Goods → Receive Invoice → Pay |
| 2 | 80 (20.0%) | …with a **rework loop**: Approve → **Reject → Revise → Approve** → … |
| 3 | 46 (11.5%) | Invoice arrives **before** the goods |
| 4 | 33 (8.3%) | **Cancelled** after sending to the vendor |
| 5 | 27 (6.8%) | **Expedited** — approval skipped entirely |
| 6 | 15 (3.8%) | **Double rework** — two reject/revise cycles |
| 7 | 5 (1.3%) | Long-tail deviation |

Things the map makes obvious that a table never would:

- A **back-edge** from Approve → Reject → Revise → Approve: that's rework,
  and it touches nearly a quarter of all purchase orders.
- 27 cases reach the vendor **without approval** — a control gap.
- Send → Receive Goods carries by far the longest **mean duration**; switch
  *Edge metric* to **Mean duration** and the bottleneck becomes the thickest
  edge on the map.

---

## Conformance checking — how many cases followed the policy?

Turn on **Conformance → Show conformance** and paste this reference into
**Expected transitions**:

```
Create PO -> Approve -> Send to Vendor -> Receive Goods
Receive Goods -> Receive Invoice -> Pay
```

Each observed transition is now coloured green (in reference) or red
(violation), and every heatmap-style tooltip picks up **Conformance:
Conforming / Violation**. The summary strip at the top-right reports the
whole story in one line:

> **Conformance · 49% of 400 cases fully conform · 38% of 13 distinct
> transitions · 8 violations · 0 missing**

Verified against this file — half the cases fail somewhere. The top eight
violating transitions (from the map):

| Transition | ×  | What it means |
|---|---:|---|
| Approve → Reject | 115 | rework loop entry |
| Reject → Revise | 115 | rework loop body |
| Revise → Approve | 115 | rework loop exit |
| Send to Vendor → Receive Invoice | 46 | invoice before goods |
| Receive Invoice → Receive Goods | 46 | goods after invoice |
| Receive Goods → Pay | 51 | invoicing step skipped |
| Send to Vendor → Cancel | 33 | vendor cancellation |
| Create PO → Send to Vendor | 27 | **approval skipped** — control gap |

The last one is the interesting audit finding: 27 purchase orders reached
the vendor with no approval. Prefer the **Reference source → Top variant
(auto)** shortcut to skip typing the reference — it uses the most frequent
happy path as the reference model, which is a reasonable proxy when no
documented model exists.

Flip **Show missing edges** off if the reference contains transitions the
log never took and the dashed ghost lines get in the way of reading the
map. Reference lines the parser can't read (arrow missing, empty node) are
counted in the summary, so a typo doesn't fail silently.

---

## Rework metrics — how much of the log is doing work twice?

Turn on **Rework Metrics → Show rework summary**. Verified on this file:

> **Rework · 25% of 400 cases have rework · 145 re-visits · 0 self-loops
> · rework cost 14,761 · top: Approve (115)**

100 of 400 cases visited at least one activity more than once. The sum of
re-visits is 145 — the Approve→Reject→Revise→Approve loop hit 115 times
across those cases, and 15 cases went round the loop *twice* (adding 15
extra Reject visits and 15 extra Revise visits to the tally).

**Rework cost** sums the bound Value measure on every re-visit event, so
that's 14,761 in `Cost` charged to steps that only ran because a prior one
failed — a hard number to take to the process owner.

Turn on **Badge repeated activities** (default) and the top-N most-revisited
activities get an ↺ badge on their node, pointing straight at where the
loop lives. Approve carries the badge here even though **Reject** is what
*triggered* the loop — that's deliberate: the badge marks the activity
being re-visited, so the process owner knows which control needs
tightening (an Approve that has to be re-issued after Reject/Revise).

**Self-loops** count separately from rework — a self-loop is A→A (same
activity twice in a row), whereas rework catches longer loops
(A→B→A, A→B→C→A). The P2P sample has zero self-loops because Reject/Revise
sit between the two Approve occurrences.

---

## Things to try

- **Click a variant** in the right panel. The map dims to just that path, so
  you can see exactly where the variant diverges. Click again (or *Clear
  selection*) to restore.
  > The map is **not** re-laid-out on selection — node positions stay put so
  > you keep your bearings and can see where the variant sits in the whole
  > process.
- **Edge metric** — Frequency shows volume; **Mean duration** re-weights the
  same map by time and surfaces bottlenecks instead; Total value weights by cost.
- **Min edge frequency** — the fastest simplifier. Raise it to 20 and the
  long-tail deviations vanish, leaving the trunk of the process.
- **Show self-loops** — off to hide immediate repetitions.
- **Layout direction** — Left-to-right reads like a value stream;
  top-to-bottom suits deep processes.
- Hover a node for occurrence counts and how often it starts or ends a case;
  hover an edge for frequency, mean duration and total value.

> **Ordering caveat:** if many events in a case share an identical timestamp,
> their order is genuinely ambiguous. The visual sorts ties by activity name
> and warns on-screen how many cases are affected, rather than silently
> inventing transitions.
