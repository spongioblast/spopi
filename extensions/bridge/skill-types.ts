// ABOUTME: Skill inventory types shared by discovery, rules, and the settings page.
// ABOUTME: Scope stays "global" or "project"; discovery roots still say "user" internally.

export type SkillScope = "global" | "project";

export type SkillTarget = { kind: "group" | "skill"; id: string };

export type SkillStatus = "enabled" | "disabled" | "shadowed" | "invalid";

export type SkillInventoryItem = {
  kind: "skill";
  id: string;
  canonicalPath: string;
  name: string;
  description: string;
  enabled: boolean;
  status: SkillStatus;
  ruleBaseDir: string;
  ruleRelativeDir: string;
  /** skill dir relative to its sourceRoot dir, used to place it in the tree */
  treePath: string;
  sourceRoot: string;
  scope: "user" | "project";
  source: "auto" | "local";
  matchingRules: string[];
  ambiguous: boolean;
  shadowedBy?: { id: string; canonicalPath: string; name: string };
};

export type SkillGroupNode = {
  kind: "group";
  id: string;
  sourceRoot: string;
  ruleBaseDir: string;
  /** path relative to Pi's resource base, used to generate `!`/`+`/`-` rules */
  ruleBaseRelativePath: string;
  /** final path segment, used for sorting and display */
  name: string;
  scope: "user" | "project";
  source: "auto" | "local";
  state: "all-on" | "all-off" | "mixed";
  ambiguous: boolean;
  children: SkillChild[];
};

export type SkillChild = SkillInventoryItem | SkillGroupNode;

export type SkillRootKind = "pi" | "agents" | "configured";

export type SkillRoot = {
  sourceRoot: string;
  ruleBaseDir: string;
  scope: "user" | "project";
  source: "auto" | "local";
  rootKind?: SkillRootKind;
  children: SkillChild[];
};

export type SkillDiagnostic = { path?: string; message: string };

export type SkillInventory = {
  scope: SkillScope;
  settingsPath: string;
  trusted: boolean;
  roots: SkillRoot[];
  customRules: string[];
  discoveredRoots: string[];
  diagnostics: SkillDiagnostic[];
};

export type SkillMutationResult = {
  inventory: SkillInventory;
  runtimeRestartRequired: true;
};

export type BuildSkillInventoryOptions = {
  scope: SkillScope;
  cwd: string;
  agentDir: string;
  homeDir?: string;
  projectTrusted?: boolean;
};

export type MutateSkillEnabledOptions = {
  scope: SkillScope;
  cwd: string;
  agentDir: string;
  homeDir?: string;
  projectTrusted?: boolean;
  target: SkillTarget;
  enabled: boolean;
};

export type DiscoveredRoot = {
  dir: string;
  mode: "pi" | "agents";
  baseDir: string;
  scope: "user" | "project";
  source: "auto" | "local";
};

export type RawSkill = {
  canonicalPath: string;
  filePath: string;
  name: string;
  description: string;
  disableModelInvocation: boolean;
  isConfiguredFile: boolean;
  root: DiscoveredRoot;
};
