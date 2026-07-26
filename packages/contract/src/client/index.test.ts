import { expect, it } from "vitest";
import { CLIENT_PACKAGE_PATH } from "./index.js";

it("exposes the client subpath placeholder", () => {
  expect(CLIENT_PACKAGE_PATH).toBe("@corpus/contract/client");
});
