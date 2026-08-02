/**
 * Boot wiring for the embedding seam: resolve a provider once, say what
 * happened, and compare what resolved against what the index was built with.
 *
 * It runs **beside** the boot, never in front of it. Resolution embeds a probe,
 * and a configured endpoint that black-holes packets would otherwise hold the
 * socket closed for the whole timeout — a document server must serve documents
 * whether or not anything can embed them. The disposer awaits the in-flight
 * resolution after aborting it, so a shutdown cannot leave a `fetch` writing log
 * lines into a closed process.
 *
 * SERVER-043 stops at reporting. The mismatch this detects is what SERVER-044
 * turns into a queued rebuild and SERVER-046 renders in `GET /api/index/status`;
 * nothing here writes a row, drops a vector, or queues work — an issue that both
 * detects invalidation and acts on it is an issue where the detection can never
 * be tested alone.
 */

import type { CorpusServer } from "../app.js";
import { describeThrown } from "../errors.js";
import { recordedIdentities } from "./embeddings.js";
import { checkIndexIdentity, type IndexIdentityCheck } from "./identity.js";
import type { EmbeddedEngine } from "./embedded-engine.js";
import type { FetchLike } from "./http-provider.js";
import {
  describeResolution,
  resolveEmbeddingProvider,
  type ProviderResolution,
} from "./resolve.js";

export interface AttachSemanticIndexDeps {
  /** `undefined` until SERVER-048 registers the in-process engine. */
  readonly embeddedEngine?: EmbeddedEngine | undefined;
  readonly fetchFn?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface SemanticIndexBootReport {
  readonly resolution: ProviderResolution;
  readonly check: IndexIdentityCheck;
}

export interface SemanticIndexHandle {
  /** Settles when the boot resolution has been logged. Never rejects. */
  readonly ready: Promise<SemanticIndexBootReport>;
}

function logCheck(server: CorpusServer, check: IndexIdentityCheck): void {
  switch (check.kind) {
    case "mismatch":
      server.logger.info(
        `semantic index identity changed: recorded ${check.recorded}, resolved ${check.resolved} — ` +
          "the index is invalid until it is rebuilt",
        { recorded: check.recorded, resolved: check.resolved },
      );
      return;
    case "mixed":
      server.logger.error(
        `semantic index holds vectors from more than one model: ${check.identities.join(", ")}`,
        { identities: [...check.identities] },
      );
      return;
    case "unresolved":
      server.logger.info(
        `semantic index recorded ${check.recorded}; nothing can embed right now, so the ` +
          "existing vectors stay as they are",
        { recorded: check.recorded },
      );
      return;
    default:
      server.logger.debug("semantic index identity checked", { check: check.kind });
  }
}

export function attachSemanticIndex(
  server: CorpusServer,
  deps: AttachSemanticIndexDeps = {},
): SemanticIndexHandle {
  const controller = new AbortController();

  const ready = (async (): Promise<SemanticIndexBootReport> => {
    const recorded = server.projection === undefined ? [] : recordedIdentities(server.projection);

    const resolution = await resolveEmbeddingProvider({
      settings: server.config.embedding,
      recordedIdentities: recorded,
      signal: controller.signal,
      ...(deps.embeddedEngine === undefined ? {} : { embeddedEngine: deps.embeddedEngine }),
      ...(deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn }),
      ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    });

    const report = describeResolution(resolution);
    if (report.level === "error") {
      // Deliberately message-only: the operator's next action is to fix an
      // endpoint or a key, and a stack trace from inside `fetch` names none of
      // the things they have to change.
      server.logger.error(report.message);
    } else {
      server.logger.info(report.message);
    }

    const check = checkIndexIdentity(
      recorded,
      resolution.kind === "provider" ? resolution.identity : null,
    );
    logCheck(server, check);

    return { resolution, check };
  })().catch((error: unknown): SemanticIndexBootReport => {
    // Resolution is written not to throw; if it ever does, the server keeps
    // serving and the seam reports the only honest thing it can.
    server.logger.error("semantic index resolution failed", describeThrown(error));
    const detail = error instanceof Error ? error.message : String(error);
    return {
      resolution: { kind: "error", reason: "engine-failed", detail },
      check: { kind: "no-index" },
    };
  });

  server.registerDisposer(async () => {
    controller.abort();
    await ready;
  });

  return { ready };
}
