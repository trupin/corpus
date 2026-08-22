import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as YAML from "yaml";
import { z } from "zod";
import manifest from "./manifest.js";

/**
 * The §10 parity check, applied to the fixture (PLUGINS-001, sprint-012
 * TEST-121): `types.yaml` is the non-TS mirror the server and CLI read, so a
 * doc type present in one declaration and absent from the other is a drift
 * this test fails — in **both** directions. Every plugin carries this test
 * against its own two files; the todos plugin repeats it (PLUGINS-002).
 */

const TypesFileSchema = z.object({
  types: z.array(
    z.object({
      type: z.string().min(1),
      label: z.string().min(1),
      seedTemplate: z.string().min(1).optional(),
      derivedStatus: z.literal(true).optional(),
    }),
  ),
});

function declaredTypes(): z.infer<typeof TypesFileSchema>["types"] {
  const raw = readFileSync(join(import.meta.dirname, "types.yaml"), "utf8");
  return TypesFileSchema.parse(YAML.parse(raw)).types;
}

function declaredInYaml(): readonly string[] {
  return declaredTypes().map((entry) => entry.type);
}

describe("types.yaml ↔ manifest.ts parity", () => {
  it("every manifest docType is declared in types.yaml", () => {
    const yaml = new Set(declaredInYaml());
    for (const docType of manifest.docTypes) {
      expect(yaml, `manifest declares "${docType.type}" but types.yaml does not`).toContain(
        docType.type,
      );
    }
  });

  it("every types.yaml type is declared in the manifest", () => {
    const declared = new Set(manifest.docTypes.map((docType) => docType.type));
    for (const type of declaredInYaml()) {
      expect(declared, `types.yaml declares "${type}" but the manifest does not`).toContain(type);
    }
  });

  /**
   * PLUGINS-016: derived status is declared twice — `deriveStatus` in the
   * manifest, `derivedStatus: true` in types.yaml — and the two must agree per
   * type, in both directions. The fixture declares neither, which is a state
   * this invariant covers exactly like todos' both.
   */
  it("declares derived status in both files or in neither, per type", () => {
    const flagged = new Map(
      declaredTypes().map((entry) => [entry.type, entry.derivedStatus === true]),
    );
    for (const docType of manifest.docTypes) {
      expect(
        flagged.get(docType.type),
        `"${docType.type}": manifest deriveStatus and types.yaml derivedStatus disagree`,
      ).toBe(typeof docType.deriveStatus === "function");
    }
  });
});
