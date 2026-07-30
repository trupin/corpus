// `POST /api/check` — the validation surface behind `corpus doc check`
// (SPEC.md §14).
//
// §14's requirement is not that a check exists but that there is **one** of them:
// "the same validator behind `corpus doc check` runs on every save". This handler
// is what makes that literally true rather than a claim about two
// implementations that agree today. It calls `checkCorpus` — the same function
// `docs/write.ts`'s `checkSave` calls, with the same seams from the same
// `checkSeams` factory — and translates nothing: the server's `CheckFinding` and
// the wire's are the same five fields under the same names, and the thirteen
// codes are pinned to the contract's enum by `codes.test.ts`.
//
// Three things distinguish this call site from the save one, and all three are
// consequences of *what it is handed* rather than of a different validator:
//
// - **No `LOCAL_CHECK_CODES` filter.** A save is handed one file and may block
//   only on what one file can decide; a check is handed a set and reports every
//   rule the set can answer, duplicate ids and dangling anchor claims included.
//   "The set" is the submitted documents **unioned with the live corpus**: the
//   `documentExists` and `anchorClaimants` seams answer the two cross-document
//   questions the submitted set cannot settle alone, so a subset request judges
//   a document the same way a whole-workspace one does.
// - **A drifted corpus is a `200`.** The check succeeded; the corpus is what has
//   the problem. `400` is reserved for a malformed *request*, and the schema's
//   own XOR produces it before this handler ever runs.
// - **`ok` is derived here.** The server's `CheckReport` is `{errors, warnings}`;
//   the wire adds the verdict, defined as `errors.length === 0`. Warnings never
//   flip it — that is the whole point of §14's severity split.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes, type CheckFinding as WireFinding } from "@corpus/contract";
import { checkCorpus, toCheckDocument, type CheckDocument } from "../core/index.js";
import { checkSeams, findDocumentRow, isSkillFrontmatterException } from "../docs/index.js";
import type { ProjectionDb } from "../projection/index.js";

export interface CheckRoutesDeps {
  readonly workspaceRoot: string;
  readonly projection: ProjectionDb;
}

/**
 * A file that could not be read at all is reported as the document it is — one
 * that does not parse — rather than being dropped or raised. A row whose file
 * vanished under it is ordinary drift (`db doctor`'s `orphan_row`), and a check
 * that threw on it would be the one call in the API that fails *because* the
 * corpus is broken.
 */
function readForCheck(absPath: string, path: string): CheckDocument {
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch (error) {
    return {
      path,
      ok: false,
      error: `file could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return toCheckDocument(path, raw);
}

/**
 * The `{ids}` branch: resolve each id through the projection and read the real
 * file, every time — so editing a document on disk changes the next check's
 * answer with no restart and no watcher involvement.
 *
 * Ids naming no document contribute nothing: no finding, no `404`, no code
 * outside the closed thirteen (sprint-012 Adjudication 23, and the route declares
 * no `404` at all). The report describes what was read; `GET /api/docs/{id}` is
 * how a caller asks whether a document exists.
 *
 * Ids are de-duplicated first. The same id twice is one document, and handing the
 * checker two copies of it would manufacture a `duplicate-id` finding out of the
 * *request* rather than out of the corpus.
 */
function readByIds(deps: CheckRoutesDeps, ids: readonly string[]): CheckDocument[] {
  const documents: CheckDocument[] = [];
  for (const id of new Set(ids)) {
    const row = findDocumentRow(deps.projection, id);
    if (row === null) continue;
    documents.push(readForCheck(resolve(deps.workspaceRoot, row.path), row.path));
  }
  return documents;
}

export function mountCheckRoutes(app: OpenAPIHono, deps: CheckRoutesDeps): void {
  app.openapi(contractRoutes.checkDocuments, (c) => {
    const request = c.req.valid("json");
    // Both branches are closed objects in an XOR union, so a validated request
    // carries exactly one of the two keys — the discrimination is the schema's
    // and this handler never sees "both" or "neither".
    const documents =
      "ids" in request
        ? readByIds(deps, request.ids)
        : // The `--staged` form: bytes that exist only in git's index. Nothing is
          // read from disk and nothing is written to it — the path is used for
          // the path-derived rules and echoed on every finding.
          request.documents.map((document) => toCheckDocument(document.path, document.content));

    const report = checkCorpus(documents, checkSeams(deps.projection));
    // §7's skill leniency, applied through the write path's own predicate: a
    // document the system accepts on write must not fail a check (sprint-013
    // Adjudication 6). Waived rather than re-graded — every code that reaches
    // `warnings` is one of §14's two, and this is not one of them.
    const errors: WireFinding[] = report.errors.filter(
      (finding) => !isSkillFrontmatterException(finding),
    );

    return c.json({ ok: errors.length === 0, errors, warnings: [...report.warnings] }, 200);
  });
}
