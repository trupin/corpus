import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { OpenAPI3 } from "openapi-typescript";
import { buildOpenApiDocument } from "../openapi.js";

/**
 * Generation of the committed contract artifacts (SPEC.md §9.3). Kept out of
 * `tsconfig.build.json` so `openapi-typescript` stays a dev-only dependency and
 * never ships in `dist/`; `scripts/generate.ts` is the CLI shim over this module.
 */

/** Paths are relative to the package root so the generator can also target a temp dir in tests. */
export const OPENAPI_JSON_PATH = "openapi.json";
export const CLIENT_TYPES_PATH = "src/client/schema.generated.ts";

const CLIENT_TYPES_BANNER = `/**
 * Generated from openapi.json — do not edit.
 * Regenerate with: npm run generate -w packages/contract
 */
`;

export interface ContractArtifacts {
  /** Contents of the committed \`openapi.json\`. */
  readonly openapiJson: string;
  /** Contents of the generated \`paths\`/\`components\` module the typed client is built on. */
  readonly clientTypes: string;
}

/**
 * Renders both artifacts in memory. Byte-stable for a given set of route
 * definitions — that stability is what makes the drift check meaningful.
 */
export async function buildContractArtifacts(): Promise<ContractArtifacts> {
  const document = buildOpenApiDocument();
  const openapiJson = `${JSON.stringify(document, null, 2)}\n`;

  // Imported lazily so the module graph of `dist/` never reaches a devDependency.
  const { default: openapiTS, astToString } = await import("openapi-typescript");
  // Fed from the serialized bytes rather than the in-memory document, so the
  // client types can only ever describe what `openapi.json` actually says.
  const ast = await openapiTS(JSON.parse(openapiJson) as OpenAPI3);
  const clientTypes = `${CLIENT_TYPES_BANNER}${astToString(ast)}`;

  return { openapiJson, clientTypes };
}

/** Writes both artifacts under `packageRoot`, creating parent directories as needed. */
export async function writeContractArtifacts(packageRoot: string): Promise<ContractArtifacts> {
  const artifacts = await buildContractArtifacts();
  const targets: ReadonlyArray<readonly [string, string]> = [
    [OPENAPI_JSON_PATH, artifacts.openapiJson],
    [CLIENT_TYPES_PATH, artifacts.clientTypes],
  ];

  for (const [relativePath, contents] of targets) {
    const absolute = resolve(packageRoot, relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, "utf8");
  }

  return artifacts;
}

/** Absolute path of `packages/contract`, resolved from this module's location. */
export function contractPackageRoot(): string {
  return resolve(import.meta.dirname, "..", "..");
}

/**
 * The one thing this comparison provably is **not** about, said in every
 * failure (INFRA-032).
 *
 * A contributor who has not run `npm run build` has a stale `dist/`, and this
 * repo produces a phantom compiler error from exactly that cause often enough
 * that a reader's first guess is a build. It cannot be one here: both sides are
 * built from `packages/contract/src` — the committed file is read from disk and
 * the expected contents come from the route definitions this test imports
 * relatively — so the verdict is identical with `dist/` stale, current, or
 * deleted outright. Saying so costs one line and saves a build nobody needed. A
 * check that gets read as flaky is a check that gets turned off.
 */
export const NOT_A_STALE_BUILD =
  "This is not a stale `dist/`: both sides are built from `packages/contract/src`, so " +
  "`npm run build` cannot change this result.";

/**
 * Why the committed artifacts do not match the ones the route definitions
 * produce — **named, not guessed** (INFRA-032).
 *
 * Which artifacts are stale is itself the evidence, and the three patterns have
 * three different causes and two different fixes:
 *
 * - **Both.** The routes moved and nothing regenerated, or a committed file was
 *   hand-edited. The ordinary case, and `npm run generate` is the whole fix.
 * - **`openapi.json` alone.** The client types still match the document the
 *   routes produce, so the routes did not move — the committed document was
 *   edited, or only half of a regeneration was committed.
 * - **The client types alone.** The document is byte-identical, which rules the
 *   routes out entirely: the same input produced different output, so the
 *   *generator* changed. That is `openapi-typescript` at a version other than
 *   the one that wrote the committed file, and regenerating without installing
 *   first would commit that version's output rather than fix anything.
 *
 * A `dist/` is ruled out in all three ({@link NOT_A_STALE_BUILD}), because the
 * reader's first guess is otherwise a build that cannot help.
 */
export function staleArtifactDiagnosis(stale: readonly string[]): string {
  const openapiStale = stale.includes(OPENAPI_JSON_PATH);
  const clientStale = stale.includes(CLIENT_TYPES_PATH);
  const regenerate = "Fix: npm run generate -w packages/contract";

  if (openapiStale && clientStale) {
    return [
      `Both committed artifacts are out of date (${OPENAPI_JSON_PATH}, ${CLIENT_TYPES_PATH}).`,
      "Cause: the route definitions under packages/contract/src changed and nothing regenerated,",
      "or a committed artifact was edited by hand.",
      regenerate,
      NOT_A_STALE_BUILD,
    ].join("\n");
  }

  if (clientStale) {
    return [
      `${CLIENT_TYPES_PATH} is out of date and ${OPENAPI_JSON_PATH} is current.`,
      "Cause: the document the routes produce is byte-identical, so the routes did not move —",
      "the generator did. openapi-typescript is at a different version than the one that wrote",
      "the committed file, or the committed client types were edited by hand.",
      "Fix: npm install, then npm run generate -w packages/contract",
      NOT_A_STALE_BUILD,
    ].join("\n");
  }

  return [
    `${OPENAPI_JSON_PATH} is out of date and ${CLIENT_TYPES_PATH} is current.`,
    "Cause: the committed document was edited by hand, or half a regeneration was committed —",
    "the client types still describe the document the routes produce.",
    regenerate,
    NOT_A_STALE_BUILD,
  ].join("\n");
}
