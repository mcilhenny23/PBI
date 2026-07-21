const fs = require("fs");
const path = require("path");
const OUT = __dirname;
function box(mu, sig) { const u = Math.random(), v = Math.random(); return mu + sig * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
// 10k normal + a bimodal group example.
const rows1 = ["Id,Value"];
for (let i = 0; i < 10000; i++) rows1.push(`${i},${box(50, 10).toFixed(3)}`);
fs.writeFileSync(path.join(OUT, "normal-10k.csv"), rows1.join("\n") + "\n");

const rows2 = ["Id,Group,Value"];
for (let i = 0; i < 5000; i++) rows2.push(`${i},A,${box(35, 8).toFixed(3)}`);
for (let i = 5000; i < 10000; i++) rows2.push(`${i},B,${box(55, 6).toFixed(3)}`);
fs.writeFileSync(path.join(OUT, "two-groups-10k.csv"), rows2.join("\n") + "\n");
console.log("Wrote 2 histograms CSVs.");
