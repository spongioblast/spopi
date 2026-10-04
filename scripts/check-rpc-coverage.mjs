#!/usr/bin/env node
// ABOUTME: Checks docs/RPC_COVERAGE.md against Pi's RPC command and event names.
// ABOUTME: A handled row must name one or more comma-separated files that still contain that name.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dirname, "..");
const rpcTypesPath = join(
  root,
  "node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts",
);
const rpcDocPath = join(root, "src-tauri/resources/pi/docs/rpc.md");
const jsonDocPath = join(root, "src-tauri/resources/pi/docs/json.md");
const coveragePath = join(root, "docs/RPC_COVERAGE.md");

function read(path) {
  return readFileSync(path, "utf8");
}

function typeBody(text, typeName) {
  const marker = `export type ${typeName} =`;
  const start = text.indexOf(marker);
  if (start < 0) return "";
  const rest = text.slice(start + marker.length);
  const next = rest.search(/\nexport |\n\/\*|\n\/\/#/);
  return next < 0 ? rest : rest.slice(0, next);
}

function quotedTypes(body) {
  return [...body.matchAll(/type:\s*"([a-z0-9_]+)"/g)].map((match) => match[1]);
}

function declarationFile(fromFile, specifier) {
  if (specifier.startsWith(".")) {
    const base = resolve(dirname(fromFile), specifier);
    const candidates = [base, base.replace(/\.ts$/, ".d.ts"), `${base}.d.ts`];
    return candidates.find((candidate) => existsSync(candidate)) || null;
  }
  const pkgName = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  const subpath = specifier.slice(pkgName.length);
  let dir = dirname(fromFile);
  while (true) {
    const pkgPath = join(dir, "node_modules", pkgName, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(read(pkgPath));
      const entry = subpath ? pkg.exports?.[`.${subpath}`] : pkg.exports?.["."] || pkg.types;
      const rel = typeof entry === "string" ? entry : entry?.types || pkg.types;
      return join(dir, "node_modules", pkgName, rel);
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function findTypeFile(startFile, typeName, seen = new Set()) {
  if (!startFile || seen.has(`${startFile}:${typeName}`)) return null;
  seen.add(`${startFile}:${typeName}`);
  const text = read(startFile);
  if (text.includes(`export type ${typeName} `) || text.includes(`export type ${typeName}=`)) {
    return startFile;
  }
  const follows = [];
  for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+"([^"]+)"/g)) {
    const names = match[1].split(",").map((part) => part.trim().split(/\s+/).pop());
    if (names.includes(typeName)) follows.push(match[2]);
  }
  for (const match of text.matchAll(/export\s+\*\s+from\s+"([^"]+)"/g)) {
    follows.push(match[1]);
  }
  // Pi 1.0 writes `import { type AgentEvent } from "@earendil-works/pi-agent-core"`.
  for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+"([^"]+)"/g)) {
    const names = match[1].split(",").map((part) =>
      part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+/)
        .pop(),
    );
    if (names.includes(typeName)) follows.push(match[2]);
  }
  for (const specifier of follows) {
    const found = findTypeFile(declarationFile(startFile, specifier), typeName, seen);
    if (found) return found;
  }
  return null;
}

function importedTypeNames(fromFile, typeName) {
  const file = findTypeFile(fromFile, typeName);
  if (!file) throw new Error(`Pi types have no ${typeName}`);
  return quotedTypes(typeBody(read(file), typeName));
}

function eventNamesFromJsonDoc(text) {
  const start = text.indexOf("\n## RPC-only events\n");
  if (start < 0) return [];
  const rest = text.slice(start + 1);
  const end = rest.indexOf("\n## ", 1);
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...section.matchAll(/"type":"([a-z0-9_]+)"/g)].map((match) => match[1]);
}

function eventNamesFromRpcDoc(text) {
  const events = text.indexOf("\n## Events\n");
  const table = text.indexOf("\n### Event Types\n", events);
  const end = text.indexOf("\n### ", table + 1);
  const section = text.slice(table, end < 0 ? undefined : end);
  const names = [];
  for (const line of section.split("\n")) {
    const row = line.match(/^\|\s*`([^`]+)`/);
    if (!row) continue;
    for (const part of row[1].split("/")) {
      const name = part.trim();
      if (/^[a-z0-9_]+$/.test(name)) names.push(name);
    }
  }
  return names;
}

function piNames() {
  const rpcTypes = read(rpcTypesPath);
  const commands = quotedTypes(typeBody(rpcTypes, "RpcCommand"));
  const sessionTypes = declarationFile(rpcTypesPath, "../../core/agent-session.ts");
  const sessionEvents = importedTypeNames(sessionTypes, "AgentSessionEvent");
  const agentEvents = importedTypeNames(sessionTypes, "AgentEvent");
  const docEvents = eventNamesFromRpcDoc(read(rpcDocPath));
  const rpcOnlyEvents = eventNamesFromJsonDoc(read(jsonDocPath));
  return {
    command: [...new Set(commands)],
    event: [...new Set([...agentEvents, ...sessionEvents, ...docEvents, ...rpcOnlyEvents])],
  };
}

function coverageRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const [name, kind, status, where, reason] = cells;
    if (!["handled", "unused", "forbidden"].includes(status)) continue;
    rows.push({ name, kind, status, where, reason });
  }
  return rows;
}

const expected = piNames();
const rows = coverageRows(read(coveragePath));
const errors = [];
const seen = new Set();

for (const row of rows) {
  const key = `${row.kind}:${row.name}`;
  if (seen.has(key)) errors.push(`duplicate row ${key}`);
  seen.add(key);
  if (!["command", "event"].includes(row.kind)) {
    errors.push(`${row.name} has kind ${row.kind}`);
    continue;
  }
  if (!expected[row.kind].includes(row.name)) {
    errors.push(`${row.kind} ${row.name} is not in Pi's types`);
  }
  if (row.status !== "handled") continue;
  if (!row.where) {
    errors.push(`${row.name} is handled without a path`);
    continue;
  }
  const files = row.where
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!files.length) {
    errors.push(`${row.name} is handled without a path`);
    continue;
  }
  for (const file of files) {
    const path = join(root, file);
    if (!existsSync(path)) {
      errors.push(`${row.name} path does not exist: ${file}`);
      continue;
    }
    const source = read(path);
    if (!new RegExp(`\\b${row.name}\\b`).test(source)) {
      errors.push(`${file} does not contain ${row.name}`);
    }
  }
}

for (const kind of ["command", "event"]) {
  for (const name of expected[kind]) {
    if (!seen.has(`${kind}:${name}`)) errors.push(`missing ${kind} ${name}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log(
  `rpc coverage ok (${expected.command.length} commands, ${expected.event.length} events)`,
);
