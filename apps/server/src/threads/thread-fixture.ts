// The thread suites' fixture: a real workspace, a real git repository, the real
// Hono app, driven through `app.request` (SPEC.md §6, §7, §8).
//
// Nothing here is a mock. What SERVER-006 has to be right about — two files
// written atomically, one commit staging both, a timestamp that is unique
// because the write path made it so, an event file that a parked long-poll can
// see — is only observable against real bytes, a real `git log`, the real
// projection and the real queue directories. A test that stubbed any of them
// would assert that the stub was called.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createWriteWorkspace,
  type WriteWorkspace,
  type WriteWorkspaceOptions,
} from "../docs/write-fixture.js";
import { parseDocument, parseThreadBody } from "../core/index.js";

export {
  AUTH,
  JSON_HEADERS,
  FIXTURE_NOW,
  TOKEN,
  createDoc,
  putDoc,
  readDocKey,
} from "../docs/write-fixture.js";
export type { WriteWorkspace } from "../docs/write-fixture.js";

/** SERVER-006's own scratch label, so leftovers name their owner. */
export const THREAD_SPRINT = "s006";

export function createThreadWorkspace(
  prefix: string,
  options: WriteWorkspaceOptions = {},
): WriteWorkspace {
  return createWriteWorkspace(prefix, { sprint: THREAD_SPRINT, ...options });
}

/** The frontmatter of a workspace file, as plain YAML values. */
export const frontmatterOf = (ws: WriteWorkspace, path: string): Record<string, unknown> =>
  parseDocument(ws.read(path)).data;

export const threadPath = (id: string): string => `data/threads/${id}.md`;

export const threadFrontmatterOf = (ws: WriteWorkspace, id: string): Record<string, unknown> =>
  frontmatterOf(ws, threadPath(id));

/** The turns a thread file holds, parsed by the same code the server writes with. */
export const turnsOf = (
  ws: WriteWorkspace,
  id: string,
): { author: string; ts: string; body: string }[] => [
  ...parseThreadBody(parseDocument(ws.read(threadPath(id))).body).turns,
];

/**
 * Pending events, `evt_*.json` only. Every status directory ships a `.gitkeep`,
 * which has broken a count assertion in each of the last three sprints.
 */
export function pendingEvents(ws: WriteWorkspace): string[] {
  const dir = join(ws.root, ".corpus", "queue", "pending");
  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith("evt_") && name.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Runs `body` with the queue's `pending/` directory replaced by a regular file,
 * so the enqueue fails *after* the write pipeline has already committed — the
 * post-commit failure SERVER-021 is about.
 *
 * A read-only directory would do the same on a developer's machine and nothing
 * at all in a container running as root; `ENOTDIR` is refused for everyone. The
 * layout is restored whatever happens, or the fixture's own teardown would trip
 * over it.
 */
export async function withBrokenQueue<T>(ws: WriteWorkspace, body: () => Promise<T>): Promise<T> {
  const pending = join(ws.root, ".corpus", "queue", "pending");
  rmSync(pending, { recursive: true, force: true });
  writeFileSync(pending, "", "utf8");
  try {
    return await body();
  } finally {
    rmSync(pending, { force: true });
    mkdirSync(pending, { recursive: true });
  }
}

/**
 * The workspace-relative paths a turn body's attachment references point at,
 * percent-decoding the turn stamp the markdown escaped. §6's invariant is
 * exactly that each of these resolves once the turn is committed.
 */
export const referencedAttachments = (body: string): string[] =>
  [...body.matchAll(/]\(attachments\/([^)\s]+)\)/g)].map(
    (match) => `.corpus/attachments/${decodeURIComponent(match[1] ?? "")}`,
  );

export interface CreatedThread {
  readonly id: string;
  readonly anchorId: string | null;
  readonly eventId: string | null;
  readonly warnings: { code: string; detail: string }[];
  readonly thread: Record<string, unknown>;
}

/** `POST /api/threads`, failing loudly on anything but the declared `201`. */
export async function createThread(
  ws: WriteWorkspace,
  body: Record<string, unknown>,
  actor?: "user" | "agent",
): Promise<CreatedThread> {
  const response = await ws.post(
    "/api/threads",
    body,
    actor === undefined ? {} : { "x-corpus-author": actor },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (response.status !== 201) {
    throw new Error(`thread create failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  const thread = payload["thread"] as Record<string, unknown>;
  return {
    id: thread["id"] as string,
    anchorId: payload["anchorId"] as string | null,
    eventId: payload["eventId"] as string | null,
    warnings: payload["warnings"] as { code: string; detail: string }[],
    thread,
  };
}

export interface AppendedTurn {
  readonly status: number;
  readonly ts: string;
  readonly eventId: string | null;
  readonly body: Record<string, unknown>;
}

/** `POST /api/threads/{id}/turns` as JSON, returning the parsed envelope. */
export async function appendTurn(
  ws: WriteWorkspace,
  id: string,
  body: Record<string, unknown>,
  actor?: "user" | "agent",
): Promise<AppendedTurn> {
  const response = await ws.post(
    `/api/threads/${id}/turns`,
    body,
    actor === undefined ? {} : { "x-corpus-author": actor },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  const turn = payload["turn"] as { ts: string } | undefined;
  return {
    status: response.status,
    ts: turn?.ts ?? "",
    eventId: (payload["eventId"] as string | null | undefined) ?? null,
    body: payload,
  };
}

/** A `multipart/form-data` request against the real app, built from real parts. */
export async function postForm(
  ws: WriteWorkspace,
  path: string,
  parts: readonly (readonly [string, string | Blob])[],
  headers: Record<string, string> = {},
): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of parts) form.append(name, value);
  return ws.server.app.request(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${ws.server.config.token}`, ...headers },
    body: form,
  });
}
