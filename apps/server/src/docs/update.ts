// `PUT /api/docs/{id}` — the save path, and the one place anchor reconciliation
// is guaranteed to run (SPEC.md §5, §6, §9.2).
//
// Two properties are what make §6 "a mechanical guarantee of the write path,
// not a discipline anyone has to remember":
//
// - `oldBody` is the body **as read from disk in this request**, never a
//   client-supplied copy. An edit that landed out of band since the client last
//   read is therefore reconciled against reality rather than against a stale
//   snapshot, and it survives the save.
// - The reconciled `anchors` map is written **in the same serialization and the
//   same commit** as the body. A design that wrote anchors afterwards would
//   leave a window in which a crash detaches every thread on the document.

import type { Actor, AnchorReconciliation, Doc, UpdateDocRequest } from "@corpus/contract";
import { EXTRA_MAX_BYTES } from "@corpus/contract";
import { reconcileAnchors } from "../anchors/index.js";
import {
  formatInstant,
  readExtraFrontmatter,
  serializeDocument,
  setBody,
  setFrontmatterFields,
} from "../core/index.js";
import { badRequest } from "../errors.js";
import { DOCS_KEY, docKey } from "../events/index.js";
import { loadDocument, readAnchorsMap, toWireDoc } from "./read.js";
import {
  runMutation,
  validateBeforeWrite,
  type DocsWorkspace,
  type DocumentMutex,
  type MutationResult,
} from "./write.js";

export type UpdateOutcome = {
  readonly doc: Doc;
  readonly anchors: AnchorReconciliation;
  readonly result: MutationResult;
};

/** Bounded so a YAML value that aliases its own ancestor cannot spin forever. */
const MAX_CANONICAL_DEPTH = 12;

/**
 * A value in a form whose JSON text depends on its *content* and not on the
 * order its keys happen to sit in. `query: {type: thread, status: open}` and
 * `query: {status: open, type: thread}` are one value, and re-sending the same
 * query with its keys in another order must not count as a change — otherwise
 * the save stamps `updated` and commits a file whose bytes did not move
 * (CONTRACT-011 made `query` and `extra` the first object-valued keys a `PUT`
 * can carry, so this is new ground for {@link sameValue}).
 */
function canonicalize(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== "object" || depth >= MAX_CANONICAL_DEPTH) {
    return value ?? null;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalize(item, depth + 1)]),
  );
}

/** `undefined` for a value with no JSON text at all — a cycle, or a bigint. */
const canonicalJson = (value: unknown): string | undefined => {
  try {
    return JSON.stringify(canonicalize(value, 0));
  } catch {
    return undefined;
  }
};

/** Structural equality for the frontmatter values a `PUT` can carry. */
const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  const left = canonicalJson(a);
  // A value that cannot be compared is treated as different, so the patch's own
  // value replaces it — which is what "the named key is replaced wholesale"
  // means for a file the reader could not make sense of.
  return left !== undefined && left === canonicalJson(b);
};

/**
 * The `UpdateDocRequest` fields that are **frontmatter** keys and whose value
 * is written literally. `body` is deliberately absent: it is the markdown below
 * the fence, and copying the request's fields wholesale into the frontmatter
 * patch would write a `body:` key into the YAML block beside the real body.
 *
 * `pinned` belongs here rather than with the clearable keys because it is not
 * nullable on the wire: its absent and `false` states mean the same thing, so
 * `pinned: false` is written as itself — an explicit `pinned: false` in the
 * file and no `pinned` key at all both read back as `false` (CONTRACT-011).
 */
export const UPDATABLE_FRONTMATTER_KEYS = [
  "title",
  "tags",
  "status",
  "due",
  "reviewed",
  "evergreen",
  "pinned",
] as const satisfies readonly (keyof UpdateDocRequest)[];

