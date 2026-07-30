import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as YAML from "yaml";
import { z } from "zod";
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

  it("registers the todo doc type with all three renderers and validate", () => {
    const docType = manifest.docTypes.find((entry) => entry.type === TODO_DOC_TYPE);
    expect(docType).toBeDefined();
    expect(typeof docType?.View).toBe("function");
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

  it("validates a document's items, reporting problems and nothing when valid", () => {
    const validate = manifest.docTypes[0]?.validate;
    // `validate` reads one frontmatter key; the rest of a `Doc` is irrelevant
    // to it, so the fixture states only what is under test.
    const doc = (items: unknown): Parameters<NonNullable<typeof validate>>[0] =>
      ({ frontmatter: { extra: { items } } }) as unknown as Parameters<
        NonNullable<typeof validate>
      >[0];

    expect(validate?.(doc([{ text: "a", done: false, ts: "2026-07-20T09:00:00.000Z" }]))).toEqual(
      [],
    );
    expect(validate?.(doc("nope"))).toEqual(["items: must be a list of items; found string"]);
    expect(validate?.(doc([{ text: "a" }]))?.join("; ")).toContain("items[0].done");
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
   * sprint-014 Adjudication 17. Template pre-fill is **body-only** (SPEC.md
   * §11 — "a template's own housekeeping fields do not bleed into documents
   * created from it"), so a seeded `items: []` could never reach an instance.
   * Every reader here treats an absent key as an empty list instead, which
   * also covers a hand-written document and one whose key was deleted.
   */
  it("ships no `items` key, because no template frontmatter ever reaches an instance", () => {
    const raw = readFileSync(join(import.meta.dirname, "seeds", "todo-template.md"), "utf8");
    const frontmatter = YAML.parse(String(raw.split("---")[1])) as Record<string, unknown>;
    expect(frontmatter["items"]).toBeUndefined();
  });
});
