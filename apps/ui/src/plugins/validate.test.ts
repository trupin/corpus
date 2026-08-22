import { describe, expect, it } from "vitest";
import { validateManifest } from "./validate";

const component = (): null => null;

const valid = {
  id: "fixture",
  name: "Fixture",
  docTypes: [{ type: "fixture-note", View: component }],
  columns: [{ type: "sample", label: "Samples", Component: component }],
};

describe("validateManifest", () => {
  it("passes a valid manifest and returns it by reference", () => {
    const result = validateManifest(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest).toBe(valid);
  });

  it("passes a minimal manifest — empty docTypes and columns", () => {
    expect(validateManifest({ id: "p", name: "P", docTypes: [], columns: [] }).ok).toBe(true);
  });

  it("fails a missing id, naming the field", () => {
    const result = validateManifest({ name: "P", docTypes: [], columns: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("id");
  });

  it("fails a non-array docTypes, naming the field", () => {
    const result = validateManifest({ id: "p", name: "P", docTypes: "todo", columns: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("docTypes");
  });

  it("fails a duplicate type within one manifest's docTypes", () => {
    const result = validateManifest({
      id: "p",
      name: "P",
      docTypes: [{ type: "todo" }, { type: "todo" }],
      columns: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('docTypes declares the type "todo" twice');
  });

  it("fails a duplicate type within one manifest's columns", () => {
    const result = validateManifest({
      id: "p",
      name: "P",
      docTypes: [],
      columns: [
        { type: "board", label: "A", Component: component },
        { type: "board", label: "B", Component: component },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('columns declares the type "board" twice');
  });

  it("passes a docType declaring deriveStatus as a function (PLUGINS-016)", () => {
    const manifest = {
      id: "p",
      name: "P",
      docTypes: [{ type: "todo", deriveStatus: () => null }],
      columns: [],
    };
    const result = validateManifest(manifest);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest).toBe(manifest);
  });

  it("fails a deriveStatus that is not a function — the discovery-side refusal", () => {
    // `derivedStatus: true` is the types.yaml spelling; in the manifest the
    // declaration IS the function, so a bare flag here is a broken manifest
    // and the whole plugin is skipped with a warning, never loaded halfway.
    const result = validateManifest({
      id: "p",
      name: "P",
      docTypes: [{ type: "todo", deriveStatus: true }],
      columns: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("deriveStatus must be a function");
  });

  it("passes a docType declaring deriveDue as a function (PLUGINS-018)", () => {
    const manifest = {
      id: "p",
      name: "P",
      docTypes: [{ type: "todo", deriveDue: () => ({ due: null }) }],
      columns: [],
    };
    const result = validateManifest(manifest);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest).toBe(manifest);
  });

  it("fails a deriveDue that is not a function — every member of the seam, or none", () => {
    // `deriveStatus` and `deriveDue` are one seam with one member per core
    // field. A manifest checked on one member and not the other loads halfway:
    // `dueLock` would read a declaration off `deriveDue: "x"` and lock the
    // control, and nothing would ever be able to call it.
    const result = validateManifest({
      id: "p",
      name: "P",
      docTypes: [{ type: "todo", deriveDue: "x" }],
      columns: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("deriveDue must be a function");
  });

  it("fails a component field that is not a function, naming the field", () => {
    const result = validateManifest({
      id: "p",
      name: "P",
      docTypes: [{ type: "todo", View: "not-a-component" }],
      columns: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("View");
  });

  it("never throws — a hostile value becomes {ok: false}", () => {
    for (const value of [null, undefined, 42, "manifest", [], { id: 1 }]) {
      expect(validateManifest(value).ok).toBe(false);
    }
  });
});