/**
 * The §11 view keys whose `null` **clears the key from the file** rather than
 * writing `null` into it (CONTRACT-011). `due` and `reviewed` are pointedly not
 * here: they are §5 canonical-block fields whose `null` is a written value.
 */
export const CLEARABLE_FRONTMATTER_KEYS = [
  "order",
  "query",
  "column",
] as const satisfies readonly (keyof UpdateDocRequest)[];

/**
 * The frontmatter fields the request actually changes. A `PUT` names only what
 * it changes, and autosave re-sends unchanged values constantly, so "present in
 * the request" is not the same question as "different from the file".
 *
 * A key mapped to `undefined` is a **removal**: that is `setFrontmatterFields`'
 * own spelling for deleting a key, and it is how a clearing `null` and a
 * removing `extra` entry reach the file. Removals of keys the file does not
 * carry are dropped here rather than passed on, so a `null` that clears nothing
 * does not make the save stamp `updated`.
 */
export function changedFields(
  current: Readonly<Record<string, unknown>>,
  patch: UpdateDocRequest,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const key of UPDATABLE_FRONTMATTER_KEYS) {
    const value = patch[key];
    if (value === undefined) continue;
    if (sameValue(current[key], value)) continue;
    changed[key] = value;
  }
  for (const key of CLEARABLE_FRONTMATTER_KEYS) {
    applyPatchEntry(changed, current, key, patch[key]);
  }
  // **`extra` is a shallow merge patch** (RFC 7386 at the top level): a named
  // key replaces the file's key wholesale, `null` removes it, and a key the
  // request does not name is left alone byte-for-byte — which is what lets two
  // plugins write different keys of one document without racing each other.
  // Never a read-modify-write of the whole object, and never a nested merge.
  for (const [key, value] of Object.entries(patch.extra ?? {})) {
    applyPatchEntry(changed, current, key, value);
  }
  return changed;
}

/** One merge-patch entry: `undefined` skips, `null` removes, anything else replaces. */
function applyPatchEntry(
  changed: Record<string, unknown>,
  current: Readonly<Record<string, unknown>>,
  key: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (value === null) {
    if (Object.hasOwn(current, key)) changed[key] = undefined;
    return;
  }
  if (sameValue(current[key], value)) return;
  changed[key] = value;
}

/** A document's `extra` object as the contract measures it: JSON, in UTF-8 bytes. */
const extraBytes = (data: Readonly<Record<string, unknown>>): number =>
  new TextEncoder().encode(JSON.stringify(readExtraFrontmatter(data))).length;

/**
 * `EXTRA_MAX_BYTES` over the **merged result**, which is the only place it means
 * anything (PR #10 finding 15).
 *
 * `ExtraFrontmatterSchema` bounds one request's `extra`; `extra` on update is a
 * shallow merge patch, so twenty requests of 20 KiB under twenty different keys
 * each passed that check and left a 400 KiB object on disk — past a bound the
 * contract advertises to every reader, and past the point where the document's
 * own row is a sane thing to carry in a collection response. The bound belongs
 * to the document, so it is checked against what the file will hold.
 *
 * **Only growth is refused.** A file can exceed the bound only by being edited
 * out of band, and a document in that state must stay editable — otherwise every
 * autosave on it would 400, and the one patch that could fix it (dropping keys)
 * would be refused along with the rest. So a write that leaves `extra` no larger
 * than it found it is allowed through whatever its size, and it is specifically
 * *growing past* the bound that is rejected.
 */
function assertExtraWithinBound(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): void {
  const bytes = extraBytes(after);
  if (bytes <= EXTRA_MAX_BYTES || bytes <= extraBytes(before)) return;
  throw badRequest("request failed validation", [
    {
      path: "body.extra",
      message:
        `this patch would leave \`extra\` at ${String(bytes)} bytes on disk; the bound is ` +
        `${String(EXTRA_MAX_BYTES)} bytes per document. \`extra\` is a merge patch, so the bound ` +
        "is on the merged result, not on one request.",
    },
  ]);
}

