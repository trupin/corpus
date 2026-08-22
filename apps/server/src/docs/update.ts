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
  claudeCodeFrontmatterIssues,
  documentTitle,
  formatInstant,
  readExtraFrontmatter,
  serializeDocument,
  setBody,
  setFrontmatterFields,
} from "../core/index.js";
import { badRequest, forbidden } from "../errors.js";
import { DOCS_KEY, docKey } from "../events/index.js";
import { assertDocumentKey } from "./key.js";
import { stampedOrigin } from "./create.js";
import { loadDocument, readAnchorsMap, toWireDoc } from "./read.js";
import { nextTags } from "./tags.js";
import {
  claudeCodeRootFor,
  runMutation,
  validateBeforeWrite,
  type DocsWorkspace,
  type DocumentMutex,
  type MutationResult,
  validationError,
} from "./write.js";
import { originOrNull } from "../core/provenance.js";

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
 * The §10 view keys whose `null` **clears the key from the file** rather than
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
 *
 * **`title` is compared against the name the document goes by, not against the
 * raw key** (SERVER-100). Frontmatter need not carry `title:` at all — §7's
 * hand-written skills carry `name:`, a hand-dropped file carries neither — and
 * every reader still shows such a document under the name {@link documentTitle}
 * resolves. The reader autosaves the title it is displaying, so comparing that
 * against `current["title"]` reported a rename the first time any such document
 * was opened: `title:` was written, `updated` moved, a commit landed and §4's
 * acknowledgment woke the agent to reflect on an edit nobody made. Asked against
 * the resolved name the answer is "identical", and §4's "a save re-sending a
 * title identical to the stored one changes nothing and opens nothing" holds
 * without a special case anywhere downstream. This is the same rule
 * {@link currentOrigin} follows below, for the same reason: a write must ask the
 * question the reader answered, or it disagrees with what the caller was shown.
 *
 * `goesBy` is that resolved name — the caller passes the projection row's title
 * as the last rung. A caller with no row omits it and gets the plain comparison,
 * which is the old behaviour and is right for a caller that has no document to
 * derive a name from.
 */
