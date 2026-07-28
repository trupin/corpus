/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { DEV_PROBE_PATH, devRoutes } from "./devRoutes";

describe("devRoutes", () => {
  it("mounts the probe in a development build", () => {
    const route = devRoutes(true);
    expect(route).not.toBeNull();
    expect(route?.props).toMatchObject({ path: DEV_PROBE_PATH });
  });

  it("mounts nothing in a production build", () => {
    // `import.meta.env.DEV` is a compile-time constant, so a production bundle
    // drops both this branch and the probe component it would have rendered.
    expect(devRoutes(false)).toBeNull();
  });

  it("defaults to the build's own DEV flag", () => {
    expect(devRoutes()).not.toBeNull();
    expect(import.meta.env.DEV).toBe(true);
  });
});
