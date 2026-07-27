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
import { reconcileAnchors } from "../anchors/index.js";
import { formatInstant, serializeDocument, setBody, setFrontmatterFields } from "../core/index.js";
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

/** Structural equality for the scalar/array frontmatter values a `PUT` can carry. */
const sameValue = (a: unknown, b: unknown): boolean =>
  a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The `UpdateDocRequest` fields that are **frontmatter** keys. `body` is
 * deliberately absent: it is the markdown below the fence, and copying the
 * request's fields wholesale into the frontmatter patch would write a `body:`
 * key into the YAML block beside the real body.
 */
export const UPDATABLE_FRONTMATTER_KEYS = [
  "title",
  "tags",
  "status",
  "due",
  "reviewed",
  "evergreen",
] as const satisfies readonly (keyof UpdateDocRequest)[];

/**
 * The frontmatter fields the request actually changes. A `PUT` names only what
 * it changes, and autosave re-sends unchanged values constantly, so "present in
 * the request" is not the same question as "different from the file".
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
  return changed;
}

export async function updateDocument(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  patch: UpdateDocRequest,
): Promise<UpdateOutcome> {
  await (workspace.assertWritable ?? (() => undefined))(id, actor);

  return mutex.run(id, async () => {
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
