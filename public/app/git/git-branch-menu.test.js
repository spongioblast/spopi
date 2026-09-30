// ABOUTME: Tests git-branch-menu.
// ABOUTME: Includes "isSafeBranchName accepts locals and rejects options".
// ABOUTME: Branch name validation for checkout/create.

import { expect, test } from "vitest";
import { isSafeBranchName } from "./git-branch-menu.js";

test("isSafeBranchName accepts locals and rejects options", () => {
  expect(isSafeBranchName("main")).toBe(true);
  expect(isSafeBranchName("feature/topic")).toBe(true);
  expect(isSafeBranchName("-b")).toBe(false);
  expect(isSafeBranchName("a b")).toBe(false);
  expect(isSafeBranchName("../x")).toBe(false);
});
