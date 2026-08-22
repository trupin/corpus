import type { JobLookup } from "./write.js";
import { unknownJob } from "../errors.js";
// `POST /api/docs` — creation (SPEC.md §9.2, §10).
//
// Creation is zero-form and inbox-first: a type and a title are the whole
// requirement, and everything else the server fills in — the id, the path, the
// stamped frontmatter block, and the body when a template for the type exists.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Actor, CreateDocRequest, Doc } from "@corpus/contract";
import {
  MAX_SLUG_LENGTH,
  claudeCodeFrontmatterIssues,
  emptyDocument,
  formatInstant,
  idPrefixForDocType,
  newId,
  serializeDocument,
  setFrontmatterFields,
  slugifyTitle,
  THREADS_ROOT,
} from "../core/index.js";
import { DOCS_KEY, docKey } from "../events/index.js";
import { invocableName } from "../threads/mentions.js";
import { isIdTaken, loadDocument, toWireDoc } from "./read.js";
import { findTemplate } from "./templates.js";
import {
  CREATE_LANE,
  claudeCodeRootFor,
  resolveFolder,
  runMutation,
  validateBeforeWrite,
  validationError,
  type DocsWorkspace,
  type DocumentMutex,
  type MutationResult,
} from "./write.js";

/** Bounded so a pathological corpus fails loudly rather than looping forever. */
export const MAX_SLUG_ATTEMPTS = 1000;

export type CreateOutcome = { readonly doc: Doc; readonly result: MutationResult };

/**
 * A free path for a new document. Threads are flat and named by their id, so
 * they never collide; documents dedupe by appending `-2`, `-3`, … rather than
 * overwriting, because two documents may legitimately share a title (SPEC.md
 * §5 — the id is identity, the path is presentation).
 *
 * **Except where the path is not presentation.** Under §7's skill and
 * agent-definition roots the filename *is* the name the document answers to —
 * `.claude/agents/researcher.md` is what makes `@researcher` resolve (§8) — so
 * deduping there would silently hand back `@researcher-2`: a second persona at
 * an address nobody asked for, while the address they did ask for goes on
 * meaning the older document. Those roots refuse instead, and the question is
 * put to {@link invocableName} — the very function §8 resolves a mention with —
 * so "the filename is the address" is asked once and answered in one place.
 */
export function allocatePath(
  workspaceRoot: string,
  input: { readonly id: string; readonly type: string; readonly title: string },
  folder: string,
): string {
  if (input.type === "thread") return `${THREADS_ROOT}/${input.id}.md`;
  const slug = slugifyTitle(input.title);
  // A title that slugifies to nothing — pure emoji, pure punctuation, only
  // combining marks — still needs a filename, and the id is always safe.
  const base = slug === "" ? input.id : slug;
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    const suffix = attempt === 1 ? "" : `-${attempt}`;
    // Trim the slug rather than the suffix, so every candidate — not just the
    // first — respects the filesystem-safe cap.
    const stem = base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, "");
    const candidate = `${folder}/${stem}${suffix}.md`;
    if (!existsSync(resolve(workspaceRoot, candidate))) return candidate;
    const name = invocableName(candidate);
    if (name !== null) {
      validationError(`the name \`${name}\` is already taken in ${folder}`, [
        {
          path: "title",
          message:
            `${candidate} already exists, and in that root the filename is the name the ` +
            `document answers to — edit it with \`PUT /api/docs/{id}\`, or choose a title ` +
            "that names a different agent",
        },
      ]);
    }
  }
  return `${folder}/${input.id}.md`;
}

