// ABOUTME: Each mode writes its pi-permission-system recipe, including path denies.
// ABOUTME: Tests permission-recipes.ts; an empty config reads as Ask.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentRoot,
  autoEditBashRules,
  autoEditRecipeStale,
  denyRoot,
  handlers,
  permissionConfigPath,
  permissionRecipe,
  protectedRoots,
  rootDeniesMissing,
  skillReadsAsk,
  upgradeDenied,
} from "./permission-recipes";

const previous = process.env.PI_CODING_AGENT_DIR;
const previousInstall = process.env.SPOPI_INSTALL_DIR;
const previousPublic = process.env.SPOPI_PUBLIC_DIR;

beforeEach(() => {
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "spopi-permission-"));
  process.env.SPOPI_INSTALL_DIR = "D:/SPOPI";
  process.env.SPOPI_PUBLIC_DIR = "D:/SPOPI/public";
});

afterEach(() => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
  if (previousInstall === undefined) delete process.env.SPOPI_INSTALL_DIR;
  else process.env.SPOPI_INSTALL_DIR = previousInstall;
  if (previousPublic === undefined) delete process.env.SPOPI_PUBLIC_DIR;
  else process.env.SPOPI_PUBLIC_DIR = previousPublic;
});

function writtenPermission(): Record<string, unknown> {
  return JSON.parse(readFileSync(permissionConfigPath(), "utf8")).permission;
}

type Matcher = {
  compileWildcardPatternEntries: (entries: [string, string][]) => unknown[];
  findCompiledWildcardMatch: (patterns: unknown[], name: string) => { state: string } | null;
};

// The permission extension's own matcher, loaded at run time: its source does not
// type-check under this repo's tsconfig.
const MATCHER_PATH =
  "../../node_modules/@gotgenes/pi-permission-system/src/policy/wildcard-matcher";
const matcher = (await import(/* @vite-ignore */ MATCHER_PATH)) as Matcher;
const NORMALIZE_PATH = "../../node_modules/@gotgenes/pi-permission-system/src/policy/normalize";
const MANAGER_PATH =
  "../../node_modules/@gotgenes/pi-permission-system/src/policy/permission-manager";
const { expandDirectionalSugar } = (await import(/* @vite-ignore */ NORMALIZE_PATH)) as {
  expandDirectionalSugar: (permission: Record<string, unknown>) => Record<string, unknown>;
};

/** The decision the extension reaches on one directional path surface. */
function surfaceDecision(
  permission: Record<string, unknown>,
  surface: "path_read" | "path_write",
  target: string,
): string | undefined {
  const rules = expandDirectionalSugar(permission)[surface] as Record<string, string> | undefined;
  if (!rules) return undefined;
  return matcher.findCompiledWildcardMatch(
    matcher.compileWildcardPatternEntries(Object.entries(rules)),
    target,
  )?.state;
}

function autoEditDecision(
  command: string,
  env: Record<string, string | undefined> = {},
): string | undefined {
  const rules = Object.entries(autoEditBashRules(env));
  return matcher.findCompiledWildcardMatch(matcher.compileWildcardPatternEntries(rules), command)
    ?.state;
}

describe("Auto-edit live debugging rules", () => {
  const live = { SPOPI_CDP_PORT: "9340" };

  it("lets the model look at and click the SPOPI window on its own port", () => {
    for (const command of [
      "agent-browser --cdp 9340 snapshot -i",
      "agent-browser --cdp 9340 snapshot",
      "agent-browser --cdp 9340 click @e3",
      "agent-browser --cdp 9340 get text @e4",
      "agent-browser --cdp 9340 screenshot .pi/tmp/screens/live.png",
      "agent-browser --cdp 9340 tab list",
      "agent-browser --cdp 9340 reload",
    ]) {
      expect(autoEditDecision(command, live), command).toBe("allow");
    }
  });

  it("still asks for another port, navigation, page JavaScript, and risky flags", () => {
    for (const command of [
      "agent-browser --cdp 9222 snapshot -i",
      "agent-browser --cdp 9340 open https://example.com",
      "agent-browser --cdp 9340 back",
      "agent-browser --cdp 9340 eval document.cookie",
      "agent-browser --cdp 9340 click @e1 --profile Default",
      "agent-browser --cdp 9340 snapshot --init-script x.js",
    ]) {
      expect(autoEditDecision(command, live), command).toBe("ask");
    }
  });

  it("asks for every CDP command when live debugging is off", () => {
    expect(autoEditDecision("agent-browser --cdp 9340 snapshot -i")).toBe("ask");
  });

  it("marks a recipe stale when a SPOPI tool allow or the port changed", () => {
    const current = permissionRecipe("auto-edit", [], live).permission;
    expect(autoEditRecipeStale(current, live)).toBe(false);
    expect(autoEditRecipeStale(current, {})).toBe(true);
    expect(autoEditRecipeStale(current, { SPOPI_CDP_PORT: "9341" })).toBe(true);
    const plain = permissionRecipe("auto-edit", [], {}).permission;
    expect(autoEditRecipeStale(plain, {})).toBe(false);
    expect(autoEditRecipeStale({ ...plain, spopi_screenshot: undefined }, {})).toBe(true);
    expect(plain.spopi_ui_copy).toBe("allow");
    expect(autoEditRecipeStale({ ...plain, spopi_ui_copy: undefined }, {})).toBe(true);
  });
});

