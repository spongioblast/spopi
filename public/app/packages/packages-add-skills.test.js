// ABOUTME: Tests the opaque local Skills install tab state machine.
// ABOUTME: Verifies picker cancellation, scanning, selection, trust, and install payloads.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../i18n.js", () => ({
  onLocaleChange: () => () => {},
  t: (key, params) => {
    let value = key;
    if (params)
      for (const [name, item] of Object.entries(params))
        value = value.replace(`{${name}}`, String(item));
    return value;
  },
}));

import { mountSkillsInstallTab } from "./packages-add-skills.js";

const scan = {
  path: "D:/skills",
  tree: [
    {
      kind: "group",
      id: "group-1",
      name: "Group",
      children: [
        { kind: "skill", id: "skill-1", name: "One", description: "first" },
        { kind: "skill", id: "skill-2", name: "Two", description: "second" },
      ],
    },
  ],
  defaultSelection: [
    { kind: "skill", id: "skill-1" },
    { kind: "skill", id: "skill-2" },
  ],
};

function transport(overrides = {}) {
  return {
    pickSkillFolder: vi.fn().mockResolvedValue({ path: "D:/skills" }),
    scanSkillFolder: vi.fn().mockResolvedValue(scan),
    addSkillFolder: vi.fn().mockResolvedValue({
      addedEntries: ["./skills"],
      skippedEntries: [],
      reloaded: false,
    }),
    ...overrides,
  };
}

