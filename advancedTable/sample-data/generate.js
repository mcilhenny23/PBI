const fs = require("fs");
const path = require("path");
const OUT = __dirname;
const products = ["Widget A","Widget B","Widget C","Gadget X","Gadget Y","Gadget Z","Sprocket 100","Sprocket 200","Cog Pro","Cog Lite"];
const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// Long-format CSV: one row per product × month with Revenue.
// Additional wide columns Units, ASP, Margin repeated per row (aggregation done in PBI).
const rows = ["Product,Month,Revenue,Units,ASP,Margin"];
for (const p of products) {
  const baseRev = 8000 + Math.random() * 12000;
  const baseUnits = 300 + Math.random() * 400;
  const asp = 15 + Math.random() * 25;
  const margin = -0.05 + Math.random() * 0.3;
  for (let i = 0; i < months.length; i++) {
    const trend = 1 + (i / 12) * (Math.random() - 0.3) * 0.3;
    const seasonal = 1 + Math.sin(i / 12 * Math.PI * 2 + Math.random()) * 0.15;
    const rev = baseRev * trend * seasonal + (Math.random() - 0.5) * 1500;
    const units = Math.round(baseUnits * trend * seasonal);
    rows.push(`${p},${months[i]},${rev.toFixed(0)},${units},${asp.toFixed(2)},${(margin).toFixed(3)}`);
  }
}
fs.writeFileSync(path.join(OUT, "product-monthly.csv"), rows.join("\n") + "\n");
console.log("Wrote product-monthly.csv");
