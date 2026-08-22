import { describe, expect, expectTypeOf, it } from "vitest";
import type { Doc } from "@corpus/contract";
import { definePlugin } from "./index.js";
import type {
  ColumnComponentProps,
  DerivedDocDue,
  DerivedDocStatus,
  DocPanelProps,
  DocViewProps,
  ListItemProps,
  OpenPayload,
  OpenRequest,
  PluginManifest,
  RevealTarget,
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
      deriveStatus: (doc: Doc) => (doc.frontmatter.status === "archived" ? null : "open"),
      deriveDue: (doc: Doc) => (doc.frontmatter.status === "archived" ? null : { due: null }),
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

/**
 * UI-037's reveal seam, pinned at the type level. The point of the payload is
 * that it is **additive**: every plugin written against `onOpen(docId)` keeps
 * compiling, and a plugin that wants to point at something inside the document
 * passes one more field rather than reaching for a second callback.
 */
describe("the open payload", () => {
  const open = (_target: OpenPayload): void => undefined;

  it("accepts a bare document id — the call every existing plugin makes", () => {
    open("doc_a");
    expectTypeOf<string>().toExtend<OpenPayload>();
  });

  it("accepts a request with an item reveal, with and without disambiguation", () => {
    open({ docId: "doc_a", reveal: { kind: "item", exact: "Call the plumber" } });
    open({
      docId: "doc_a",
      reveal: { kind: "item", exact: "Call the plumber", prefix: "- [ ] ", suffix: " (tuesday)" },
    });
    expectTypeOf<{ docId: string; reveal: RevealTarget }>().toExtend<OpenRequest>();
  });

  it("accepts a request with a thread reveal", () => {
    open({ docId: "doc_a", reveal: { kind: "thread", threadId: "th_1" } });
  });

  it("rejects a reveal that is neither kind, and a kind missing its payload", () => {
    // @ts-expect-error — `kind` is the discriminant; "anchor" is not one of them
    open({ docId: "doc_a", reveal: { kind: "anchor", exact: "x" } });
    // @ts-expect-error — an item reveal without the text to find
    open({ docId: "doc_a", reveal: { kind: "item" } });
    // @ts-expect-error — a thread reveal quoting text instead of naming a thread
    open({ docId: "doc_a", reveal: { kind: "thread", exact: "x" } });
    // @ts-expect-error — a reveal is not an open: the document is still required
    open({ reveal: { kind: "thread", threadId: "th_1" } });
  });

  it("keeps a plugin `Component` assignable when it only ever opens by id", () => {
    const Column = (props: ColumnComponentProps) => props.onOpen?.("doc_a") ?? null;
    expectTypeOf(Column).parameter(0).toExtend<ColumnComponentProps>();
  });
});

/**
 * PLUGINS-016 — the derived-status declaration (SPEC.md §12, rider signed
 * 2026-08-12). The type pins the rider's own bound: the derivation chooses
 * between `open` and `resolved` and nothing else, with `null` meaning "does
 * not apply — the stored value stands".
 */
describe("deriveStatus", () => {
  it("admits open, resolved, and null — the does-not-apply fallback", () => {
    definePlugin({
      id: "p",
      name: "P",
      docTypes: [{ type: "t", deriveStatus: () => "open" }],
      columns: [],
    });
    definePlugin({
      id: "p",
      name: "P",
      docTypes: [{ type: "t", deriveStatus: () => "resolved" }],
      columns: [],
    });
    definePlugin({
      id: "p",
      name: "P",
      docTypes: [{ type: "t", deriveStatus: () => null }],
      columns: [],
    });
  });

  it("rejects archived — it is not a claim about content, and is never derived", () => {
    expectTypeOf<"archived">().not.toExtend<DerivedDocStatus>();
    definePlugin({
      id: "p",
      name: "P",
      // @ts-expect-error — the derivation may not choose `archived` (SPEC.md §12)
      docTypes: [{ type: "t", deriveStatus: () => "archived" }],
      columns: [],
    });
  });

  it("stays optional — a type without it has a status somebody sets", () => {
    expectTypeOf<"open" | "resolved">().toExtend<DerivedDocStatus>();
    definePlugin({ id: "p", name: "P", docTypes: [{ type: "t" }], columns: [] });
  });
});

/**
 * PLUGINS-018 — the derived-`due` declaration, the same seam one field over.
 * The type pins the distinction the whole issue turns on: a due date has three
 * answers, and the middle one — "the derivation applies and there is no
 * deadline" — is the one a bare `string | null` could not say.
 */
describe("deriveDue", () => {
  it("admits a date, a null date, and the does-not-apply fallback", () => {
    definePlugin({
      id: "p",
      name: "P",
      docTypes: [{ type: "t", deriveDue: () => ({ due: "2026-08-04" }) }],
      columns: [],
    });
    definePlugin({
      id: "p",
      name: "P",
      docTypes: [{ type: "t", deriveDue: () => ({ due: null }) }],
      columns: [],
    });
    definePlugin({
      id: "p",
      name: "P",
      docTypes: [{ type: "t", deriveDue: () => null }],
      columns: [],
    });
  });

  it("keeps `no deadline` and `does not apply` distinguishable — they are different types", () => {
    expectTypeOf<DerivedDocDue>().toEqualTypeOf<{ readonly due: string | null }>();
    expectTypeOf<null>().not.toExtend<DerivedDocDue>();
  });

  it("rejects a bare date — the wrapper is what carries the third answer", () => {
    definePlugin({
      id: "p",
      name: "P",
      // @ts-expect-error — a derivation answers `{ due }`, never a bare string
      docTypes: [{ type: "t", deriveDue: () => "2026-08-04" }],
      columns: [],
    });
  });

  it("stays optional — a type without it has a due date somebody sets", () => {
    definePlugin({ id: "p", name: "P", docTypes: [{ type: "t" }], columns: [] });
  });
});

describe("definePlugin", () => {
  it("returns its argument by reference — an identity for type inference only", () => {
    expect(definePlugin(minimal)).toBe(minimal);
    expect(definePlugin(full)).toBe(full);
  });
});
