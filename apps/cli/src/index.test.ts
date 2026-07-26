import { expect, it } from "vitest";
import { ACTOR_HEADER, contractRoutes } from "@corpus/contract";
import { createCorpusClient } from "@corpus/contract/client";
import { ExitCode, PACKAGE_NAME, registry, run, validateRegistry } from "./index.js";

it("exports the package name", () => {
  expect(PACKAGE_NAME).toBe("@corpus/cli");
});

it("exports the run loop, the registry and the validation entry point", () => {
  expect(typeof run).toBe("function");
  expect(validateRegistry(registry)).toBe(registry);
  expect(ExitCode.success).toBe(0);
});

it("resolves @corpus/contract through its package entry point", () => {
  expect(ACTOR_HEADER).toBe("x-corpus-author");
  expect(contractRoutes.getHealth.path).toBe("/api/health");
});

it("resolves the @corpus/contract/client subpath export", () => {
  expect(typeof createCorpusClient).toBe("function");
});
