// Emit a warehouse-style floor plan PNG + a CSV whose Plan column carries the base64 data URI.
// Run: node generate-floorplan.js
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const OUT = __dirname;

const W = 700, H = 320;
const svgParts = [];
svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
svgParts.push(`<rect width="${W}" height="${H}" fill="#f8f8f8" stroke="#333" stroke-width="2"/>`);

// Zones
function zone(x, y, w, h, fill, label) {
  svgParts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" fill-opacity="0.15" stroke="#666" stroke-dasharray="4 3"/>`);
  svgParts.push(`<text x="${x + 8}" y="${y + 18}" font-family="Arial" font-size="12" fill="#555" font-weight="600">${label}</text>`);
}
zone(30, 30, 120, 260, "#1f77b4", "RECEIVING");
zone(160, 30, 220, 260, "#2ca02c", "STORAGE (aisles B–C)");
zone(390, 30, 60, 260, "#ff7f0e", "PACKING");
zone(460, 30, 210, 260, "#d62728", "SHIPPING");

// Rack shelves (visual detail)
for (let x = 170; x <= 340; x += 20) {
  svgParts.push(`<line x1="${x}" x2="${x}" y1="50" y2="270" stroke="#bbb" stroke-width="1"/>`);
}
// Loading docks on shipping side
for (let y = 60; y <= 240; y += 60) {
  svgParts.push(`<rect x="660" y="${y - 8}" width="30" height="16" fill="#eee" stroke="#666"/>`);
  svgParts.push(`<text x="675" y="${y + 4}" font-family="Arial" font-size="10" text-anchor="middle" fill="#666">DOCK</text>`);
}
// Aisles
svgParts.push(`<text x="220" y="300" font-family="Arial" font-size="10" fill="#888">Aisle B</text>`);
svgParts.push(`<text x="300" y="300" font-family="Arial" font-size="10" fill="#888">Aisle C</text>`);

svgParts.push(`</svg>`);
const svgStr = svgParts.join("");
const svgPath = path.join(OUT, "floorplan.svg");
fs.writeFileSync(svgPath, svgStr);

// Convert SVG → PNG via headless Chrome (already used elsewhere in the project).
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const htmlPath = path.join(OUT, "_render.html");
fs.writeFileSync(htmlPath, `<!doctype html><html><body style="margin:0;background:transparent">${svgStr}</body></html>`);
const pngPath = path.join(OUT, "floorplan.png");
const userData = path.join(OUT, "_chrome-tmp");
try {
  execSync(`"${CHROME}" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="${userData}" --force-device-scale-factor=1 --window-size=${W},${H} --screenshot="${pngPath}" "file:///${htmlPath.replace(/\\/g, '/')}"`);
} catch (e) { /* the second run typically completes even after complaining about the profile lock */ }

// Read the PNG and emit a small CSV that carries it as base64 in the Plan column.
const b64 = fs.readFileSync(pngPath).toString("base64");
const dataUri = `data:image/png;base64,${b64}`;

// Compose the CSV: one row per pick location, plus a `Plan` column that repeats the URI (Power BI needs a value per row).
const src = fs.readFileSync(path.join(OUT, "warehouse-picks.csv"), "utf8").split(/\r?\n/).filter(Boolean);
const header = src[0].split(",");
const out = [];
out.push(header.concat(["Plan"]).join(","));
for (let i = 1; i < src.length; i++) {
  // Only the first row needs the URI; Power BI will show it in the visual regardless of others.
  const val = i === 1 ? dataUri : "";
  out.push(src[i] + "," + JSON.stringify(val));
}
fs.writeFileSync(path.join(OUT, "warehouse-with-plan.csv"), out.join("\n") + "\n");

// Cleanup the temp html/user-data.
try { fs.unlinkSync(htmlPath); } catch {}
try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}

console.log(`Wrote floorplan.png (${(b64.length / 1024).toFixed(1)}kB base64) and warehouse-with-plan.csv`);