export function changedFields(
  current: Readonly<Record<string, unknown>>,
  patch: UpdateDocRequest,
  actor: Actor = "user",
  stamp: string | null = null,
  goesBy: string | null = null,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const key of UPDATABLE_FRONTMATTER_KEYS) {
    const value = patch[key];
    if (value === undefined) continue;
    if (sameValue(current[key], value)) continue;
    // The one key whose stored value is not the key (see the note above): a
    // `title` equal to the name the document already goes by renames nothing.
    // Written as a second skip rather than as a substituted left-hand side so a
    // value the raw key already holds is still recognised — a document whose
    // `title:` is blank goes by its filename, and re-sending that blank must
    // stay the no-op it has always been.
    if (key === "title" && goesBy !== null && documentTitle(current, goesBy) === patch.title) {
      continue;
    }
    changed[key] = value;
  }
  // SPEC.md §7's canonical keyless write, made true of this route as well as of
  // the bulk one (SERVER-102). `tags` above carries the **whole set**, so a
  // caller that wanted one more tag had to read the list and merge it itself —
  // and two such callers each lose the other's tag. `addTags`/`removeTags` name
  // the change instead, and the merge happens **here**: against `current`, which
  // is the file this save just read off disk, inside the document's lane. There
  // is no window between the read and the write for another tag to arrive in,
  // which is the whole difference between the two shapes.
  //
  // The contract refuses `tags` alongside either delta, so this can never
  // contend with the loop above for the same key.
  if (patch.addTags !== undefined || patch.removeTags !== undefined) {
    const merged = nextTags(current["tags"], patch.addTags, patch.removeTags);
    // Through the same "different from the file?" gate every other field passes,
    // so a delta that asks for what is already there is a no-op rather than a
    // commit — the autosave rule, applied to the verb §10 calls a no-op too.
    if (!sameValue(current["tags"], merged)) changed["tags"] = merged;
  }
  for (const key of CLEARABLE_FRONTMATTER_KEYS) {
    applyPatchEntry(changed, current, key, patch[key]);
  }
  // §9.2's provenance, and the two directions it moves.
  //
  // **Detach** — `origin: null` — clears the key. It is user-only, and the
  // refusal is the caller's actor rather than the field's shape: the wire type
  // is an ordinary nullable id (a `{"type":"null"}` schema reaches
  // `openapi-fetch` as `never`, CONTRACT-050), so "clear only, never set" is
  // enforced here, where it can say why.
  //
  // **A stamp from a `job`** fills the key only when the document has none:
  // **first writer wins**. An edit that could re-file a document would let any
  // later write move someone else's artifact between conversations, and the
  // person's own detach is the one thing that moves it back out.
  if (patch.origin !== undefined) {
    if (patch.origin !== null) {
      validationError("a document's origin is server-assigned and can only be cleared", [
        {
          path: "body.origin",
          message:
            "send `null` to detach this document from its conversation (SPEC.md §9.2). An " +
            "origin is never set by a caller — name the `job` your write serves and the server " +
            "records where that work came from.",
        },
      ]);
    }
    if (actor !== "user") {
      throw forbidden(
        "detaching a document from its conversation is user-only (SPEC.md §9.2): it is a " +
          "person's correction of where their work was filed, and an agent that could undo it " +
          "could quietly move an artifact out of the scope it belongs to.",
      );
    }
    // Cleared whenever the key holds anything at all, not only a real origin: a
    // legacy junk value under a now-reserved key would otherwise sit on disk
    // forever, invisible to every reader and clearable by nobody.
    if (current["origin"] != null) changed["origin"] = null;
  } else if (stamp !== null && currentOrigin(current) === null) {
    // "Has no origin" is `origin: null`, not an absent key: every document
    // written since SERVER-110 carries the key, and the null is the fact that it
    // came from no job. Testing for the key's presence would make the stamp fire
    // only on documents written before provenance existed.
    changed["origin"] = stamp;
  }
  // **`extra` is a shallow merge patch** (RFC 7386 at the top level): a named
  // key replaces the file's key wholesale, `null` removes it, and a key the
  // request does not name is left alone byte-for-byte — which is what lets two
  // writers touch different keys of one document without racing each other.
  // Never a read-modify-write of the whole object, and never a nested merge.
  for (const [key, value] of Object.entries(patch.extra ?? {})) {
    applyPatchEntry(changed, current, key, value);
  }
  return changed;
}

/**
 * This document's origin **as the rest of the system sees it**.
 *
 * `current` is raw YAML, and the read paths deliberately report anything that is
 * not a thread id as `null` — `origin` was a legal `extra` key before it was
 * reserved, so a corpus that predates the field must stay readable. Testing the
 * raw value here would split the two: `GET` would say a legacy document is
 * unfiled while a write naming a job silently declined to file it, answering
 * `200` and recording nothing. That is the silent ignore §9.2 names by name, so
 * the stamp asks the same question the reader answers (PR #47 re-review).
 */
const currentOrigin = (current: Readonly<Record<string, unknown>>): string | null =>
  originOrNull(current["origin"]);

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

