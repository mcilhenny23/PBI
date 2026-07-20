# Matrix Profile — Sample Data

Two series. Import a CSV in Power BI Desktop (**Home → Get data → Text/CSV**),
drop the **Matrix Profile** visual on the canvas, then bind the fields below.

Field wells:

| Well              | Kind    | Meaning                                          |
|-------------------|---------|--------------------------------------------------|
| **Time / Index**  | Grouping | Ordered position — **Don't summarize**           |
| **Value**         | Measure | The series value                                 |

The visual slides a window of length **m** over the series and, for every
position, records the distance to its nearest match elsewhere. That curve is the
*matrix profile*, drawn in the strip beneath the series:

- **Dips** = this shape happens again → **motifs** (green, joined by arcs)
- **Peaks** = nothing else looks like this → **discords** (red)

---

## Which dataset shows what — and why

The two files demonstrate opposite ends of the technique, because **motifs and
discords want opposite baselines**:

- To see a **motif**, normal behaviour must be *unrepetitive*, so the planted
  repeat is the only thing that matches itself.
- To see a **discord**, normal behaviour must be *repetitive*, so the anomaly is
  the only thing that doesn't match.

Feed a random-walk series to a discord search and it will (correctly) tell you
every stretch is novel — because in a random walk, it is.

---

## 1 · Pump pressure — motif discovery

**File:** `01-pump-pressure.csv` (1,500 readings, aperiodic drift)

- **Time / Index** ← `Reading`  (Don't summarize)
- **Value** ← `Pressure`
- **Matrix Profile → Window length** = `60`

The pressure wanders without repeating, except for two **identical surge
events** at readings **300** and **900**. Nothing else in the series repeats.

→ The top motif comes back as exactly **(300, 900) with distance 0.00** — a
perfect match — joined by a connector arc, with the runner-up pair far behind at
2.25. That's the visual finding a recurring operational event nobody labelled.

---

## 2 · ECG — discord (anomaly) discovery

**File:** `02-ecg-anomaly.csv` (2,000 samples, 20 synthetic heartbeats of 100 samples)

- **Time / Index** ← `Sample`  (Don't summarize)
- **Value** ← `ECG`
- **Matrix Profile → Window length** = `100`  *(one beat)*

Nineteen beats are normal. Beat 13 — starting at sample **1300** — has a
suppressed R spike.

→ The top discord lands at sample **1301** with a profile distance of **5.9**,
against **0.98** for the next highest. That 6× gap is the signature of a single
genuine anomaly, and it was found with no training data, no labels and no
threshold — just the window length.

---

## Things to try

- **Window length** is the only real parameter. Set it to roughly the duration
  of the pattern you care about. On the ECG, try 100 (one beat) versus 50 (half
  a beat) and watch the profile change character.
- **Exclusion zone** stops a window matching itself shifted by one sample. At
  0% every position trivially matches its neighbour and the profile flatlines
  to zero — a good way to see why the exclusion exists.
- **Motif / discord counts** — raise them to see the second- and third-best
  patterns, which are usually much weaker than the first.
- Hover anywhere for the value, the profile distance and where that
  subsequence's nearest match lives.

> **Performance:** the profile is O(n²). Series longer than 10,000 points are
> truncated with an on-screen notice.
