/**
 * Where the model artifact lives: one directory per user, shared by every
 * workspace on the machine.
 *
 * Per-user rather than per-workspace because the artifact is 22 MiB of
 * revision-pinned, byte-identical data — a second workspace has nothing to gain
 * from a second copy, and `corpus init` would otherwise cost a download.
 * Outside the workspace because §9.1 makes the semantic index derived state
 * that is "never in git", and a 22 MiB file inside `data/` would be exactly the
 * kind of thing a `git add -A` sweeps in.
 *
 * **The location is derived from the environment the server was given**, never
 * from `os.homedir()`. Two consequences, both wanted: a server booted with an
 * environment naming no home directory (which is how this package's own tests
 * boot one) has nowhere to cache a model and says so, instead of quietly
 * reaching into the developer's real cache; and `CORPUS_MODEL_CACHE_DIR` is
 * enough to relocate it, for a sandbox, a shared read-only mirror, or an E2E
 * run that must start cold. An override that cannot be used is **refused, not
 * ignored** — see {@link ModelCacheRoot}.
 *
 * Platform conventions are followed rather than invented: `~/Library/Caches` on
 * macOS, `%LOCALAPPDATA%` on Windows, XDG elsewhere. The leaf is
 * `<model>@<revision>` so a manifest bump lands beside the old artifact instead
 * of on top of it — a rollback is then a code change, not a re-download.
 */

import { join, posix, win32 } from "node:path";
import type { EmbeddedModelManifest } from "./manifest.js";

/** Overrides every platform default. Must be absolute — a relative cache would follow `cwd`. */
export const MODEL_CACHE_DIR_ENV = "CORPUS_MODEL_CACHE_DIR";

export interface CacheLocation {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
}

/**
 * Where the artifacts go, or why nowhere.
 *
 * The third case is the one that earns the union. An operator — or an E2E run
 * that must start cold — who sets `CORPUS_MODEL_CACHE_DIR` to a relative path
 * has stated an intent, and the old behaviour was to discard it and fall back to
 * the platform default: the run then found the *shared* per-user cache, warm,
 * and reported a first-run download it never performed. A refusal that says so
 * is the only answer that cannot be mistaken for success.
 */
export type ModelCacheRoot =
  /** Use this directory. */
  | { readonly kind: "root"; readonly path: string }
  /** The environment names no per-user location, and no override was given. */
  | { readonly kind: "unset" }
  /** An override was given and cannot be used. `detail` is the sentence to publish. */
  | { readonly kind: "unusable"; readonly detail: string };

/**
 * Path handling follows the *named* platform rather than the running one, so
 * `C:\Users\…` is recognised as absolute when deciding what Windows would do —
 * a test on macOS asking about `win32` gets Windows' answer, not a wrong one.
 */
const pathFor = (platform: NodeJS.Platform): typeof posix => (platform === "win32" ? win32 : posix);

/**
 * The root every model directory hangs under, or `undefined` when the
 * environment names no per-user location — which is a real answer, not a
 * failure: the engine reports itself unavailable and the server serves
 * documents exactly as before.
 */
export function modelCacheRoot(location: CacheLocation): ModelCacheRoot {
  const { env, platform } = location;
  const path = pathFor(platform);
  const absolute = (value: string | undefined): string | undefined =>
    value !== undefined && value !== "" && path.isAbsolute(value) ? value : undefined;
  const root = (value: string | undefined): ModelCacheRoot =>
    value === undefined ? { kind: "unset" } : { kind: "root", path: value };

  // An override that is present but unusable is refused rather than ignored: a
  // silent fall-through to the platform default would hand back the shared warm
  // cache under a name the caller chose precisely to avoid it.
  const written = env[MODEL_CACHE_DIR_ENV];
  if (written !== undefined && written !== "") {
    if (!path.isAbsolute(written)) {
      return {
        kind: "unusable",
        detail:
          `${MODEL_CACHE_DIR_ENV} is set to the relative path ${written}; it must be absolute, ` +
          "because a relative model cache would follow whatever directory the server was " +
          "started from — set it to an absolute path or unset it to use the per-user default",
      };
    }
    return { kind: "root", path: written };
  }

  if (platform === "darwin") {
    const home = absolute(env["HOME"]);
    return root(
      home === undefined ? undefined : path.join(home, "Library", "Caches", "corpus", "models"),
    );
  }

  if (platform === "win32") {
    const local = absolute(env["LOCALAPPDATA"]);
    if (local !== undefined) return root(path.join(local, "corpus", "Cache", "models"));
    const profile = absolute(env["USERPROFILE"]);
    return root(
      profile === undefined
        ? undefined
        : path.join(profile, "AppData", "Local", "corpus", "Cache", "models"),
    );
  }

  const xdg = absolute(env["XDG_CACHE_HOME"]);
  if (xdg !== undefined) return root(path.join(xdg, "corpus", "models"));
  const home = absolute(env["HOME"]);
  return root(home === undefined ? undefined : path.join(home, ".cache", "corpus", "models"));
}

/** `<root>/<model>@<revision>` — the directory holding one manifest's artifacts. */
export function modelCacheDir(
  root: string,
  manifest: Pick<EmbeddedModelManifest, "model" | "revision">,
): string {
  return join(root, `${manifest.model}@${manifest.revision}`);
}