/**
 * **A value this patch writes into one of Claude Code's two discovery fields
 * must come out correct**; a fault the patch does not write is left alone
 * (SERVER-123 regression, PR #49 reviews 3 and 4).
 *
 * `extra` is the one way a caller can write `name` or `description` on an
 * existing document, which makes this the second and last route that accepts
 * those fields *as caller data* — `docs/create.ts`'s `claudeCodeFields` is the
 * first, and this is deliberately its mirror: same function
 * ({@link claudeCodeFrontmatterIssues}, the one `corpus doc check` reports
 * through), same `extra.<field>` issue paths, same refusal before the write
 * pipeline, and the same line create draws on `name` ("a caller that supplies a
 * different one is refused rather than silently overwritten"). Neither is a
 * second copy of the rule; both ask the rule about the caller's own values.
 *
 * **The comparison is per field, between the value on disk and the value the
 * patch would leave there** — not between the two issue *lists*. Those are three
 * different questions and only the first is the one worth asking:
 *
 * - Comparing issue lists **keyed on the field name** (review 3's version) asks
 *   "did this field acquire *a* fault?", which cannot see a field trading one
 *   fault for another. Measured against a real server: a hand-authored
 *   `.claude/agents/reviewer.md` with a `description` and no `name`, patched
 *   with `--extra name=numbers`, has `{name}` faulty before *and* after, so
 *   nothing looked introduced — and the write answered `200` and manufactured
 *   the exact divergence SERVER-123 exists to close, one file loadable by Claude
 *   Code as `numbers` and resolvable by Corpus as `@reviewer`. Keying on the
 *   issue's *message* instead would close that hole but leaves the rule resting
 *   on prose staying distinct enough to tell two faults apart, which is not a
 *   property error text should have to carry.
 * - Asking whether the patch **names** the field is wrong the other way: the
 *   board's autosave re-sends `extra` wholesale, so a document whose stored
 *   `name` is already wrong would have every save refused for echoing its own
 *   bytes back. `sameValue` is what makes "writes" mean *changes*, exactly as it
 *   does for every other field in {@link changedFields}.
 *
 * So the rule is: the server never **authors** a faulty Claude Code value, and
 * goes on tolerating every one it did not author. A patch that touches only
 * `description` may still leave a wrong `name` standing — which is what keeps
 * `--extra description=…` a working repair for a profile faulty in both fields,
 * the regression review 3 caught. The save path itself no longer blocks on this
 * finding at all (see `write.ts`'s `isClaudeRootFrontmatter`), so a
 * hand-authored profile stays editable, archivable and bulk-actionable while
 * `corpus doc check` goes on reporting it.
 *
 * Costs the autosave path nothing: the caller checks `patch.extra !== undefined`
 * first, and a body save carries no `extra`.
 */
function assertClaudeCodeFieldsAuthoredGood(
  path: string,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): void {
  const discoveredAs = claudeCodeRootFor(path)?.discoveredAs ?? null;
  if (discoveredAs === null) return;

  const authored = claudeCodeFrontmatterIssues(after, discoveredAs).filter(
    (issue) => !sameValue(before[issue.field], after[issue.field]),
  );
  if (authored.length === 0) return;

  throw badRequest(
    `this patch would write a Claude Code field this file cannot be loaded with: ` +
      `${authored[0]?.message ?? "invalid"}`,
    authored.map((issue) => ({ path: `body.extra.${issue.field}`, message: issue.message })),
  );
}

/**
 * **A `PUT` may not take a document off `archived`** (SERVER-039, wave-3 audit
 * FIX 5).
 *
 * `PUT` writes frontmatter and nothing else. For a `type: skill` document, what
 * makes archiving *mean* anything is where the folder lives — SPEC.md §7:
 * archiving a skill "moves its folder to `.claude/skills-archived/` … no longer
 * discovered by Claude Code" — so a `status: open` written here reports success
 * and leaves the document disabled, invisible to Claude Code, and still holding
 * its name against `corpus skill create`. `POST /api/docs/{id}/unarchive` is the
 * operation that undoes archiving, because unarchiving is a filesystem move and
 * a name release, not a field edit.
 *
 * The rule already existed — as a **client-side** guard in `corpus doc edit`
 * (CLI-017), which the UI's frontmatter form and any `curl` walk straight past.
 * The server is the sole writer (CLAUDE.md Architecture Decision 2); a rule only
 * a client enforces is not enforced. So it lives in the verb.
 *
 * Three deliberate narrownesses:
 *
 * - **Only leaving `archived`.** Writing `status: archived` through `PUT` stays
 *   allowed: for every non-skill type it is exactly what `POST /archive` does,
 *   and for a skill the archive route heals it on the next call (`planFolderMove`
 *   reads where the folder *is*, not what the frontmatter claims). Coming back
 *   has no such healer from this side.
 * - **Only a real change.** `changedFields` has already dropped a `status` equal
 *   to the file's, so re-sending `archived` on an archived document — which is
 *   what an autosave of an untouched form does — never reaches this.
 * - **400, not 409.** The route's `409` is §7's stale-key refusal and nothing
 *   else (`packages/contract/src/routes/docs.ts`); this is the same situation as
 *   the archive route's "destination already exists", settled as a 400 by
 *   sprint-005 Open Conflict 4. It is also genuinely a statement about the request body.
 *
 * The archived-ness is read from the file *and* from the projection row, because
 * they can disagree in exactly the case this guard is about: a `SKILL.md` sitting
 * under `.claude/skills-archived/` is projected `archived` whatever its
 * frontmatter says, and that row is what the client saw before it sent this.
 */
