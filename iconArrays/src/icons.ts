"use strict";

/**
 * Bundled icon geometry for the Icon Array visual.
 *
 * Every icon is a single SVG `<path>` `d` string drawn inside its own square
 * coordinate box of side `viewSize`. The renderer places an icon by applying a
 * `translate(x,y) scale(cellPx / viewSize)` transform, so the paths themselves
 * never need to know the final pixel size. All paths use `fill-rule: nonzero`
 * and consist of closed subpaths (the person glyph is a head + body pair).
 *
 * No external resources — pure string constants, trivially certifiable.
 */

export interface IconDef {
    /** Path data, authored inside a `viewSize × viewSize` box. */
    path: string;
    /** Side length of the coordinate box the path was authored in. */
    viewSize: number;
}

export type IconShape = "person" | "circle" | "square" | "heart";

export const ICONS: Record<IconShape, IconDef> = {
    // Classic pictograph person: head circle + rounded torso (Material-style, 24×24 box).
    person: {
        path:
            "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z" +
            "M12 14c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
        viewSize: 24
    },
    // Filled circle (radius 44 centred in a 100×100 box), drawn as two arcs.
    circle: {
        path: "M50 6 A44 44 0 1 0 50 94 A44 44 0 1 0 50 6 Z",
        viewSize: 100
    },
    // Rounded-corner square.
    square: {
        path: "M18 8 H82 A10 10 0 0 1 92 18 V82 A10 10 0 0 1 82 92 H18 A10 10 0 0 1 8 82 V18 A10 10 0 0 1 18 8 Z",
        viewSize: 100
    },
    // Symmetric heart: top dip at (50,30), two lobes, point at (50,84).
    heart: {
        path: "M50 30 C50 15 25 8 14 24 C4 39 24 62 50 84 C76 62 96 39 86 24 C75 8 50 15 50 30 Z",
        viewSize: 100
    }
};

/** Resolve an icon definition, defaulting to the person glyph. */
export function getIcon(shape: string): IconDef {
    return ICONS[shape as IconShape] ?? ICONS.person;
}
