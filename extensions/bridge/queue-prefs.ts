// ABOUTME: steeringMode and followUpMode in Pi settings.json.
// ABOUTME: The live session is updated separately through RPC.

import { agentConfigPath, asString } from "./paths";
import { readSettingsRecord, updateSettingsObject } from "./settings-io";

const MODES = ["all", "one-at-a-time"] as const;

type QueueMode = (typeof MODES)[number];

function modeOf(value: unknown): QueueMode {
  return value === "all" ? "all" : "one-at-a-time";
}

export function readQueueModes() {
  const settings = readSettingsRecord(agentConfigPath());
  return {
    steeringMode: modeOf(settings.steeringMode),
    followUpMode: modeOf(settings.followUpMode),
    path: agentConfigPath(),
  };
}

export function writeQueueMode(kind: unknown, mode: unknown) {
  const key = asString(kind) === "followUp" ? "followUpMode" : "steeringMode";
  if (asString(kind) !== "followUp" && asString(kind) !== "steering") {
    throw new Error("kind must be steering or followUp");
  }
  if (!MODES.includes(mode as QueueMode)) throw new Error("mode must be all or one-at-a-time");
  updateSettingsObject(agentConfigPath(), (settings) => {
    settings[key] = mode;
  });
  return { kind: asString(kind), mode, path: agentConfigPath() };
}
