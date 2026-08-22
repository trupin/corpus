import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as YAML from "yaml";
import { z } from "zod";
import { parseBodyItems } from "./items.js";
import manifest from "./manifest.js";
import derive, { deriveDue } from "./server/derive.js";
import { TODO_DOC_TYPE, TODOS_COLUMN_TYPE } from "./shared.js";

/**
 * The §10 parity check applied to todos (PLUGINS-001's TEST-121, carried into
 * PLUGINS-002): `types.yaml` is the non-TS mirror the server and CLI read,
 * because neither ever loads UI code. A doc type present in one declaration and
 * absent from the other is a drift this test fails, in **both** directions.
 *
 * The manifest's own shape is asserted here too — it is the one file the UI
 * registry validates at runtime, and a manifest that loses a renderer degrades
 * silently to the core default rather than failing loudly.
 */

const TypesFileSchema = z.object({
  types: z.array(
    z.object({
      type: z.string().min(1),
      label: z.string().min(1),
      seedTemplate: z.string().min(1).optional(),
      // `true` or absent, never `false`: two spellings of "not derived" would
      // be a second thing for the server and this test to disagree about.
      derivedStatus: z.literal(true).optional(),
      derivedDue: z.literal(true).optional(),
    }),
  ),
});

/**
 * The derived-field seam, enumerated once so a third field is one row here
 * rather than a third copy of the same test (PLUGINS-016 landed `status`,
 * PLUGINS-018 `due`). Each row names the three places one field is declared:
 * the manifest function the UI calls, the `types.yaml` flag the server and the
 * CLI read without executing anything, and the `server/derive.ts` export the
 * server executes.
 */
const DERIVED_FIELDS = [
  { field: "status", manifest: "deriveStatus", flag: "derivedStatus" },
  { field: "due", manifest: "deriveDue", flag: "derivedDue" },
] as const;

function declared(): z.infer<typeof TypesFileSchema>["types"] {
  const raw = readFileSync(join(import.meta.dirname, "types.yaml"), "utf8");
  return TypesFileSchema.parse(YAML.parse(raw)).types;
}

describe("types.yaml ↔ manifest.ts parity", () => {
  it("every manifest docType is declared in types.yaml", () => {
    const yaml = new Set(declared().map((entry) => entry.type));
    for (const docType of manifest.docTypes) {
      expect(yaml, `manifest declares "${docType.type}" but types.yaml does not`).toContain(
        docType.type,
      );
    }
  });

  it("every types.yaml type is declared in the manifest", () => {
    const types = new Set(manifest.docTypes.map((docType) => docType.type));
    for (const entry of declared()) {
      expect(types, `types.yaml declares "${entry.type}" but the manifest does not`).toContain(
        entry.type,
      );
    }
  });

  it("declares exactly the one type this plugin owns", () => {
    expect(declared().map((entry) => entry.type)).toEqual([TODO_DOC_TYPE]);
    expect(declared()[0]?.label).toBe("Todo");
  });

  /**
   * PLUGINS-016 for `status`, PLUGINS-018 for `due`: every derived field is
   * declared from both sides — the UI from the manifest's `derive<Field>`
   * function, the server and CLI from `derived<Field>: true` in types.yaml —
   * so the two must agree per type **and** per field, in both directions,
   * exactly like the type list itself.
   */
  it.each(DERIVED_FIELDS)(
    "declares derived $field in both files or in neither, per type",
    ({ manifest: fn, flag }) => {
      const flagged = new Map(declared().map((entry) => [entry.type, entry[flag] === true]));
      for (const docType of manifest.docTypes) {
        expect(
          flagged.get(docType.type),
          `"${docType.type}": manifest ${fn} and types.yaml ${flag} disagree`,
        ).toBe(typeof docType[fn] === "function");
      }
      expect(flagged.get(TODO_DOC_TYPE)).toBe(true);
    },
  );
});

