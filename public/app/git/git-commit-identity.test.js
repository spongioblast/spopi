// ABOUTME: Tests the commit dialog's Git name and email form.
// ABOUTME: The values go to Git's config through the identity service.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginIdentityEdit,
  createIdentityState,
  identityProblem,
  isIdentityError,
  mountCommitIdentity,
} from "./git-commit-identity.js";

describe("git commit identity", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("detects Git's missing-author stderr", () => {
    expect(
      isIdentityError(
        "Author identity unknown\n*** Please tell me who you are.\n\ngit config --global user.email",
      ),
    ).toBe(true);
    expect(isIdentityError("unable to auto-detect email address")).toBe(true);
    expect(isIdentityError("hook says no")).toBe(false);
  });

  it("rejects an empty name or a spaced email", () => {
    expect(identityProblem({ name: "", email: "ada@example.com" })).toBeTruthy();
    expect(identityProblem({ name: "Ada", email: "ada at example.com" })).toBeTruthy();
    expect(identityProblem({ name: "Ada", email: "ada@example.com" })).toBe("");
  });

  it("shows the author line when Git already has a name", async () => {
    const service = {
      load: vi.fn(async () => ({
        name: "Ada Lovelace",
        email: "ada@example.com",
        global: { name: "Ada Lovelace", email: "ada@example.com" },
        repository: { name: "", email: "" },
      })),
      save: vi.fn(),
    };
    const state = createIdentityState();
    const { element, save } = mountCommitIdentity({ state, service });
    document.body.append(element);
    await vi.waitFor(() =>
      expect(element.querySelector(".git-identity-who-name")?.textContent).toBe("Ada Lovelace"),
    );
    expect(element.querySelector(".git-identity-who-email")?.textContent).toBe("ada@example.com");
    expect(element.classList.contains("is-form")).toBe(false);
    expect(await save()).toBe(true);
    expect(service.save).not.toHaveBeenCalled();
  });

  it("asks for a name when Git has none, then writes it", async () => {
    const service = {
      load: vi.fn(async () => ({
        name: "",
        email: "",
        global: { name: "", email: "" },
        repository: { name: "", email: "" },
      })),
      save: vi.fn(async ({ name, email, scope }) => ({
        name,
        email,
        global: scope === "global" ? { name, email } : { name: "", email: "" },
        repository: { name: "", email: "" },
      })),
    };
    const state = createIdentityState();
    const { element, save } = mountCommitIdentity({ state, service });
    document.body.append(element);
    await vi.waitFor(() => expect(element.querySelector(".git-identity-name")).not.toBeNull());
    expect(element.classList.contains("is-form")).toBe(true);
    expect(await save()).toBe(false);
    element.querySelector(".git-identity-name").value = "Ada";
    element.querySelector(".git-identity-name").dispatchEvent(new Event("input"));
    element.querySelector(".git-identity-email").value = "ada@example.com";
    element.querySelector(".git-identity-email").dispatchEvent(new Event("input"));
    expect(await save()).toBe(true);
    expect(service.save).toHaveBeenCalledWith({
      name: "Ada",
      email: "ada@example.com",
      scope: "global",
    });
    await vi.waitFor(() =>
      expect(element.querySelector(".git-identity-who-name")?.textContent).toBe("Ada"),
    );
  });

  it("Change opens the form without losing the current name", async () => {
    const service = {
      load: vi.fn(async () => ({
        name: "Ada",
        email: "ada@example.com",
        global: { name: "Ada", email: "ada@example.com" },
        repository: { name: "", email: "" },
      })),
      save: vi.fn(),
    };
    const state = createIdentityState();
    const { element } = mountCommitIdentity({ state, service });
    document.body.append(element);
    await vi.waitFor(() => expect(element.querySelector(".git-identity-change")).not.toBeNull());
    element.querySelector(".git-identity-change").click();
    expect(element.querySelector(".git-identity-name").value).toBe("Ada");
    expect(state.draft.scope).toBe("global");
    beginIdentityEdit(state);
    expect(state.editing).toBe(true);
  });
});
