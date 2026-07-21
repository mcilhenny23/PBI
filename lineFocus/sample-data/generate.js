const fs = require("fs");
const path = require("path");
const OUT = __dirname;

// 40-country GDP-like fake growth series over 12 quarters
const countries = [
  "USA","China","Japan","Germany","India","UK","France","Italy","Brazil","Canada",
  "Russia","South Korea","Australia","Spain","Mexico","Indonesia","Netherlands","Saudi Arabia","Turkey","Switzerland",
  "Taiwan","Poland","Sweden","Belgium","Argentina","Norway","Ireland","Israel","Thailand","Nigeria",
  "Austria","Malaysia","Denmark","Philippines","Vietnam","Bangladesh","Colombia","South Africa","Chile","Finland"
];
const quarters = [];
for (let y = 2024; y <= 2026; y++) {
  for (let q = 1; q <= 4; q++) quarters.push(`${y} Q${q}`);
}

// Build a tall (long) CSV: Quarter,Country,Value  (natural PBI shape)
const rows = ["Quarter,Country,Value"];
for (const c of countries) {
  let v = 100 + Math.random() * 50;
  const trend = (Math.random() - 0.5) * 4;
  const vol = 2 + Math.random() * 6;
  for (const q of quarters) {
    v = Math.max(20, v + trend + (Math.random() - 0.5) * vol);
    rows.push(`${q},${c},${v.toFixed(2)}`);
  }
}
fs.writeFileSync(path.join(OUT, "gdp-40-series.csv"), rows.join("\n") + "\n");
console.log("Wrote gdp-40-series.csv");
