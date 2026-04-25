#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_FILENAME = 'package.json';
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.github',
  '.vercel',
  'coverage',
  'dist',
  'node_modules',
]);

function printDivider() {
  console.log('==========================================');
}

function printHeader(title) {
  printDivider();
  console.log(`  ${title}`);
  printDivider();
}

function printSection(index, total, title) {
  console.log(`\n[${index}/${total}] ${title}`);
}

function quotePowerShellArgument(argument) {
  return /^[A-Za-z0-9_./:\\@^=-]+$/.test(argument)
    ? argument
    : `'${argument.replace(/'/g, "''")}'`;
}

function formatPowerShellCommand(cwd, command, args = []) {
  return `PS ${cwd}> ${[command, ...args].map(quotePowerShellArgument).join(' ')}`;
}

function printAction(cwd, command, args = []) {
  console.log(formatPowerShellCommand(cwd, command, args));
}

function collectDependencyNames(manifest) {
  return Array.from(
    new Set(
      DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {}))
    )
  ).sort((left, right) => left.localeCompare(right));
}

function collectDependencyCounts(manifest) {
  return DEPENDENCY_FIELDS.reduce((counts, field) => {
    counts[field] = Object.keys(manifest[field] ?? {}).length;
    return counts;
  }, {});
}

function cloneDependencySnapshot(manifest) {
  return DEPENDENCY_FIELDS.reduce((snapshot, field) => {
    snapshot[field] = { ...(manifest[field] ?? {}) };
    return snapshot;
  }, {});
}

function collectRangeChanges(beforeSnapshot, afterManifest) {
  const changes = [];

  for (const field of DEPENDENCY_FIELDS) {
    const beforeEntries = beforeSnapshot[field] ?? {};
    const afterEntries = afterManifest[field] ?? {};
    const dependencyNames = Array.from(
      new Set([...Object.keys(beforeEntries), ...Object.keys(afterEntries)])
    ).sort((left, right) => left.localeCompare(right));

    for (const dependencyName of dependencyNames) {
      const beforeRange = beforeEntries[dependencyName];
      const afterRange = afterEntries[dependencyName];

      if (beforeRange !== afterRange) {
        changes.push({
          field,
          name: dependencyName,
          beforeRange,
          afterRange,
        });
      }
    }
  }

  return changes;
}

function describeCounts(counts) {
  return DEPENDENCY_FIELDS
    .filter((field) => counts[field] > 0)
    .map((field) => `${field}:${counts[field]}`)
    .join(', ');
}

function formatChange(change) {
  return `${change.name} (${change.field}) ${change.beforeRange ?? '<missing>'} -> ${change.afterRange ?? '<removed>'}`;
}

async function readManifest(packageJsonPath) {
  const manifestText = await readFile(packageJsonPath, 'utf8');
  return JSON.parse(manifestText);
}

async function collectPackageJsonPaths(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const packageJsonPaths = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      packageJsonPaths.push(...(await collectPackageJsonPaths(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name === MANIFEST_FILENAME) {
      packageJsonPaths.push(entryPath);
    }
  }

  return packageJsonPaths;
}

async function discoverTargets() {
  const packageJsonPaths = await collectPackageJsonPaths(ROOT_DIR);
  const targets = [];

  for (const packageJsonPath of packageJsonPaths.sort((left, right) => left.localeCompare(right))) {
    const manifest = await readManifest(packageJsonPath);
    const dependencyNames = collectDependencyNames(manifest);

    if (dependencyNames.length === 0) {
      continue;
    }

    const directoryPath = path.dirname(packageJsonPath);
    targets.push({
      dir: directoryPath,
      packageJsonPath,
      packageJsonLabel: path.relative(ROOT_DIR, packageJsonPath) || MANIFEST_FILENAME,
      lockfilePath: path.join(directoryPath, 'pnpm-lock.yaml'),
      dependencyNames,
      dependencyCounts: collectDependencyCounts(manifest),
      beforeSnapshot: cloneDependencySnapshot(manifest),
    });
  }

  return targets;
}

async function runPnpmUpgrade(target) {
  const args = ['up', '--latest', ...target.dependencyNames];
  printAction(target.dir, 'pnpm', args);

  await new Promise((resolve, reject) => {
    const child = spawn(PNPM_COMMAND, args, {
      cwd: target.dir,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', (error) => {
      reject(new Error(`Unable to execute pnpm in ${target.dir}: ${error.message}`));
    });

    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `pnpm exited abnormally for ${target.packageJsonLabel}: ${signal ? `signal ${signal}` : `code ${code}`}`
        )
      );
    });
  });
}

async function verifyTarget(target) {
  const nextManifest = await readManifest(target.packageJsonPath);
  const changedRanges = collectRangeChanges(target.beforeSnapshot, nextManifest);
  const lockfileExists = existsSync(target.lockfilePath);
  const lockfileLabel = lockfileExists
    ? path.relative(ROOT_DIR, target.lockfilePath)
    : '<no local pnpm-lock.yaml>';

  console.log(
    `[ok] ${target.packageJsonLabel} -> ${target.dependencyNames.length} dependencies inspected, ${changedRanges.length} ranges updated, lockfile: ${lockfileLabel}`
  );

  if (changedRanges.length > 0) {
    const preview = changedRanges.slice(0, 10).map(formatChange);
    preview.forEach((line) => console.log(`  - ${line}`));

    if (changedRanges.length > preview.length) {
      console.log(`  - ... ${changedRanges.length - preview.length} more`);
    }
  } else {
    console.log('  - Already at the newest published ranges or no manifest rewrite was necessary.');
  }
}

async function main() {
  printHeader('Upgrade Package Dependencies For Dependabot');

  const targets = await discoverTargets();

  if (targets.length === 0) {
    throw new Error('No package.json with dependencies was found under the repository root.');
  }

  console.log(`Repository root: ${ROOT_DIR}`);
  console.log(`Targets: ${targets.length}`);

  for (const target of targets) {
    console.log(
      `- ${target.packageJsonLabel} (${describeCounts(target.dependencyCounts)})`
    );
  }

  for (const [index, target] of targets.entries()) {
    printSection(
      index + 1,
      targets.length,
      `upgrade ${target.packageJsonLabel}`
    );
    await runPnpmUpgrade(target);
    await verifyTarget(target);
  }

  console.log('\nDone.');
}

main().catch((error) => {
  console.error(`\n[failed] ${error.message}`);
  process.exitCode = 1;
});
