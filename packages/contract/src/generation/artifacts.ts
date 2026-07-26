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
