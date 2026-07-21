# Word Cloud Modern — Sample Data

## `customer-feedback.csv` — raw text mode

25 short customer-feedback strings. In Power BI:
- `Response` → **Text / Term** (leave **Weight** unbound)

The visual tokenizes, removes English stop words, builds n-grams per the format-pane setting, and lays them out. Try:
- **Text Processing → N-gram size → Unigrams + Bigrams** (default) — meaningful phrases like "customer service", "product quality", "fast delivery" appear alongside single words.
- **Text Processing → N-gram size → Unigrams** — just single words.
- **Text Processing → Custom stop words**: add words specific to your domain that should disappear.

## `pre-aggregated-terms.csv` — pre-aggregated mode

Terms already counted, with a category. In Power BI:
- `Term` → **Text / Term**
- `Count` → **Weight**
- `Category` → **Category** (color grouping)

In this mode **Click a word** cross-filters the report by that term — the SelectionManager wires up automatically because `Weight` is bound (needs data-model identity per row). Colors follow the `Category` column instead of a rank ramp.

## Toggles worth trying

- **Layout → Weight → size scale = Logarithmic** to compress big outliers.
- **Layout → Rotations = ±45° and ±90°** for a busier, more decorative pack.
- **Layout → Spiral = Rectangular** for a tighter block shape.
