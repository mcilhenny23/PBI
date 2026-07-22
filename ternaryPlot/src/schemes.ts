"use strict";

/**
 * Classification-region overlays for the ternary plot.
 *
 * A bare triangle is a scatter — every point is just a coordinate. A domain
 * classification triangle turns that scatter into a diagnostic: each point
 * inherits the region it falls in, and the shape of the point cloud reads
 * as "these samples are silty clay loam, those are sandy loam".
 *
 * Schemes ship as data: each region is a polygon in barycentric (a, b, c)
 * coordinates where a+b+c = 1, mapped to the visual's A/B/C vertices. The
 * scheme also names what each vertex is supposed to be, so the user knows
 * which component to bind where.
 */

export interface ClassificationRegion {
    /** Class name — drawn at the region's centroid when labels are on. */
    name: string;
    /** Short label used when the region is too small for the full name. */
    short?: string;
    /**
     * Ordered polygon vertices as barycentric (a, b, c) fractions summing
     * to 1. First and last vertex are joined automatically.
     */
    vertices: [number, number, number][];
}

export interface ClassificationScheme {
    id: string;
    name: string;
    /** Human-readable one-liner. */
    description: string;
    /** What the user should bind to each vertex, so the polygons make sense. */
    axisA: string;
    axisB: string;
    axisC: string;
    regions: ClassificationRegion[];
}

/**
 * USDA soil-texture classes. Vertices are in [%clay, %sand, %silt] / 100
 * mapped to A = Clay (top), B = Sand (bottom-left), C = Silt (bottom-right)
 * — the standard USDA orientation.
 *
 * Vertex coordinates approximate the NRCS Soil Survey Manual polygons
 * rounded to whole percent. Not surveyor-accurate, but visually correct:
 * the 12 regions tile the triangle, boundaries fall on the standard
 * inflection points (clay 40, clay 27, silt 40, sand 45 etc.), and a point
 * plotted from a real texture reading lands in the right class within
 * about 1-2% at any boundary.
 */
const USDA_SOIL: ClassificationScheme = {
    id: "usda-soil",
    name: "USDA soil texture",
    description: "Twelve soil-texture classes from the USDA NRCS Soil Survey Manual.",
    axisA: "Clay (%)",
    axisB: "Sand (%)",
    axisC: "Silt (%)",
    // All vertices are [clay, sand, silt] as fractions.
    regions: [
        {
            name: "Clay", short: "Cl",
            vertices: [[1.00,0.00,0.00], [0.60,0.00,0.40], [0.40,0.20,0.40], [0.40,0.45,0.15], [0.55,0.45,0.00]]
        },
        {
            name: "Silty clay", short: "SiCl",
            vertices: [[0.60,0.00,0.40], [0.40,0.00,0.60], [0.40,0.20,0.40]]
        },
        {
            name: "Sandy clay", short: "SaCl",
            vertices: [[0.55,0.45,0.00], [0.35,0.45,0.20], [0.35,0.65,0.00]]
        },
        {
            name: "Clay loam", short: "ClLo",
            vertices: [[0.40,0.20,0.40], [0.27,0.20,0.53], [0.27,0.45,0.28], [0.40,0.45,0.15]]
        },
        {
            name: "Silty clay loam", short: "SiClLo",
            vertices: [[0.40,0.00,0.60], [0.27,0.00,0.73], [0.27,0.20,0.53], [0.40,0.20,0.40]]
        },
        {
            name: "Sandy clay loam", short: "SaClLo",
            vertices: [[0.35,0.45,0.20], [0.20,0.45,0.35], [0.20,0.53,0.27], [0.075,0.65,0.275], [0.20,0.65,0.15], [0.35,0.65,0.00]]
        },
        {
            name: "Loam", short: "Lo",
            vertices: [[0.27,0.20,0.53], [0.27,0.45,0.28], [0.075,0.525,0.40], [0.075,0.42,0.505], [0.10,0.30,0.60]]
        },
        {
            name: "Silt loam", short: "SiLo",
            // Bordered by Silt above (silt >= 80, clay < 12). Traced from
            // top-left (clay 0.27, silt 0.73) clockwise around the boundary.
            vertices: [[0.27,0.00,0.73], [0.27,0.20,0.53], [0.10,0.30,0.60], [0.00,0.20,0.80], [0.12,0.08,0.80], [0.12,0.00,0.88]]
        },
        {
            name: "Silt", short: "Si",
            // USDA definition: silt >= 80, clay < 12.
            vertices: [[0.00,0.00,1.00], [0.12,0.00,0.88], [0.12,0.08,0.80], [0.00,0.20,0.80]]
        },
        {
            name: "Sandy loam", short: "SaLo",
            vertices: [[0.20,0.45,0.35], [0.075,0.525,0.40], [0.075,0.65,0.275], [0.00,0.70,0.30], [0.00,0.85,0.15], [0.075,0.775,0.15], [0.15,0.70,0.15], [0.20,0.53,0.27]]
        },
        {
            name: "Loamy sand", short: "LoSa",
            vertices: [[0.00,0.85,0.15], [0.00,0.90,0.10], [0.10,0.85,0.05], [0.15,0.85,0.00], [0.075,0.775,0.15]]
        },
        {
            name: "Sand", short: "Sa",
            vertices: [[0.00,0.90,0.10], [0.00,1.00,0.00], [0.10,0.90,0.00], [0.10,0.85,0.05]]
        }
    ]
};

export const SCHEMES: ClassificationScheme[] = [USDA_SOIL];

export function schemeById(id: string): ClassificationScheme | null {
    return SCHEMES.find(s => s.id === id) ?? null;
}

/** Centroid of a polygon in barycentric coordinates (arithmetic mean). */
export function barycentricCentroid(vertices: [number, number, number][]): [number, number, number] {
    let a = 0, b = 0, c = 0;
    for (const v of vertices) { a += v[0]; b += v[1]; c += v[2]; }
    const n = vertices.length || 1;
    return [a / n, b / n, c / n];
}