describe("the manifest", () => {
  it("names the plugin and carries a picker glyph and no order contest", () => {
    expect(manifest.id).toBe("todos");
    expect(manifest.name).toBe("Todos");
    expect(manifest.icon).toBeTruthy();
    // `order` breaks ties over a contested doc type; `todo` is uncontested, so
    // declaring one would be noise.
    expect(manifest.order).toBeUndefined();
  });

  /**
   * PLUGINS-006 and `SPEC.md:404` — "the plugin registers no custom document
   * renderer". A manifest that omits a renderer is a *supported* degradation
   * (the core default takes over), which is why this is an assertion about the
   * registration rather than a hole in it: dropping the `View` is what gives a
   * todo document the core editor and, with it, the anchor layer that makes
   * item-level commenting an ordinary §6 text-quote anchor.
   *
   * The `docTypes` seam is still proved by the other three slots (SHARED-005
   * answer 3), and the `View` slot itself stays contracted and covered by the
   * underscore fixture plugin.
   */
  it("registers the todo doc type with no View, and with ListItem, DocPanel, validate and both derivations", () => {
    const docType = manifest.docTypes.find((entry) => entry.type === TODO_DOC_TYPE);
    expect(docType).toBeDefined();
    expect(docType?.View).toBeUndefined();
    expect(typeof docType?.ListItem).toBe("function");
    expect(typeof docType?.DocPanel).toBe("function");
    expect(typeof docType?.validate).toBe("function");
    // SPEC.md §12 (rider signed 2026-08-12): status is derived, never set.
    expect(typeof docType?.deriveStatus).toBe("function");
    // PLUGINS-018: and so is `due`, from the same items.
    expect(typeof docType?.deriveDue).toBe("function");
  });

  it("registers one column type whose default query pins the doc type", () => {
    expect(manifest.columns).toHaveLength(1);
    const column = manifest.columns[0];
    expect(column?.type).toBe(TODOS_COLUMN_TYPE);
    expect(column?.label).toBe("Todos");
    expect(typeof column?.Component).toBe("function");
    expect(column?.defaultQuery).toEqual({ type: TODO_DOC_TYPE });
  });

  it("validates a document, reporting problems and nothing when valid", () => {
    const validate = manifest.docTypes[0]?.validate;
    // `validate` takes a whole `Doc` (`@corpus/kit`'s `types.ts:100`) and since
    // PLUGINS-005 it reads the **body**; the fixture states only what is under
    // test. The kit's signature is unchanged — nothing here needs it to be.
    const doc = (body: string, extra?: unknown): Parameters<NonNullable<typeof validate>>[0] =>
      ({
        body,
        frontmatter: { extra: extra === undefined ? {} : { items: extra } },
      }) as unknown as Parameters<NonNullable<typeof validate>>[0];

    // A body is either task lines or prose — there is nothing left to malform.
    expect(validate?.(doc("- [ ] a\n- [x] b\n"))).toEqual([]);
    expect(validate?.(doc("## Notes\n"))).toEqual([]);
    // A pre-migration key that was hand-edited is the one remaining problem.
    expect(validate?.(doc("## Notes\n", "nope"))).toEqual([
      "items: must be a list of items; found string",
    ]);
    expect(validate?.(doc("## Notes\n", [{ text: "a" }]))?.join("; ")).toContain("items[0].done");
  });
});

/**
 * PLUGINS-016's third leg: the declaration's two executable halves — the
 * manifest's `deriveStatus` (what the UI calls) and `server/derive.ts`'s
 * default export (what the server calls) — must answer identically for the
 * same document, or the board and the file could disagree about the one field
 * the rider promises they never disagree about (SPEC.md §12).
 */
describe("manifest.deriveStatus ↔ server/derive parity", () => {
  const deriveStatus = manifest.docTypes[0]?.deriveStatus;

  const doc = (
    status: string,
    body: string,
    extra?: Readonly<Record<string, unknown>>,
  ): Parameters<NonNullable<typeof deriveStatus>>[0] =>
    // The derivation reads type, status, body and extra; the fixture states
    // only what is under test, exactly as the validate fixture above does.
    ({
      body,
      frontmatter: { type: TODO_DOC_TYPE, status, extra: extra ?? {} },
    }) as unknown as Parameters<NonNullable<typeof deriveStatus>>[0];

  it("answers identically across the whole rider matrix", () => {
    const matrix: readonly [string, string, Readonly<Record<string, unknown>> | undefined][] = [
      ["open", "- [x] a\n- [x] b\n", undefined], // all done → resolved
      ["open", "- [x] a\n- [ ] b\n", undefined], // one open → open
      ["resolved", "", undefined], // empty list → open
      ["open", "```\n- [ ] example\n```\n", undefined], // fenced only → open
      ["archived", "- [x] a\n", undefined], // archived stands → null
      ["open", "", { items: "nope" }], // unreadable → null
      ["open", "", { items: [{ text: "a", done: true }] }], // legacy → resolved
    ];
    for (const [status, body, extra] of matrix) {
      const viaManifest = deriveStatus?.(doc(status, body, extra));
      const viaServer = derive({ type: TODO_DOC_TYPE, status, body, extra });
      expect(viaManifest, `status=${status} body=${JSON.stringify(body)}`).toBe(viaServer);
    }
  });

  it("agrees on the concrete answers, not only on agreeing", () => {
    expect(deriveStatus?.(doc("open", "- [x] a\n"))).toBe("resolved");
    expect(deriveStatus?.(doc("resolved", "- [ ] a\n"))).toBe("open");
    expect(deriveStatus?.(doc("archived", "- [x] a\n"))).toBeNull();
  });
});

/**
 * PLUGINS-018, the same third leg one field over: the manifest's `deriveDue`
 * (what the UI calls) and `server/derive.ts`'s `deriveDue` export (what the
 * server calls) must answer identically for the same document, or the board
 * and the file could disagree about a deadline — which is the disagreement
 * this whole issue exists to end.
 */
