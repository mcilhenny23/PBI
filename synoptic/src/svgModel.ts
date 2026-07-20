"use strict";

/**
 * SVG template ingestion — the security-critical layer.
 *
 * ── Why this file exists ─────────────────────────────────────────
 * The obvious way to render a user-supplied schematic is to sanitize the SVG
 * and drop it into the DOM. That is exactly what Microsoft's certification
 * audit rejects: the visual would still be *injecting third-party markup*, and
 * the reviewer has to trust a sanitizer to be perfect forever.
 *
 * This module takes the other route — **parse, extract, re-render**:
 *
 *   1. **Parse** the template with `DOMParser` into an *inert* document.
 *      `DOMParser.parseFromString` never executes scripts and never fetches
 *      anything; the result is a detached tree we only ever read from.
 *   2. **Extract** a strict allow-list of geometry into plain TypeScript
 *      objects. Every element type, every attribute name, and every attribute
 *      *value* must match a whitelist. Anything unrecognised is dropped and
 *      counted.
 *   3. **Re-render** later from those plain objects, creating every element
 *      ourselves via `createElementNS`.
 *
 * No node from the parsed document is ever adopted into the live DOM. No
 * `innerHTML`, no `insertAdjacentHTML`, no `appendChild` of parsed nodes. The
 * output is a clean tree built from validated numbers and strings, so there is
 * no injection surface to sanitize — and therefore no need for DOMPurify.
 *
 * Specific things the allow-list denies:
 *   - `<script>`, `<foreignObject>`, `<use>`, `<image>`, `<animate>`, `<set>`,
 *     `<style>`, `<filter>`, `<mask>` — anything that executes, embeds, or
 *     references external resources.
 *   - every `on*` handler attribute (never read, so never copied).
 *   - `href` / `xlink:href` in any form, so nothing can point off-box.
 *   - any colour value that isn't a literal — `url(#…)` and friends are
 *     rejected, which is what stops a fill referencing an external resource.
 *   - path/points data containing anything but numbers and path commands.
 */

export type ShapeKind =
    | "group" | "rect" | "circle" | "ellipse"
    | "line" | "polyline" | "polygon" | "path" | "text";

export interface ShapeNode {
    kind: ShapeKind;
    /** Sanitized id / data-tag used to bind data. Null if absent. */
    id: string | null;
    /** Validated numeric geometry (x, cx, r, …). */
    nums: Record<string, number>;
    /** Validated string geometry (`d`, `points`). */
    strs: Record<string, string>;
    fill: string | null;
    stroke: string | null;
    strokeWidth: number | null;
    opacity: number | null;
    transform: string | null;
    text: string | null;
    children: ShapeNode[];
}

export interface SvgModel {
    viewBox: [number, number, number, number];
    shapes: ShapeNode[];
    accepted: number;
    /** Element names that were dropped, with counts — surfaced in the UI. */
    rejected: Map<string, number>;
}

/** Hard ceilings so a hostile or accidental template can't wedge the visual. */
const MAX_SHAPES = 4000;
const MAX_DEPTH = 24;
const MAX_PATH_CHARS = 20000;
const MAX_TEXT_CHARS = 200;

const ALLOWED: Record<string, ShapeKind> = {
    g: "group", rect: "rect", circle: "circle", ellipse: "ellipse",
    line: "line", polyline: "polyline", polygon: "polygon",
    path: "path", text: "text"
};

/** Numeric attributes accepted per element kind. */
const NUM_ATTRS: Record<ShapeKind, string[]> = {
    group: [],
    rect: ["x", "y", "width", "height", "rx", "ry"],
    circle: ["cx", "cy", "r"],
    ellipse: ["cx", "cy", "rx", "ry"],
    line: ["x1", "y1", "x2", "y2"],
    polyline: [], polygon: [], path: [],
    text: ["x", "y", "font-size"]
};

// ── Value validators ───────────────────────────────────────────

