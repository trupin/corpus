import { expect, it } from "vitest";
import { PACKAGE_NAME as CONTRACT_PACKAGE_NAME } from "@corpus/contract";
import { PACKAGE_NAME, runCli } from "./index.js";

it("exports the package name", () => {
  expect(PACKAGE_NAME).toBe("@corpus/cli");
});

it("runCli returns the placeholder notice until CLI-001 lands", () => {
  expect(runCli()).toContain("CLI-001");
});

it("resolves @corpus/contract through its package entry point", () => {
  expect(CONTRACT_PACKAGE_NAME).toBe("@corpus/contract");
});