describe("agent-browser upgrade", () => {
  function bashDecision(mode: "ask" | "auto-edit" | "full", command: string) {
    const bash = permissionRecipe(mode).permission.bash as Record<string, string>;
    return matcher.findCompiledWildcardMatch(
      matcher.compileWildcardPatternEntries(Object.entries(bash)),
      command,
    )?.state;
  }

  it("denies upgrade in every mode and still asks before install in Auto-edit", () => {
    for (const mode of ["ask", "auto-edit", "full"] as const) {
      expect(bashDecision(mode, "agent-browser upgrade"), mode).toBe("deny");
    }
    expect(autoEditDecision("agent-browser install")).toBe("ask");
    expect(upgradeDenied(permissionRecipe("ask").permission)).toBe(true);
    expect(
      autoEditRecipeStale({ ...permissionRecipe("auto-edit").permission, bash: { "*": "ask" } }),
    ).toBe(true);
  });
});

describe("Auto-edit browser rules", () => {
  it("lets the model look at and click a local page", () => {
    for (const command of [
      "agent-browser open http://127.0.0.1:5173",
      "agent-browser open http://localhost:3000/settings",
      "agent-browser snapshot -i",
      "agent-browser screenshot .pi/tmp/screens/home.png",
      "agent-browser screenshot --annotate .pi/tmp/screens/home.png",
      "agent-browser click @e3",
      'agent-browser fill @e5 "hello"',
      "agent-browser set viewport 390 844",
      "agent-browser diff screenshot --baseline .pi/tmp/screens/home.png",
      "agent-browser errors",
      "agent-browser a11y",
      "agent-browser close",
    ]) {
      expect(autoEditDecision(command), command).toBe("allow");
    }
  });

  it("asks before another site, page JavaScript, or a real profile", () => {
    for (const command of [
      "agent-browser open https://example.com",
      "agent-browser open http://localhost:1@example.com/",
      "agent-browser open http://127.0.0.1.example.com/",
      "agent-browser eval document.cookie",
      "agent-browser read https://example.com",
      "agent-browser upload @e1 ~/.ssh/id_ed25519",
      "agent-browser wait --fn fetch('https://example.com')",
      "agent-browser snapshot --profile Default",
      "agent-browser --cdp 9222 snapshot -i",
      "agent-browser cookies get",
      "agent-browser a11y https://example.com",
      "npm test",
    ]) {
      expect(autoEditDecision(command), command).toBe("ask");
    }
  });
});

