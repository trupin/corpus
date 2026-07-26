import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildContractArtifacts,
  CLIENT_TYPES_PATH,
  contractPackageRoot,
  OPENAPI_JSON_PATH,
  writeContractArtifacts,
  type ContractArtifacts,
} from "./artifacts.js";

let first: ContractArtifacts;
let second: ContractArtifacts;
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "corpus-contract-"));
  first = await writeContractArtifacts(scratch);
  second = await buildContractArtifacts();
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
   * The same check the pre-push hook performs, run as a unit test so CI fails on
   * drift too (SPEC.md §9.3 asks for the check in both places).
   */
  it.each([
    [OPENAPI_JSON_PATH, () => first.openapiJson],
    [CLIENT_TYPES_PATH, () => first.clientTypes],
  ])("has %s committed in sync with the route definitions", async (path, expected) => {
    const committed = await readFile(join(contractPackageRoot(), path), "utf8");
    expect(committed, `${path} is stale — run: npm run generate -w packages/contract`).toBe(
      expected(),
    );
  });
});

describe("contractPackageRoot", () => {
  it("resolves the package root, where the artifacts live", async () => {
    await expect(readFile(join(contractPackageRoot(), "package.json"), "utf8")).resolves.toContain(
      '"@corpus/contract"',
    );
  });
});
