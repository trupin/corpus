/** @vitest-environment jsdom */
import type { Doc, DocStatus } from "@corpus/contract";
import type { PluginManifest } from "@corpus/kit/plugin";
import { describe, expect, it } from "vitest";
import { buildRegistry, EMPTY_REGISTRY } from "../plugins/registry";
import { docFixture } from "../testing/readerFixture";
import { formStatusLock, statusLock, type StatusSubject } from "./statusLock";

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

  it("says which of the two facts put the word there, where both could have", () => {
    const registry = registryWith("todo", { deriveStatus: () => "resolved" as const });
    // An archived todo is the one document where a reader could reasonably ask
    // whether `archived` was derived. §12 says it never is, so the reason says so.
    const lock = statusLock({ type: "todo", status: "archived" }, registry);
    expect(lock?.kind).toBe("archived");
    expect(lock?.reason).toContain("not a reading of its content");
    // A type that derives nothing has no such ambiguity, and is not told about one.
    expect(statusLock({ type: "note", status: "archived" }, registry)?.reason).not.toContain(
      "not a reading",
    );
  });

  it("tells the two facts apart by kind, not by wording", () => {
    const registry = registryWith("todo", { deriveStatus: () => "resolved" as const });
    expect(statusLock({ type: "todo", status: "open" }, registry)?.kind).toBe("derived");
    expect(statusLock({ type: "note", status: "archived" }, registry)?.kind).toBe("archived");
  });
});

/**
 * The **form's** extra question (UI-092), which narrows the answer above and is
 * not a second opinion about it.
 *
 * `statusLock` answers the declaration — does this *type* derive? — because that
 * is all a row can supply. The form holds the whole `Doc`, so it can ask the
 * sharper one: does the derivation have anything to say about *this* document?
 * §12's rider leaves exactly one case where it does not, and PLUGINS-016 rule 2
 * names it — content that cannot be read derives nothing, "the stored value
 * stands", and a stored value nothing derives is the person's again.
 */
describe("formStatusLock", () => {
  const todo = (overrides: { status?: DocStatus; body?: string } = {}): Doc =>
    docFixture({
      body: overrides.body ?? "- [x] done\n",
      frontmatter: { id: "doc_t", type: "todo", status: overrides.status ?? "resolved" },
    });

  /** A derivation shaped like the todos plugin's: unreadable content declines. */
  const derivingRegistry = () =>
    registryWith("todo", {
      deriveStatus: (doc: Doc) => {
        if (doc.frontmatter.status === "archived") return null;
        // An empty body stands in for "the items cannot be read" — a legacy
        // `extra.items` list, which `readItems` refuses and `deriveStatus`
        // therefore declines on.
        if (doc.body === "") return null;
        return doc.body.includes("- [ ]") ? "open" : "resolved";
      },
    });

  it("keeps the lock where the derivation has an answer", () => {
    const lock = formStatusLock(todo(), derivingRegistry());
    expect(lock?.kind).toBe("derived");
    expect(lock?.reason).toContain("derived");
  });

  it("hands the field back where the content cannot be read", () => {
    expect(formStatusLock(todo({ body: "" }), derivingRegistry())).toBeNull();
    // The shared predicate still locks it, and is right to: the menu asks about
    // the type and cannot afford a fetch to ask about the document.
    expect(statusLock({ type: "todo", status: "open" }, derivingRegistry())).not.toBeNull();
  });

  it("never releases an archived document, though the derivation declines for it too", () => {
    // The trap this composition had to avoid: `deriveStatus` returns `null` for
    // an archived document *by rule*, so a check that only asked "did it derive?"
    // would unlock a field the write path refuses outright (SERVER-039).
    expect(formStatusLock(todo({ status: "archived" }), derivingRegistry())?.kind).toBe("archived");
  });

  it("contains a derivation that throws, and leaves the field editable", () => {
    const registry = registryWith("todo", {
      deriveStatus: () => {
        throw new Error("plugin fell over");
      },
    });
    expect(() => formStatusLock(todo(), registry)).not.toThrow();
    expect(formStatusLock(todo(), registry)).toBeNull();
  });

  it("locks nothing the shared predicate left open — it narrows, it does not rival", () => {
    const registry = derivingRegistry();
    const docs: readonly Doc[] = [
      todo(),
      todo({ body: "- [ ] open one\n" }),
      todo({ body: "" }),
      todo({ status: "archived" }),
      docFixture({ frontmatter: { id: "doc_n", type: "note", status: "open" } }),
      docFixture({ frontmatter: { id: "doc_n", type: "note", status: "resolved" } }),
      docFixture({ frontmatter: { id: "doc_n", type: "note", status: "archived" } }),
    ];
    for (const doc of docs) {
      const where = `${doc.frontmatter.type}/${doc.frontmatter.status}`;
      const form = formStatusLock(doc, registry);
      if (form === null) continue;
      expect(statusLock(doc.frontmatter, registry), where).toBe(form);
    }
  });

  it("leaves an ordinary document alone in both directions", () => {
    const note = docFixture({ frontmatter: { id: "doc_n", type: "note", status: "open" } });
    expect(formStatusLock(note, derivingRegistry())).toBeNull();
    expect(formStatusLock(note, EMPTY_REGISTRY)).toBeNull();
  });

  it("leaves the field editable when the plugin is gone (§15 M6)", () => {
    expect(formStatusLock(todo(), EMPTY_REGISTRY)).toBeNull();
  });
});
