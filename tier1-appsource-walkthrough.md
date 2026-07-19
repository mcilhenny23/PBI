# Tier 1 — Publishing a Power BI Custom Visual to AppSource

A complete walkthrough using the **Fan Chart** visual as a worked example. This covers every step from empty directory to listed AppSource visual, with the specific files, commands, and submission artifacts needed.

---

## Phase 0: Environment & Tooling

### Prerequisites

- **Node.js** — LTS (v18+). The `pbiviz` CLI is a Node tool.
- **npm** — comes with Node.
- **pbiviz CLI** — `npm install -g powerbi-visuals-tools`
- **Power BI Desktop** — for testing the visual with real data before submission.
- **A Microsoft account with a work email** — Partner Center requires this (a personal @gmail won't work). An M365 developer tenant or a cheap Entra ID setup on a domain you own satisfies it.

### Scaffold

```bash
pbiviz new fanChart
cd fanChart
```

This generates the full project structure:

```
fanChart/
├── assets/icon.png          ← 20×20 PNG icon (replace with yours)
├── capabilities.json         ← Data roles, dataViewMappings, objects
├── pbiviz.json               ← Visual metadata (name, GUID, author, version)
├── package.json              ← npm deps (D3 + powerbi-visuals-api pre-included)
├── src/
│   ├── visual.ts             ← The main visual class (constructor + update + getFormattingModel)
│   └── settings.ts           ← Format pane model (cards/slices)
├── style/visual.less         ← CSS
└── tsconfig.json
```

The GUID in `pbiviz.json` is auto-generated and unique. **Never change it** after first submission — it's how AppSource tracks your visual across updates.

---

## Phase 1: The Four Files That Matter

Every custom visual is defined by four files. Everything else is build tooling.

### 1. `capabilities.json` — What data the visual accepts

This is the contract between your visual and Power BI. It defines:

- **dataRoles** — the field wells shown in the visualization pane. Each role has a `name`, `displayName`, `kind` (Grouping or Measure), and optional `description`.
- **dataViewMappings** — how those roles map to a dataView shape (categorical, table, or matrix). For the fan chart, categorical is the right fit: one grouping axis + multiple measures.
- **objects** — format-pane properties (colors, toggles, dropdowns). These wire to the settings model.
- **privileges** — leave empty (`[]`) for a certifiable visual. Adding `WebAccess` here would let you fetch external resources, but that blocks certification.

**Fan chart data roles:**

| Role | Kind | Purpose |
|---|---|---|
| Axis | Grouping | Time / horizon labels (X axis) |
| Central Estimate | Measure | p50 / point forecast |
| Actuals | Measure (optional) | Historical values (solid line) |
| Band Upper/Lower 1 | Measure ×2 | Inner band (e.g. p25/p75) |
| Band Upper/Lower 2 | Measure ×2 | Middle band (e.g. p10/p90) |
| Band Upper/Lower 3 | Measure ×2 | Outer band (e.g. p5/p95) |

The `dataReductionAlgorithm` on the categories role sets `top: { count: 10000 }` — this is the max rows Power BI will send. For a fan chart (typically <365 time points) this is more than enough.

### 2. `src/settings.ts` — Format pane model

Uses the modern `FormattingSettingsService` API (cards and slices). Each card = a collapsible section in the format pane; each slice = one control.

**Fan chart cards:**

- **Fan Appearance** — band color (ColorPicker), central/actuals line colors, show-central toggle, outer-band opacity (NumUpDown, 0–100 mapped to 0.0–1.0), curve interpolation (ItemDropdown: linear/monotone/basis/step).
- **Axes** — show X/Y axis toggles, show gridlines, font size.

The `name` property on each card/slice **must match** the object/property names in `capabilities.json`. This is the binding contract — a mismatch means the format pane reads/writes to nowhere.

### 3. `src/visual.ts` — The visual class

Implements `IVisual` with three methods:

- **`constructor(options)`** — called once. Create the root SVG/Canvas element. Stash `options.host` (for color palette, selection manager, etc.) and `options.host.eventService` (rendering lifecycle).
- **`update(options)`** — called on every data change, resize, or format-pane edit. This is where all rendering happens. The pattern:
  1. Call `this.events.renderingStarted(options)` first.
  2. Read the dataView from `options.dataViews[0]`.
  3. Parse data into your internal model.
  4. Set up D3 scales from viewport dimensions and data extent.
  5. Render (clear old elements, draw new ones).
  6. Call `this.events.renderingFinished(options)` — or `renderingFailed()` in the catch block.
- **`getFormattingModel()`** — returns the formatting model for the properties pane.

**Fan chart rendering approach:**

The fan is just nested `d3.area()` polygons between symmetric quantile pairs, drawn outermost-first (most transparent) so inner bands paint on top. Then a solid line for actuals, a dashed line for the central estimate, and standard D3 axes.

The key decisions:
- **SVG, not Canvas** — for a chart with <10 path elements and <365 data points, SVG is simpler, debuggable, and plays better with Power BI's accessibility/selection infrastructure.
- **`d3.scalePoint`** for the X axis — categories, not continuous time. If you need true time scale, use `d3.scaleTime` and parse the category values as dates.
- **Curve interpolation** — `d3.curveMonotoneX` as default. Monotone preserves the data's shape (no overshooting) while looking smooth. Exposed as a dropdown so users can switch to linear, basis, or step.

### 4. `pbiviz.json` — Metadata

The `author.name` and `author.email` fields are **required** — the build fails without them. Fill in the real values you'll use on AppSource. The `version` must be a 4-digit string (`"1.0.0.0"`).

---

## Phase 2: Build & Test Locally

### Compile

```bash
npx pbiviz package
```

This produces a `.pbiviz` file in `dist/`. It's a zip containing the bundled JS, the icon, and the manifest.

**Common first-build issues:**
- Missing author info → hard error, clear message.
- TypeScript type mismatches → the pbiviz SDK's type definitions are finicky with the FormattingSettings API. Cast to `String()` when dropdown values complain about enum types.
- API version mismatch → if `pbiviz.json` says `"5.3.0"` but `package.json` has `"5.11.0"`, the CLI auto-downgrades with a warning. Either align them or let it auto-resolve.

### Test in Power BI Desktop

1. Open Power BI Desktop.
2. In the Visualizations pane, click the `...` (ellipsis) → "Import a visual from a file."
3. Select the `.pbiviz` from `dist/`.
4. Drag it onto the canvas. Add fields from a dataset.

**What to test before submission:**
- Does it render with all fields filled?
- Does it handle missing optional fields gracefully (no actuals, only one band pair)?
- Does it handle **empty data** (no fields at all) without crashing?
- Does it resize correctly (drag the visual to tiny, to wide, to tall)?
- Do format-pane controls actually work (change colors, toggle axes)?
- Does it handle null/NaN values in the middle of a series?

The empty-data and resize cases are what AppSource reviewers test first. A visual that throws on empty input will be rejected.

### Dev server (optional, for faster iteration)

```bash
npx pbiviz start
```

This starts a local dev server. In Power BI Service, enable Developer Visual in settings, and the "Developer Visual" icon appears in the viz pane, hot-reloading from your local build. Faster than reimporting the .pbiviz every time.

---

## Phase 3: Pre-Submission Checklist

Before touching Partner Center, verify:

- [ ] **Icon** — replace `assets/icon.png` with a 20×20 PNG that represents your visual. This shows in the viz pane.
- [ ] **Screenshots** — you'll need 1–5 screenshots (1366×768 recommended) showing the visual with real data. These go in the AppSource listing.
- [ ] **Sample .pbix** — a Power BI Desktop file with embedded sample data and your visual already configured. Reviewers open this to test. Make the data realistic (a 24-month forecast with actuals and three band pairs, not "Category A / Category B").
- [ ] **Privacy policy URL** — a hosted page. GitHub Pages with a simple privacy.md works.
- [ ] **Support URL** — can point to a GitHub issues page.
- [ ] **Description** — 100–3000 characters for the AppSource listing. Focus on what data shape it accepts and what the user sees, not implementation details.
- [ ] **Version** — `pbiviz.json` version must be 4-digit (`1.0.0.0`). Increment for updates.

---

## Phase 4: Partner Center Enrollment

This is the bureaucratic phase.

### 1. Create a developer account

Go to [Partner Center](https://partner.microsoft.com/dashboard) and open a developer account. You need:

- A work email (your-domain-backed Microsoft account).
- Business verification — Microsoft verifies your identity. For an individual, this may involve ID verification. Timeline: days to ~2 weeks.
- Payment of the one-time registration fee (~$19 USD for individuals).

If you have an existing Microsoft 365 tenant (even a free dev tenant), you can use that org's admin account.

### 2. Enroll in the commercial marketplace program

In Partner Center → Account Settings → Programs → enroll in "Commercial Marketplace." This unlocks the ability to create Power BI visual offers.

### 3. Wait for approval

The enrollment itself needs Microsoft approval. Usually 1–3 business days, sometimes longer.

---

## Phase 5: Create & Submit the Offer

### 1. Create a new Power BI visual offer

Partner Center → Overview → "Create a new" → "Power BI visual."
Enter the visual name ("Fan Chart").

### 2. Upload packages

- Upload the `.pbiviz` file.
- Upload the sample `.pbix` file.

### 3. Fill in properties

- Description, screenshots, icon, categories.
- Support URL, privacy policy URL, license terms URL.
- (Optional) Check "Request Power BI certification" — but for Tier 1, skip this. Publish first, certify later.

### 4. Review & submit

Partner Center has a "Review and publish" step. Click it. Your visual enters the validation queue.

### 5. Validation

The AppSource team:
- Opens the .pbix and tests the visual with data.
- Tests with empty/null data.
- Tests resize behavior.
- Checks that the visual renders in Power BI Service (not just Desktop).
- Checks the description, screenshots, and metadata for policy compliance.

**Expected timeline: 3–10 business days.** Expect at least one rejection on your first submission — usually for a minor issue (screenshot dimensions, metadata, or an edge case they found). Fix it, resubmit, and the re-review is faster.

### 6. Go live

Once approved, you review the visual in a test environment in Partner Center. Click "Go live" to publish it to AppSource. It becomes available to all Power BI users worldwide within hours.

---

## Phase 6: Post-Submission — What the Build Warnings Mean

The `pbiviz package` command emits warnings for recommended (not required) features. Here's what each one means and when to add it:

| Warning | What it means | Priority |
|---|---|---|
| **Allow Interactions** | Let other visuals cross-filter this one | Medium — add for v1.1 |
| **Color Palette** | Use Power BI's theme colors instead of hardcoded | Medium — makes the visual theme-aware |
| **Context Menu** | Right-click menu (drill, export, etc.) | Low for a fan chart |
| **High Contrast** | Accessibility — respect high-contrast mode | High if you pursue certification |
| **Highlight Data** | Cross-highlight support | Medium |
| **Keyboard Navigation** | Tab/arrow key navigation | High for certification |
| **Landing Page** | Show instructions when no data is bound | High — great UX, easy to add |
| **Localizations** | Multi-language support | Low unless targeting international |
| **Selection Across Visuals** | Click a data point → filter other visuals | Medium |
| **Tooltips** | Hover tooltips on data points | High — users expect this |

For Tier 1 (uncertified), none of these block submission. For Tier 2 (certification), high-contrast and keyboard navigation become important.

---

## Appendix: File Inventory

The built fan chart visual in this package:

```
fanChart/
├── capabilities.json     ← 8 data roles (axis + central + actuals + 3 band pairs)
├── pbiviz.json           ← metadata (update author/email before your submission)
├── src/settings.ts       ← 2 format cards: Fan Appearance + Axes
├── src/visual.ts         ← ~200 lines: D3 area bands + lines + axes
├── style/visual.less     ← minimal styling
└── dist/*.pbiviz         ← the compiled package, ready to import into Power BI Desktop
```

The `.pbiviz` file is also provided separately for immediate testing in Power BI Desktop. Import it via Visualizations → `...` → "Import a visual from a file."

---

## Timeline Summary

| Step | Effort | Wall time |
|---|---|---|
| Scaffold + build the visual | Hours to days (depends on complexity) | — |
| Test in Desktop, fix edge cases | 1–2 days | — |
| Partner Center enrollment | 30 min of form-filling | 2–14 days (verification) |
| Prepare submission assets (screenshots, .pbix, privacy policy) | 2–3 hours | — |
| Submit to AppSource | 30 min | — |
| Validation review | — | 3–10 business days |
| Fix rejection + resubmit | 1–2 hours | 2–5 more business days |
| **Total** | **~1–3 days of work** | **~2–5 weeks wall time** |

The wall time is almost entirely waiting for Microsoft. The actual work — for a visual at this complexity level — is a weekend.
