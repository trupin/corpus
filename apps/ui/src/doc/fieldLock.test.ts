/** @vitest-environment jsdom */
import type { Doc, DocStatus } from "@corpus/contract";
import type { PluginManifest } from "@corpus/kit/plugin";
import { describe, expect, it } from "vitest";
import { buildRegistry, EMPTY_REGISTRY } from "../plugins/registry";
import { docFixture } from "../testing/readerFixture";
import {
  DERIVED_FIELDS,
  dueLock,
  fieldLocks,
  formDueLock,
  formStatusLock,
  NO_FIELD_LOCKS,
  statusLock,
  type FieldSubject,
} from "./fieldLock";

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

const NOTE: FieldSubject = { type: "note", status: "open" };

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

  it("leaves the field editable when the plugin is gone (§12 M6)", () => {
    expect(formStatusLock(todo(), EMPTY_REGISTRY)).toBeNull();
  });
});

/**
 * The **`due`** member of the same seam (PLUGINS-018, SERVER-134).
 *
 * Read against the predicate rather than the form, exactly as the status cases
 * are: the form's rendering of the answer lives in
 * `reader/FrontmatterForm.test.tsx`. What is pinned here is the shape — a
 * declaration-level lock and a form-level narrowing of it — and the one place
 * `due` is genuinely not `status`: `deriveDue` has **three** answers, and the
 * middle one (`{due: null}`) means the derivation applies and there is no
 * deadline. A composition that read it as "does not apply" would hand back the
 * control on precisely the document whose deadline the server is about to clear.
 */
describe("dueLock", () => {
  it("leaves an ordinary document's deadline the person's to set", () => {
    expect(dueLock(NOTE, EMPTY_REGISTRY)).toBeNull();
    expect(dueLock({ type: "note", status: "resolved" }, EMPTY_REGISTRY)).toBeNull();
  });

  it("locks a type whose plugin derives its due, naming where the value comes from", () => {
    const registry = registryWith("todo", { deriveDue: () => ({ due: "2026-08-04" }) });
    const lock = dueLock({ type: "todo", status: "open" }, registry);
    expect(lock?.kind).toBe("derived");
    expect(lock?.reason).toContain("derived");
    expect(lock?.reason).not.toContain("items");
  });

  it("reads the declaration, not the derived value", () => {
    const registry = registryWith("todo", { deriveDue: () => null });
    expect(dueLock({ type: "todo", status: "open" }, registry)).not.toBeNull();
  });

  it("does not lock a type that derives only its status", () => {
    const registry = registryWith("todo", { deriveStatus: () => "open" as const });
    expect(dueLock({ type: "todo", status: "open" }, registry)).toBeNull();
    expect(statusLock({ type: "todo", status: "open" }, registry)).not.toBeNull();
  });

  it("does not lock a type that derives only its due", () => {
    const registry = registryWith("todo", { deriveDue: () => ({ due: null }) });
    expect(statusLock({ type: "todo", status: "open" }, registry)).toBeNull();
    expect(dueLock({ type: "todo", status: "open" }, registry)).not.toBeNull();
  });

  it("keeps an archived list's deadline locked, and differs from status in kind", () => {
    // The decision of 2026-08-22 (PR #55 re-review, finding 2). §12's rider is
    // categorical — the field is not editable for this type — and a live control
    // on an archived list writes a date the unarchive silently converges away.
    // The two members still part company here, but on the *kind* of lock:
    // `archived` on status, where there is an act on another route; `derived` on
    // due, where there is no act anywhere.
    const registry = registryWith("todo", { deriveDue: () => ({ due: "2026-08-04" }) });
    expect(dueLock({ type: "todo", status: "archived" }, registry)?.kind).toBe("derived");
    expect(statusLock({ type: "todo", status: "archived" }, registry)?.kind).toBe("archived");
  });

  it("still leaves an archived document nothing derives the person's", () => {
    // Locking an archived list is the derivation's doing, never the archive's.
    expect(dueLock({ type: "note", status: "archived" }, EMPTY_REGISTRY)).toBeNull();
    const registry = registryWith("todo", { deriveStatus: () => "open" as const });
    expect(dueLock({ type: "todo", status: "archived" }, registry)).toBeNull();
  });

  it("locks nothing while discovery is still empty", () => {
    expect(dueLock({ type: "todo", status: "open" }, EMPTY_REGISTRY)).toBeNull();
  });
});

