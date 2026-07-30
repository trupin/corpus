import { describe, expect, expectTypeOf, it } from "vitest";
import type { Doc } from "@corpus/contract";
import { definePlugin } from "./index.js";
import type {
  ColumnComponentProps,
  DocPanelProps,
  DocViewProps,
  ListItemProps,
  PluginManifest,
} from "./types.js";

/**
 * The §10 manifest contract, pinned at the type level (sprint-012 TEST-76/77):
 * a minimal manifest and a fully-populated one both satisfy `PluginManifest`,
 * an unknown key is rejected, and `definePlugin` is an identity.
 */

const minimal = {
  id: "fixture",
  name: "Fixture",
  docTypes: [],
  columns: [],
} satisfies PluginManifest;

const full = {
  id: "fixture",
  name: "Fixture",
  icon: "▣",
  order: 5,
  docTypes: [
    {
      type: "fixture-note",
      View: (_props: DocViewProps) => null,
      ListItem: (_props: ListItemProps) => null,
      DocPanel: (_props: DocPanelProps) => null,
      validate: (_doc: Doc) => [],
    },
  ],
  columns: [
    {
      type: "sample",
      label: "Samples",
      icon: "▣",
      Component: (_props: ColumnComponentProps) => null,
      defaultQuery: { type: "fixture-note" },
    },
  ],
} satisfies PluginManifest;

describe("PluginManifest", () => {
  it("accepts a minimal manifest — id, name, empty arrays", () => {
    expectTypeOf(minimal).toExtend<PluginManifest>();
  });

  it("accepts a fully-populated manifest", () => {
    expectTypeOf(full).toExtend<PluginManifest>();
  });

  it("rejects a manifest with an unknown key", () => {
    // @ts-expect-error — excess property: `pages` is not part of the §10 contract
    definePlugin({ id: "p", name: "P", docTypes: [], columns: [], pages: [] });
    // @ts-expect-error — excess property inside a docTypes entry
    definePlugin({ id: "p", name: "P", docTypes: [{ type: "t", Header: null }], columns: [] });
  });

  it("requires id, name, docTypes and columns", () => {
    // @ts-expect-error — docTypes and columns are required (may be empty, never absent)
    definePlugin({ id: "p", name: "P" });
  });
});

describe("definePlugin", () => {
  it("returns its argument by reference — an identity for type inference only", () => {
    expect(definePlugin(minimal)).toBe(minimal);
    expect(definePlugin(full)).toBe(full);
  });
});
