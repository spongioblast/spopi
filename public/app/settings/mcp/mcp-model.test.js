// ABOUTME: Tests MCP list grouping, name rules, and the secret warning.
// ABOUTME: Fixtures are real `pi mcp list --json` output.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clashingName,
  groupServers,
  isHttp,
  looksLikeToken,
  rowState,
  validServerName,
} from "./mcp-model.js";

const mixed = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/pi-cli/mcp-list-mixed.json"), "utf8"),
);
const empty = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/pi-cli/mcp-list-empty.json"), "utf8"),
);

describe("mcp model", () => {
  it("groups the captured list and the empty list", () => {
    const grouped = groupServers(mixed);
    expect(grouped.global.map((server) => server.name)).toEqual([
      "echo",
      "broken",
      "remote",
      "off",
    ]);
    expect(grouped.errors).toHaveLength(1);
    expect(groupServers(empty).global).toEqual([]);
    expect(rowState(grouped.global[0]).dot).toBe("ok");
    expect(rowState(grouped.global[2]).dot).toBe("warn");
    expect(rowState(grouped.global[1]).dot).toBe("error");
    expect(rowState(grouped.global[3]).dot).toBe("off");
    expect(isHttp(grouped.global[2])).toBe(true);
    expect(isHttp(grouped.global[0])).toBe(false);
  });

  it("keeps Pi's project override on the global server it changes", () => {
    const [echo, broken] = groupServers(mixed).global;
    expect(echo.override).toBe("C:\\Users\\me\\code\\app\\.pi\\mcp.json");
    expect(echo.exposure).toBe("direct");
    expect(broken.override).toBeUndefined();
  });

  it("blocks a dash/underscore clash and warns on a token", () => {
    expect(validServerName("echo")).toBe(true);
    expect(validServerName("bad name")).toBe(false);
    expect(clashingName("my-server", ["my_server"])).toBe("my_server");
    expect(looksLikeToken(`sk-${"a".repeat(20)}`)).toBe(true);
    expect(looksLikeToken("${" + "TOKEN}")).toBe(false);
  });
});