describe("formDueLock", () => {
  const todo = (overrides: { status?: DocStatus; body?: string } = {}): Doc =>
    docFixture({
      body: overrides.body ?? "- [ ] pay the deposit (due: 2026-08-04)\n",
      frontmatter: {
        id: "doc_t",
        type: "todo",
        status: overrides.status ?? "open",
        due: "2026-08-04",
      },
    });

  /** A derivation shaped like the todos plugin's, with all three answers. */
  const derivingRegistry = () =>
    registryWith("todo", {
      deriveDue: (doc: Doc) => {
        if (doc.frontmatter.status === "archived") return null;
        if (doc.body === "") return null;
        const dates = [...doc.body.matchAll(/- \[ \] .*\(due: (\d{4}-\d{2}-\d{2})\)/g)].map(
          (match) => String(match[1]),
        );
        return { due: dates.sort()[0] ?? null };
      },
    });

  it("keeps the lock where the derivation has a date", () => {
    const lock = formDueLock(todo(), derivingRegistry());
    expect(lock?.kind).toBe("derived");
    expect(lock?.reason).toContain("derived");
  });

  it("keeps the lock where the derivation applies and there is no deadline", () => {
    // `DerivedDocDue`'s middle answer. `{due: null}` is not "does not apply": it
    // is the answer that has to CLEAR the field, so the control it belongs to
    // stays locked and says so. A `?? stored` composition collapses this case,
    // and a finished list would keep a deadline forever.
    const lock = formDueLock(todo({ body: "- [x] paid (due: 2026-08-04)\n" }), derivingRegistry());
    expect(lock?.kind).toBe("derived");
  });

  it("hands the field back where the content cannot be read", () => {
    expect(formDueLock(todo({ body: "" }), derivingRegistry())).toBeNull();
    expect(dueLock({ type: "todo", status: "open" }, derivingRegistry())).not.toBeNull();
  });

  it("keeps an archived list's deadline locked, though the derivation declines for it", () => {
    // The trap this narrowing has to avoid, and the mirror of `formStatusLock`'s
    // own archived case: rule 2 makes *every* derivation decline for an archived
    // document, so a narrowing that simply asked would release the field on
    // every archived list — on the strength of a decline that says nothing about
    // this document's content.
    const lock = formDueLock(todo({ status: "archived" }), derivingRegistry());
    expect(lock?.kind).toBe("derived");
  });

  it("contains a derivation that throws, and leaves the field editable", () => {
    const registry = registryWith("todo", {
      deriveDue: () => {
        throw new Error("plugin fell over");
      },
    });
    expect(() => formDueLock(todo(), registry)).not.toThrow();
    expect(formDueLock(todo(), registry)).toBeNull();
  });

  it("reads an answer of the wrong shape as declining", () => {
    // `plugins/validate.ts` establishes that a `deriveDue` is a function and can
    // establish nothing about what it returns. A malformed answer lands where a
    // throw lands — the direction that leaves the field the person's.
    for (const answer of ["2026-08-04", 20260804, {}, { due: 3 }, [], true]) {
      const registry = registryWith("todo", { deriveDue: () => answer as never });
      expect(formDueLock(todo(), registry), JSON.stringify(answer)).toBeNull();
    }
  });

  it("locks nothing the shared predicate left open — it narrows, it does not rival", () => {
    const registry = derivingRegistry();
    const docs: readonly Doc[] = [
      todo(),
      todo({ body: "- [x] paid (due: 2026-08-04)\n" }),
      todo({ body: "- [ ] undated\n" }),
      todo({ body: "" }),
      todo({ status: "archived" }),
      todo({ status: "resolved" }),
      docFixture({ frontmatter: { id: "doc_n", type: "note", status: "open" } }),
      docFixture({ frontmatter: { id: "doc_n", type: "note", status: "archived" } }),
    ];
    for (const doc of docs) {
      const where = `${doc.frontmatter.type}/${doc.frontmatter.status}/${doc.body}`;
      const form = formDueLock(doc, registry);
      if (form === null) continue;
      expect(dueLock(doc.frontmatter, registry), where).toBe(form);
    }
  });

  it("leaves the field editable when the plugin is gone (§12 M6)", () => {
    expect(formDueLock(todo(), EMPTY_REGISTRY)).toBeNull();
  });
});