describe("manifest.deriveDue ↔ server/derive parity", () => {
  const deriveDueFn = manifest.docTypes[0]?.deriveDue;

  const doc = (
    status: string,
    body: string,
    extra?: Readonly<Record<string, unknown>>,
  ): Parameters<NonNullable<typeof deriveDueFn>>[0] =>
    ({
      body,
      frontmatter: { type: TODO_DOC_TYPE, status, extra: extra ?? {} },
    }) as unknown as Parameters<NonNullable<typeof deriveDueFn>>[0];

  it("answers identically across the whole matrix", () => {
    const matrix: readonly [string, string, Readonly<Record<string, unknown>> | undefined][] = [
      ["open", "- [ ] a (due: 2026-08-04)\n- [ ] b (due: 2026-09-30)\n", undefined],
      ["open", "- [x] a (due: 2026-08-04)\n- [ ] b (due: 2026-09-30)\n", undefined],
      ["open", "- [x] a (due: 2026-08-04)\n- [x] b (due: 2026-09-30)\n", undefined],
      ["open", "- [ ] undated\n", undefined],
      ["resolved", "", undefined],
      ["open", "```\n- [ ] example (due: 2026-01-01)\n```\n", undefined],
      ["archived", "- [ ] a (due: 2026-08-04)\n", undefined],
      ["open", "", { items: "nope" }],
      ["open", "", { items: [{ text: "a", done: false, due: "2026-08-04" }] }],
    ];
    for (const [status, body, extra] of matrix) {
      const viaManifest = deriveDueFn?.(doc(status, body, extra));
      const viaServer = deriveDue({ type: TODO_DOC_TYPE, status, body, extra });
      expect(viaManifest, `status=${status} body=${JSON.stringify(body)}`).toEqual(viaServer);
    }
  });

  it("agrees on the concrete answers, not only on agreeing", () => {
    // The reporter's case: the earliest open deadline reaches the document.
    expect(
      deriveDueFn?.(doc("open", "- [ ] a (due: 2026-08-04)\n- [ ] b (due: 2026-09-30)\n")),
    ).toEqual({ due: "2026-08-04" });
    // Checking it moves the deadline on; checking the last one clears it.
    expect(
      deriveDueFn?.(doc("open", "- [x] a (due: 2026-08-04)\n- [ ] b (due: 2026-09-30)\n")),
    ).toEqual({ due: "2026-09-30" });
    expect(deriveDueFn?.(doc("open", "- [x] a (due: 2026-08-04)\n"))).toEqual({ due: null });
    // Undated is `no deadline`, never a date — and never "not applicable".
    expect(deriveDueFn?.(doc("open", "- [ ] undated\n"))).toEqual({ due: null });
    // Archived and unreadable are the seam's shared carve-outs.
    expect(deriveDueFn?.(doc("archived", "- [ ] a (due: 2026-08-04)\n"))).toBeNull();
    expect(deriveDueFn?.(doc("open", "", { items: "nope" }))).toBeNull();
  });
});

describe("the seed template", () => {
  /** SPEC.md §11: a template IS a document — `type: template` with `for: <type>`. */
  it("is a valid template document for the todo type", () => {
    const path = declared()[0]?.seedTemplate;
    expect(path).toBe("seeds/todo-template.md");
    const raw = readFileSync(join(import.meta.dirname, String(path)), "utf8");
    const fences = raw.split("---");
    expect(fences.length).toBeGreaterThanOrEqual(3);
    const frontmatter = YAML.parse(String(fences[1])) as Record<string, unknown>;
    expect(frontmatter["type"]).toBe("template");
    expect(frontmatter["for"]).toBe(TODO_DOC_TYPE);
    expect(frontmatter["id"]).toMatch(/^doc_/);
    expect(raw.slice(raw.indexOf("---", 3) + 3).trim().length).toBeGreaterThan(0);
  });

  /**
   * sprint-014 Adjudication 17, still true and now for a second reason.
   * Template pre-fill is **body-only** (SPEC.md §11 — "a template's own
   * housekeeping fields do not bleed into documents created from it"), so a
   * seeded `items:` key could never reach an instance — and since PLUGINS-005
   * there is nothing it could seed, because items are body text.
   */
  it("ships no `items` key, because no template frontmatter ever reaches an instance", () => {
    const raw = readFileSync(join(import.meta.dirname, "seeds", "todo-template.md"), "utf8");
    const frontmatter = YAML.parse(String(raw.split("---")[1])) as Record<string, unknown>;
    expect(frontmatter["items"]).toBeUndefined();
  });

  /**
   * TEST-490 and `SPEC.md:403`'s "its type's template can ship starter items in
   * its body like any template pre-fill" — the consequence the design predicted:
   * templates start working for todos the moment items become body text.
   */
  it("ships starter task-list items in its body, parsed by the format owner", () => {
    const raw = readFileSync(join(import.meta.dirname, "seeds", "todo-template.md"), "utf8");
    const body = raw.slice(raw.indexOf("---", 3) + 3);
    const items = parseBodyItems(body);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((entry) => !entry.done)).toBe(true);
    // The seeded due date is an ordinary inline marker, not a second syntax.
    expect(items.some((entry) => entry.due !== undefined)).toBe(true);
    for (const line of body.split("\n").filter((entry) => entry.startsWith("- ["))) {
      expect(line).toMatch(/^- \[ \] \S/);
    }
  });
});
