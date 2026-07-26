import { expect, it } from "vitest";
import { PACKAGE_NAME as CONTRACT_PACKAGE_NAME } from "@corpus/contract";
import { PACKAGE_NAME } from "./index.js";

it("exports the package name", () => {
  expect(PACKAGE_NAME).toBe("@corpus/server");
});

// Guards the built exports map: this import resolves through
// @corpus/contract's package.json "exports" into its dist/, so a broken build
// or a broken exports map fails here rather than in production.
it("resolves @corpus/contract through its package entry point", () => {
  expect(CONTRACT_PACKAGE_NAME).toBe("@corpus/contract");
});
