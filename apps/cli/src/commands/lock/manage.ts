import { DEFAULT_LOCK_TTL_SECONDS } from "@corpus/contract";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * Reading and holding document locks (SPEC.md §7). `acquire`/`release` are the
 * explicit form of what the editing verbs do implicitly; they exist here so a
 * script — or an operator diagnosing contention — can take and drop a lease
 * without editing anything. Both act as the agent, like every other CLI call;
 * `lock break` is the one exception, and it is a different verb for that reason.
 */

export async function runAcquire(context: WorkspaceCommandContext): Promise<void> {
  const docId = context.args.get("doc-id");
  const ttl = context.flags.number("ttl");
  const lock = await context.client.request((api) =>
    api.POST("/api/locks/{docId}", {
      params: { path: { docId } },
      ...(ttl === undefined ? {} : { body: { ttl } }),
    }),
  );
  context.out.emit(lock);
  context.out.line(`locked ${lock.docId} for ${lock.holder}, lease ${String(lock.ttl)}s.`);
}

export async function runRelease(context: WorkspaceCommandContext): Promise<void> {
  const docId = context.args.get("doc-id");
  const result = await context.client.request((api) =>
    api.DELETE("/api/locks/{docId}", { params: { path: { docId } } }),
  );
  context.out.emit(result);
  context.out.line(`released the ${result.holder} lock on ${result.docId}.`);
}

export async function runList(context: WorkspaceCommandContext): Promise<void> {
  const result = await context.client.request((api) => api.GET("/api/locks"));
  context.out.emit(result);
  if (result.locks.length === 0) {
    context.out.line("no locks held.");
    return;
  }
  for (const lock of result.locks) {
    context.out.line(
      `${lock.docId} — ${lock.holder}, acquired ${lock.acquired}, lease ${String(lock.ttl)}s`,
    );
  }
}

export async function runReap(context: WorkspaceCommandContext): Promise<void> {
  const result = await context.client.request((api) => api.POST("/api/locks/reap"));
  context.out.emit(result);
  context.out.line(
    result.reaped.length === 0
      ? "no expired locks."
      : `cleared ${String(result.reaped.length)} expired lock(s): ${result.reaped.join(", ")}`,
  );
}

const DOC_ID_ARG = {
  name: "doc-id",
  required: true,
  description: "The document's id.",
} as const;

export const acquireCommand: WorkspaceCommandSpec = {
  name: "acquire",
  summary: "Take a document's edit lock.",
  description:
    "One holder at a time. Re-acquiring a lock you already hold renews its lease; a lock held by " +
    "the other party answers `409` (exit 5) carrying that lock, so the caller can see who has it " +
    "and until when.",
  args: [DOC_ID_ARG],
  flags: [
    {
      name: "ttl",
      type: "number",
      valueName: "seconds",
      description: `Lease length. The server's default is ${String(DEFAULT_LOCK_TTL_SECONDS)}s; a TTL is what stops a crashed session wedging a document.`,
    },
  ],
  examples: [
    {
      command: "corpus lock acquire doc_a1b2c3",
      description: "Hold a document for the default lease.",
    },
    {
      command: "corpus lock acquire doc_a1b2c3 --ttl 60 --json",
      description:
        'One JSON value: `{"docId":"doc_a1b2c3","holder":"agent","acquired":"2026-07-27T10:00:00.000Z","ttl":60}`.',
    },
  ],
  handler: (context) => runAcquire(context),
};

export const releaseCommand: WorkspaceCommandSpec = {
  name: "release",
  summary: "Drop a document's edit lock.",
  description:
    "Only the holder may release: a lock held by the other party answers `403` (exit 5), and a " +
    "document with no lock answers `404` (exit 5). To clear somebody else's lock, break it.",
  args: [DOC_ID_ARG],
  flags: [],
  examples: [
    { command: "corpus lock release doc_a1b2c3", description: "Release a lock you hold." },
  ],
  handler: (context) => runRelease(context),
};

export const listCommand: WorkspaceCommandSpec = {
  name: "list",
  summary: "Show every lock currently held.",
  description:
    "Reads `GET /api/locks` — the same state the board's lock banners render, so a document that " +
    "refuses a write shows up here with its holder and lease.",
  args: [],
  flags: [],
  examples: [
    { command: "corpus lock list", description: "One line per held lock, or `no locks held.`" },
    {
      command: "corpus lock list --json",
      description: 'One JSON value: `{"locks":[{"docId":"doc_a1b2c3","holder":"user",…}]}`.',
    },
  ],
  handler: (context) => runList(context),
};

export const reapCommand: WorkspaceCommandSpec = {
  name: "reap",
  summary: "Clear locks that are past their lease.",
  description:
    "Releases every lock whose TTL has expired, so a crashed editor cannot wedge a document — the " +
    "lock twin of `corpus queue reap-stale`. A lock still inside its lease is left alone, and a " +
    "second call reports nothing cleared and exits 0.",
  args: [],
  flags: [],
  examples: [
    { command: "corpus lock reap", description: "Clear leases left behind by a crashed session." },
    {
      command: "corpus lock reap --json",
      description: 'One JSON value: `{"reaped":["doc_a1b2c3"]}`, empty when nothing had expired.',
    },
  ],
  handler: (context) => runReap(context),
};
