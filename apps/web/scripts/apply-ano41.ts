import { readFileSync, writeFileSync } from "node:fs";

const production = new URL("../../../contracts/deployments.json", import.meta.url);
const candidate = new URL("../../../contracts/deployments.ano41.json", import.meta.url);
const live = JSON.parse(readFileSync(production, "utf8"));
const next = JSON.parse(readFileSync(candidate, "utf8"));
const only = process.argv[2];
const sections = only ? [only] : Object.keys(next);

for (const key of sections) {
  if (!live[key] || !next[key]) throw new Error(`unknown network ${key}`);
  live[key] = {
    ...live[key],
    previousFactory: live[key].AnoraFactory,
    AnoraFactory: next[key].AnoraFactory,
    AnoraFacilityImplementation: next[key].AnoraFacilityImplementation,
    deployedAt: next[key].deployedAt,
    note: "model-aware factory: createFacilityWithModel, Junior protection, frozen terms snapshot",
  };
  console.log(`${key}: ${live[key].previousFactory} -> ${live[key].AnoraFactory}`);
}

writeFileSync(production, JSON.stringify(live, null, 2) + "\n");
