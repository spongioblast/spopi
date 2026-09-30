// ABOUTME: Tests host-UI capability frames.
// ABOUTME: Includes "parses only SPOPI".
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  capabilityLabel,
  commandUnsupportedCapabilityMessage,
  ExtensionCommandCompatibility,
  parseHostUiCapabilityFrame,
} from "./extension-command-compatibility.js";

const MCP = {
  name: "mcp",
  source: "extension",
  sourceInfo: { path: "/ext/pi-mcp-adapter/index.ts" },
};
const WEBSEARCH = {
  name: "websearch",
  source: "extension",
  sourceInfo: { path: "/ext/pi-web-access/index.ts" },
};

function report(capability) {
  return { message: JSON.stringify({ __spopiHostUi: { capability } }) };
}

function createStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

describe("host-UI capability frames", () => {
  it("parses only SPOPI's own capability envelope", () => {
    expect(
      parseHostUiCapabilityFrame(JSON.stringify({ __spopiHostUi: { capability: "setFooter" } })),
    ).toBe("setFooter");
    expect(parseHostUiCapabilityFrame("MCP: 3 servers enabled")).toBeNull();
    expect(parseHostUiCapabilityFrame('{"__spopiHostUi": broken')).toBeNull();
    expect(parseHostUiCapabilityFrame(JSON.stringify({ __spopiHostUi: {} }))).toBeNull();
  });

  it("names capabilities the way pi-gui does", () => {
    expect(capabilityLabel("custom")).toBe("custom UI");
    expect(capabilityLabel("onTerminalInput")).toBe("terminal input");
    expect(capabilityLabel("setEditorComponent")).toBe("custom editor UI");
    expect(capabilityLabel("setToolsExpanded")).toBe("set tools expanded");
    expect(commandUnsupportedCapabilityMessage("mcp", "custom")).toContain(
      "/mcp uses terminal-only custom UI",
    );
  });
});

describe("ExtensionCommandCompatibility", () => {
  let storage;
  let clock;

  beforeEach(() => {
    storage = createStorage();
    clock = 1_000;
  });

  function create(overrides = {}) {
    return new ExtensionCommandCompatibility({
      workspaceId: "ws-1",
      storage,
      now: () => clock,
      ...overrides,
    });
  }

  it("attributes a capability report to the command that was just submitted", () => {
    const onLearn = vi.fn();
    const store = create({ onLearn });

    store.beginCommand(MCP);
    expect(store.consumeNotify(report("setFooter"))).toBe(true);

    expect(store.get(MCP)).toMatchObject({
      commandName: "mcp",
      extensionPath: "/ext/pi-mcp-adapter/index.ts",
      status: "terminal-only",
      capability: "setFooter",
    });
    expect(onLearn).toHaveBeenCalledTimes(1);
    expect(onLearn.mock.calls[0][0].message).toContain("/mcp uses terminal-only footer UI");
  });

  it("swallows the frame but records nothing when no command is running", () => {
    const store = create();
    expect(store.consumeNotify(report("setHeader"))).toBe(true);
    expect(store.get(MCP)).toBeUndefined();
  });

  it("ignores a report that arrives long after the command was submitted", () => {
    const store = create();
    store.beginCommand(MCP);
    clock += 60_000;

    expect(store.consumeNotify(report("setFooter"))).toBe(true);
    expect(store.get(MCP)).toBeUndefined();
  });

  it("closes the attribution window when a plain prompt is sent", () => {
    const store = create();
    store.beginCommand(MCP);
    store.beginCommand(undefined);

    store.consumeNotify(report("setFooter"));
    expect(store.get(MCP)).toBeUndefined();
  });

  it("passes ordinary notifications through untouched", () => {
    const store = create();
    expect(store.consumeNotify({ message: "MCP: 3 servers enabled" })).toBe(false);
  });

  it("reports each capability once per command", () => {
    const onLearn = vi.fn();
    const store = create({ onLearn });

    store.beginCommand(MCP);
    store.consumeNotify(report("setFooter"));
    store.consumeNotify(report("setFooter"));

    expect(onLearn).toHaveBeenCalledTimes(1);
  });

  it("decorates only the commands it has learned about", () => {
    const store = create();
    store.beginCommand(MCP);
    store.consumeNotify(report("onTerminalInput"));

    const [mcp, websearch] = store.decorate([MCP, WEBSEARCH]);
    expect(mcp.compatibility.status).toBe("terminal-only");
    expect(websearch.compatibility).toBeUndefined();
  });

  it("remembers what it learned across a reload of the same workspace", () => {
    const store = create();
    store.beginCommand(MCP);
    store.consumeNotify(report("setFooter"));

    expect(create().get(MCP)?.capability).toBe("setFooter");
    // A different workspace starts with a clean slate.
    expect(create({ workspaceId: "ws-2" }).get(MCP)).toBeUndefined();
  });

  it("forgets commands pi no longer reports", () => {
    const store = create();
    store.beginCommand(MCP);
    store.consumeNotify(report("setFooter"));

    store.prune([WEBSEARCH]);
    expect(store.get(MCP)).toBeUndefined();
    expect(create().get(MCP)).toBeUndefined();
  });

  it("survives a storage that throws", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const store = create({ storage: hostile });
    store.beginCommand(MCP);

    expect(() => store.consumeNotify(report("setFooter"))).not.toThrow();
    expect(store.get(MCP)?.capability).toBe("setFooter");
  });
});
