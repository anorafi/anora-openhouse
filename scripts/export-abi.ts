import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const outDir = join(root, "apps/web/src/abi");

const targets = [
  { artifact: "contracts/out/AnoraFactory.sol/AnoraFactory.json", name: "AnoraFactory" },
  { artifact: "contracts/out/AnoraFacility.sol/AnoraFacility.json", name: "AnoraFacility" },
  { artifact: "contracts/out/TestUSDC.sol/TestUSDC.json", name: "TestUSDC" },
];

mkdirSync(outDir, { recursive: true });

for (const target of targets) {
  const artifactPath = join(root, target.artifact);
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const abi = artifact.abi;
  const body = `export const ${target.name}Abi = ${JSON.stringify(abi, null, 2)} as const;\n`;
  writeFileSync(join(outDir, `${target.name}.ts`), body);
  console.log(`wrote ${target.name}.ts (${abi.length} entries)`);
}

const indexBody = targets.map((t) => `export { ${t.name}Abi } from "./${t.name}";`).join("\n") + "\n";
writeFileSync(join(outDir, "index.ts"), indexBody);
console.log("wrote index.ts");
