# Order Book Heatmap — Sample Data

Import the CSV in Power BI Desktop (**Home → Get data → Text/CSV**), drop the
**Order Book Heatmap** visual on the canvas, then bind the fields below.

Field wells:

| Well                  | Kind    | Meaning                                            |
|-----------------------|---------|----------------------------------------------------|
| **Time**              | Grouping | One heatmap column per value — **Don't summarize**  |
| **Price Level**       | Grouping | One heatmap row per value — **Don't summarize**     |
| **Size / Liquidity**  | Measure | Resting depth at that price and time                |
| **Trade Volume**      | Measure | Optional — executed prints, drawn as circles        |

> **Sign convention:** negative size = **bid**, positive = **ask**. Unsigned
> data still renders the heatmap; the sign is what unlocks the best bid / best
> ask reference lines. Intensity uses the absolute value either way.

---

## Limit order book — 2 minutes of depth

**File:** `01-order-book.csv` (90 time steps × 61 price levels = 5,490 rows, 34 trades)

- **Time** ← `Time`  (Don't summarize)
- **Price Level** ← `Price`  (Don't summarize)
- **Size / Liquidity** ← `Size`
- **Trade Volume** ← `TradeVolume`

What's in the book, and what you should see:

| Feature | Appearance |
|---|---|
| Depth profile | Liquidity thickens away from the mid — dark near the touch, bright at the edges |
| **The spread** | A thin dark channel running left to right where no orders rest. It wanders as the mid drifts. |
| **Resting walls** | Two bright horizontal bands — a large bid parked at **99.85** and an ask at **100.16**. Big passive orders that sit through the whole session are exactly what this chart is for. |
| Trades | White circles at the touch, area-proportional to executed volume |

**Turn on the reference lines** (*Reference Lines → Show best bid / Show best
ask*): green and red step-lines trace the top of book and the spread between
them becomes explicit.

---

## Things to try

- **Intensity scale** — the default is **Log** for a reason. Switch to Linear
  and the thin levels near the touch disappear into the floor while the walls
  saturate; book depth is heavily tailed and log is what makes it readable.
- **Color ramp** — Blues is the trading-screen convention; Viridis and Inferno
  are perceptually uniform if you're comparing intensities carefully.
- **Cell interpolation** — Nearest keeps honest crisp cells (you can see the
  tick grid); Bilinear smooths it into a continuous density field.
- **Trade radius** — raise Max radius to make prints dominate, or turn the
  overlay off to read the book alone.
- Hover any cell for the exact price, resting size and side.