function num(v: string | null): number | null {
    if (v == null) return null;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
}

/**
 * Colours must be literals. This is what rejects `url(#x)`, `image-set(…)`,
 * and anything else that could reach for an external resource.
 */
function safeColor(v: string | null): string | null {
    if (v == null) return null;
    const s = String(v).trim().toLowerCase();
    if (s === "none" || s === "transparent") return s;
    if (/^#[0-9a-f]{3}$|^#[0-9a-f]{4}$|^#[0-9a-f]{6}$|^#[0-9a-f]{8}$/.test(s)) return s;
    if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/.test(s)) return s;
    if (/^[a-z]{3,20}$/.test(s)) return s;      // CSS named colours
    return null;
}

/** Path data: path command letters, digits, signs, separators. Nothing else. */
function safePathData(v: string | null): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s || s.length > MAX_PATH_CHARS) return null;
    return /^[\sMmLlHhVvCcSsQqTtAaZz0-9.,+\-eE]+$/.test(s) ? s : null;
}

/** Polygon/polyline points: numbers and separators only. */
function safePoints(v: string | null): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s || s.length > MAX_PATH_CHARS) return null;
    return /^[\s0-9.,+\-eE]+$/.test(s) ? s : null;
}

/** Only the affine transform functions, with numeric arguments. */
function safeTransform(v: string | null): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s || s.length > 400) return null;
    return /^(\s*(translate|scale|rotate|matrix|skewX|skewY)\s*\(\s*[-0-9.,\seE]+\)\s*)+$/.test(s)
        ? s : null;
}

/** Ids become selectors and data keys, so keep them boring. */
function safeId(v: string | null): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s || s.length > 128) return null;
    return /^[A-Za-z0-9_\-.: ]+$/.test(s) ? s : null;
}

function clamp01(n: number | null): number | null {
    if (n == null) return null;
    return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ── Extraction ─────────────────────────────────────────────────

/**
 * Read one element into a plain object, or return null to drop it.
 * Note every value passes a validator — nothing is copied verbatim.
 */
function extractElement(elImpl: Element, depth: number, model: SvgModel): ShapeNode | null {
    const tag = elImpl.tagName.toLowerCase();
    const kind = ALLOWED[tag];
    if (!kind) {
        model.rejected.set(tag, (model.rejected.get(tag) || 0) + 1);
        return null;
    }
    if (model.accepted >= MAX_SHAPES || depth > MAX_DEPTH) return null;

    const node: ShapeNode = {
        kind,
        // `data-tag` is offered as an alternative binding key to `id`.
        id: safeId(elImpl.getAttribute("id")) ?? safeId(elImpl.getAttribute("data-tag")),
        nums: {}, strs: {},
        fill: safeColor(elImpl.getAttribute("fill")),
        stroke: safeColor(elImpl.getAttribute("stroke")),
        strokeWidth: num(elImpl.getAttribute("stroke-width")),
        opacity: clamp01(num(elImpl.getAttribute("opacity"))),
        transform: safeTransform(elImpl.getAttribute("transform")),
        text: null,
        children: []
    };

    for (const a of NUM_ATTRS[kind]) {
        const n = num(elImpl.getAttribute(a));
        if (n != null) node.nums[a] = n;
    }
    if (kind === "path") {
        const d = safePathData(elImpl.getAttribute("d"));
        if (!d) return null;                       // a path with no usable data is noise
        node.strs["d"] = d;
    }
    if (kind === "polyline" || kind === "polygon") {
        const p = safePoints(elImpl.getAttribute("points"));
        if (!p) return null;
        node.strs["points"] = p;
    }
    if (kind === "text") {
        // textContent only — never innerHTML. Child markup is discarded.
        const t = (elImpl.textContent || "").replace(/\s+/g, " ").trim();
        node.text = t.slice(0, MAX_TEXT_CHARS);
        const anchor = (elImpl.getAttribute("text-anchor") || "").toLowerCase();
        if (anchor === "middle" || anchor === "end" || anchor === "start") {
            node.strs["text-anchor"] = anchor;
        }
    }

    model.accepted++;

    if (kind === "group" || kind === "text") {
        for (let i = 0; i < elImpl.children.length; i++) {
            const child = extractElement(elImpl.children[i], depth + 1, model);
            if (child) node.children.push(child);
        }
    }
    return node;
}

/**
 * Parse a template into the internal model.
 * Returns null when the string isn't parseable SVG at all.
 */
export function parseSvgTemplate(source: string): SvgModel | null {
    if (!source || typeof source !== "string") return null;
    const text = source.trim();
    if (!text) return null;

    let doc: Document;
    try {
        // Inert parse: no script execution, no network, detached from our DOM.
        doc = new DOMParser().parseFromString(text, "image/svg+xml");
    } catch {
        return null;
    }
    if (!doc || doc.getElementsByTagName("parsererror").length > 0) return null;

    const root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== "svg") return null;

    const model: SvgModel = {
        viewBox: [0, 0, 100, 100],
        shapes: [],
        accepted: 0,
        rejected: new Map<string, number>()
    };

    // Prefer viewBox; fall back to width/height; otherwise a unit box.
    const vb = root.getAttribute("viewBox");
    if (vb && /^[\s0-9.,+\-eE]+$/.test(vb)) {
        const p = vb.trim().split(/[\s,]+/).map(Number);
        if (p.length === 4 && p.every(Number.isFinite) && p[2] > 0 && p[3] > 0) {
            model.viewBox = [p[0], p[1], p[2], p[3]];
        }
    } else {
        const w = num(root.getAttribute("width")), h = num(root.getAttribute("height"));
        if (w && h && w > 0 && h > 0) model.viewBox = [0, 0, w, h];
    }

    for (let i = 0; i < root.children.length; i++) {
        const node = extractElement(root.children[i], 0, model);
        if (node) model.shapes.push(node);
    }
    return model;
}

