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
import { DOCS_KEY, TREE_KEY, docKey } from "../events/index.js";
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

    const extras = template?.frontmatter ?? {};
    const fields: Record<string, unknown> = {
      // Canonical key order (SPEC.md §5), which is the order they are written.
      id,
      type: input.type,
      title: input.title,
      created: stamp,
      updated: stamp,
      tags: input.tags ?? asStringArray(extras["tags"]) ?? [],
      status: input.status ?? asStatus(extras["status"]) ?? "open",
      anchors: {},
      due: input.due ?? (typeof extras["due"] === "string" ? extras["due"] : null),
      reviewed: null,
      evergreen: input.evergreen ?? extras["evergreen"] === true,
    };
    // Everything else the template declared and the request did not name — a
    // plugin's own keys, a default `tags` list, a `column` hint.
    for (const [key, value] of Object.entries(extras)) {
      if (key in fields) continue;
      fields[key] = value;
    }

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
        keys: [DOCS_KEY, docKey(id), TREE_KEY],
      },
    });

    return {
      doc: toWireDoc(
        workspace.projection,
        loadDocument(workspace.workspaceRoot, workspace.projection, id),
      ),
      result,
    };
  });
}

const asStringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value] : null;

const asStatus = (value: unknown): "open" | "resolved" | "archived" | null =>
  value === "open" || value === "resolved" || value === "archived" ? value : null;
