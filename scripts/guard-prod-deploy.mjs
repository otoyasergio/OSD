#!/usr/bin/env node
/**
 * Refuse production deploys unless HEAD is on `main` and matches origin/main.
 * Prevents rolling service.torontomoto.com back to an old feature branch.
 */
import { execSync } from "node:child_process";

function run(command) {
  return execSync(command, { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`\nRefusing production deploy: ${message}\n`);
  console.error("Production must ship from main only.");
  console.error("  git checkout main && git pull --ff-only origin main");
  console.error("  npm run deploy:production\n");
  process.exit(1);
}

let branch;
try {
  branch = run("git rev-parse --abbrev-ref HEAD");
} catch {
  fail("not inside a git repository.");
}

if (branch === "HEAD") {
  fail("detached HEAD — check out the main branch first.");
}

if (branch !== "main") {
  fail(`current branch is "${branch}", not main.`);
}

try {
  run("git fetch origin main");
} catch {
  // Offline / no remote: still allow if local branch is named main, but warn.
  console.warn("Warning: could not fetch origin/main; checking local tip only.");
}

const head = run("git rev-parse HEAD");
let originMain;
try {
  originMain = run("git rev-parse origin/main");
} catch {
  fail("origin/main is missing. Run: git fetch origin main");
}

if (head !== originMain) {
  fail(
    `local main (${head.slice(0, 7)}) does not match origin/main (${originMain.slice(0, 7)}). Pull or push first.`
  );
}

const dirty = run("git status --porcelain");
if (dirty) {
  fail("working tree has uncommitted changes. Commit or stash before deploying.");
}

console.log("Production deploy guard passed (main @ " + head.slice(0, 7) + ").");
