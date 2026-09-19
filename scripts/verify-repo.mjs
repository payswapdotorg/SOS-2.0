import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "AGENTS.md",
  "ARCHITECT_START_HERE.md",
  "spec/architecture.md",
  "spec/architecture-lock.md",
  "spec/meta-model.md",
  "spec/requirements.md",
  "spec/implementation-roadmap.md",
  "spec/development-state/implementation-state.json",
  "docs/architecture-to-code.md",
  "docs/code-to-architecture.md",
  "docs/package-ecology.md",
  "docs/probabilistic-learning.md",
  "docs/assurance-model.md",
  "docs/research/research-basis.md"
];

for (const p of required) {
  if (!fs.existsSync(path.join(root, p))) throw new Error("Missing required file: " + p);
}

const state = JSON.parse(fs.readFileSync(path.join(root, "spec/development-state/implementation-state.json"), "utf8"));
const workDir = path.join(root, "spec/work-orders");
const workFiles = fs.readdirSync(workDir).filter(f => f.endsWith(".md") && f !== "README.md");
const ids = new Set();

for (const file of workFiles) {
  const text = fs.readFileSync(path.join(workDir, file), "utf8");
  const match = text.match(/^# (W[0-9.]+)/m);
  if (!match) throw new Error("Work Order without ID: " + file);
  if (ids.has(match[1])) throw new Error("Duplicate Work Order: " + match[1]);
  ids.add(match[1]);
}

for (const [id, task] of Object.entries(state.tasks)) {
  if (id !== "W0" && !ids.has(id)) throw new Error("State references missing Work Order: " + id);
  for (const dep of task.dependencies || []) {
    if (!state.tasks[dep]) throw new Error("Unknown dependency " + dep + " for " + id);
  }
}

for (const [id, task] of Object.entries(state.tasks)) {
  if (task.status === "ELIGIBLE") {
    for (const dep of task.dependencies || []) {
      const d = state.tasks[dep];
      if (!(d.status === "BOOTSTRAP_COMPLETE" || d.status === "COMPLETE" || d.mergedAs)) {
        throw new Error("Eligible task " + id + " has unmet dependency " + dep);
      }
    }
  }
}

console.log("SOS 2.0 repository contract check: PASS");
console.log("Work Orders discovered:", workFiles.length);
console.log("Frontier:", state.currentFrontier.join(", "));
