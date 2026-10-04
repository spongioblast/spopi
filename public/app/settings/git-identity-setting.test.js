// ABOUTME: Tests the Settings row that reads and writes Git's name and email.
// ABOUTME: A save with both fields writes Git's config through the host.

import { afterEach, describe, expect, it, vi } from "vitest";
import { gitIdentityRow } from "./git-identity-setting.js";

describe("git identity setting", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("loads the computer-wide name and writes a change", async () => {
    const control = {
      getGitIdentity: vi.fn(async () => ({
        name: "Ada",
        email: "ada@example.com",
        global: { name: "Ada", email: "ada@example.com" },
        repository: null,
      })),
      setGitIdentity: vi.fn(async ({ name, email, scope }) => ({
        name,
        email,
        global: { name, email },
        repository: null,
        scope,
      })),
    };
    const row = gitIdentityRow({
      control,
      getWorkspaceId: () => "ws-1",
    });
    document.body.append(row);
    await vi.waitFor(() => expect(row.querySelector(".git-identity-name")?.value).toBe("Ada"));
    expect(row.querySelector(".git-identity-email").value).toBe("ada@example.com");
    expect(row.querySelector('input[value="repository"]').disabled).toBe(true);
    row.querySelector(".git-identity-name").value = "Ada Lovelace";
    row.querySelector(".git-identity-name").dispatchEvent(new Event("input"));
    row.querySelector("button").click();
    await vi.waitFor(() => expect(control.setGitIdentity).toHaveBeenCalled());
    expect(control.setGitIdentity).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      scope: "global",
    });
    expect(row.querySelector(".settings-git-identity-status").textContent).toMatch(/saved/i);
  });
});
