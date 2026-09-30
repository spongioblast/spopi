// ABOUTME: Parses Pi package sources into npm, git, and local identities.
// ABOUTME: Identity ignores version and ref so two pins of one package stay one package.

import hostedGitInfo from "hosted-git-info";

export type ParsedPackageSource =
  | { type: "npm"; spec: string; name: string; version?: string; range?: string; pinned: boolean }
  | {
      type: "git";
      repo: string;
      host: string;
      path: string;
      ref?: string;
      pinned: boolean;
    }
  | { type: "local"; path: string };

/**
 * Returns false (i.e. NOT local) for known non-local prefixes. Matches Pi's
 * `isLocalPath` exactly: npm:, git:, github:, http:, https:, ssh: are not
 * local; everything else (including git@host:path SSH shorthand) is local.
 */
export function isLocalPath(source: string): boolean {
  const trimmed = source.trim();
  return !(
    trimmed.startsWith("npm:") ||
    trimmed.startsWith("git:") ||
    trimmed.startsWith("github:") ||
    trimmed.startsWith("http:") ||
    trimmed.startsWith("https:") ||
    trimmed.startsWith("ssh:")
  );
}

/**
 * Parse an npm spec into name and optional version. Mirrors Pi's regex
 * `/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/`.
 */
export function parseNpmSpec(spec: string): { name: string; version?: string } {
  const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
  if (!match) return { name: spec };
  const name = match[1] ?? spec;
  const version = match[2];
  return { name, version };
}

/**
 * Reimplementation of Pi's parseGitUrl. The package does not export it
 * (exports map only exposes `.` and `./rpc-entry`), and deep-path imports
 * fail under Pi's compiled runtime. A contract test cross-checks this
 * against the package's authoritative implementation loaded via createRequire
 * in the dev/test environment.
 *
 * Ported from Pi utils/git.ts: splitRef + buildGitSource + parseGenericGitUrl,
 * using the same `hosted-git-info` dependency Pi uses for host-specific
 * shorthand resolution.
 */
export function parseGitUrl(source: string): {
  type: "git";
  repo: string;
  host: string;
  path: string;
  ref?: string;
  pinned: boolean;
} | null {
  const trimmed = source.trim();
  const hasGitPrefix = trimmed.startsWith("git:");
  const url = hasGitPrefix ? trimmed.slice(4).trim() : trimmed;

  // Without git: prefix, only accept explicit protocol URLs.
  if (!hasGitPrefix && !/^(https?|ssh|git):\/\//i.test(url)) {
    return null;
  }

  const split = splitRef(url);

  // Try hosted-git-info shorthand resolution first.
  const hostedCandidates = [split.ref ? `${split.repo}#${split.ref}` : undefined, url].filter(
    (value): value is string => Boolean(value),
  );
  for (const candidate of hostedCandidates) {
    const info = hostedGitInfo.fromUrl(candidate);
    if (info) {
      if (split.ref && info.project?.includes("@")) continue;
      const useHttpsPrefix =
        !split.repo.startsWith("http://") &&
        !split.repo.startsWith("https://") &&
        !split.repo.startsWith("ssh://") &&
        !split.repo.startsWith("git://") &&
        !split.repo.startsWith("git@");
      return buildGitSource({
        repo: useHttpsPrefix ? `https://${split.repo}` : split.repo,
        host: info.domain || "",
        path: `${info.user}/${info.project}`,
        ref: info.committish || split.ref || undefined,
      });
    }
  }

  // Fall back to generic https: prefix resolution.
  const httpsCandidates = [
    split.ref ? `https://${split.repo}#${split.ref}` : undefined,
    `https://${url}`,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of httpsCandidates) {
    const info = hostedGitInfo.fromUrl(candidate);
    if (info) {
      if (split.ref && info.project?.includes("@")) continue;
      return buildGitSource({
        repo: `https://${split.repo}`,
        host: info.domain || "",
        path: `${info.user}/${info.project}`,
        ref: info.committish || split.ref || undefined,
      });
    }
  }

  return parseGenericGitUrl(url);
}

