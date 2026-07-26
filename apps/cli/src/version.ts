import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * The version `corpus --version` prints. Read from this package's own
 * package.json — from `src/` when running under tsx and from `dist/` when
 * running the built bin, both of which sit one level below the package root.
 */

const PackageManifestSchema = z.looseObject({ version: z.string().min(1) });

export function cliPackageRoot(): string {
  return resolve(import.meta.dirname, "..");
}

export function readPackageVersion(packageRoot: string = cliPackageRoot()): string {
  const manifestPath = resolve(packageRoot, "package.json");
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  return PackageManifestSchema.parse(parsed).version;
}
