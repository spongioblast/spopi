// ABOUTME: Finds likely real secrets (provider API keys, tokens, private keys) in the files a run changed.
// ABOUTME: Read-only and in-process: a short list of high-confidence patterns, so no scanner has to be installed.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const MAX_FILE_BYTES = 1_000_000;
const MAX_FINDINGS = 20;

const RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g },
  { name: "GitHub token", pattern: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g },
  { name: "GitLab token", pattern: /\bglpat-[A-Za-z0-9_-]{20}\b/g },
  {
    name: "OpenAI API key",
    pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/g,
  },
  { name: "Anthropic API key", pattern: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,}/g },
  { name: "OpenRouter API key", pattern: /\bsk-or-v1-[a-f0-9]{64}\b/g },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: "Stripe live key", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b/g },
  { name: "Hugging Face token", pattern: /\bhf_[A-Za-z0-9]{34,}\b/g },
  { name: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: "private key", pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
];

const PLACEHOLDER = /x{5,}|example|your[_-]|placeholder|dummy|redacted/i;

export type SecretFinding = {
  /** Project-relative path with forward slashes. */
  file: string;
  line: number;
  kind: string;
  /** The first characters only; the full value never leaves this module. */
  preview: string;
  /** Hash of file and value, so a secret already reported is not reported again. */
  fingerprint: string;
};

/** `.env` and `.env.local` are where secrets belong; `.env.example` is committed, so it is scanned. */
function isEnvFile(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  return /^\.env(\..+)?$/.test(base) && !/example|sample|template|dist/.test(base);
}

function readText(file: string): string | null {
  try {
    if (fs.statSync(file).size > MAX_FILE_BYTES) return null;
    const text = fs.readFileSync(file, "utf8");
    return text.includes("\0") ? null : text;
  } catch {
    return null;
  }
}

export function scanSecrets(cwd: string, files: Iterable<string>): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const file of files) {
    const absolute = path.resolve(cwd, file);
    if (isEnvFile(absolute)) continue;
    const text = readText(absolute);
    if (!text) continue;
    const relative = path.relative(cwd, absolute).replaceAll("\\", "/");
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      for (const rule of RULES) {
        for (const match of lines[index].matchAll(rule.pattern)) {
          const value = match[0];
          if (PLACEHOLDER.test(value)) continue;
          findings.push({
            file: relative,
            line: index + 1,
            kind: rule.name,
            preview: rule.name === "private key" ? value : `${value.slice(0, 6)}…`,
            fingerprint: createHash("sha256").update(`${absolute}\0${value}`).digest("hex"),
          });
          if (findings.length >= MAX_FINDINGS) return findings;
        }
      }
    }
  }
  return findings;
}

function listing(findings: SecretFinding[]): string {
  return findings.map((f) => `- ${f.file}:${f.line} ${f.kind} (${f.preview})`).join("\n");
}

/** What the model reads: where, what kind, the way to fix it, and the way out for a fake value. */
export function secretMessage(findings: SecretFinding[]): string {
  return [
    "Files changed in this run contain what looks like a real secret:",
    listing(findings),
    "",
    "A secret in a source file ends up in git history and in every copy of the project. Read it from an environment variable or a git-ignored file such as `.env` instead, and leave a placeholder in its place.",
    "If the value is a placeholder or a test value, say so and leave it.",
  ].join("\n");
}

/** What the user reads when the model is not asked (again) about it. */
export function secretNotice(findings: SecretFinding[]): string {
  return `Possible secret in a changed file:\n${listing(findings)}`;
}
