import { describe, expect, it } from "vitest";
import { EMBEDDED_MODEL, manifestBytes, modelArtifacts } from "./manifest.js";

describe("EMBEDDED_MODEL", () => {
  it("pins every artifact to HTTPS, to a content-addressed revision, and to a sha256", () => {
    for (const artifact of modelArtifacts(EMBEDDED_MODEL)) {
      const url = new URL(artifact.url);
      expect(url.protocol).toBe("https:");
      // The revision, not a branch: `resolve/main/...` is a moving target.
      expect(url.pathname).toContain(EMBEDDED_MODEL.revision);
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.bytes).toBeGreaterThan(0);
    }
  });

  it("names a permissive licence, because the artifact is fetched onto a user's machine", () => {
    expect(EMBEDDED_MODEL.license).toBe("apache-2.0");
  });

  it("fetches the small artifact first, so a failure is cheap and early", () => {
    const [first, second] = modelArtifacts(EMBEDDED_MODEL);
    expect(first?.bytes).toBeLessThan(second?.bytes ?? 0);
    expect(manifestBytes(EMBEDDED_MODEL)).toBe((first?.bytes ?? 0) + (second?.bytes ?? 0));
  });

  it("keeps the sequence budget inside what the checkpoint was trained for", () => {
    expect(EMBEDDED_MODEL.maxTokens).toBeGreaterThan(2);
    expect(EMBEDDED_MODEL.maxTokens).toBeLessThanOrEqual(512);
  });
});
