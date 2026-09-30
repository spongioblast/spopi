// ABOUTME: Groups Pi commands and tools by sourceInfo for each installed package.
// ABOUTME: A package is loaded, failed, or registered nothing. Peer ranges are not consulted.

export type PackageHealthState = "loaded" | "failed" | "registered-nothing";

export type PackageHealthInput = {
  packages?: Array<{ source?: string; name?: string }>;
  commands?: Array<{ name?: string; sourceInfo?: { source?: string; path?: string } }>;
  tools?: Array<{ name?: string; sourceInfo?: { source?: string; path?: string } }>;
  errors?: Array<{ error?: string; extensionPath?: string; packageName?: string }>;
};

export type PackageHealthRow = {
  name: string;
  state: PackageHealthState;
  error: string;
  count: number;
};

export function packageNameFromSource(source: string): string {
  const trimmed = source.replace(/^npm:/, "");
  if (trimmed.startsWith("@")) return trimmed.split("/").slice(0, 2).join("/");
  return trimmed.split("/")[0] || trimmed;
}

/** Package identity is the npm name, not a substring of a longer name or an error sentence. */
export function pathOwnsPackage(filePath: string, name: string): boolean {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash <= 1) return false;
    const scope = name.slice(0, slash);
    const pkg = name.slice(slash + 1);
    return parts.some((part, index) => part === scope && parts[index + 1] === pkg);
  }
  return parts.includes(name);
}

function sourceOwnsPackage(source: string, name: string): boolean {
  return packageNameFromSource(source) === name;
}

function ownedBy(item: { sourceInfo?: { source?: string; path?: string } }, name: string): boolean {
  return (
    sourceOwnsPackage(item.sourceInfo?.source || "", name) ||
    pathOwnsPackage(item.sourceInfo?.path || "", name)
  );
}

function errorOwns(
  error: { error?: string; extensionPath?: string; packageName?: string },
  name: string,
): boolean {
  if (error.packageName && sourceOwnsPackage(error.packageName, name)) return true;
  return pathOwnsPackage(error.extensionPath || "", name);
}

/** One row per package. Failed wins over a partial registration. */
export function classifyPackageHealth(input: PackageHealthInput = {}): PackageHealthRow[] {
  const commands = input.commands || [];
  const tools = input.tools || [];
  const errors = input.errors || [];
  return (input.packages || []).map((pkg) => {
    const name = pkg.name || packageNameFromSource(String(pkg.source || ""));
    const count = [...commands, ...tools].filter((item) => ownedBy(item, name)).length;
    const failure = errors.find((error) => errorOwns(error, name));
    const state: PackageHealthState = failure
      ? "failed"
      : count > 0
        ? "loaded"
        : "registered-nothing";
    return { name, state, error: failure?.error || "", count };
  });
}