/** Walk every node in the model (used for data binding and bbox work). */
export function walkShapes(shapes: ShapeNode[], fn: (n: ShapeNode) => void): void {
    for (const s of shapes) {
        fn(s);
        if (s.children.length) walkShapes(s.children, fn);
    }
}

/**
 * Axis-aligned bounds in template coordinates.
 * Used for fill-level clipping and rotation centres. Paths and polygons are
 * approximated from their coordinate pairs, which is accurate enough for
 * positioning a clip rectangle.
 */
export function shapeBounds(n: ShapeNode): { x: number; y: number; w: number; h: number } | null {
    switch (n.kind) {
        case "rect": {
            const { x = 0, y = 0, width, height } = n.nums;
            return width > 0 && height > 0 ? { x, y, w: width, h: height } : null;
        }
        case "circle": {
            const { cx = 0, cy = 0, r } = n.nums;
            return r > 0 ? { x: cx - r, y: cy - r, w: r * 2, h: r * 2 } : null;
        }
        case "ellipse": {
            const { cx = 0, cy = 0, rx, ry } = n.nums;
            return rx > 0 && ry > 0 ? { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 } : null;
        }
        case "line": {
            const { x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = n.nums;
            return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) || 1, h: Math.abs(y2 - y1) || 1 };
        }
        case "polyline": case "polygon": case "path": {
            const src = n.strs["points"] || n.strs["d"] || "";
            const nums = src.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
            if (!nums || nums.length < 4) return null;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i + 1 < nums.length; i += 2) {
                const x = Number(nums[i]), y = Number(nums[i + 1]);
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
            if (!Number.isFinite(minX) || maxX <= minX) return null;
            return { x: minX, y: minY, w: maxX - minX, h: Math.max(1, maxY - minY) };
        }
        case "text": {
            const { x = 0, y = 0 } = n.nums;
            return { x: x - 20, y: y - 12, w: 40, h: 16 };
        }
        default:
            return null;
    }
}
