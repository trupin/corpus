import { expect, it } from "vitest";
import { ACTOR_HEADER } from "@corpus/contract";
import { PACKAGE_NAME } from "./index";

it("exports the package name", () => {
  expect(PACKAGE_NAME).toBe("@corpus/kit");
});

it("resolves @corpus/contract through its package entry point", () => {
  expect(ACTOR_HEADER).toBe("x-corpus-author");
});