/** Mirror Pi's splitRef: separate a trailing @ref or #ref from the repo. */
export function splitRef(url: string): { repo: string; ref?: string } {
  const scpLikeMatch = url.match(/^git@([^:]+):(.+)$/);
  if (scpLikeMatch) {
    const pathWithMaybeRef = scpLikeMatch[2] ?? "";
    const refSeparator = pathWithMaybeRef.indexOf("@");
    if (refSeparator < 0) return { repo: url };
    const repoPath = pathWithMaybeRef.slice(0, refSeparator);
    const ref = pathWithMaybeRef.slice(refSeparator + 1);
    if (!repoPath || !ref) return { repo: url };
    return { repo: `git@${scpLikeMatch[1] ?? ""}:${repoPath}`, ref };
  }

  if (url.includes("://")) {
    try {
      const parsed = new URL(url);
      const pathWithMaybeRef = parsed.pathname.replace(/^\/+/, "");
      const refSeparator = pathWithMaybeRef.indexOf("@");
      if (refSeparator < 0) return { repo: url };
      const repoPath = pathWithMaybeRef.slice(0, refSeparator);
      const ref = pathWithMaybeRef.slice(refSeparator + 1);
      if (!repoPath || !ref) return { repo: url };
      parsed.pathname = `/${repoPath}`;
      return { repo: parsed.toString().replace(/\/$/, ""), ref };
    } catch {
      return { repo: url };
    }
  }

  const slashIndex = url.indexOf("/");
  if (slashIndex < 0) return { repo: url };
  const host = url.slice(0, slashIndex);
  const pathWithMaybeRef = url.slice(slashIndex + 1);
  const refSeparator = pathWithMaybeRef.indexOf("@");
  if (refSeparator < 0) return { repo: url };
  const repoPath = pathWithMaybeRef.slice(0, refSeparator);
  const ref = pathWithMaybeRef.slice(refSeparator + 1);
  if (!repoPath || !ref) return { repo: url };
  return { repo: `${host}/${repoPath}`, ref };
}

export function decodeForValidation(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function hasUnsafeGitInstallPart(value: string, allowSlash: boolean): boolean {
  const decoded = decodeForValidation(value);
  if (decoded === null) return true;
  const candidates = [value, decoded];
  for (const candidate of candidates) {
    if (candidate.includes("\0") || candidate.includes("\\") || candidate.startsWith("/")) {
      return true;
    }
    if (!allowSlash && candidate.includes("/")) return true;
    if (candidate.split("/").includes("..")) return true;
  }
  return false;
}

export function buildGitSource(args: { repo: string; host: string; path: string; ref?: string }): {
  type: "git";
  repo: string;
  host: string;
  path: string;
  ref?: string;
  pinned: boolean;
} | null {
  if (args.path.startsWith("/")) return null;
  const normalizedPath = args.path.replace(/\.git$/, "").replace(/^\/+/, "");
  if (!args.host || !normalizedPath || normalizedPath.split("/").length < 2) return null;
  if (hasUnsafeGitInstallPart(args.host, false) || hasUnsafeGitInstallPart(normalizedPath, true)) {
    return null;
  }
  return {
    type: "git",
    repo: args.repo,
    host: args.host,
    path: normalizedPath,
    ref: args.ref,
    pinned: args.ref !== undefined,
  };
}

export function parseGenericGitUrl(url: string): {
  type: "git";
  repo: string;
  host: string;
  path: string;
  ref?: string;
  pinned: boolean;
} | null {
  const { repo: repoWithoutRef, ref } = splitRef(url);
  let repo = repoWithoutRef;
  let host = "";
  let path = "";

  const scpLikeMatch = repoWithoutRef.match(/^git@([^:]+):(.+)$/);
  if (scpLikeMatch) {
    host = scpLikeMatch[1] ?? "";
    path = scpLikeMatch[2] ?? "";
  } else if (
    repoWithoutRef.startsWith("https://") ||
    repoWithoutRef.startsWith("http://") ||
    repoWithoutRef.startsWith("ssh://") ||
    repoWithoutRef.startsWith("git://")
  ) {
    try {
      const parsed = new URL(repoWithoutRef);
      host = parsed.hostname;
      path = parsed.pathname.replace(/^\/+/, "");
    } catch {
      return null;
    }
  } else {
    const slashIndex = repoWithoutRef.indexOf("/");
    if (slashIndex < 0) return null;
    host = repoWithoutRef.slice(0, slashIndex);
    path = repoWithoutRef.slice(slashIndex + 1);
    if (!host.includes(".") && host !== "localhost") return null;
    repo = `https://${repoWithoutRef}`;
  }

  return buildGitSource({ repo, host, path, ref });
}

/**
 * Parse a package source string into a typed ParsedPackageSource. Mirrors
 * Pi's parseSource: npm: → npm, isLocalPath → local, else try parseGitUrl →
 * git, else fallback to local.
 */
export function parsePackageSource(source: string): ParsedPackageSource {
  if (source.startsWith("npm:")) {
    const spec = source.slice("npm:".length).trim();
    const { name, version } = parseNpmSpec(spec);
    return { type: "npm", spec, name, version, pinned: false };
  }
  if (isLocalPath(source)) {
    return { type: "local", path: source };
  }
  const git = parseGitUrl(source);
  if (git) return git;
  return { type: "local", path: source };
}

// ── Identity ──────────────────────────────────────────────────────────

/**
 * Compute a stable identity for a parsed source. Identity ignores version
 * (npm) and ref (git), so two entries with the same name/repo but different
 * versions/refs are the same package.
 */
export function packageIdentity(parsed: ParsedPackageSource): string {
  if (parsed.type === "npm") return `npm:${parsed.name}`;
  if (parsed.type === "git") return `git:${parsed.host}/${parsed.path}`;
  return `local:${parsed.path}`;
}
