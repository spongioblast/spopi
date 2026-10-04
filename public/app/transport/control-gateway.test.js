// ABOUTME: Tests HostControlGateway.
// ABOUTME: Includes "lists configured pi packages via a host_request".
import { describe, expect, it } from "vitest";
import { HostControlGateway } from "./control-gateway.js";
import { createInMemoryRuntimeAdapter } from "./runtime-gateway.js";

describe("HostControlGateway", () => {
  it("lists configured pi packages via a host_request", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const response = control.listPiPackages();
    const sent = adapter.takeSent();
    expect(sent).toMatchObject({ type: "host_request", operation: "list_pi_packages" });
    adapter.receive({
      type: "host_response",
      requestId: sent.requestId,
      operation: "list_pi_packages",
      packages: ["npm:pi-web-access"],
    });
    await expect(response).resolves.toEqual(["npm:pi-web-access"]);
  });

  it("checks pi package updates with the workspace scope", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const response = control.checkPiPackageUpdates("ws-1");
    const sent = adapter.takeSent();
    expect(sent).toMatchObject({
      type: "host_request",
      operation: "check_pi_package_updates",
      workspaceId: "ws-1",
    });
    adapter.receive({
      type: "host_response",
      requestId: sent.requestId,
      operation: "check_pi_package_updates",
      updates: [{ source: "npm:foo", scope: "global", available: true }],
    });
    await expect(response).resolves.toEqual([
      { source: "npm:foo", scope: "global", available: true },
    ]);
  });

  it("loads the community catalog through the host", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const pending = control.browsePiPackages();
    const frame = adapter.takeSent();
    expect(frame).toMatchObject({ type: "host_request", operation: "browse_pi_packages" });
    adapter.receive({
      type: "host_response",
      requestId: frame.requestId,
      packages: [{ name: "pi-lens" }],
      stale: true,
      cachedAt: 10,
    });
    await expect(pending).resolves.toEqual({
      packages: [{ name: "pi-lens" }],
      stale: true,
      cachedAt: 10,
    });
  });

  it("sends the source with install/remove requests", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const install = control.installPiPackage("npm:foo");
    const installFrame = adapter.takeSent();
    expect(installFrame).toMatchObject({
      type: "host_request",
      operation: "install_pi_package",
      source: "npm:foo",
    });
    adapter.receive({ type: "host_response", requestId: installFrame.requestId, ok: true });
    await expect(install).resolves.toBeUndefined();

    const remove = control.removePiPackage("npm:foo");
    const removeFrame = adapter.takeSent();
    expect(removeFrame).toMatchObject({ operation: "remove_pi_package", source: "npm:foo" });
    adapter.receive({ type: "host_response", requestId: removeFrame.requestId, ok: true });
    await expect(remove).resolves.toBeUndefined();
  });

  it("lists, adds, and removes MCP servers and passes the host error through", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const listed = control.listMcpServers({ workspaceId: "ws-1" });
    const listFrame = adapter.takeSent();
    expect(listFrame).toMatchObject({ operation: "list_mcp_servers", workspaceId: "ws-1" });
    adapter.receive({
      type: "host_response",
      requestId: listFrame.requestId,
      list: { servers: [{ name: "echo" }], errors: [] },
    });
    await expect(listed).resolves.toEqual({
      list: { servers: [{ name: "echo" }], errors: [] },
    });

    const added = control.addMcpServer({ name: "echo", kind: "stdio" }, { workspaceId: "ws-1" });
    const addFrame = adapter.takeSent();
    expect(addFrame).toMatchObject({
      operation: "add_mcp_server",
      workspaceId: "ws-1",
      spec: { name: "echo", kind: "stdio" },
    });
    adapter.receive({
      type: "host_response",
      requestId: addFrame.requestId,
      error: { message: "--env expects KEY=VALUE" },
    });
    await expect(added).rejects.toThrow("--env expects KEY=VALUE");

    const removed = control.removeMcpServer("echo", "project", { workspaceId: "ws-1" });
    const removeFrame = adapter.takeSent();
    expect(removeFrame).toMatchObject({
      operation: "remove_mcp_server",
      name: "echo",
      scope: "project",
    });
    adapter.receive({ type: "host_response", requestId: removeFrame.requestId, ok: true });
    await expect(removed).resolves.toBeUndefined();
  });

  it("rejects the request when the host returns an error", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const response = control.installPiPackage("npm:bad");
    const sent = adapter.takeSent();
    adapter.receive({
      type: "host_response",
      requestId: sent.requestId,
      error: { message: "npm is not installed" },
    });
    await expect(response).rejects.toThrow("npm is not installed");
  });

  it("passes the local (project scope) flag on install/remove", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const install = control.installPiPackage("npm:foo", { local: true });
    const installFrame = adapter.takeSent();
    expect(installFrame).toMatchObject({
      operation: "install_pi_package",
      source: "npm:foo",
      local: true,
    });
    adapter.receive({ type: "host_response", requestId: installFrame.requestId, ok: true });
    await expect(install).resolves.toBeUndefined();

    const remove = control.removePiPackage("npm:foo", { local: true });
    const removeFrame = adapter.takeSent();
    expect(removeFrame).toMatchObject({
      operation: "remove_pi_package",
      source: "npm:foo",
      local: true,
    });
    adapter.receive({ type: "host_response", requestId: removeFrame.requestId, ok: true });
    await expect(remove).resolves.toBeUndefined();
  });

  it("sends the source for an update request", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const response = control.updatePiPackage("npm:foo");
    const sent = adapter.takeSent();
    expect(sent).toMatchObject({
      type: "host_request",
      operation: "update_pi_package",
      source: "npm:foo",
    });
    adapter.receive({ type: "host_response", requestId: sent.requestId, ok: true });
    await expect(response).resolves.toBeUndefined();
  });

  it("returns the folder the user picked", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const response = control.pickSkillFolder("ws-1");
    const sent = adapter.takeSent();
    expect(sent).toMatchObject({
      type: "host_request",
      operation: "pick_skill_folder",
      workspaceId: "ws-1",
    });
    adapter.receive({
      type: "host_response",
      requestId: sent.requestId,
      operation: "pick_skill_folder",
      path: "D:/skills",
    });
    await expect(response).resolves.toEqual({ path: "D:/skills" });
  });

  it("returns a null path when the folder picker is cancelled", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const response = control.pickSkillFolder();
    const sent = adapter.takeSent();
    adapter.receive({
      type: "host_response",
      requestId: sent.requestId,
      operation: "pick_skill_folder",
      path: null,
    });
    await expect(response).resolves.toEqual({ path: null });
  });

  it("returns the new instance id after a runtime restart", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const response = control.restartRuntime("ws-1", "s-1");
    const sent = adapter.takeSent();
    expect(sent).toMatchObject({
      type: "host_request",
      operation: "restart_runtime",
      workspaceId: "ws-1",
      sessionId: "s-1",
    });
    adapter.receive({
      type: "host_response",
      requestId: sent.requestId,
      operation: "restart_runtime",
      instanceId: "instance-new",
    });
    await expect(response).resolves.toBe("instance-new");
  });

  it("resolves a project path to a workspace id", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const response = control.resolveWorkspace("/tmp/project");
    const sent = adapter.takeSent();
    expect(sent).toMatchObject({
      type: "host_request",
      operation: "resolve_workspace",
      projectPath: "/tmp/project",
    });
    adapter.receive({
      type: "host_response",
      requestId: sent.requestId,
      workspaceId: "workspace-a",
    });
    await expect(response).resolves.toBe("workspace-a");
  });

  it("opens a path with the desktop's default app", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const response = control.openPath("/tmp/spopi/README.md");
    const sent = adapter.takeSent();
    expect(sent).toMatchObject({
      type: "host_request",
      operation: "open_path",
      path: "/tmp/spopi/README.md",
    });
    adapter.receive({ type: "host_response", requestId: sent.requestId, ok: true });
    await expect(response).resolves.toBeUndefined();
  });

  it("reveals a workspace-relative path in the file manager", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const response = control.revealPath("src/app.js", { workspaceId: "ws-1" });
    const sent = adapter.takeSent();
    expect(sent).toMatchObject({
      type: "host_request",
      operation: "reveal_path",
      path: "src/app.js",
      workspaceId: "ws-1",
    });
    adapter.receive({ type: "host_response", requestId: sent.requestId, ok: true });
    await expect(response).resolves.toBeUndefined();
  });

  it("deletes sessions by id and normalizes the deleted/errors arrays", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const response = control.deleteSessions(["s-1", "s-2"]);
    const sent = adapter.takeSent();
    expect(sent).toMatchObject({
      type: "host_request",
      operation: "delete_sessions",
      sessionIds: ["s-1", "s-2"],
    });
    adapter.receive({
      type: "host_response",
      requestId: sent.requestId,
      operation: "delete_sessions",
      deleted: ["s-1"],
      errors: ["s-2"],
    });
    await expect(response).resolves.toEqual({ deleted: ["s-1"], errors: ["s-2"] });
  });

  it("rejects pending requests on disconnect", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const control = new HostControlGateway(adapter);
    const response = control.openExternal("https://example.com");
    adapter.disconnect();
    await expect(response).rejects.toThrow("disconnected");
  });
});
