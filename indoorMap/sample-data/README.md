# Indoor Map — Sample Data

## Files
- `floorplan.png` — a fake warehouse floor plan (700 × 320 px). Zones: Receiving, Storage (aisles B–C), Packing, Shipping (with loading docks).
- `warehouse-picks.csv` — 20 pick-location rows with X/Y in **image-pixel coordinates**, a Zone category, and a Picks metric.
- `warehouse-with-plan.csv` — same rows plus a `Plan` column carrying the PNG as a `data:image/png;base64,…` URI (in the first row only). Bind this column to **Floor Plan (base64)** so the plan shows up as the underlay.

## Power BI setup

**Field mapping**
- `X` → **X**
- `Y` → **Y**
- `Location` → **Label**
- `Zone` → **Category**
- `Picks` → **Value**
- `Plan` → **Floor Plan (base64)** (from `warehouse-with-plan.csv`)

Set **Image → Image width** to `700` and **Image height** to `320` so the coordinate system matches the plan.

## Toggles worth trying
- **Overlay → Points** — zone-colored dots sized by pick count.
- **Overlay → Heat** — Gaussian splat with the Inferno ramp; hot cells (Shipping row E) glow.
- **Overlay → Both** — points on top of heat.
- **Image → Coordinate origin → Bottom-left** — for CAD exports where Y grows upward.

## Security note
The `Floor Plan` column only accepts `data:image/png`, `data:image/jpeg`, or `data:image/webp`. **SVG URIs are rejected** — they can carry script tags. If you drop an SVG URI, the visual shows an inline warning ("SVG floor plans are not accepted — use PNG or JPEG").
