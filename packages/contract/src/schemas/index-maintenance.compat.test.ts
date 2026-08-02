import { describe, expect, it } from "vitest";
import type { components } from "../client/schema.generated.js";
import { IndexStatusSchema, type IndexStatus } from "./index-maintenance.js";

/**
 * The rider's central promise, asserted rather than reviewed: **`IndexStatus` as
 * CONTRACT-023 signed it did not move.**
 *
 * The 2026-08-01 rider adds one optional `detail` string so a first-run model
 * download is distinguishable from a workspace that will never have a model
 * (SERVER-048's evaluation, FAIL-1). Additive is a claim, not a hope: `apps/cli`
 * and `apps/ui` compile against the generated component types, so a field that
 * arrived required — or an enum that gained a value — would be a build break
 * rather than a runtime surprise.
 *
 * The pre-rider shape below is a **verbatim hand transcription** of the
 * `IndexStatus` component as CONTRACT-023 committed it (descriptions stripped),
 * following `./retrieval.compat.test.ts` and `./db.compat.test.ts`. It is
 * deliberately derived from nothing in the package: a snapshot that tracked the
 * current types would assert nothing at all.
 *
 * Compatibility is asserted against the **generated** shapes, for the reason
 * recorded in `./db.compat.test.ts`: under `exactOptionalPropertyTypes`,
 * `z.infer` widens an optional property to `?: T | undefined` while
 * `openapi-typescript` never writes an explicit `| undefined`, so zod-inferred
 * types are assignable *from* generated ones and not *to* them.
 */

interface PreRiderIndexStatus {
  indexed: number;
  pending: number;
  failed: number;
  identity: string | null;
  rebuilding: boolean;
  state: "current" | "indexing" | "stale" | "disabled";
}

/** What a pre-rider server serialized: six fields, and no seventh key at all. */
const PRE_RIDER: PreRiderIndexStatus = {
  indexed: 660,
  pending: 0,
  failed: 0,
  identity: "local/all-MiniLM-L6-v2@384",
  rebuilding: false,
  state: "current",
};

type WireIndexStatus = components["schemas"]["IndexStatus"];

/** What a rider-era server serializes during a first-run download. */
const RIDER_ERA: WireIndexStatus = {
  indexed: 0,
  pending: 81,
  failed: 0,
  identity: null,
  rebuilding: false,
  state: "disabled",
  detail:
    "downloading the all-MiniLM-L6-v2 embedding model (10.4 MiB of 22.6 MiB, 46%) — " +
    "semantic ranking starts once it is cached",
};

describe("a pre-rider client still compiles and still parses", () => {
  /**
   * Assignability, not object literals: these are values off a wire, so no
   * excess-property check applies and the assertion is purely "nothing the
   * pre-rider type promised has gone missing, changed type, or changed
   * optionality".
   */
  it("lets pre-rider reading code consume a rider-era payload", () => {
    const consumed: PreRiderIndexStatus = RIDER_ERA;
    expect(consumed.state).toBe("disabled");
    expect(consumed.identity).toBeNull();
  });

  it("lets a pre-rider payload satisfy the current generated type", () => {
    const wire: WireIndexStatus = PRE_RIDER;
    expect(wire.indexed).toBe(660);
    expect("detail" in wire).toBe(false);
  });

  it("lets a pre-rider payload satisfy the schema's inferred type", () => {
    const inferred: IndexStatus = PRE_RIDER;
    expect(inferred).toEqual(PRE_RIDER);
  });

  it("still parses a pre-rider payload, so no shipped handler's output turns invalid", () => {
    expect(IndexStatusSchema.parse(PRE_RIDER)).toEqual(PRE_RIDER);
  });

  it("lets a wire-typed rider-era payload flow into the schema's inferred type", () => {
    const inferred: IndexStatus = RIDER_ERA;
    expect(IndexStatusSchema.parse(RIDER_ERA)).toEqual(inferred);
  });
});

/**
 * The generated type is where a consumer's compiler reads optionality, and it is
 * the half a schema-only assertion would miss. Under
 * `exactOptionalPropertyTypes` a literal missing a **required** property is a
 * compile error, so this line stops typechecking the moment `detail` stops being
 * optional.
 */
describe("`detail` stays optional on the generated component", () => {
  it("keeps it omissible in the generated client components", () => {
    const wire: WireIndexStatus = {
      indexed: 0,
      pending: 0,
      failed: 0,
      identity: null,
      rebuilding: false,
      state: "disabled",
    };
    expect("detail" in wire).toBe(false);
  });
});
