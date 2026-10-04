// ABOUTME: Tests MCP tool titles and names that are not MCP tools.
// ABOUTME: A server name that contains an underscore stays one server name.
import { describe, expect, it } from "vitest";
import { displayToolName } from "./tool-display-name.js";

describe("displayToolName", () => {
  it("titles an MCP tool as server / tool", () => {
    expect(displayToolName("mcp__echo__write_note")).toBe("echo / write_note");
  });

  it("keeps an underscore inside the server name", () => {
    expect(displayToolName("mcp__my_server__echo")).toBe("my_server / echo");
  });

  it("leaves other tools unchanged", () => {
    expect(displayToolName("bash")).toBe("bash");
    expect(displayToolName("read")).toBe("read");
  });
});
