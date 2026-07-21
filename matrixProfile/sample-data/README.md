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

### The visual handles this for you

Because of that tension, blindly drawing "top 3 motifs and top 3 discords" means
**half the highlights are noise on any real dataset**. So the default
**Highlight → Auto** only marks findings that genuinely stand apart from the
next-best candidates, scored in robust σ:

| Dataset | Motif salience | Discord salience | Auto shows |
|---|---:|---:|---|
| Pump pressure | **1.43σ** | 0.60σ | motif only |
| ECG | 0.72σ | **88σ** | discord only |

The suppressed side is exactly the meaningless one — the pump's "discord" is
just its noisiest stretch, and the ECG's "motif" is two adjacent normal beats.
A note under the header tells you when a side has been suppressed, so silence
never reads as breakage.

Set **Highlight** to *Motifs only*, *Discords only* or *Both (unfiltered)* to
override, and lower **Salience threshold** (default 1.0) to admit weaker
findings.

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

## Don't know what window length to use? Scan for it

**Window length** is the one parameter that matters, and it is also the one
users most often have no basis for setting. Set **Matrix Profile → Window
length** to **Multi-length (scan & suggest)** and the visual computes a profile
at a whole range of lengths at once, spaced geometrically, and draws the result
as a *pan matrix profile*:

- **X** = position in the series (same axis as the chart above)
- **Y** = window length, shortest at the bottom
- **Colour** = distance to the nearest match, dark for a close match, bright
  yellow-green for none

A feature that only exists at one scale appears as a short stripe; a genuine
anomaly appears as a **column running up through many lengths**. On the ECG file
the suppressed beat is the brightest thing in the strip at **10 of the 12**
lengths scanned — only the two shortest miss it, because a 25-sample window
lands inside a beat rather than spanning one.

The visual then picks the length whose profile has the strongest **contrast** —
the largest robust-σ gap between its most extreme window and its typical one,
measured after dividing every distance by `sqrt(2m)` so lengths are comparable.
That gives **m = 107** on the ECG (true beat period 100) and **m = 99** on the
pump (planted surge 60): both within 2×, which is close enough for the profile
to be read, then tuned by hand.

The findings drawn on the series come from the suggested length, and the note
under the header tells you what was chosen.

| Setting | Meaning |
|---|---|
| **Lengths to scan** | How many lengths to try (default 12). Cost grows linearly. |
| **Shortest / Longest length** | Blank = auto. The upper end is capped so at least ten windows fit — a profile built from a handful of windows says nothing. |

> **Cost:** a scan is O(lengths × n²), so it is capped at the first **3,000**
> points rather than 10,000. Twelve lengths over 2,000 points takes about half a
> second; the result is cached, so restyling never recomputes it.

---

## Things to try

- **Window length** is the only real parameter. Set it to roughly the duration
  of the pattern you care about. On the ECG, try 100 (one beat) versus 50 (half
  a beat) and watch the profile change character — or switch to **Multi-length**
  and see both at once.
- **Exclusion zone** stops a window matching itself shifted by one sample. At
  0% every position trivially matches its neighbour and the profile flatlines
  to zero — a good way to see why the exclusion exists.
- **Motif / discord counts** — raise them to see the second- and third-best
  patterns. In Auto these are usually still suppressed, because they sit at the
  ordinary level; switch Highlight to *Both (unfiltered)* to see them anyway.
- **Salience threshold** — drop it to 0 to reproduce the old always-show-N
  behaviour, or raise it to demand a very clear finding.
- Hover anywhere for the value, the profile distance and where that
  subsequence's nearest match lives.

> **Performance:** the profile is O(n²). Series longer than 10,000 points are
> truncated with an on-screen notice.