export async function updateDocument(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  patch: UpdateDocRequest,
): Promise<UpdateOutcome> {
  return mutex.run(id, async () => {
    // §7's edit lock, checked **inside** the lane: a write queued behind another
    // operation on the same document can wait arbitrarily long, and a lease the
    // other party acquires in that interval has to refuse it (SERVER-022
    // finding 7). Still exactly one call per verb, and still before this verb
    // reads or writes anything.
    await (workspace.assertWritable ?? (() => undefined))(id, actor);

    const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
    const { parsed } = loaded;

    const nextBody = patch.body ?? parsed.body;
    const bodyChanged = nextBody !== parsed.body;
    const fields = changedFields(parsed.data, patch);

    // §6 step by step: resolve against `oldBody`, map through the diff, write
    // the result back. The engine owns every judgment; this call site owns only
    // the inputs and the persistence.
    const anchorsBefore = readAnchorsMap(parsed.data["anchors"]);
    const reconciled =
      bodyChanged && Object.keys(anchorsBefore).length > 0
        ? reconcileAnchors(parsed.body, nextBody, anchorsBefore)
        : null;
    const report: AnchorReconciliation = {
      remapped: reconciled?.report.remapped ?? [],
      orphaned: reconciled?.report.orphaned ?? [],
    };

    // SPEC.md §5: marking a document "still current" is a committed act that is
    // deliberately *not* an edit — staleness runs from `max(updated, reviewed)`,
    // so stamping `updated` here would make review indistinguishable from
    // editing and reset the very clock the act is about.
    const stampUpdated = bodyChanged || Object.keys(fields).some((key) => key !== "reviewed");

    const nextParsed = setFrontmatterFields(setBody(parsed, nextBody), {
      ...fields,
      ...(reconciled === null ? {} : { anchors: reconciled.anchors }),
      ...(stampUpdated ? { updated: formatInstant(workspace.now()) } : {}),
    });
    // Before anything is written, and only when the patch can move `extra` at
    // all — the autosave path carries no `extra` and must not pay for the walk.
    if (patch.extra !== undefined) assertExtraWithinBound(parsed.data, nextParsed.data);

    const text = serializeDocument(nextParsed);

    // Autosave fires on a timer, so most saves change nothing. A no-op that
    // wrote, committed, re-projected and broadcast would put one commit per
    // idle minute into the audit trail.
    if (text === loaded.text) {
      return {
        doc: toWireDoc(workspace.projection, loaded),
        anchors: report,
        result: { changed: false, warnings: [], commit: null },
      };
    }

    const warnings = validateBeforeWrite(workspace, loaded.path, text);

    const result = await runMutation(workspace, {
      docId: id,
      actor,
      warnings,
      plan: {
        operations: [{ kind: "write", path: loaded.path, content: text }],
        stage: [loaded.path],
        project: [loaded.path],
        unproject: [],
        commit: {
          subject: `doc edit: ${titleOf(nextParsed.data, loaded.row.title)} (${id}) by ${actor}`,
          anchors: report,
        },
        keys: [DOCS_KEY, docKey(id)],
        // `PUT` may set `status: archived`, and archived documents are counted
        // in no folder — so an edit that carries a status is exactly as
        // tree-changing as `POST /archive` (SERVER-018). Every other field the
        // route can write is invisible to `docs/tree.ts`, and a body edit is
        // the autosave path, which must not pay for a tree query.
        mayChangeTree: "status" in fields,
      },
    });

    return {
      doc: toWireDoc(
        workspace.projection,
        loadDocument(workspace.workspaceRoot, workspace.projection, id),
      ),
      anchors: report,
      result,
    };
  });
}

const titleOf = (data: Readonly<Record<string, unknown>>, fallback: string): string =>
  typeof data["title"] === "string" && data["title"].trim() !== "" ? data["title"] : fallback;
