#!/usr/bin/env bun
import { type BunLockFile, type BunLockFilePackageArray, semver } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const lockfilePath = join(process.cwd(), "bun.lock");
const module = await import(lockfilePath);
const lockfile: BunLockFile = module.default;

const check = process.argv.includes("--check") || !!process.env["CI"];

/** ------------- Utils ------------- */
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

function searchInTree(packages: string[], searchedDep: string): string {
  const path = [...packages, searchedDep].join("/");
  if (path in lockfile.packages) return path;
  return searchInTree(packages.slice(0, -1), searchedDep);
}

function getVersion(info: BunLockFilePackageArray): string {
  return info[0].slice(info[0].lastIndexOf("@") + 1);
}

type PackageInfo =
  | string
  | boolean
  | { [key: string]: PackageInfo }
  | PackageInfo[];
function printInfo(info: PackageInfo): string {
  if (Array.isArray(info)) {
    return `[${info.map(printInfo).join(", ")}]`;
  } else if (typeof info === "object") {
    const entries = Object.entries(info);
    if (entries.length === 0) return "{}";
    return `{ ${entries
      .map(([key, value]) => `${JSON.stringify(key)}: ${printInfo(value)}`)
      .join(", ")} }`;
  } else {
    return JSON.stringify(info);
  }
}
/** ------------- Utils ------------- */

/** Get all the requirements for each package */
const requirements: Record<string, string[]> = {};
for (const dependencyPath in lockfile.packages) {
  const info = lockfile.packages[dependencyPath];
  if (info.length !== 4) continue; // Only support npm
  const packages = pathToPackages(dependencyPath);
  for (const depName in info[2].dependencies) {
    const requirement = info[2].dependencies[depName];
    const pkg = searchInTree(packages, depName);
    (requirements[pkg] ??= []).push(requirement);
  }
}

/**
 * The algorithm uses the fact that top-level packages are listed before nested ones.
 * For each package, we list their dependency, check if it exist as a nested package
 * If it does:
 *   1. First, we check if the resquested version is satisfied by the current top-level package.
 *      If it does, we add the package to the hoistedPackages array
 *   2. If not, we check if the nested package satisfies the requirements for the top-level package.
 *      If it does, the info for the top-level package is updated to the nested package and the package is added to the hoistedPackages array.
 * Later in the loop, any nested package that is part of the hoistedPackages array will be dropped.
 */
const hoistedPackages: string[] = [];
const newPackages = { ...lockfile.packages };
for (const dependencyPath in lockfile.packages) {
  const packages = pathToPackages(dependencyPath);
  if (
    packages.length > 1
    && hoistedPackages.some(
      (pkg) => dependencyPath === pkg || dependencyPath.startsWith(`${pkg}/`),
    )
  ) {
    delete newPackages[dependencyPath];
    continue;
  }
  const info = lockfile.packages[dependencyPath];
  if (info.length !== 4) continue; // Only support npm
  for (const depName in info[2].dependencies) {
    const nestedName = `${dependencyPath}/${depName}`;
    if (nestedName in lockfile.packages) {
      const previousLevelPath = searchInTree(packages.slice(0, -1), depName);
      const previousLevelInfo = lockfile.packages[previousLevelPath];
      const previousLevelVersion = getVersion(previousLevelInfo);
      const requestedVersion = info[2].dependencies[depName];
      if (semver.satisfies(previousLevelVersion, requestedVersion)) {
        hoistedPackages.push(nestedName);
      } else {
        const nestedInfo = lockfile.packages[nestedName];
        const nestedVersion = getVersion(nestedInfo);
        if (
          requirements[previousLevelPath].every((requirement) =>
            semver.satisfies(nestedVersion, requirement),
          )
        ) {
          hoistedPackages.push(nestedName);
          newPackages[previousLevelPath] = nestedInfo;
        }
      }
    }
  }
}

if (hoistedPackages.length === 0) {
  console.log("No duplicates found");
  process.exit(0);
}

if (check) {
  console.log(`Duplicates found: ${hoistedPackages.join(", ")}`);
  console.log("Run `bun dedupe` to fix");
  process.exit(1);
}

const lockfileLines = readFileSync(lockfilePath, "utf-8").split("\n");
const packagesStartIndex = lockfileLines.indexOf('  "packages": {');
const packagesEndIndex = lockfileLines.indexOf("  }", packagesStartIndex);
const newLockfileLines = [
  ...lockfileLines.slice(0, packagesStartIndex + 1),
  ...Object.entries(newPackages).map(
    ([path, info], i) =>
      `${i === 0 ? "" : "\n"}    "${path}": ${printInfo(info)},`,
  ),
  ...lockfileLines.slice(packagesEndIndex),
];
writeFileSync(lockfilePath, newLockfileLines.join("\n"));

console.log(`Duplicates removed: ${hoistedPackages.join(", ")}`);
