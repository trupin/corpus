import { describe, expect, it } from "vitest";
import { deriveDue as deriveDueFromItems, deriveStatus } from "../items.js";
import { TODO_DOC_TYPE } from "../shared.js";
import derive, { deriveDue, deriveStatus as namedStatus } from "./derive.js";

/**
 * The non-UI derivation module (PLUGINS-016) — the thing the server imports
 * for a `derivedStatus: true` type. Its whole job is to be the same answer as
 * `items.ts`'s `deriveStatus` behind a discovery-shaped default export, so the
 * tests assert delegation and the one guard the wrapper adds.
 */
describe("server/derive", () => {
  it("default-exports a function — the discovery convention routes.ts follows", () => {
    expect(typeof derive).toBe("function");
  });

  it("derives for the todo type exactly as items.ts does", () => {
    const cases = [
      { body: "- [x] a\n", extra: undefined, status: "open" },
      { body: "- [ ] a\n", extra: undefined, status: "resolved" },
      { body: "", extra: undefined, status: "resolved" },
      { body: "- [ ] a\n", extra: undefined, status: "archived" },
      { body: "", extra: { items: "nope" }, status: "open" },
      { body: "", extra: { items: [{ text: "a", done: true }] }, status: "open" },
    ] as const;
    for (const { body, extra, status } of cases) {
      expect(derive({ type: TODO_DOC_TYPE, status, body, extra })).toBe(
        deriveStatus({ body, extra }, status),
      );
    }
  });

  it("answers null for a type this plugin does not own — a foreign document keeps its stored status", () => {
    expect(derive({ type: "note", status: "open", body: "- [x] a\n" })).toBeNull();
    expect(derive({ type: "fixture-note", status: "resolved", body: "- [ ] a\n" })).toBeNull();
  });

  /**
   * PLUGINS-018: the second derived field rides the same module — one export
   * per field, so a plugin's server half stays one directory with one build
   * and one entry in `scripts/package-staging.ts`.
   */
  it("exports one function per derived field, and the default one is `status`", () => {
    expect(typeof deriveDue).toBe("function");
    expect(typeof namedStatus).toBe("function");
    expect(derive).toBe(namedStatus);
  });

  it("derives `due` for the todo type exactly as items.ts does", () => {
    const cases = [
      { body: "- [ ] a (due: 2026-08-04)\n- [ ] b (due: 2026-09-30)\n", status: "open" },
      { body: "- [x] a (due: 2026-08-04)\n- [ ] b (due: 2026-09-30)\n", status: "open" },
      { body: "- [x] a (due: 2026-08-04)\n", status: "open" },
      { body: "- [ ] undated\n", status: "open" },
      { body: "- [ ] a (due: 2026-08-04)\n", status: "archived" },
    ] as const;
    for (const { body, status } of cases) {
      expect(deriveDue({ type: TODO_DOC_TYPE, status, body })).toEqual(
        deriveDueFromItems({ body }, status),
      );
    }
    expect(
      deriveDue({ type: TODO_DOC_TYPE, status: "open", body: "", extra: { items: "nope" } }),
    ).toBeNull();
  });

  it("answers null for a foreign type here too — never a deadline on someone else's document", () => {
    expect(
      deriveDue({ type: "note", status: "open", body: "- [ ] a (due: 2026-08-04)\n" }),
    ).toBeNull();
  });
});