function assertNotUnarchivingByPut(
  id: string,
  current: Readonly<Record<string, unknown>>,
  rowStatus: string,
  fields: Readonly<Record<string, unknown>>,
): void {
  if (!Object.hasOwn(fields, "status")) return;
  const next = fields["status"];
  if (next === "archived") return;
  if (current["status"] !== "archived" && rowStatus !== "archived") return;
  throw badRequest("request failed validation", [
    {
      path: "body.status",
      message:
        `${id} is archived; \`status: ${String(next)}\` would set the frontmatter without ` +
        `bringing the document back. Use \`POST /api/docs/${id}/unarchive\` — it restores the ` +
        "status and, for a skill, moves its folder back out of `.claude/skills-archived/` and " +
        "frees the name.",
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
  return mutex.run(id, () => updateDocumentLocked(workspace, actor, id, patch));
}

/**
 * The save itself, with the caller already holding the document's lane.
 *
 * Split out for the same reason `deleteDocumentLocked` is: a caller that has to
 * do something *else* inside the lane — `docs/patch.ts`, which scans the stored
 * body for the passage it is replacing and must do that scan against the bytes
 * this save is about to overwrite — cannot re-enter a mutex it is already
 * holding without deadlocking it. Everything the verb does — §7's key check
 * included — lives here, so no caller can reach the write pipeline having
 * skipped a step.
 */
export async function updateDocumentLocked(
  workspace: DocsWorkspace,
  actor: Actor,
  id: string,
  patch: UpdateDocRequest,
): Promise<UpdateOutcome> {
  const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
  const { parsed } = loaded;

  // SPEC.md §7's key, against the bytes just read, **inside the lane**, and
  // before this verb computes or writes anything. Placed after `loadDocument`
  // deliberately: a document that does not exist is a `404` and the key question
  // never arises. A refusal from here has therefore written nothing — no file
  // touched, no commit, no re-projection, no invalidation — which is what makes
  // §7's "a refusal is never a lost edit" true rather than merely intended.
  assertDocumentKey(id, loaded.text, patch, () => toWireDoc(workspace, loaded));

  const nextBody = patch.body ?? parsed.body;
  const bodyChanged = nextBody !== parsed.body;
  const fields = changedFields(
    parsed.data,
    patch,
    actor,
    stampedOrigin(workspace, patch.job),
    loaded.row.title,
  );
  // Before anything is reconciled or written, and after `changedFields` has
  // decided the patch really moves `status` at all.
  assertNotUnarchivingByPut(id, parsed.data, loaded.row.status, fields);

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
  if (patch.extra !== undefined) {
    assertExtraWithinBound(parsed.data, nextParsed.data);
    assertClaudeCodeFieldsAuthoredGood(loaded.path, parsed.data, nextParsed.data);
  }

  const text = serializeDocument(nextParsed);

  // Autosave fires on a timer, so most saves change nothing. A no-op that
  // wrote, committed, re-projected and broadcast would put one commit per
  // idle minute into the audit trail.
  if (text === loaded.text) {
    return {
      doc: toWireDoc(workspace, loaded),
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
        // The name the reader was shown and the name `changedFields` compared
        // against — one derivation, so a `git log` line, a board row and the
        // save's own comparison cannot call one document three things
        // (SERVER-100).
        subject: `doc edit: ${documentTitle(nextParsed.data, loaded.row.title)} (${id}) by ${actor}`,
        anchors: report,
        // SPEC.md §4 lists "a document ... marked still current (§5)" among the
        // acts that close a window, and lists "an ordinary save of a document
        // body — whichever document it is to" among the things that do not. The
        // two meet on this one verb, and `reviewed` is what tells them apart: a
        // review is a statement about the document that someone else can act on,
        // where the edit around it is merely underway. `changedFields` has
        // already dropped a `reviewed` equal to the file's, so the autosave that
        // re-sends the stored value is not an act (SERVER-092).
        act: Object.hasOwn(fields, "reviewed") ? "names-the-window" : undefined,
      },
      keys: [DOCS_KEY, docKey(id)],
      // `PUT` may set `status: archived`, and archived documents are counted
      // in no folder — so an edit that carries a status is exactly as
      // tree-changing as `POST /archive` (SERVER-018). Every other field the
      // route can write is invisible to `docs/tree.ts`, and a body edit is
      // the autosave path, which must not pay for a tree query.
      mayChangeTree: "status" in fields,
      // §4's edit acknowledgment (SERVER-052): this verb *is* the edit session
      // — but only when the save changes the **body**.
      //
      // §4 asks the orchestrate skill to *reflect* on an acknowledged session:
      // to check "whether the change ripples into other documents". Only prose
      // ripples. A save that moves `extra`, `tags`, `status`, `title`, `folder`,
      // `reviewed` or `query` and leaves the body alone has produced nothing to
      // reflect *on* — and the board writes exactly such saves constantly:
      // dragging a column wider is a `PUT` carrying `{ extra: { width } }` and
      // nothing else (`apps/ui/src/board/useColumnWidth.tsx`), which used to wake
      // the agent to ask whether a column width rippled into other documents
      // (SERVER-095). So the **body** is what decides, and frontmatter riding
      // along with a real body change does not disqualify it.
      //
      // `bodyChanged` is the exact question, not an approximation of it:
      // `setBody` stores the body verbatim and `serializeDocument` concatenates
      // it verbatim, so the request's body differing from the one read off disk
      // is precisely "these bytes will move". A `PUT` naming a body identical to
      // the stored one is therefore not a content edit — which is what keeps the
      // reader's periodic autosave of untouched text from reintroducing this in
      // a quieter form — and a `PUT` naming no body at all (§9.2: a save that
      // names no change) is not one either, both by the same comparison.
      //
      // **The title counts too** (user sign-off 2026-08-11, on PR #42's
      // re-review). The first cut of this scoped a session to the body alone,
      // and the review found the case that makes that wrong: someone who opens
      // the reader and renames a document has plainly edited it, and was
      // silently never acknowledged. §4 now draws the line at what the document
      // **says** — its body, or the title it goes by — against how it is *held*.
      // `changedFields` has already dropped a title equal to the one the
      // document goes by, so the same "a re-sent identical value is not a
      // change" rule covers it without a second comparison. **The name it goes
      // by is the comparison, and the raw `title:` key is not** (SERVER-100):
      // a document that carries `name:` or no name at all still shows one, the
      // reader autosaves the one it is showing, and pinning that name into the
      // frontmatter is a change to how the document is held rather than to what
      // it says.
      //
      // **Sealing is unaffected**, which is why this can be conditional at all:
      // `observeCommit` seals through `touches(commit, session)`, which compares
      // `docId` and the staged `paths` and never reads `editPath` — and it nulls
      // `editPath` for any non-`user` actor before it looks at it. An agent save
      // through this verb still seals a session the user has open here, whatever
      // the agent changed and whether or not it changed a body.
      editSession: bodyChanged || Object.hasOwn(fields, "title") ? loaded.path : undefined,
    },
  });

  return {
    doc: toWireDoc(workspace, loadDocument(workspace.workspaceRoot, workspace.projection, id)),
    anchors: report,
    result,
  };
}
