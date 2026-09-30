// ABOUTME: Tests that the bridge uses Pi's getAgentDir.
// ABOUTME: HOME and APPDATA must not choose a different agent folder.

import { mkdtempSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

const saved = {
  dir: process.env.PI_CODING_AGENT_DIR,
  home: process.env.HOME,
};

afterEach(() => {
  if (saved.dir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = saved.dir;
  if (saved.home === undefined) delete process.env.HOME;
  else process.env.HOME = saved.home;
});

describe("getAgentDir", () => {
  it("uses PI_CODING_AGENT_DIR before HOME", () => {
    const scratch = mkdtempSync(path.join(os.tmpdir(), "spopi-scratch-agent-"));
    process.env.PI_CODING_AGENT_DIR = scratch;
    process.env.HOME = path.join(os.tmpdir(), "spopi-other-home");
    expect(getAgentDir()).toBe(path.resolve(scratch));
  });

  it("expands a leading tilde with the real home directory", () => {
    process.env.PI_CODING_AGENT_DIR = "~/pi-scratch";
    expect(getAgentDir()).toBe(path.join(os.homedir(), "pi-scratch"));
  });

  it("ignores HOME when the variable is unset", () => {
    delete process.env.PI_CODING_AGENT_DIR;
    process.env.HOME = path.join(os.tmpdir(), "spopi-home-ignored");
    expect(getAgentDir()).toBe(path.join(os.homedir(), ".pi", "agent"));
  });
});
