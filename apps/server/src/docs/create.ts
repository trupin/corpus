// `POST /api/docs` — creation (SPEC.md §9.2, §11).
//
// Creation is zero-form and inbox-first: a type and a title are the whole
// requirement, and everything else the server fills in — the id, the path, the
// stamped frontmatter block, and the body when a template for the type exists.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Actor, CreateDocRequest, Doc } from "@corpus/contract";
import {
  MAX_SLUG_LENGTH,
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
import { isIdTaken, loadDocument, toWireDoc } from "./read.js";
import { findTemplate } from "./templates.js";
import {
  CREATE_LANE,
  resolveFolder,
  runMutation,
  validateBeforeWrite,
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
  }
  return `${folder}/${input.id}.md`;
}

/**
 * §11's view keys and §12's plugin keys, as frontmatter keys of a brand-new
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

export async function createDocument(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  input: CreateDocRequest,
): Promise<CreateOutcome> {
  const folder = resolveFolder(input.folder);

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
