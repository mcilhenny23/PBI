// Generate sample scatter datasets. Run with: node generate-samples.js
const fs = require("fs");
const path = require("path");
const OUT = __dirname;

function box(mu, sigma) {
  const u = Math.random(), v = Math.random();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 1. 50k Gaussian blob + outliers
{
  const rows = ["Id,X,Y,Group,Weight"];
  for (let i = 0; i < 50_000; i++) {
    const cx = box(0, 1), cy = box(0, 1);
    rows.push(`${i},${cx.toFixed(4)},${cy.toFixed(4)},Main,${Math.abs(cx * cy).toFixed(3)}`);
  }
  for (let i = 50_000; i < 50_200; i++) {
    rows.push(`${i},${(box(5, 0.5)).toFixed(4)},${(box(4, 0.5)).toFixed(4)},Outlier,${(Math.random() * 2).toFixed(3)}`);
  }
  fs.writeFileSync(path.join(OUT, "gaussian-50k.csv"), rows.join("\n") + "\n");
}

// 2. Two-cluster classification
{
  const rows = ["Id,X,Y,Class"];
  for (let i = 0; i < 15_000; i++) rows.push(`${i},${box(-1, 0.7).toFixed(4)},${box(-1, 0.7).toFixed(4)},A`);
  for (let i = 15_000; i < 30_000; i++) rows.push(`${i},${box(1, 0.7).toFixed(4)},${box(1, 0.7).toFixed(4)},B`);
  fs.writeFileSync(path.join(OUT, "two-clusters-30k.csv"), rows.join("\n") + "\n");
}

// 3. Small 1k for pure Points mode
{
  const rows = ["Id,X,Y,Group"];
  for (let i = 0; i < 1000; i++) {
    const g = i < 500 ? "A" : "B";
    const mu = g === "A" ? -0.6 : 0.6;
    rows.push(`${i},${box(mu, 0.4).toFixed(4)},${box(0, 0.5).toFixed(4)},${g}`);
  }
  fs.writeFileSync(path.join(OUT, "small-1k.csv"), rows.join("\n") + "\n");
}

console.log("Wrote sample CSVs to", OUT);
