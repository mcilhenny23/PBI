# Synoptic Mimic Diagram — Sample Data

Import the CSV in Power BI Desktop (**Home → Get data → Text/CSV**), drop the
**Synoptic Mimic Diagram** on the canvas, then bind the fields below.

Field wells:

| Well             | Kind    | Meaning                                            |
|------------------|---------|----------------------------------------------------|
| **SVG Template** | Grouping | The schematic as SVG text — one row carries it     |
| **Element ID**   | Grouping | Matches an `id` (or `data-tag`) in that template   |
| **Value**        | Measure | Drives fill level / colour / opacity / rotation / text |
| **State**        | Grouping | Optional discrete state, shown in the tooltip      |

---

## How the template is handled — and why it matters

The obvious implementation sanitizes the SVG and injects it into the page.
**This visual never does that.** Instead:

1. **Parse** — `DOMParser` builds an *inert* document. It executes nothing and
   fetches nothing, and the result stays detached from the page.
2. **Extract** — a strict allow-list pulls out geometry into plain TypeScript
   objects. Every element type, attribute name, *and attribute value* must pass
   a validator.
3. **Re-render** — the diagram is drawn from those plain objects, with every
   element created by the visual's own code.

No node from the parsed template is ever adopted into the live DOM. There is no
`innerHTML`, no `insertAdjacentHTML`, and no `href` of any kind survives — so
there is no injection surface, and **no sanitizer dependency** (the reference
design's DOMPurify isn't needed and isn't installed).

What gets refused:

| Refused | Why |
|---|---|
| `<script>`, `<foreignObject>`, `<use>`, `<image>`, `<animate>`, `<style>`, `<filter>`, `<mask>` | executes, embeds, or reaches off-box |
| every `on*` handler | never read, so never copied |
| `href` / `xlink:href` | nothing may point outside the visual |
| `fill="url(…)"` and similar | colours must be literals |
| `d` / `points` containing anything but numbers and path commands | no expressions |
| `transform` other than translate/scale/rotate/matrix/skew with numeric args | no expressions |

Supported shapes: `g`, `rect`, `circle`, `ellipse`, `line`, `polyline`,
`polygon`, `path`, `text`. Caps: 4,000 shapes, 24 nesting levels.

> A *permitted* element with a *rejected* attribute still draws — it just falls
> back to the default fill rather than being thrown away. Turn on
> **Template → Report dropped elements** to see exactly what the allow-list
> refused.

---

## Tank farm — 3 tanks, 2 valves, a pump

**File:** `01-tank-farm.csv` (6 tags; the template is in row 1's `SvgTemplate` cell)

- **SVG Template** ← `SvgTemplate`
- **Element ID** ← `ElementID`
- **Value** ← `Value`
- **State** ← `State`

| Tag | Value | Shows as |
|---|---:|---|
| TANK-01 | 82 | Tank filled 82%, green |
| TANK-02 | 45 | Filled 45% |
| TANK-03 | 18 | Filled 18%, red — running low |
| VALVE-A | 100 | Fully coloured — open |
| VALVE-B | 0 | Empty — closed |
| PUMP-01 | 95 | Above the alarm threshold |

**The template deliberately contains hostile elements** — a `<script>`, an
`<image>` pointing off-box, a `<use>`, a `<foreignObject>`, and a rect with
`fill="url(https://…)"`. They're there so you can watch the allow-list refuse
them: the note under the diagram lists exactly what was dropped.

---

## Things to try

- **Bind value to** — *Fill level* is the tank behaviour. Switch to *Colour*,
  *Opacity*, *Rotation* (for gauges/dials) or *Text* (numeric readouts).
- **Value low / high** — set the range that maps to empty→full.
- **Animate flow** — marches a dashed pattern along any shape whose id starts
  with `pipe`.
- **Blink on alarm** with **Alarm threshold** 90 — PUMP-01 starts blinking.
- **Show element IDs** — debug overlay labelling every bindable shape, for
  working out what to name your measures.

> **Colour ramp note:** the low→high ramp interpolates in RGB, so a red→green
> ramp passes through brown at the midpoint. Pick endpoints that interpolate
> cleanly (amber→green, or grey→blue) if the midpoint matters.
