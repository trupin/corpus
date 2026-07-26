import { expect, it } from "vitest";
import { ACTOR_HEADER, contractRoutes } from "@corpus/contract";
import { createCorpusClient } from "@corpus/contract/client";
import { PACKAGE_NAME, runCli } from "./index.js";

it("exports the package name", () => {
  expect(PACKAGE_NAME).toBe("@corpus/cli");
});

it("runCli returns the placeholder notice until CLI-001 lands", () => {
  expect(runCli()).toContain("CLI-001");
});

it("resolves @corpus/contract through its package entry point", () => {
  expect(ACTOR_HEADER).toBe("x-corpus-author");
  expect(contractRoutes.getHealth.path).toBe("/api/health");
});

it("resolves the @corpus/contract/client subpath export", () => {
  expect(typeof createCorpusClient).toBe("function");
});
