import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { InternalError } from "../errors.js";

/**
 * `.corpus/template-manifest.json` — what `corpus init` installed, so
 * `corpus workspace upgrade` can three-way compare against the **original**
 * bytes later (SPEC.md §2.1).
 *
 * The manifest is worthless if written after the fact: nothing can retroactively
 * learn what the first install contained, which is why `corpus init` writes it in
 * the same run (sprint-003 Open Conflict 10). It records a workspace-relative
 * **post-rename** path and the sha-256 of the bytes that were installed.
 *
 * It is deliberately the only thing under `.corpus/` an upgrade may write: the
 * rest of that directory is runtime state the server owns.
 */

export interface ManifestEntry {
  /** Workspace-relative, POSIX-separated, post-rename. */
  readonly path: string;
  readonly sha256: string;
  /**
   * Sha of the same bytes with the upgrade-ignored frontmatter keys removed
   * (`ignored-keys.ts`, CLI-083) — what lets a later run tell "differs only in
   * a server stamp or a column width" from "edited".
   *
   * Optional rather than a manifest version 2: a manifest written before
   * CLI-083 has no way to gain it — the installed bytes are gone, so the
   * normalized baseline is unrecoverable, never guessed (sprint-024 P4) — and
   * an optional field lets both generations parse under `version: 1` in both
   * directions ({@link readTemplateManifest}'s `isEntry` is structural and
   * carries unknown keys, so an older tool reads a newer manifest too). An
   * entry without it simply compares raw, which for the residual case —
   * upstream changed the file and the workspace's only delta is ignored keys —
   * honestly reads `keep-modified`.
   */
  readonly normalizedSha256?: string;
}

export interface TemplateManifest {
  readonly version: 1;
  readonly tool: string;
  readonly installedAt: string;
  readonly files: readonly ManifestEntry[];
}

export function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * Serialized exactly as `corpus init` writes it: 2-space JSON with a trailing
 * newline, so a manifest an upgrade rewrites is diff-comparable with the one the
 * initial commit recorded.
 */
export function serializeManifest(manifest: TemplateManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * The workspace's manifest, or `undefined` when there is none — a workspace
 * created before manifests existed is a normal state that
 * `corpus workspace upgrade` handles conservatively, not an error.
 *
 * A manifest that exists but does not parse *is* an error: guessing at a broken
 * baseline is how an upgrade would clobber the file it exists to protect.
 */
export function readTemplateManifest(manifestPath: string): TemplateManifest | undefined {
  if (!existsSync(manifestPath)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (cause) {
    throw manifestError(manifestPath, "it is not valid JSON", cause);
  }
  if (!isManifest(parsed)) throw manifestError(manifestPath, "its shape is not recognised");
  return parsed;
}

function manifestError(path: string, why: string, cause?: unknown): InternalError {
  return new InternalError(`the template manifest at ${path} cannot be read: ${why}.`, {
    hint: "Move it aside and re-run with `--adopt` to write a fresh baseline; nothing is overwritten in the meantime.",
    ...(cause === undefined ? {} : { cause }),
  });
}

function isManifest(value: unknown): value is TemplateManifest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TemplateManifest>;
  return (
    candidate.version === 1 &&
    typeof candidate.tool === "string" &&
    typeof candidate.installedAt === "string" &&
    Array.isArray(candidate.files) &&
    candidate.files.every(isEntry)
  );
}

/**
 * Structural, never exhaustive: an entry is recognised by the two fields this
 * tool reads, and any other key on it is carried along and ignored. That is what
 * lets a manifest written by an older tool — which recorded a provenance marker
 * beside the hash — still parse instead of being rejected as unrecognisable,
 * which would break `corpus workspace upgrade` in the very workspaces it exists
 * to protect.
 *
 * `normalizedSha256` is read when it is a string and treated as absent for any
 * other shape, rather than failing the manifest: a malformed optional field
 * degrades to the raw comparison, which is exactly the pre-CLI-083 behaviour
 * and overwrites nothing.
 */
function isEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ManifestEntry>;
  return typeof candidate.path === "string" && typeof candidate.sha256 === "string";
}
