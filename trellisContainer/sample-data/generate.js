const fs = require("fs");
const path = require("path");
const OUT = __dirname;
const stores = ["Store 01","Store 02","Store 03","Store 04","Store 05","Store 06","Store 07","Store 08","Store 09","Store 10","Store 11","Store 12"];
const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const rows = ["Store,Month,Revenue"];
for (const s of stores) {
  const base = 40 + Math.random() * 60;
  const seasonal = 20 + Math.random() * 30;
  for (let i = 0; i < months.length; i++) {
    const y = base + Math.sin(i / 12 * Math.PI * 2) * seasonal + (Math.random() - 0.5) * 15;
    rows.push(`${s},${months[i]},${Math.max(10, y).toFixed(1)}`);
  }
}
// Add All Stores Avg benchmark panel
for (let i = 0; i < months.length; i++) {
  let sum = 0;
  for (const s of stores) {
    const base = 60, seasonal = 22;
    sum += base + Math.sin(i / 12 * Math.PI * 2) * seasonal;
  }
  rows.push(`All Stores Avg,${months[i]},${(sum / stores.length).toFixed(1)}`);
}
fs.writeFileSync(path.join(OUT, "store-revenue.csv"), rows.join("\n") + "\n");
console.log("Wrote store-revenue.csv");
