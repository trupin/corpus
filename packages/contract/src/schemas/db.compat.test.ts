import { describe, expect, it } from "vitest";
import type { components } from "../client/schema.generated.js";
import { DoctorReportSchema, type DoctorReport } from "./db.js";

/**
 * CONTRACT-025's additivity guarantee, asserted rather than asserted-in-prose.
 *
 * The rider adds `warnings` to a response that `apps/cli` and `apps/server`
 * already read. "Additive" is a claim about two directions, and only one of them
 * is obvious:
 *
 * - **Read.** Code written against the pre-rider types must still compile when
 *   handed a post-rider payload — i.e. nothing was removed, renamed, or widened.
 * - **Write.** A payload built to the pre-rider shape must still satisfy the
 *   post-rider type and still parse — i.e. the new field is genuinely optional.
 *   This is the direction that fails if `warnings` is made required, and it is
 *   why the shipped doctor handler compiles untouched until SERVER-038 lands.
 *
 * The A-era shapes below are a **verbatim hand transcription** of
 * `src/client/schema.generated.ts` as it stood before this rider (the
 * `DoctorReport`, `ProjectionDrift` and `DoctorStats` components, descriptions
 * stripped). They are deliberately not derived from anything in the package: a
 * snapshot that tracks the current types would assert nothing at all.
 */

interface AEraProjectionDrift {
  kind:
    | "missing_row"
    | "orphan_row"
    | "content_mismatch"
    | "count_mismatch"
    | "unparseable"
    | "duplicate_id";
  path: string | null;
  detail: string;
}

interface AEraDoctorStats {
  files: number;
  documents: number;
  hashed: number;
  parsed: number;
  durationMs: number;
}

interface AEraDoctorReport {
  ok: boolean;
  drift: AEraProjectionDrift[];
  stats: AEraDoctorStats;
}

/** What an A-era server serialized, and what an A-era test fixture built. */
const A_ERA_PAYLOAD: AEraDoctorReport = {
  ok: false,
  drift: [{ kind: "missing_row", path: "data/docs/new.md", detail: "no `documents` row" }],
  stats: { files: 6, documents: 5, hashed: 1, parsed: 1, durationMs: 9 },
};

/** What a post-rider server serializes once SERVER-038's pass exists. */
const POST_RIDER_PAYLOAD: DoctorReport = {
  ...A_ERA_PAYLOAD,
  warnings: [
    {
      kind: "unindexable_file",
      path: "data/docs/.claude/skills/invisible-doc.md",
      detail: "the projection will never index this file",
      commit: "a1b2c3d",
    },
  ],
};

/** The generated client component — the type `apps/cli` and `packages/kit` see. */
type WireDoctorReport = components["schemas"]["DoctorReport"];

/** The same payload as the generated client types it, rather than as Zod infers it. */
const WIRE_PAYLOAD: WireDoctorReport = {
  ...A_ERA_PAYLOAD,
  warnings: [
    {
      kind: "unindexable_file",
      path: "data/docs/node_modules/ignored-dir-doc.md",
      detail: "under `node_modules/`, which the document walk skips",
      commit: null,
    },
  ],
};

describe("the doctor rider is additive, in both directions", () => {
  it("lets A-era reading code consume a post-rider payload", () => {
    // Assignability, not an object literal: this is a value off the wire, so no
    // excess-property check applies and the assertion is purely "nothing the
    // A-era type promised has gone missing or changed shape".
    const consumed: AEraDoctorReport = POST_RIDER_PAYLOAD;
    expect(consumed.ok).toBe(false);
    expect(consumed.drift).toHaveLength(1);
    expect(consumed.stats.files).toBe(6);
  });

  it("lets an A-era payload satisfy the post-rider type", () => {
    const produced: DoctorReport = A_ERA_PAYLOAD;
    expect(produced).toEqual(A_ERA_PAYLOAD);
  });

  it("still parses an A-era payload, so no shipped handler's output turns invalid", () => {
    expect(DoctorReportSchema.parse(A_ERA_PAYLOAD)).toEqual(A_ERA_PAYLOAD);
  });

  /**
   * The object literal is the assertion: under `exactOptionalPropertyTypes` a
   * literal missing a **required** property is a compile error, so this line
   * fails to typecheck the moment `warnings` stops being optional.
   */
  it("keeps `warnings` optional in the generated client component", () => {
    const withoutWarnings: WireDoctorReport = {
      ok: true,
      drift: [],
      stats: { files: 0, documents: 0, hashed: 0, parsed: 0, durationMs: 0 },
    };
    expect("warnings" in withoutWarnings).toBe(false);
  });

  /**
   * The direction that actually occurs: a payload the generated client typed
   * flows into code holding the schema's inferred type (the server's handler
   * imports `DoctorReport` from the package root, the CLI reads
   * `components["schemas"]["DoctorReport"]`).
   *
   * The reverse is deliberately **not** asserted, and the reason is a toolchain
   * quirk worth writing down rather than working around: under
   * `exactOptionalPropertyTypes`, `z.infer` widens an optional property to
   * `warnings?: T[] | undefined` while `openapi-typescript` emits `warnings?:
   * T[]` — it never writes an explicit `| undefined` anywhere in the generated
   * module (749 optional properties, zero occurrences). So zod-inferred types are
   * assignable *from* generated ones and not *to* them, uniformly, for every
   * optional field in this contract. That asymmetry predates this rider and is
   * not something a schema change here can or should fix.
   */
  it("lets a wire-typed payload flow into the schema's inferred type", () => {
    const fromSchema: DoctorReport = WIRE_PAYLOAD;
    expect(fromSchema.warnings?.[0]?.kind).toBe("unindexable_file");
    expect(DoctorReportSchema.parse(WIRE_PAYLOAD)).toEqual(WIRE_PAYLOAD);
  });

  /** The A-era generated component read the same payload; it still must. */
  it("lets A-era reading code consume a wire-typed payload too", () => {
    const consumed: AEraDoctorReport = WIRE_PAYLOAD;
    expect(consumed.stats.durationMs).toBe(9);
    expect(consumed.drift[0]?.kind).toBe("missing_row");
  });
});
