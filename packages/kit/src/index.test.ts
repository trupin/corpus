import { expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

it("exports the package name", () => {
  expect(PACKAGE_NAME).toBe("@corpus/kit");
});
