import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "spec/productization-requirements.md",
  "spec/productization-roadmap.md",
  "spec/productization-state/implementation-state.json",
  "docs/ux/user-journey-simulation.md",
  "docs/ux/sharenet-inspired-design.md",
  "docs/deployment/free-tier-plan.md"
];

for (const p of required) {
  if (!fs.existsSync(path.join(root, p))) throw new Error("Missing productization authority: " + p);
}

const state = JSON.parse(fs.readFileSync(path.join(root, "spec/productization-state/implementation-state.json"), "utf8"));
const workDir = path.join(root, "spec/productization-work-orders");
const workFiles = fs.readdirSync(workDir).filter((f) => f.endsWith(".md") && f !== "README.md");
const ids = new Set();

for (const file of workFiles) {
  const text = fs.readFileSync(path.join(workDir, file), "utf8");
  const match = text.match(/^# (P\d+)/m);
  if (!match) throw new Error("Productization Work Order without ID: " + file);
  if (ids.has(match[1])) throw new Error("Duplicate productization Work Order: " + match[1]);
  ids.add(match[1]);
}

for (const [id, task] of Object.entries(state.tasks)) {
  if (!ids.has(id)) throw new Error("State references missing productization Work Order: " + id);
  for (const dep of task.dependencies || []) {
    if (!state.tasks[dep]) throw new Error("Unknown dependency " + dep + " for " + id);
  }
}

for (const [id, task] of Object.entries(state.tasks)) {
  if (task.status === "READY") {
    for (const dep of task.dependencies || []) {
      const d = state.tasks[dep];
      const satisfied = d.status === "COMPLETE" || Boolean(d.mergedAs);
      if (!satisfied) throw new Error("READY task " + id + " has unmet dependency " + dep);
    }
  }
}

console.log("SOS productization repository contract check: PASS");
console.log("Productization Work Orders:", workFiles.length);
console.log("Frontier:", state.currentFrontier.join(", "));
