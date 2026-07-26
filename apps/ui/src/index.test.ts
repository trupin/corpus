import { expect, it } from "vitest";
import { PACKAGE_NAME as CONTRACT_PACKAGE_NAME } from "@corpus/contract";
import { PACKAGE_NAME as KIT_PACKAGE_NAME } from "@corpus/kit";
import { PACKAGE_NAME } from "./index";

it("exports the package name", () => {
  expect(PACKAGE_NAME).toBe("@corpus/ui");
});

it("resolves @corpus/kit and @corpus/contract through their package entry points", () => {
  expect(KIT_PACKAGE_NAME).toBe("@corpus/kit");
  expect(CONTRACT_PACKAGE_NAME).toBe("@corpus/contract");
});
