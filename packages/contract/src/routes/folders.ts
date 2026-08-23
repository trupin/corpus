import { createRoute } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import {
  DeleteFolderResultSchema,
  FolderPathRequestSchema,
  FolderStatusResultSchema,
  RenameFolderRequestSchema,
  RenameFolderResultSchema,
} from "../schemas/folders.js";
import {
  CONFLICT_RESPONSE,
  FORBIDDEN_RESPONSE,
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

/**
 * SPEC.md §9.2's folder acts (rider 7, signed 2026-08-22), and the explorer's
 * folder menu (§10, rider 1).
 *
 * Four routes rather than one with a verb field: they answer with three
 * different result shapes, `delete` is user-only where the others are not, and
 * `rename` is the only one that can conflict. A single route would have had to
 * publish the union of all of that on every call.
 *
 * **Each carries the acting party like every other write** (§4): the header is
 * optional and defaults to `user`, and it becomes the git author of the one
 * auto-commit the act makes. A folder act is one action and therefore one
 * commit, whatever the folder held.
 *
 * **Each names every document it changed**, under the same rule the bulk route
 * follows: the response's `documents` array carries the ids and the one field
 * that moved, so a client updates itself in place. That includes documents the
 * request never named — threads inherit their parent's folder (§6) — which is
 * §9.2's "a response's warnings also carry effects on documents the request
 * never named", applied to the result rather than to the warnings, because here
 * the effect *is* the act rather than a consequence of it.
 */
export const renameFolder = createRoute({
  method: "post",
  path: "/api/folders/rename",
  tags: ["folders"],
  summary: "Rename or move a folder, and every document in it",
  description:
    "Moves `data/docs/<from>` to `data/docs/<to>`, carrying every document and thread under it " +
    "(SPEC.md §9.2). **Ids never change** — the path is presentation and the id is identity " +
    "(§5) — so every `[[ref]]`, anchor entry and thread `parent` keeps resolving, and the " +
    "response lists each document's new path rather than a new id. **The paths are in the body, " +
    "not the URL**, because a folder path carries slashes. `404` when `from` names no folder, " +
    "`409` when `to` already exists — a rename never merges two folders — and `400` when either " +
    "path is malformed or `to` is inside `from`. It lands as the single auto-commit §4 requires, " +
    "authored by the acting party.",
  request: {
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description: "The folder to rename and where it is going. A rename names both.",
      content: { "application/json": { schema: RenameFolderRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(
      RenameFolderResultSchema,
      "Every document the rename moved, each at its new path, and any §11 warnings.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    409: CONFLICT_RESPONSE,
  },
});

export const archiveFolder = createRoute({
  method: "post",
  path: "/api/folders/archive",
  tags: ["folders"],
  summary: "Archive every document in a folder",
  description:
    "Flips `status` to `archived` on every document and thread under `data/docs/<path>` " +
    "(SPEC.md §9.2, rider 7). **It moves nothing**: archiving a folder is a status act, not a " +
    "relocation, so the folder stays where it is and every path is unchanged — which is what " +
    "makes it reversible by `POST /api/folders/unarchive` rather than by remembering where " +
    "things were. A document already archived is left as it is and is still listed, because the " +
    "act applied to it. A document the flip could not be applied to is named in `refused` with " +
    "why, and the act stands for every other document — §10's bulk rule, so one file the write " +
    "lane could not take never refuses the folder. `404` when the folder is unknown. One action, " +
    "one commit (§4), authored by the acting party.",
  request: {
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description: "The folder to archive. An act on a folder names one, so the body is mandatory.",
      content: { "application/json": { schema: FolderPathRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(
      FolderStatusResultSchema,
      "Every document in the folder with its status after the act, the ones the act could not " +
        "apply to, and any §11 warnings.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const unarchiveFolder = createRoute({
  method: "post",
  path: "/api/folders/unarchive",
  tags: ["folders"],
  summary: "Restore every archived document in a folder",
  description:
    "The inverse flip, back to `status: resolved` — the state archiving already implied (SPEC.md " +
    "§5) — on every document and thread under `data/docs/<path>`. It moves nothing, for the " +
    "reason archiving moves nothing. A document that was not archived is left as it is and is " +
    "still listed, and one the flip could not be applied to is named in `refused` with why. " +
    "`404` when the folder is unknown. One action, one commit (§4), authored by the acting " +
    "party.",
  request: {
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description: "The folder to restore. An act on a folder names one, so the body is mandatory.",
      content: { "application/json": { schema: FolderPathRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(
      FolderStatusResultSchema,
      "Every document in the folder with its status after the act, the ones the act could not " +
        "apply to, and any §11 warnings.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const deleteFolder = createRoute({
  method: "post",
  path: "/api/folders/delete",
  tags: ["folders"],
  summary: "Delete a folder and every document in it (user-only)",
  description:
    "**User-only**, exactly as deleting a document is (SPEC.md §9.2, rider 7): a request " +
    "carrying `x-corpus-author: agent` is rejected with `403` — the agent archives, never " +
    "deletes (§7). Nothing is hard-deleted from history; git preserves every file and every " +
    "version of it, and the threads of a deleted document become orphaned records that still " +
    "name it as `parent` (§9.2). The response lists the ids and nothing more, because there is " +
    "no field left to report: a client drops those rows. A document that could not be deleted " +
    "is named in `refused` with why, and still exists — the delete stands for every other " +
    "document. `404` when the folder is unknown. " +
    "**A `POST`, not a `DELETE`**, for the reason the whole family is: the folder is named in " +
    "the body because a folder path carries slashes, and a `DELETE` with a body is a request " +
    "intermediaries are entitled to strip.",
  request: {
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description: "The folder to delete. An act on a folder names one, so the body is mandatory.",
      content: { "application/json": { schema: FolderPathRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(
      DeleteFolderResultSchema,
      "The ids of every document the delete removed, the ones it could not remove, and any §11 " +
        "warnings.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