describe("skills install tab", () => {
  let container;
  beforeEach(() => {
    document.body.replaceChildren();
    const dialogs = document.createElement("div");
    dialogs.id = "dialog-container";
    dialogs.className = "hidden";
    document.body.append(dialogs);
    container = document.createElement("div");
  });

  it("returns to idle when the picker is cancelled", async () => {
    const client = transport({ pickSkillFolder: vi.fn().mockResolvedValue(null) });
    const tab = mountSkillsInstallTab({
      container,
      transport: client,
      isProjectTrusted: () => true,
    });
    await tab.activate();
    container.querySelector(".skills-install-choose").click();
    await vi.waitFor(() => expect(client.pickSkillFolder).toHaveBeenCalled());
    expect(client.scanSkillFolder).not.toHaveBeenCalled();
    expect(container.querySelector(".skills-install-tree")).toBeNull();
  });

  it("scans the picked folder and submits the selection", async () => {
    const client = transport();
    const tab = mountSkillsInstallTab({
      container,
      transport: client,
      isProjectTrusted: () => true,
    });
    await tab.activate();
    container.querySelector(".skills-install-choose").click();
    await vi.waitFor(() =>
      expect(container.querySelectorAll("[data-install-node]")).toHaveLength(3),
    );
    container.querySelector(".skills-install-review").click();
    expect(client.addSkillFolder).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.querySelector(".skills-install-confirm"));
    document
      .getElementById("dialog-container")
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector(".skills-install-confirm")).not.toBeNull();
    document.querySelector(".skills-install-confirm").click();
    await vi.waitFor(() => expect(client.addSkillFolder).toHaveBeenCalled());
    expect(client.addSkillFolder).toHaveBeenCalledWith({
      path: "D:/skills",
      scope: "global",
      selection: [
        { kind: "skill", id: "skill-1" },
        { kind: "skill", id: "skill-2" },
      ],
    });
  });

  it("says Pi reloaded and refreshes commands when the agent was idle", async () => {
    const client = transport({
      addSkillFolder: vi.fn().mockResolvedValue({
        addedEntries: ["./skills"],
        skippedEntries: [],
        reloaded: true,
      }),
    });
    const showSuccess = vi.fn();
    const onReloaded = vi.fn();
    const tab = mountSkillsInstallTab({
      container,
      transport: client,
      isProjectTrusted: () => true,
      showSuccess,
      onReloaded,
    });
    await tab.activate();
    container.querySelector(".skills-install-choose").click();
    await vi.waitFor(() =>
      expect(container.querySelector(".skills-install-review")).not.toBeNull(),
    );
    container.querySelector(".skills-install-review").click();
    document.querySelector(".skills-install-confirm").click();
    await vi.waitFor(() =>
      expect(showSuccess).toHaveBeenCalledWith("settings.installSkills.reloaded"),
    );
    expect(onReloaded).toHaveBeenCalled();
  });

  it("updates group selection and disables untrusted project scope", async () => {
    const client = transport();
    const tab = mountSkillsInstallTab({
      container,
      transport: client,
      isProjectTrusted: () => false,
    });
    await tab.activate();
    container.querySelector(".skills-install-choose").click();
    await vi.waitFor(() =>
      expect(container.querySelector("[data-install-node='group-1']")).not.toBeNull(),
    );
    expect(container.querySelector("[data-scope='project']").disabled).toBe(true);
    const groupInput = container.querySelector("[data-install-node='group-1'] input");
    groupInput.checked = false;
    groupInput.dispatchEvent(new Event("change"));
    expect(container.querySelector(".skills-install-review").disabled).toBe(true);
  });

  it("cancels confirmation without writing", async () => {
    const client = transport();
    const tab = mountSkillsInstallTab({
      container,
      transport: client,
      isProjectTrusted: () => true,
    });
    await tab.activate();
    container.querySelector(".skills-install-choose").click();
    await vi.waitFor(() =>
      expect(container.querySelector(".skills-install-review")).not.toBeNull(),
    );
    container.querySelector(".skills-install-review").click();
    expect(document.activeElement).toBe(document.querySelector(".skills-install-confirm"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(client.addSkillFolder).not.toHaveBeenCalled();
    expect(document.querySelector(".dialog")).toBeNull();
    expect(container.querySelector(".skills-install-review")).not.toBeNull();
  });

  it("renders a scan failure", async () => {
    const client = transport({
      scanSkillFolder: vi.fn().mockRejectedValue(new Error("scan exploded")),
    });
    const tab = mountSkillsInstallTab({
      container,
      transport: client,
      isProjectTrusted: () => true,
    });
    await tab.activate();
    container.querySelector(".skills-install-choose").click();
    await vi.waitFor(() => expect(container.textContent).toContain("scan exploded"));
  });

  it("says when a folder has no skills and lists the files Pi would skip", async () => {
    const client = transport({
      scanSkillFolder: vi.fn().mockResolvedValue({
        path: "D:/skills",
        tree: [],
        defaultSelection: [],
        diagnostics: [{ path: "D:/skills/hello/SKILL.md", message: "description is required" }],
      }),
    });
    const tab = mountSkillsInstallTab({
      container,
      transport: client,
      isProjectTrusted: () => true,
    });
    await tab.activate();
    container.querySelector(".skills-install-choose").click();
    await vi.waitFor(() =>
      expect(container.querySelector(".skills-install-empty")?.textContent).toBe(
        "settings.installSkills.noSkills",
      ),
    );
    expect(container.querySelector(".skills-install-diagnostics li")?.textContent).toBe(
      "hello/SKILL.md: description is required",
    );
    expect(container.querySelector(".skills-install-review")).toBeNull();
    expect(container.querySelector(".skills-scope-tabs")).toBeNull();
  });

  it("disables the choose button while scanning so scans cannot overlap", async () => {
    let resolveScan;
    const client = transport({
      scanSkillFolder: vi.fn(() => new Promise((r) => (resolveScan = r))),
    });
    const tab = mountSkillsInstallTab({
      container,
      transport: client,
      isProjectTrusted: () => true,
    });
    await tab.activate();
    const choose = () => container.querySelector(".skills-install-choose");
    choose().click();
    await vi.waitFor(() => expect(client.scanSkillFolder).toHaveBeenCalledTimes(1));
    // While scanning, the choose button is disabled, so a second click cannot
    // start an overlapping scan. This is the primary race guard; the monotonic
    // scanSeq counter inside chooseSource is defense-in-depth for any future
    // code path that reaches chooseSource without the button gate.
    expect(choose().disabled).toBe(true);
    choose().click(); // ignored — button is disabled
    expect(client.scanSkillFolder).toHaveBeenCalledTimes(1);
    resolveScan(scan);
    await vi.waitFor(() => expect(choose().disabled).toBe(false));
  });
});
