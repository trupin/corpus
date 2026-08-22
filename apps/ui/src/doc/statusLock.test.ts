/** @vitest-environment jsdom */
import type { Doc } from "@corpus/contract";
import type { PluginManifest } from "@corpus/kit/plugin";
import { describe, expect, it } from "vitest";
import { buildRegistry, EMPTY_REGISTRY } from "../plugins/registry";
import { statusLock, type StatusSubject } from "./statusLock";

/**
 * The one predicate behind two surfaces (UI-094).
 *
 * These read the function rather than either surface, because the whole point of
 * the move is that the answer is the same one wherever it is asked: the form's
 * own rendering of it lives in `reader/FrontmatterForm.test.tsx`, and the menu's
 * omission in `menu/docActions.test.tsx`.
 */

/**
 * A manifest as discovery hands it over, holding one doc type.
 *
 * It **asserts the plugin survived validation**, and that is not ceremony: the
 * first draft of this file omitted `id`, every manifest was refused, and the two
 * derived-status cases passed against a registry that held nothing. A fixture
 * that silently becomes empty turns a negative assertion into a tautology.
 */
function registryWith(type: string, manifest: Partial<PluginManifest["docTypes"][number]>) {
  const registry = buildRegistry([
    {
      dir: "todos",
      loaded: {
        module: {
          default: {
            id: "todos",
            name: "Todos",
            docTypes: [{ type, ...manifest }],
            columns: [],
          },
        },
      },
    },
  ]);
  expect(registry.warnings, "the fixture manifest must survive validation").toEqual([]);
  expect(registry.docTypes.has(type)).toBe(true);
  return registry;
}

const NOTE: StatusSubject = { type: "note", status: "open" };

describe("statusLock", () => {
  it("leaves an ordinary document's status the person's to set", () => {
    expect(statusLock(NOTE, EMPTY_REGISTRY)).toBeNull();
  });

  it("leaves a resolved document's status settable — reopening is the way back", () => {
    expect(statusLock({ type: "note", status: "resolved" }, EMPTY_REGISTRY)).toBeNull();
  });

  it("shows an archived status with the reason it is nobody's to set", () => {
    expect(statusLock({ type: "note", status: "archived" }, EMPTY_REGISTRY)?.reason).toContain(
      "Unarchive in the ⋯ menu",
    );
  });

  it("locks every type that is not a thread the same way — one vocabulary (SPEC.md §5)", () => {
    // SHARED-031: `view` and `template` take the same three statuses as a note.
    for (const type of ["note", "view", "template", "skill", "thread", "something-unknown"]) {
      expect(statusLock({ type, status: "open" }, EMPTY_REGISTRY)).toBeNull();
    }
  });

  it("locks a type whose plugin derives its status, naming where the value comes from", () => {
    const registry = registryWith("todo", {
      deriveStatus: (doc: Doc) => (doc.body === "" ? "open" : "resolved"),
    });
    const lock = statusLock({ type: "todo", status: "open" }, registry);
    expect(lock?.reason).toContain("derived");
    // And not by name: §10 keeps a plugin's vocabulary out of core's sentences.
    expect(lock?.reason).not.toContain("items");
  });

  it("does not lock a plugin type that declares no derivation", () => {
    const registry = registryWith("todo", {});
    expect(statusLock({ type: "todo", status: "open" }, registry)).toBeNull();
  });

  it("reads the declaration, not the derived value", () => {
    // `deriveStatus` returning `null` means "the stored value stands" — an
    // archived document, or one whose content cannot be read. The *type* still
    // derives, so the field is still nobody's to set: SHARED-031 part 2 speaks
    // of "a type whose status is derived rather than set".
    const registry = registryWith("todo", { deriveStatus: () => null });
    expect(statusLock({ type: "todo", status: "open" }, registry)).not.toBeNull();
  });

  it("prefers the archive reason on an archived document of a derived type", () => {
    // The ladder's top rung is a place, not a claim about what is left to do, so
    // the way back is what the person needs told (SPEC.md §5).
    const registry = registryWith("todo", { deriveStatus: () => "resolved" as const });
    expect(statusLock({ type: "todo", status: "archived" }, registry)?.reason).toContain(
      "Unarchive",
    );
  });

  it("locks nothing while discovery is still empty", () => {
    // A control that is briefly editable corrects itself when discovery settles;
    // one that is uneditable because a manifest failed to load has no way back.
    expect(statusLock({ type: "todo", status: "open" }, EMPTY_REGISTRY)).toBeNull();
  });
});
