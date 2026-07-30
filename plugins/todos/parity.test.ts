import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as YAML from "yaml";
import { z } from "zod";
import { parseBodyItems } from "./items.js";
import manifest from "./manifest.js";
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
    }),
  ),
});

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
  it("registers the todo doc type with no View, and with ListItem, DocPanel and validate", () => {
    const docType = manifest.docTypes.find((entry) => entry.type === TODO_DOC_TYPE);
    expect(docType).toBeDefined();
    expect(docType?.View).toBeUndefined();
    expect(typeof docType?.ListItem).toBe("function");
    expect(typeof docType?.DocPanel).toBe("function");
    expect(typeof docType?.validate).toBe("function");
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