/**
 * The list a **writer** guards itself against (PR #55 re-review, finding 1).
 *
 * What these pin is not an answer but a shape: every field a type may take away
 * is in one list, and one call answers for all of them. The wedge that made this
 * necessary — a `due` guarded by a boolean parameter and a `status` guarded by
 * nothing — is asserted where it bit, in `reader/FrontmatterForm.test.tsx`.
 */
describe("fieldLocks", () => {
  const todo = (overrides: { status?: DocStatus; body?: string } = {}): Doc =>
    docFixture({
      body: overrides.body ?? "- [ ] pay the deposit (due: 2026-08-04)\n",
      frontmatter: {
        id: "doc_t",
        type: "todo",
        status: overrides.status ?? "open",
        due: "2026-08-04",
      },
    });

  const bothDerived = () =>
    registryWith("todo", {
      deriveStatus: (doc: Doc) => (doc.body.includes("- [ ]") ? "open" : "resolved"),
      deriveDue: () => ({ due: "2026-08-04" }),
    });

  it("names every field a doc type may take away, and nothing else", () => {
    // One member per `deriveX` on `PluginDocType`. A third one added there and
    // forgotten here would be a field `changedFields` writes unguarded.
    expect([...DERIVED_FIELDS]).toEqual(["status", "due"]);
  });

  it("answers for every one of them at once", () => {
    const locks = fieldLocks(todo(), bothDerived());
    expect(Object.keys(locks).sort()).toEqual([...DERIVED_FIELDS].sort());
    expect(locks.status?.kind).toBe("derived");
    expect(locks.due?.kind).toBe("derived");
  });

  it("gives each field its own predicate's answer, never one shared verdict", () => {
    const statusOnly = registryWith("todo", { deriveStatus: () => "open" as const });
    expect(fieldLocks(todo(), statusOnly).status).not.toBeNull();
    expect(fieldLocks(todo(), statusOnly).due).toBeNull();

    const dueOnly = registryWith("todo", { deriveDue: () => ({ due: "2026-08-04" }) });
    expect(fieldLocks(todo(), dueOnly).status).toBeNull();
    expect(fieldLocks(todo(), dueOnly).due).not.toBeNull();
  });

  it("agrees with the form predicates it composes, on every document", () => {
    const registry = bothDerived();
    const docs: readonly Doc[] = [
      todo(),
      todo({ body: "- [x] paid (due: 2026-08-04)\n" }),
      todo({ body: "" }),
      todo({ status: "archived" }),
      docFixture({ frontmatter: { id: "doc_n", type: "note", status: "open" } }),
    ];
    for (const doc of docs) {
      const where = `${doc.frontmatter.type}/${doc.frontmatter.status}/${doc.body}`;
      expect(fieldLocks(doc, registry).status, where).toBe(formStatusLock(doc, registry));
      expect(fieldLocks(doc, registry).due, where).toBe(formDueLock(doc, registry));
    }
  });

  it("locks nothing while discovery has loaded nothing", () => {
    // The window the wedge lives in: the controls are live, so a writer that
    // consulted only this would send both fields. See `changedFields`.
    expect(fieldLocks(todo(), EMPTY_REGISTRY)).toEqual(NO_FIELD_LOCKS);
  });

  it("locks nothing, as a value a caller with no registry can pass", () => {
    for (const field of DERIVED_FIELDS) expect(NO_FIELD_LOCKS[field]).toBeNull();
  });
});
