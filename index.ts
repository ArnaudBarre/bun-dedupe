#!/usr/bin/env bun
import { type BunLockFile, type BunLockFilePackageArray, semver } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const lockfilePath = join(process.cwd(), "bun.lock");
const module = await import(lockfilePath);
const lockfile: BunLockFile = module.default;

const check = process.argv.includes("--check") || !!process.env["CI"];

function pathToPackages(path: string): string[] {
  const packages: string[] = [];
  let isScope = false;
  for (const subPart of path.split("/")) {
    if (isScope) {
      packages[packages.length - 1] += `/${subPart}`;
      isScope = false;
    } else {
      packages.push(subPart);
      if (subPart.startsWith("@")) isScope = true;
    }
  }
  return packages;
}

function searchInTree(
  packages: string[],
  searchedDep: string,
): BunLockFilePackageArray {
  const parent = packages.slice(0, -1);
  const path = [...parent, searchedDep].join("/");
  if (path in lockfile.packages) return lockfile.packages[path];
  return searchInTree(parent, searchedDep);
}

const hoistedPackages: string[] = [];
const pathsToDrop: string[] = [];
for (const dependencyPath in lockfile.packages) {
  const packages = pathToPackages(dependencyPath);
  if (
    packages.length > 1
    && hoistedPackages.some((pkg) => dependencyPath.startsWith(pkg))
  ) {
    pathsToDrop.push(dependencyPath);
    continue;
  }
  const info = lockfile.packages[dependencyPath];
  if (info.length !== 4) continue; // Only support npm
  for (const depName in info[2].dependencies) {
    const nestedName = `${dependencyPath}/${depName}`;
    if (nestedName in lockfile.packages) {
      const previousLevelInfo = searchInTree(packages, depName);
      const previousLevelVersion = previousLevelInfo[0].slice(
        previousLevelInfo[0].lastIndexOf("@") + 1,
      );
      const requestedVersion = info[2].dependencies[depName];
      if (semver.satisfies(previousLevelVersion, requestedVersion)) {
        hoistedPackages.push(nestedName);
      }
    }
  }
}

if (pathsToDrop.length === 0) {
  console.log("No duplicates found");
  process.exit(0);
}

if (check) {
  console.log(`Duplicates found: ${pathsToDrop.join(", ")}`);
  console.log("Run `bun dedupe` to fix");
  process.exit(1);
}

const lockfileLines = readFileSync(lockfilePath, "utf-8").split("\n");
const newLockfileLines: string[] = [];
let state: "start" | "in-packages" | "end" = "start";
let dropIndex = 0;
for (const line of lockfileLines) {
  switch (state) {
    case "start":
      newLockfileLines.push(line);
      if (line === `  "packages": {`) state = "in-packages";
      break;
    case "in-packages":
      if (line.startsWith(`    "${pathsToDrop[dropIndex]}":`)) {
        newLockfileLines.splice(newLockfileLines.length - 1, 1); // drop the previous blank line
        dropIndex++;
      } else {
        newLockfileLines.push(line);
      }
      if (line === "  }") state = "end";
      break;
    case "end":
      newLockfileLines.push(line);
      break;
  }
}
writeFileSync(lockfilePath, newLockfileLines.join("\n"));
