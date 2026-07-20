# Spectrogram — Sample Data

Two signals. Import a CSV in Power BI Desktop (**Home → Get data → Text/CSV**),
drop the **Spectrogram** visual on the canvas, then bind the fields below.

Field wells:

| Well                    | Kind    | Meaning                                              |
|-------------------------|---------|------------------------------------------------------|
| **Time / Sample Index** | Grouping | Ordered sample position — **Don't summarize**        |
| **Amplitude**           | Measure | Signal amplitude at each sample                      |
| **Sensor**              | Grouping | Optional — one stacked spectrogram per sensor        |

> **Important:** set `SampleIndex` to **Don't summarize** so all samples arrive
> as individual rows. Set **Axis → Sample rate** to match your data (both
> samples here are **1000 Hz**), otherwise axes are labelled in bins and frames.

Both files are sampled at **1000 Hz**, so the Nyquist limit — the highest
frequency the data can represent — is **500 Hz**.

---

## 1 · Machine vibration — a developing fault

**File:** `01-machine-vibration.csv` (8,000 samples = 8 seconds @ 1000 Hz)

- **Time / Sample Index** ← `SampleIndex`  (Don't summarize)
- **Amplitude** ← `Amplitude`
- **Axis → Sample rate** = `1000`

What's in the signal, and what you should see:

| Component | Appearance |
|---|---|
| 120 Hz fundamental | A steady bright horizontal line low in the plot |
| 240 Hz harmonic | A second, fainter horizontal line at twice the height |
| Developing fault | A **rising diagonal streak** from ~200 Hz at t=2s to ~450 Hz at t=8s, brightening as it climbs |
| Broadband noise | Faint background texture |

That rising, brightening diagonal is the whole point: a fault signature that a
line chart of raw amplitude completely hides.

**Suggested format:** Window size 256, overlap 50%, Hann, dB scale, Viridis.
Then turn on **Alarm Bands** with low 380 / high 460 to flag the band the fault
sweeps into.

---

## 2 · Tone and chirp — a clean reference

**File:** `02-tone-and-chirp.csv` (4,000 samples = 4 seconds @ 1000 Hz)

- Same bindings as above.

A steady **150 Hz tone** (flat horizontal line) plus a **linear chirp sweeping
50 → 450 Hz** (a straight diagonal). This is the textbook pair for confirming a
spectrogram is reading correctly — if the line isn't flat and the sweep isn't
straight, something is misconfigured.

---

## Things to try

- **Window size** — the core trade-off. 1024 gives sharp frequency resolution
  but smears events in time; 64 pinpoints *when* but blurs *what*. Watch the
  chirp change character as you step through the sizes.
- **dB vs Linear** — switch Magnitude scale to Linear and most of the detail
  vanishes into black. Real signals have enormous dynamic range; dB is the
  default for a reason.
- **Min magnitude** — raise from −80 toward −40 to cut noise and isolate the
  strong components.
- **Window function** — set to Rectangular to see spectral leakage smear each
  line, then back to Hann or Blackman.
- **Frequency scale → Log** — compresses the high end, useful when the action
  is down at low frequencies.
- Hover anywhere for exact time, frequency and magnitude in dB.