/**
 * The Claude Code half of a new document's frontmatter, when the path it is
 * being created at is one Claude Code loads a subagent from (SERVER-123).
 *
 * Two fields, and they are owned by different parties on purpose:
 *
 * - **`name` is the server's, derived from the allocated filename.** It is not
 *   caller data: `.claude/agents/<stem>.md` is what makes `@<stem>` resolve
 *   (§8), so the only correct value is the stem, and a caller can do nothing
 *   with the field but get it wrong. Deriving it closes §7's naming divergence
 *   at the source — one file could otherwise be `numbers` to a dispatch and
 *   `@bareprofile` to a mention, with no error anywhere. A caller that supplies
 *   a *matching* `name` is agreeing with the server and passes; a caller that
 *   supplies a different one is refused rather than silently overwritten,
 *   because it asked for something the system cannot give it.
 * - **`description` is the caller's, and the server fills it in when the caller
 *   sends none.** Without it Claude Code loads nothing at all, so it cannot
 *   simply be left out; but §10's creation is **zero-form** — "a type and a
 *   title are the whole requirement, and everything else the server fills in" —
 *   and demanding one here would make the type's own verb refuse the shape
 *   every other type accepts. It would also be unsendable: the agent reaches
 *   this route only through `corpus doc create` (Architecture Decision 2),
 *   which has no `--extra` flag, so a hard requirement would make
 *   `--type agent-def` a verb that always fails. The title is what the caller
 *   said the agent is, so it is what the field says until somebody writes
 *   something better with `corpus doc edit --extra description=…`. Thin, and
 *   **loadable** — which is the whole difference this issue is about.
 *
 * An *explicitly* empty `description` is refused rather than defaulted: a caller
 * that named the field asked for something Claude Code cannot use, and silently
 * substituting the title would answer a question it did not ask.
 *
 * The refusal is raised here, before the write pipeline, so it names the field
 * the caller actually sets (`extra.name`, `extra.description`) instead of
 * arriving as a generic frontmatter finding. It cannot drift from the check: the
 * fault list comes from {@link claudeCodeFrontmatterIssues}, the very function
 * `corpus doc check` reports through, and `validateBeforeWrite` runs it again
 * over the bytes this returns.
 */
function claudeCodeFields(path: string, input: CreateDocRequest): Record<string, unknown> {
  const discoveredAs = claudeCodeRootFor(path)?.discoveredAs ?? null;
  if (discoveredAs === null) return {};

  const supplied = input.extra ?? {};
  // A title that is only whitespace names no agent; the filename does, and it is
  // the same fallback `allocatePath` makes for the path itself.
  const fallback = input.title.trim() === "" ? discoveredAs : input.title;
  const fields = {
    name: supplied["name"] ?? discoveredAs,
    description: supplied["description"] ?? fallback,
  };

  const issues = claudeCodeFrontmatterIssues(fields, discoveredAs);
  if (issues.length > 0) {
    validationError(
      `an agent definition needs Claude Code's frontmatter: ${issues[0]?.message ?? "invalid"}`,
      issues.map((issue) => ({ path: `extra.${issue.field}`, message: issue.message })),
    );
  }
  return fields;
}

/**
 * §10's view keys and §12's plugin keys, as frontmatter keys of a brand-new
 * document (CONTRACT-011).
 *
 * Two rules, both the contract's own. **A key whose value is absent is not
 * written**: `order: null` "is the same as omitting it: no `order` key",
 * `pinned` defaults to `false` and an absent `pinned` reads as `false`, so a
 * plain note's frontmatter stays §5's canonical block and nothing else. And
 * **`extra` is flat, mirroring the file** — a plugin key is a YAML key beside
 * the core ones (§12's `todo` carries a top-level `items:`), so each key is
 * spread in as itself rather than nested under an `extra:` mapping the file
 * format has never had. A `null` extra value is a no-op on create, since there
 * is nothing yet to remove.
 *
 * A key here can never shadow a core one: `ExtraFrontmatterSchema` rejects all
 * eighteen reserved keys with a `400` before the handler is reached.
 */
function viewFields(input: CreateDocRequest): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (input.pinned === true) fields["pinned"] = true;
  if (input.order !== undefined && input.order !== null) fields["order"] = input.order;
  if (input.query !== undefined && input.query !== null) fields["query"] = input.query;
  if (input.column !== undefined && input.column !== null) fields["column"] = input.column;
  for (const [key, value] of Object.entries(input.extra ?? {})) {
    if (value === null) continue;
    fields[key] = value;
  }
  return fields;
}

