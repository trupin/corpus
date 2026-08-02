/**
 * Boot wiring for the embedded engine: build it, give it a voice, and make sure
 * it is torn down before the process exits.
 *
 * Constructing an engine costs nothing — no filesystem access, no network, no
 * runtime load. `availability()` is the first thing that looks at the disk, and
 * `open()` the first thing that reads 22 MiB, and both happen only because
 * SERVER-043's resolution asked. So this can run unconditionally on every boot,
 * including in a workspace that will never index anything.
 *
 * The engine's cache location comes from **the environment the server was
 * given**, not from the process's: `runServerProcess` already threads `env`
 * through for exactly this kind of decision, and it is what keeps a test that
 * boots a server with `env: {}` from reaching into a developer's real model
 * cache (`cache.ts`).
 */

import type { CorpusServer } from "../../app.js";
import {
  createEmbeddedEngine,
  type CorpusEmbeddedEngine,
  type EmbeddedEngineOptions,
} from "./engine.js";

export interface AttachEmbeddedEngineOptions {
  readonly platform?: NodeJS.Platform | undefined;
  /**
   * Everything the server itself does not decide — the manifest, the runtime,
   * the transport. Nothing sets it in production; it is the seam a test, or a
   * future caller pointing at a mirrored artifact, reaches through.
   */
  readonly engine?: Omit<EmbeddedEngineOptions, "location" | "report"> | undefined;
}

export function attachEmbeddedEngine(
  server: CorpusServer,
  env: Readonly<Record<string, string | undefined>>,
  options: AttachEmbeddedEngineOptions = {},
): CorpusEmbeddedEngine {
  const engine = createEmbeddedEngine({
    ...options.engine,
    location: { env, platform: options.platform ?? process.platform },
    report: ({ level, message }) => {
      if (level === "error") server.logger.error(message);
      else server.logger.info(message);
    },
  });
  server.registerDisposer(() => engine.close());
  return engine;
}
