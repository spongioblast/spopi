// ABOUTME: Tests the Windows Firewall row text for phone access.
// ABOUTME: Covers phone-firewall.js for the port, the allowed sources, and Windows block rules.

import { describe, expect, it } from "vitest";
import { firewallState } from "./phone-firewall.js";

describe("phone firewall row", () => {
  it("says what the firewall does for the chosen port", () => {
    expect(firewallState({ supported: false }, 57640)).toBeNull();
    expect(firewallState({ supported: true, rule: false, ports: [] }, 57640)?.button).toBe(
      "settings.phone.firewallAllow",
    );
    expect(firewallState({ supported: true, rule: true, ports: ["57640"] }, 57640)).toEqual({
      text: "settings.phone.firewallOk",
      button: "",
    });
    expect(firewallState({ supported: true, rule: true, ports: ["1234"] }, 57640)?.button).toBe(
      "settings.phone.firewallUpdate",
    );
    expect(
      firewallState({ supported: true, rule: true, ports: ["57640"], blocked: 2 }, 57640)?.text,
    ).toBe("settings.phone.firewallBlocked");
  });

  it("offers to update a rule that lets in other addresses than the allowed sources", () => {
    const rule = { supported: true, rule: true, ports: ["57640"], blocked: 0 };
    expect(
      firewallState({ ...rule, remote: ["127.0.0.1/32"] }, 57640, ["192.168.80.0/24"]),
    ).toEqual({
      text: "settings.phone.firewallOtherSources",
      button: "settings.phone.firewallUpdate",
    });
    expect(
      firewallState({ ...rule, remote: ["192.168.80.0/24"] }, 57640, ["192.168.80.57/24"])?.button,
    ).toBe("");
    expect(firewallState({ ...rule, remote: ["Any"] }, 57640, ["192.168.80.0/24"])?.button).toBe(
      "settings.phone.firewallUpdate",
    );
    expect(firewallState({ ...rule, remote: ["127.0.0.1/32"] }, 57640, ["bad"])?.button).toBe("");
    expect(firewallState(rule, 57640, ["192.168.80.0/24"])?.button).toBe("");
  });
});