describe("permission recipes", () => {
  it("writes protected roots as plain drive paths, including the extension mirror", () => {
    expect(denyRoot("\\\\?\\C:\\Users\\a b\\SPOPI\\public\\")).toBe("C:/Users/a b/SPOPI/public");
    expect(denyRoot("\\\\?\\UNC\\server\\share\\SPOPI")).toBe("//server/share/SPOPI");
    expect(denyRoot("D:\\SPOPI")).toBe("D:/SPOPI");
    expect(denyRoot("D:\\work\\SPOPI\\src-tauri\\..")).toBe("D:/work/SPOPI");
    const previousMirror = process.env.SPOPI_EXTENSIONS_MIRROR;
    process.env.SPOPI_EXTENSIONS_MIRROR = "C:\\Users\\a\\AppData\\Local\\Temp\\spopi-ext\\0.7.0";
    const path = permissionRecipe("ask").permission.path_write as Record<string, string>;
    expect(path["C:/Users/a/AppData/Local/Temp/spopi-ext/0.7.0/*"]).toBe("deny");
    if (previousMirror === undefined) delete process.env.SPOPI_EXTENSIONS_MIRROR;
    else process.env.SPOPI_EXTENSIONS_MIRROR = previousMirror;
  });

  it("denies a write into the install folder, which the old //?/ patterns never matched", () => {
    const target = "C:/Users/a b/AppData/Local/Programs/SPOPI/public/app/app.js";
    const decide = (rules: Record<string, string>) =>
      matcher.findCompiledWildcardMatch(
        matcher.compileWildcardPatternEntries(Object.entries(rules)),
        target,
      )?.state;
    const path = permissionRecipe("auto-edit", [
      "\\\\?\\C:\\Users\\a b\\AppData\\Local\\Programs\\SPOPI",
    ]).permission.path_write as Record<string, string>;
    expect(decide(path)).toBe("deny");
    expect(
      decide({
        "*": "allow",
        "//?/C:/Users/a b/AppData/Local/Programs/SPOPI/*": "deny",
      }),
    ).toBe("allow");
  });

  it("rewrites a recipe whose protected roots never matched", async () => {
    mkdirSync(dirname(permissionConfigPath()), { recursive: true });
    writeFileSync(
      permissionConfigPath(),
      JSON.stringify({
        permission: { "*": "allow", bash: { "*": "allow" }, path: { "//?/D:/SPOPI": "deny" } },
      }),
    );
    const roots = protectedRoots();
    expect(
      rootDeniesMissing(JSON.parse(readFileSync(permissionConfigPath(), "utf8")).permission, roots),
    ).toBe(true);
    await handlers.get_permission_mode({ ui: { setStatus: vi.fn() } }, {});
    const path = writtenPermission().path_write as Record<string, string>;
    expect(path["D:/SPOPI"]).toBe("deny");
    expect(path["//?/D:/SPOPI"]).toBeUndefined();
    expect(writtenPermission().path).toBeUndefined();
    expect(writtenPermission()["*"]).toBe("allow");
  });

  it("puts write denies for protected roots in every mode", () => {
    const roots = protectedRoots();
    expect(roots).toContain("D:/SPOPI");
    expect(roots).toContain("D:/SPOPI/public");
    for (const mode of ["ask", "auto-edit", "full"] as const) {
      const path = permissionRecipe(mode, roots).permission.path_write as Record<string, string>;
      expect(path["D:/SPOPI"]).toBe("deny");
      expect(path["D:/SPOPI/*"]).toBe("deny");
      expect(path["D:/SPOPI/public"]).toBe("deny");
      expect(path["D:/SPOPI/public/*"]).toBe("deny");
    }
  });

  it("lets Pi read the shipped UI and install skills but never write them", () => {
    const shipped = "D:/SPOPI/public/app/theme/themes.js";
    const skill = "D:/SPOPI/resources/skills/spopi-customize/SKILL.md";
    const expected = { ask: "ask", "auto-edit": "allow", full: undefined } as const;
    for (const mode of ["ask", "auto-edit", "full"] as const) {
      const { permission } = permissionRecipe(mode, protectedRoots());
      for (const target of [shipped, skill]) {
        expect(surfaceDecision(permission, "path_write", target), `${mode} write`).toBe("deny");
        expect(surfaceDecision(permission, "path_read", target), `${mode} read`).toBe(
          expected[mode],
        );
      }
    }
  });

  it("never asks at the skill gate, whose answer outlives a mode switch", async () => {
    const { PermissionManager } = (await import(/* @vite-ignore */ MANAGER_PATH)) as {
      PermissionManager: new (options: {
        agentDir: string;
      }) => {
        check: (intent: { kind: "tool"; surface: string; input: { name: string } }) => {
          state: string;
        };
      };
    };
    for (const mode of ["ask", "auto-edit", "full"] as const) {
      const { permission } = permissionRecipe(mode, protectedRoots());
      expect(skillReadsAsk(permission), mode).toBe(false);
      mkdirSync(dirname(permissionConfigPath()), { recursive: true });
      writeFileSync(permissionConfigPath(), JSON.stringify({ permission }));
      const manager = new PermissionManager({ agentDir: agentRoot() });
      const skill = { kind: "tool", surface: "skill", input: { name: "spopi-customize" } } as const;
      expect(manager.check(skill).state, mode).toBe("allow");
    }
  });

  it("rewrites a recipe that still asks for skill reads and keeps its mode", async () => {
    mkdirSync(dirname(permissionConfigPath()), { recursive: true });
    const { permission } = permissionRecipe("full", protectedRoots());
    const older = { ...permission, skill: undefined };
    writeFileSync(permissionConfigPath(), JSON.stringify({ permission: older }));
    expect(skillReadsAsk(JSON.parse(readFileSync(permissionConfigPath(), "utf8")).permission)).toBe(
      true,
    );
    await expect(
      handlers.get_permission_mode({ ui: { setStatus: vi.fn() } }, {}),
    ).resolves.toMatchObject({ data: { mode: "full" } });
    expect(writtenPermission().skill).toEqual({ "*": "allow" });
    expect(writtenPermission()["*"]).toBe("allow");
  });

  it("rewrites the older recipe that denied reads of protected roots", async () => {
    mkdirSync(dirname(permissionConfigPath()), { recursive: true });
    const older = { "*": "ask", path: { "*": "ask", "D:/SPOPI": "deny", "D:/SPOPI/*": "deny" } };
    writeFileSync(permissionConfigPath(), JSON.stringify({ permission: older }));
    expect(rootDeniesMissing(older, protectedRoots())).toBe(true);
    await handlers.get_permission_mode({ ui: { setStatus: vi.fn() } }, {});
    expect(writtenPermission().path).toEqual({ "*": "ask" });
    expect((writtenPermission().path_write as Record<string, string>)["D:/SPOPI/*"]).toBe("deny");
    expect(rootDeniesMissing(writtenPermission(), protectedRoots())).toBe(false);
  });

  it("writes Ask, Auto-edit, and Full access and reads the mode back", async () => {
    const setStatus = vi.fn();
    const ctx = { ui: { setStatus } };
    await expect(handlers.get_permission_mode(ctx, {})).resolves.toMatchObject({
      ok: true,
      data: { mode: "ask" },
    });
    expect(writtenPermission()["*"]).toBe("ask");
    expect((writtenPermission().path_write as Record<string, string>)["D:/SPOPI"]).toBe("deny");

    await handlers.set_permission_mode(ctx, { mode: "ask" });
    expect(writtenPermission()["*"]).toBe("ask");
    expect((writtenPermission().path as Record<string, string>)["*"]).toBe("ask");

    await handlers.set_permission_mode(ctx, { mode: "auto-edit" });
    const auto = writtenPermission();
    expect(auto.read).toBe("allow");
    expect(auto.edit).toBe("allow");
    expect(auto.write).toBe("allow");
    expect(auto.external_directory).toBe("ask");
    expect((auto.bash as Record<string, string>)["*"]).toBe("ask");
    expect((auto.path_write as Record<string, string>)["D:/SPOPI"]).toBe("deny");
    expect((auto.path_write as Record<string, string>)["*/agent-browser.json"]).toBe("ask");
    expect(auto.path).toEqual({ "*": "allow" });
    expect(auto.spopi_screenshot).toBe("allow");

    const withoutScreenshot = { ...auto, spopi_screenshot: undefined };
    writeFileSync(permissionConfigPath(), JSON.stringify({ permission: withoutScreenshot }));
    await handlers.get_permission_mode(ctx, {});
    expect(writtenPermission().spopi_screenshot).toBe("allow");

    await handlers.set_permission_mode(ctx, { mode: "full" });
    expect(writtenPermission()["*"]).toBe("allow");
    expect((writtenPermission().bash as Record<string, string>)["*"]).toBe("allow");
    expect(writtenPermission().read).toBeUndefined();
    await expect(handlers.get_permission_mode(ctx, {})).resolves.toMatchObject({
      data: { mode: "full" },
    });
    expect(setStatus).toHaveBeenCalledWith("pi-permission-system", "full");

    writeFileSync(
      permissionConfigPath(),
      JSON.stringify({ permission: { "*": "allow", path: { "D:/SPOPI": "deny" } } }),
    );
    await handlers.get_permission_mode(ctx, {});
    expect((writtenPermission().bash as Record<string, string>)["*"]).toBe("allow");
    await expect(handlers.set_permission_mode(ctx, { mode: "plan" })).resolves.toMatchObject({
      ok: false,
    });
  });
});
