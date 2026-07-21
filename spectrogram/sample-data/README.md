# Spectrogram — Sample Data

Three signals. Import a CSV in Power BI Desktop (**Home → Get data → Text/CSV**),
drop the **Spectrogram** visual on the canvas, then bind the fields below.

Field wells:

| Well                    | Kind    | Meaning                                              |
|-------------------------|---------|------------------------------------------------------|
| **Time / Sample Index** | Grouping | Ordered sample position — **Don't summarize**        |
| **Amplitude**           | Measure | Signal amplitude at each sample                      |
| **Sensor**              | Grouping | Optional — one stacked spectrogram per sensor        |
| **RPM**                 | Measure | Optional — shaft speed at each sample, enables order tracking |

> **Important:** set `SampleIndex` to **Don't summarize** so all samples arrive
> as individual rows. Set **Axis → Sample rate** to match your data (files 1
> and 2 are **1000 Hz**, file 3 is **2000 Hz**), otherwise axes are labelled in
> bins and frames.

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

## 3 · Machine run-up with RPM — order tracking

**File:** `03-runup-orders.csv` (16,000 samples = 8 seconds @ **2000 Hz**)

- **Time / Sample Index** ← `SampleIndex`  (Don't summarize)
- **Amplitude** ← `Amplitude`
- **RPM** ← `RPM`
- **Axis → Sample rate** = `2000`

A machine spinning up: shaft speed ramps **600 → 3600 RPM** (10 → 60 Hz) over
eight seconds. Three real components are present the entire time:

- **1× shaft** — a plain unbalance
- **3× shaft** — misalignment
- **5.5× shaft** — an outer-race bearing signature

In a plain Hz spectrogram every one of those is a curved diagonal — the 5.5×
band sits at 55 Hz early and 330 Hz late. This is exactly the shape a field
analyst gets paid to identify by eye. Set **Order Tracking → Y axis** to
**Orders (multiples of shaft speed)** and the same three bands snap to flat
horizontal lines at rows 1, 3 and 5.5. Verified on this file:

| Position | Frequency (early)  | Frequency (late)   | Order (stays put) |
|---|---|---|---|
| Unbalance    | 15.6 Hz  | 58.6 Hz  | **1.0×** |
| Misalignment | 46.9 Hz  | 176 Hz   | **3.0×** |
| Bearing      | 82 Hz    | 313 Hz   | **5.5×** |

The **Order markers** input takes a comma-separated list — try `1, 3, 5.5` to
put a dashed line on top of each real component, or `2` to confirm nothing
lives there (2× would appear if there were a coupling misalignment).

Once in orders mode, the **Alarm Band** low/high values are read as orders too:
setting them to 4.5 / 6 catches the bearing band no matter how fast the shaft
turns — the same alarm survives a run-up that would have needed constant
re-tuning in Hz mode.

> Orders mode needs three things at once: the **RPM** well bound, **Axis →
> Sample rate** set, and **Frequency scale → Linear** (a log-order axis is a
> different construct for octaves, not orders). If any of those is missing the
> visual silently keeps the Hz view rather than showing a wrong image.

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
