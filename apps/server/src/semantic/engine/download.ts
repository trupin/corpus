/**
 * Fetching a pinned artifact into the cache, and refusing to keep anything that
 * is not byte-for-byte what the manifest promised.
 *
 * The rule the issue states — "a tampered or truncated download is discarded
 * and reported, never loaded" — is enforced structurally rather than by
 * remembering to check:
 *
 * - Bytes are hashed **as they stream**, so a response longer than the pinned
 *   length is cut off mid-flight instead of filling a disk first.
 * - They land in a `.part` file whose name carries the pid, so two servers on
 *   one machine cannot interleave into one another's partial download.
 * - The `.part` file is renamed into place **only after** the length and digest
 *   both match. A file at its final name is therefore, by construction, a file
 *   that passed. There is no "downloaded but unverified" state to reason about.
 * - Every failure path unlinks the partial file before it propagates, so a
 *   retry starts clean and a crashed download leaves at most a `.part`.
 *
 * `fetch` is injected rather than imported so the whole module is testable
 * without a network — and so the E2E can prove the opposite, that a run with
 * the cache warm calls it zero times.
 */

import { createHash } from "node:crypto";
import { open, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { CorpusError } from "../../errors.js";
import type { FetchLike } from "../http-provider.js";
import type { ModelArtifact } from "./manifest.js";

/** A download that did not arrive, or did not arrive intact. Never carries a URL's query. */
export class ModelDownloadError extends CorpusError {
  override readonly name = "ModelDownloadError";
}

export interface DownloadProgress {
  readonly artifact: string;
  readonly received: number;
  readonly total: number;
}

export interface DownloadArtifactOptions {
  readonly artifact: ModelArtifact;
  readonly dir: string;
  readonly fetchFn: FetchLike;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((progress: DownloadProgress) => void) | undefined;
}

/** Where an artifact lives once it has been verified. */
export const artifactPath = (dir: string, artifact: ModelArtifact): string =>
  join(dir, artifact.name);

/**
 * What the cache holds for one artifact, decided by a `stat` alone.
 *
 * Cheap on purpose: this answers `availability()`, which the seam may call on
 * every resolution, and hashing 22 MiB to answer "is it there?" would put a
 * disk read on a question asked far more often than the model is loaded. The
 * full digest is still verified — once, immediately before the bytes are
 * parsed (`readVerifiedArtifact`), which is the check that actually protects
 * the runtime.
 */
export type CachedArtifactState = "present" | "absent" | "damaged";

export async function inspectArtifact(
  dir: string,
  artifact: ModelArtifact,
): Promise<CachedArtifactState> {
  try {
    const stats = await stat(artifactPath(dir, artifact));
    if (!stats.isFile()) return "damaged";
    return stats.size === artifact.bytes ? "present" : "damaged";
  } catch {
    return "absent";
  }
}

/**
 * Reads a cached artifact and returns its bytes only if they hash to the pin.
 *
 * The bytes are returned rather than the path, and the caller hands *those
 * bytes* to the parser: verifying a path and then re-reading it would leave a
 * window in which the file changed between the two. A mismatch deletes the file
 * — a cached artifact that fails its hash is worthless, and keeping it would
 * make every later attempt fail the same way — and throws.
 */
export async function readVerifiedArtifact(
  dir: string,
  artifact: ModelArtifact,
): Promise<Uint8Array> {
  const path = artifactPath(dir, artifact);
  let bytes: Uint8Array;
  try {
    const handle = await open(path, "r");
    try {
      const buffer = await handle.readFile();
      bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw new ModelDownloadError(`${artifact.name} could not be read from the model cache`, {
      cause: error,
    });
  }

  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== artifact.bytes || digest !== artifact.sha256) {
    await rm(path, { force: true });
    throw new ModelDownloadError(
      `${artifact.name} in the model cache is not the pinned artifact ` +
        `(${bytes.byteLength} bytes, sha256 ${digest}; expected ${artifact.bytes} bytes, ` +
        `sha256 ${artifact.sha256}) — it has been discarded and will be downloaded again`,
    );
  }
  return bytes;
}

/**
 * Streams one artifact into `dir`, verifying as it goes. Resolves only when a
 * file matching the pin exists at its final name.
 */
export async function downloadArtifact(options: DownloadArtifactOptions): Promise<void> {
  const { artifact, dir, fetchFn, signal } = options;
  const partial = join(dir, `${artifact.name}.part-${String(process.pid)}`);

  const response = await fetchFn(artifact.url, signal === undefined ? {} : { signal });
  if (!response.ok) {
    throw new ModelDownloadError(
      `downloading ${artifact.name} failed: HTTP ${String(response.status)}`,
    );
  }
  const body = response.body;
  if (body === null) {
    throw new ModelDownloadError(`downloading ${artifact.name} failed: the response had no body`);
  }

  const hash = createHash("sha256");
  let received = 0;
  try {
    const handle = await open(partial, "w");
    try {
      for await (const chunk of body) {
        const bytes = chunk as Uint8Array;
        received += bytes.byteLength;
        if (received > artifact.bytes) {
          throw new ModelDownloadError(
            `downloading ${artifact.name} failed: the response is longer than the pinned ` +
              `${String(artifact.bytes)} bytes`,
          );
        }
        hash.update(bytes);
        await handle.write(bytes);
        options.onProgress?.({ artifact: artifact.name, received, total: artifact.bytes });
      }
    } finally {
      await handle.close();
    }

    if (received !== artifact.bytes) {
      throw new ModelDownloadError(
        `downloading ${artifact.name} failed: got ${String(received)} bytes, expected ` +
          `${String(artifact.bytes)} — the download was truncated`,
      );
    }
    const digest = hash.digest("hex");
    if (digest !== artifact.sha256) {
      throw new ModelDownloadError(
        `downloading ${artifact.name} failed: sha256 ${digest} does not match the pinned ` +
          `${artifact.sha256} — the artifact has been discarded`,
      );
    }
    await rename(partial, artifactPath(dir, artifact));
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}