/**
 * The origin a write naming `job` stamps, or `null`.
 *
 * Refuses an unresolvable job (§9.2's `422`) and is silent about an absent one:
 * a write that names no job records no origin, and so does a write on a server
 * with no queue to ask — the same case, and neither is an error.
 */
export function stampedOrigin(
  workspace: { readonly jobs?: JobLookup | undefined },
  job: string | undefined,
): string | null {
  if (job === undefined) return null;
  const lookup = workspace.jobs;
  if (lookup === undefined) return null;
  const resolved = lookup.originFor(job);
  if (!resolved.ok) throw unknownJob(job, resolved.status);
  return resolved.origin;
}

/**
 * Refuses an unresolvable `job` without stamping anything.
 *
 * For the writes that carry a job but create no document — a move, an archive,
 * an unarchive — where §9.2 records no origin (it records one for a document a
 * job *creates*) but the route still declares the `422`. Validating without
 * stamping is what keeps that declaration honest: the alternative is a route
 * that accepts an id, ignores it, and answers `200`.
 */
export function assertJobResolvable(
  workspace: { readonly jobs?: JobLookup | undefined },
  job: string | undefined,
): void {
  stampedOrigin(workspace, job);
}

export async function createDocument(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  input: CreateDocRequest,
): Promise<CreateOutcome> {
  // The type is carried in because §7's other document roots each hold exactly
  // one type: it decides which root an omitted `folder` means, and it is what a
  // named root is checked against (SERVER-122).
  const folder = resolveFolder(input.folder, input.type);

  // One lane for every create: two concurrent creates of the same title would
  // otherwise both see the same filename free and race to it.
  return mutex.run(CREATE_LANE, async () => {
    const id = newId(idPrefixForDocType(input.type), (candidate) =>
      isIdTaken(workspace.projection, candidate),
    );
    const stamp = formatInstant(workspace.now());
    const template =
      input.body === undefined
        ? findTemplate(workspace.workspaceRoot, workspace.projection, input.type)
        : null;
    const body = input.body ?? template?.body ?? "";
    const path = allocatePath(
      workspace.workspaceRoot,
      { id, type: input.type, title: input.title },
      folder,
    );

    // The template contributed `body` and nothing else (see `templates.ts`):
    // every frontmatter value below is either the request's or the server
    // default `CreateDocRequestSchema` documents for that field.
    const fields: Record<string, unknown> = {
      // Claude Code's two discovery keys lead where the path is one it reads —
      // the key order `skills/create.ts` already writes, and the order the
      // shipped skills arrive in. Empty everywhere else, so an ordinary note's
      // frontmatter stays §5's canonical block and nothing else.
      ...claudeCodeFields(path, input),
      // Canonical key order (SPEC.md §5), which is the order they are written.
      id,
      type: input.type,
      title: input.title,
      created: stamp,
      updated: stamp,
      tags: input.tags ?? [],
      status: input.status ?? "open",
      anchors: {},
      due: input.due ?? null,
      reviewed: null,
      evergreen: input.evergreen ?? false,
      // §9.2: recorded from the job this write names, **unconditionally** —
      // whether or not that thread is designated. Scope membership is computed
      // later by walking origin (§7), and a fact not recorded at write time
      // cannot be recovered afterwards, so the cheap write now is what makes a
      // thread designated tomorrow capture what it produced today.
      origin: stampedOrigin(workspace, input.job),
      ...viewFields(input),
    };

    const text = serializeDocument(setFrontmatterFields(emptyDocument(body), fields));
    const warnings = validateBeforeWrite(workspace, path, text);

    const result = await runMutation(workspace, {
      docId: id,
      actor,
      warnings,
      plan: {
        operations: [{ kind: "write", path, content: text }],
        stage: [path],
        project: [path],
        unproject: [],
        commit: { subject: `doc create: ${input.title} (${id}) by ${actor}` },
        keys: [DOCS_KEY, docKey(id)],
        // A note lands in a folder and moves its badge; a thread lands flat
        // under `data/threads/` and moves nothing. The runner compares.
        mayChangeTree: true,
      },
    });

    return {
      doc: toWireDoc(workspace, loadDocument(workspace.workspaceRoot, workspace.projection, id)),
      result,
    };
  });
}
