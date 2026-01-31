import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it } from "bun:test";

rmSync("tests-copy", { recursive: true, force: true });
mkdirSync("tests-copy");
cpSync("tests", "tests-copy", { recursive: true });

for (const testCase of readdirSync("tests-copy")) {
  const path = join("tests-copy", testCase);
  if (!statSync(path).isDirectory()) continue;
  it(testCase, () => {
    const result = Bun.spawnSync({ cmd: ["bun", "../../index.ts"], cwd: path });
    console.log(result.stdout.toString());
    expect(result.stdout.toString()).toEqual(
      readFileSync(join(path, "expected", "output.txt"), "utf-8"),
    );
    expect(readFileSync(join(path, "bun.lock"), "utf-8")).toEqual(
      readFileSync(join(path, "expected", "bun.lock"), "utf-8"),
    );
  });
}
