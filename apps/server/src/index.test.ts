import { expect, it } from "vitest";
import { ACTOR_HEADER, contractRoutes } from "@corpus/contract";
import { PACKAGE_NAME } from "./index.js";

it("exports the package name", () => {
  expect(PACKAGE_NAME).toBe("@corpus/server");
});

// Guards the built exports map: this import resolves through
// @corpus/contract's package.json "exports" into its dist/, so a broken build
// or a broken exports map fails here rather than in production.
it("resolves @corpus/contract through its package entry point", () => {
  expect(ACTOR_HEADER).toBe("x-corpus-author");
  expect(contractRoutes.getHealth.path).toBe("/api/health");
});
