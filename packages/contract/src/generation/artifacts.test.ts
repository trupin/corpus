import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildContractArtifacts,
  CLIENT_TYPES_PATH,
  contractPackageRoot,
  NOT_A_STALE_BUILD,
  OPENAPI_JSON_PATH,
  staleArtifactDiagnosis,
  writeContractArtifacts,
  type ContractArtifacts,
} from "./artifacts.js";

let first: ContractArtifacts;
let second: ContractArtifacts;
let scratch: string;

/**
 * What each committed artifact says, and what the route definitions say it
 * should say — read once, keyed alike, so the drift check below can report
 * *which* of the two moved. That is the evidence its failure message reasons
 * from (INFRA-032), and a per-file assertion cannot see it.
 *
 * A missing artifact reads as the empty string rather than throwing: an absent
 * file is stale in the way that matters, and an ENOENT escaping the test would
 * hide the sentence that explains it.
 */
let committed: Readonly<Record<string, string>>;
let expected: Readonly<Record<string, string>>;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "corpus-contract-"));
  first = await writeContractArtifacts(scratch);
  second = await buildContractArtifacts();

  const read = (path: string): Promise<string> =>
    readFile(join(contractPackageRoot(), path), "utf8").catch(() => "");
  committed = {
    [OPENAPI_JSON_PATH]: await read(OPENAPI_JSON_PATH),
    [CLIENT_TYPES_PATH]: await read(CLIENT_TYPES_PATH),
  };
  expected = {
    [OPENAPI_JSON_PATH]: first.openapiJson,
    [CLIENT_TYPES_PATH]: first.clientTypes,
  };
}, 30_000);

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("contract artifact generation", () => {
  it("is idempotent — a second run produces byte-identical output", () => {
    expect(second.openapiJson).toBe(first.openapiJson);
    expect(second.clientTypes).toBe(first.clientTypes);
  });

  it("writes exactly what it built", async () => {
    await expect(readFile(join(scratch, OPENAPI_JSON_PATH), "utf8")).resolves.toBe(
      first.openapiJson,
    );
    await expect(readFile(join(scratch, CLIENT_TYPES_PATH), "utf8")).resolves.toBe(
      first.clientTypes,
    );
  });

  it("emits a trailing newline so the artifacts are well-formed text files", () => {
    expect(first.openapiJson.endsWith("\n")).toBe(true);
    expect(first.clientTypes.endsWith("\n")).toBe(true);
  });

  it("derives the client types from the document it just serialised", () => {
    expect(first.clientTypes).toContain("export interface paths");
    expect(first.clientTypes).toContain('"/api/docs"');
    expect(first.clientTypes).toContain("Regenerate with: npm run generate -w packages/contract");
  });

  /**
   * The check that makes a green local run mean something about the
   * **committed** contract (INFRA-032, and SPEC.md §9.3, which asks for the
   * check in more than one place).
   *
   * Everything else in `packages/contract` reads the document built in memory
   * from the route definitions, so without this one a hand-edited, half
   * regenerated or corrupted artifact reaches a push before anything notices:
   * CONTRACT-083's implementer deleted a `409` from the committed
   * `openapi.json` and watched eleven new tests stay green, because not one of
   * them reads the file.
   *
   * **It fails with a named cause, never a bare "stale".** Which artifacts
   * moved tells the three causes apart, and a stale `dist/` is ruled out in
   * words — the first guess for a mismatch in this repo is a build somebody has
   * not run, and here a build provably cannot change the answer.
   */
  it.each([OPENAPI_JSON_PATH, CLIENT_TYPES_PATH])(
    "has %s committed in sync with the route definitions",
    (path) => {
      const stale = Object.keys(expected).filter((at) => committed[at] !== expected[at]);
      expect(committed[path], staleArtifactDiagnosis(stale)).toBe(expected[path]);
    },
  );
});

/**
 * INFRA-032. The message a failing drift check prints is the whole of its value
 * to whoever meets it, and two of the three branches cannot be produced by an
 * ordinary mistake — client-types-only drift needs a dependency at the wrong
 * version — so they are pinned here rather than discovered in the one session
 * that hits them.
 */
describe("the drift check's diagnosis", () => {
  it("names the ordinary cause when both artifacts moved", () => {
    const said = staleArtifactDiagnosis([OPENAPI_JSON_PATH, CLIENT_TYPES_PATH]);
    expect(said).toContain("Both committed artifacts are out of date");
    expect(said).toContain("the route definitions under packages/contract/src changed");
    expect(said).toContain("Fix: npm run generate -w packages/contract");
  });

  /**
   * A document that still matches its routes rules the routes out, so this fix
   * starts with `npm install`: regenerating first would commit the wrong
   * generator's output and call it fixed.
   */
  it("blames the generator, not the routes, when only the client types moved", () => {
    const said = staleArtifactDiagnosis([CLIENT_TYPES_PATH]);
    expect(said).toContain("so the routes did not move");
    expect(said).toContain("openapi-typescript is at a different version");
    expect(said).toContain("Fix: npm install, then npm run generate -w packages/contract");
  });

  it("says the client types still describe the document when only it moved", () => {
    const said = staleArtifactDiagnosis([OPENAPI_JSON_PATH]);
    expect(said).toContain("edited by hand, or half a regeneration was committed");
    expect(said).toContain("Fix: npm run generate -w packages/contract");
  });

  /**
   * Verified rather than asserted: with `packages/contract/dist` moved aside
   * entirely, this file still passes, because nothing it reads resolves through
   * the package's `exports` map. The sentence is in every branch for the reason
   * it is true — a reader who reaches for `npm run build` here spends the time
   * and learns nothing.
   */
  it("rules a stale build out of every branch, because a build cannot change the answer", () => {
    for (const stale of [
      [OPENAPI_JSON_PATH, CLIENT_TYPES_PATH],
      [OPENAPI_JSON_PATH],
      [CLIENT_TYPES_PATH],
    ]) {
      expect(staleArtifactDiagnosis(stale)).toContain(NOT_A_STALE_BUILD);
    }
    expect(NOT_A_STALE_BUILD).toContain("`npm run build` cannot change this result");
  });
});

describe("contractPackageRoot", () => {
  it("resolves the package root, where the artifacts live", async () => {
    await expect(readFile(join(contractPackageRoot(), "package.json"), "utf8")).resolves.toContain(
      '"@corpus/contract"',
    );
  });
});
