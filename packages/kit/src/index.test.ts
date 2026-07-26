import { expect, it } from "vitest";
import { PACKAGE_NAME as CONTRACT_PACKAGE_NAME } from "@corpus/contract";
import { PACKAGE_NAME } from "./index";

it("exports the package name", () => {
  expect(PACKAGE_NAME).toBe("@corpus/kit");
});

it("resolves @corpus/contract through its package entry point", () => {
  expect(CONTRACT_PACKAGE_NAME).toBe("@corpus/contract");
});
