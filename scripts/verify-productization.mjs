import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "spec/productization-requirements.md",
  "spec/productization-execution-architecture.md",
  "spec/productization-roadmap.md",
  "spec/productization-state/implementation-state.json",
  "spec/productization-work-orders/README.md",
  "docs/ux/user-journey-simulation.md",
  "docs/ux/sharenet-inspired-design.md",
  "docs/deployment/free-tier-plan.md",
  "docs/implementation/PRODUCTIZATION-HANDOFF.md"
];

for (const p of required) {
  if (!fs.existsSync(path.join(root, p))) throw new Error("Missing productization authority: " + p);
}

const state = JSON.parse(fs.readFileSync(path.join(root, "spec/productization-state/implementation-state.json"), "utf8"));
const workDir = path.join(root, "spec/productization-work-orders");
const workFiles = fs.readdirSync(workDir).filter((f) => f.endsWith(".md") && f !== "README.md");
const ids = new Set();
const ownedPaths = [];

for (const file of workFiles) {
  const text = fs.readFileSync(path.join(workDir, file), "utf8");
  const match = text.match(/^# (P\d+(?:-[A-Z])?)(?![\d-])/m);
  if (!match) throw new Error("Productization Work Order without ID: " + file);
  if (ids.has(match[1])) throw new Error("Duplicate productization Work Order: " + match[1]);
  ids.add(match[1]);

  const owned = text.match(/^Owned paths:\s*(.+)$/m);
  if (owned) {
    for (const raw of owned[1].split(",")) {
      const p = raw.trim();
      if (p && !p.startsWith("repository-wide")) ownedPaths.push({ path: p, file });
    }
  }
}

const expectedIds = Object.keys(state.tasks);
for (const id of expectedIds) {
  if (!ids.has(id)) throw new Error("State references missing productization Work Order: " + id);
}
for (const id of ids) {
  if (!state.tasks[id]) throw new Error("Work Order exists without machine state entry: " + id);
}

for (let i = 0; i < ownedPaths.length; i += 1) {
  for (let j = i + 1; j < ownedPaths.length; j += 1) {
    const a = ownedPaths[i].path;
    const b = ownedPaths[j].path;
    const prefix = (x, y) => y === x || y.startsWith(x + "/");
    if (prefix(a, b) || prefix(b, a)) {
      throw new Error(`Owned path collision: ${ownedPaths[i].file} (${a}) vs ${ownedPaths[j].file} (${b})`);
    }
  }
}

function assertNoCycles(tasks) {
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error("Dependency cycle detected at " + id);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of tasks[id].dependencies || []) {
      if (!tasks[dep]) throw new Error("Unknown dependency " + dep + " for " + id);
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of Object.keys(tasks)) visit(id);
}
assertNoCycles(state.tasks);

for (const [id, task] of Object.entries(state.tasks)) {
  if (!Array.isArray(task.dependencies)) throw new Error("Dependencies must be an array for " + id);
  if (!["READY","BLOCKED","COMPLETE"].includes(task.status)) {
    throw new Error("Invalid task status for " + id + ": " + task.status);
  }
  if (task.status === "READY") {
    for (const dep of task.dependencies) {
      const d = state.tasks[dep];
      const satisfied = d.status === "COMPLETE" || Boolean(d.mergedAs);
      if (!satisfied) throw new Error("READY task " + id + " has unmet dependency " + dep);
    }
  }
  if (task.status === "COMPLETE" && !task.mergedAs) {
    throw new Error("COMPLETE task must record mergedAs: " + id);
  }
}

const frontier = new Set(state.currentFrontier);
for (const id of frontier) {
  if (!state.tasks[id]) throw new Error("Frontier references unknown task " + id);
  if (state.tasks[id].status !== "READY") throw new Error("Frontier task is not READY: " + id);
}

const autoEligible = Object.entries(state.tasks)
  .filter(([, task]) => task.status === "BLOCKED" && (task.dependencies || []).every((dep) => {
    const d = state.tasks[dep];
    return d.status === "COMPLETE" || Boolean(d.mergedAs);
  }))
  .map(([id]) => id);

for (const id of autoEligible) {
  if (!frontier.has(id)) throw new Error("Machine state frontier omitted eligible task: " + id);
}

const requiredOrderText = fs.readFileSync(path.join(workDir, "README.md"), "utf8");
for (const requiredPhrase of [
  "Unmerged siblings are never dependencies",
  "WAITING_FOR_ARCHITECT",
  "frozen W0-W18",
  "body",
  "observation"
]) {
  if (!requiredOrderText.includes(requiredPhrase)) {
    throw new Error("Work Order policy missing required phrase: " + requiredPhrase);
  }
}

console.log("SOS productization repository contract check: PASS");
console.log("Productization Work Orders:", workFiles.length);
console.log("Frontier:", state.currentFrontier.join(", "));
console.log("Owned paths:", ownedPaths.length);
console.log("All dependency edges, owned paths and machine state are consistent.");
