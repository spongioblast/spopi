// ABOUTME: /spopi-config package_health reads live commands, tools, and reported errors.
// ABOUTME: The WebView shows loaded, failed, or registered-nothing. It does not guess peer ranges.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classifyPackageHealth, type PackageHealthInput } from "./package-health";
import type { BridgeHandlers } from "./types";

type HealthApi = Pick<ExtensionAPI, "getCommands" | "getAllTools">;

let api: HealthApi | null = null;

export function registerPackageHealth(pi: HealthApi): void {
  api = pi;
}

function listOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export const handlers: BridgeHandlers = {
  package_health: async (_ctx, params) => {
    const packages = listOf<NonNullable<PackageHealthInput["packages"]>[number]>(params.packages);
    const errors = listOf<NonNullable<PackageHealthInput["errors"]>[number]>(params.errors);
    const commands = Array.isArray(params.commands)
      ? listOf<NonNullable<PackageHealthInput["commands"]>[number]>(params.commands)
      : (api?.getCommands() ?? []);
    const tools = Array.isArray(params.tools)
      ? listOf<NonNullable<PackageHealthInput["tools"]>[number]>(params.tools)
      : (api?.getAllTools() ?? []);
    return {
      ok: true,
      data: { packages: classifyPackageHealth({ packages, commands, tools, errors }) },
    };
  },
};
