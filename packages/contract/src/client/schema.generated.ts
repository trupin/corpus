/**
 * Generated from openapi.json — do not edit.
 * Regenerate with: npm run generate -w packages/contract
 */
export interface paths {
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Liveness and readiness probe
         * @description Unauthenticated. Backs `corpus server start|status` (SPEC.md §2.1).
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The server is up and owns a workspace. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Health"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/docs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Query the document collection
         * @description Structured filters compose with optional full-text search: values OR within a comma-separated parameter and AND across parameters. The default result set excludes `status: archived` (SPEC.md §11) unless `status` is passed explicitly. The thread-only filters — `parent`, `agent`, `author` and `unread` — no-op for non-thread types rather than erroring (SPEC.md §9.2). `isParent` is not one of them: it selects roots — documents with no parent — for every type, and is the one filter that is **refused** in combination, since `parent=<id>` with `isParent=true` is a contradiction and answers `400`. Every row carries its Attention reasons; rows carry search snippets when `q` is set.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Maximum rows to return (1–200). */
                    limit?: number;
                    /** @description Rows to skip before collecting the page. */
                    offset?: number;
                    /** @description Full-text query (FTS5) across document titles, bodies and turn bodies. Matching rows carry `snippets`; without `q` every row's `snippets` array is empty. */
                    q?: string;
                    /** @description Comma-separated document types; values OR together. Core values: note, thread, view, template, skill, agent-def. Open rather than enumerated because plugins define their own types (SPEC.md §5, §10). */
                    type?: string;
                    /** @description Restrict to a lifecycle status. Omitted, the default result set **excludes** `status: archived` (SPEC.md §11); passing `status` explicitly overrides that default, so `status=archived` selects archived documents *only*. To see archived documents **alongside** the rest, use `includeArchived=true` — that is the archived chip, not this parameter. */
                    status?: "open" | "resolved" | "archived";
                    /** @description Lift the default archived exclusion. `true` widens the default result set into the **union** of archived and non-archived documents — the archived chip's "include archived" reading (SPEC.md §11) — where `status=archived` selects archived documents *only*. Absent or `false` keeps today's behaviour. It modifies the **default** and nothing else, so it is a no-op alongside an explicit `status`: `status` already replaces the default filter, and `status=open&includeArchived=true` is just `status=open`. */
                    includeArchived?: boolean;
                    /** @description Comma-separated tags; values OR together. Tags are validated comma-free on write, so the separator needs no escaping scheme. */
                    tag?: string;
                    /** @description Path prefix relative to `data/docs/`, matching the folder and its descendants. Threads inherit their parent document's folder (SPEC.md §11). */
                    folder?: string;
                    /** @description Threads whose `parent` is this document id. Thread-only: it no-ops for non-thread types rather than erroring (SPEC.md §9.2). */
                    parent?: string;
                    /** @description Documents whose body contains `[[<id>]]`, read from the projection's `links` table (SPEC.md §9.1). Powers the backlinks panel and the `references:` filter chip. */
                    references?: string;
                    /** @description Agent participation state from the thread's frontmatter (SPEC.md §6). Thread-only: it no-ops for non-thread types rather than erroring (SPEC.md §9.2). */
                    agent?: "none" | "requested" | "engaged";
                    /** @description Author of the thread's last turn — the "awaiting your answer" half of Attention. Thread-only: it no-ops for non-thread types rather than erroring (SPEC.md §9.2). */
                    author?: "user" | "agent";
                    /** @description ISO 8601 instant; matches documents whose `updated` is strictly after it. Distinct from `due`, which is a calendar date or a keyword. */
                    since?: string;
                    /** @description Either an ISO calendar date (due on or before that date) or one of overdue, today, week. Keywords are resolved server-side against the workspace's clock. */
                    due?: string | ("overdue" | "today" | "week");
                    /** @description Staleness tier (SPEC.md §5), selecting documents at or beyond it — `aging` includes stale and very-stale. Documents with `evergreen: true` never match. */
                    stale?: "aging" | "stale" | "very-stale";
                    /** @description Threads whose last turn is newer than your last-seen mark (SPEC.md §7). Thread-only: it no-ops for non-thread types rather than erroring (SPEC.md §9.2). */
                    unread?: boolean;
                    /** @description Documents whose frontmatter carries `pinned: true` (`false` selects the rest — a missing key reads as `false`). The board's column set is one bounded query — `pinned=true&type=view&sort=order` — with every view's `query`, `order` and `column` on the rows, so no per-column follow-up read is ever needed (SPEC.md §11). Not thread-only: any type may carry the key, though only views render as columns. */
                    pinned?: boolean;
                    /** @description Whether the document is a **child of something** (SPEC.md §9.2). `true` selects **roots** — documents whose `parent` is null or absent — which is what lets a view show top-level documents without their child threads mixed in among them; `false` selects documents that **are** a child. Absent filters nothing, exactly like every other optional filter: there is no default of `true`, so a view that never sets it shows what it always showed. **It does not mean "has children."** A standalone note that nothing hangs off still matches `isParent=true` — the filter asks what a document is *under*, never what is *under it*. The "has at least one child" reading matches the name more literally and was considered and **rejected** (a parents-only view that hid every uncommented note would be nearly empty); the name is the one the user asked for and is kept deliberately, so do not "fix" it into the other meaning. **Not thread-only**, unlike `parent`: a non-thread document has no parent at all, so `isParent=true` genuinely matches it and `isParent=false` genuinely excludes it — an answer, not a no-op, and a mixed top-level list of notes and standalone threads is the point. `parent=<id>` together with `isParent=true` is a contradiction and is **refused with `400`** rather than answered with an empty set: `parent` no-ops for non-thread types, so an intersection would quietly return every root document that is not a thread — a confident answer to a question nobody asked. `parent=<id>&isParent=false` is merely redundant and is accepted. */
                    isParent?: boolean;
                    /** @description The Attention filter (SPEC.md §11). `me` is the union of every reason; the individual reasons (unread-reply, form, due, stale, failed-job) back the per-reason chips. Composes with the other filters by intersection — `needs=me&folder=finance` is Attention within that folder. */
                    needs?: "me" | "unread-reply" | "form" | "due" | "stale" | "failed-job";
                    /** @description Sort key; defaults to `-updated`. `relevance` requires `q` and is rejected with `400` without it, rather than silently falling back. `order` sorts ascending by the §11 view key — the board's column ordering — with the documented tiebreak: `order` with nulls last (a view with no `order` key is placed, never dropped), then `title`, then `id`. */
                    sort?: "updated" | "-updated" | "created" | "-created" | "due" | "title" | "order" | "relevance";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Matching documents, newest-updated first by default. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocList"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Create a document
         * @description The body is pre-filled from the type's `template` document when one exists and no body is given (SPEC.md §9.2). The server assigns the id; it is immutable thereafter. Creation is inbox-first: an omitted `folder` files the document in `data/docs/inbox/`.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path?: never;
                cookie?: never;
            };
            /** @description The document to create. `type` and `title` are mandatory, so the body is too. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateDocRequest"];
                };
            };
            responses: {
                /** @description The created document, and any §14 warnings. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocMutationResponse"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description The `job` names no event. Nothing was written; retry without it, or with the right id. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnknownJobError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/docs/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Apply a column's staged set — one action per document — as a single act
         * @description Applies a **staged set** to several documents and answers for all of them — the board makes one request per Save, never one per document and never one per verb. **Each entry carries its own action** (SPEC.md §11: in bulk mode each row carries its own staged action), so archiving three documents and resolving two is one request. **The act lands as a single auto-commit** (SPEC.md §4, "One action, one commit"), authored by the acting party like any other mutation: archiving twenty documents is one commit, not twenty, so reverting the action is one `git revert` and `git log` never records an effect the user was told did not happen. §4 is explicit that this survives a mixed set — **a Save carrying a mix of verbs is still one act and still one commit**, not one commit per verb — so grouping the staged set by verb and writing each group is wrong even though it would produce the same files. **Every document `changed` names has a file in that commit**, and `git show --name-only` lists it: only a write that landed puts an id in `changed`, and only those writes are staged, so a document that was refused or was already in the target state wrote nothing **of its own**. Its files may still be in the commit, carried there by another document's act — archiving a skill that nests a second requested skill moves the nested one's file while refusing it by id. That containment is the invariant, and it holds in one direction only — **the commit may also carry files for documents the act did not name**, because the result's three parts partition the **requested** ids and nothing else. Two things do that today, both required by the spec rather than incidental, and both shared with the single-document routes: §6's anchor cascade rewrites the `anchors` map of a deleted thread's parent in the same commit, and that parent survives the act and need not even have been requested; and archiving or unarchiving a skill moves its whole folder, carrying every file under it — including the `SKILL.md` of a nested skill, which the move disables (§7: what disables a skill is where its folder lives) without the act ever naming it. The commit message names the actions the act carried and the documents each one changed. It is its own entry in the history: it never folds into a preceding editing session's squashed commit, and no later save folds into it (§4's squashing is about repeated saves of *one* document, never about one act across many). An implementation that loops the single-document write path is therefore wrong rather than merely slower — it produces N commits and has nothing honest to put in `commit`.
         *
         *     **A whole-result-set selection is one entry, not a list of ids.** §11: because there is no per-row gesture for rows nobody enumerated, such a selection stages as a **single entry** carrying one action for everything the column's query matches. `wholeResultSet` is that entry — at most one, beside any number of enumerated `entries` — and **the count is re-evaluated when the Save runs**, not when it was staged, which is why it travels as a query rather than as ids the caller resolved earlier. It covers everything the query matches **except** the ids `entries` names individually, so no document is ever acted on twice and a hand-staged row keeps the verb the person chose. **`delete` cannot be spelled on it at all** (§11: "all 412 matching" is not a set anyone read before confirming), which is a type error in the generated client rather than a runtime refusal. The ids it resolves to appear in the result like any other, which is the only place the caller learns them.
         *
         *     **Partial application is the normal case, and it is a `200`.** §11: a Save "applies to what it can and reports what it could not" and "never refuses the whole set because of one document". The result states three parts — what `changed`, what was `alreadyInState` (a document already archived is a no-op, **not** a failure), and, listed apart from both, what was `refused` and why, each named individually **with the verb that applied to it**. One that fails validation is refused with its reason (§14); an unknown id is refused as `not-found`; a row the act does not apply to is refused as `not-applicable`; one whose file could not be written is refused as `write-failed`; the rest go through. **There is no staleness refusal**: every act here names its own delta, so none presents a key (SPEC.md §7) and this route is given no version to compare. There is no `404` either: an unknown id is a per-document outcome here, not a verdict on the request. Every requested id appears exactly once across the three parts, so the caller can compare the total against the count it showed.
         *
         *     **`delete` is user-only** (SPEC.md §7, §9.2): a Save carrying a `delete` entry with `x-corpus-author: agent` is rejected with `403` for the **whole request** — the refusal is the request's, not a per-document outcome — exactly as `DELETE /api/docs/{id}` rejects it. The agent archives, never deletes. Every other act is available to both parties.
         *
         *     **A `400` answers a staged set that cannot be applied as written**: nothing staged at all (no `entries` and no `wholeResultSet`), or one id staged twice. §11 makes a row carry exactly one staged action, so a repeated id means the staged set was keyed wrong; where the two entries name different verbs the message says both, because choosing one silently would be a choice about someone's documents and applying both would write one document twice inside an act that promises to be one commit of exactly what changed. Every document already being in the target state is a different thing entirely — a legal, successful act that changes nothing and therefore makes **no commit at all**: `200`, empty `changed`, null `commit`. The single-document routes are unchanged and remain the path for the reader's ⋯ menu and per-row quick actions (§11) — this route is for a selection, and the difference between them is the commit.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path?: never;
                cookie?: never;
            };
            /** @description The staged set: the individually staged rows, each with its own act, and optionally §11's single whole-result-set entry. `entries` is mandatory, so the body is too. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["BulkActionRequest"];
                };
            };
            responses: {
                /** @description What changed, what was already in that state, what did not change and why — each named with the verb that applied to it, plus the single commit the act landed as, and any §14 warnings. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["BulkActionResult"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description The acting party in `x-corpus-author` may not make this call. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ForbiddenError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/docs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a document, its resolved anchors, and its key
         * @description The read that hands out the document's **key** (SPEC.md §7): `key` names the version this response returned, and presenting it back on a write that replaces the body is what keeps two writers from overwriting each other. Beside it, `userEditing` says whether a person has an edit session open on the document right now — information, never a gate: nothing is refused because of it, and no document is ever read-only.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Identifier of any document; threads are documents too. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Frontmatter, body, this document's anchors, its key, and whether a person is editing it. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Doc"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        /**
         * Edit a document's body and frontmatter
         * @description Runs anchor reconciliation (SPEC.md §6) in the same save and reports which anchors were remapped and which were orphaned. Every field is optional — a request names only what it changes — so an omitted body is exactly a `{}` body: a save that names no change, rewrites nothing, and needs no key.
         *
         *     **A write that replaces the `body` must present the document's `key`** (SPEC.md §7): the key names the version you read, and a `body` with no key is a `400` — replacing a block without naming what it replaces is the write that can destroy something silently. **A write that names its own delta needs none** — a tag, a status, `due`, `reviewed`, `evergreen`, or a view key — because it says what it changes and merges with whatever else happened. Sending a key on such a write is welcome and is still checked, so a caller that always presents what it read needs no rule about which fields are which.
         *
         *     **A stale key is a `409`**, carrying the document as it now stands and a fresh key for it — one exchange, never a bare refusal, and never a lost edit: nothing was written and the content is yours to resend. The saved document in a `200` likewise carries the fresh key for the next write, so a writer that keeps writing never has to re-read.
         */
        put: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of any document; threads are documents too. */
                    id: string;
                };
                cookie?: never;
            };
            /** @description The fields to change, plus the `key` when they include `body`; omit the body entirely to change nothing. */
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateDocRequest"];
                };
            };
            responses: {
                /** @description The saved document — carrying a fresh `key` — and the anchor reconciliation report. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UpdateDocResponse"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
                /** @description The `key` presented names a version this document no longer is: it changed since you read it, so the write was refused rather than overwriting something you never saw (SPEC.md §7). Nothing was written and nothing is lost — `doc` is the document as it now stands, `doc.key` is the fresh key, and the content you tried to save is yours to reconcile and resend. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StaleKeyError"];
                    };
                };
                /** @description The `job` names no event. Nothing was written; retry without it, or with the right id. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnknownJobError"];
                    };
                };
            };
        };
        post?: never;
        /**
         * Delete a document (user-only)
         * @description **User-only**: a request carrying `x-corpus-author: agent` is rejected with `403` — the agent archives, never deletes (SPEC.md §7). Cascade: the document's threads become **orphaned records** — they keep their `parent` id and stay readable, but their anchors no longer resolve. Nothing is hard-deleted from history; git preserves the file and every version of it. Deletion presents no key (SPEC.md §7): it is a user's deliberate act on a document they are looking at, behind an explicit confirm, and it destroys the document rather than a version of it. It takes **no `job`**, unlike the other writes: §9.2's attribution is for work an agent does, and deletion is the one mutation an agent may never perform, so a job field here would name work that cannot exist.
         */
        delete: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of any document; threads are documents too. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The deleted id, the threads it orphaned, and any §14 warnings. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DeleteDocResult"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description The acting party in `x-corpus-author` may not make this call. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ForbiddenError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/docs/{id}/related": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Documents most related to this one
         * @description The documents most related to this one, ranked, in retrieval's frugal shape: id, title, a one-line excerpt, and **why** each is related — never bodies. Retrieval Phase A relates through the reference graph only (outgoing `[[refs]]` and backlinks, via the projection's `links` table), so every row is `linked`; from Phase B, semantically similar documents join the same ranked list and rows are labelled `linked` / `similar` / `both` without the shape moving (SPEC.md §9.1). Archived documents are excluded unless `includeArchived` lifts the default, like every list. A reference to a document that does not exist is not a row: the `links` table stores dangling references on purpose, and an id the caller cannot read is worse than no row. `404` when the document itself is unknown. Read-only; no acting party.
         */
        get: {
            parameters: {
                query?: {
                    /** @description How many related documents to return (1–50, default 10) — the same frugal cap ranked search uses, for the same reason. */
                    limit?: number;
                    /** @description Lift the default archived exclusion. Archived documents are left out of the related set by default, like every list (SPEC.md §11); `true` widens it into the **union**. Archiving is organizational rather than deletion, so an archived neighbour is still a real relation — it is just not what an agent expanding from a live document usually wants first. */
                    includeArchived?: boolean;
                };
                header?: never;
                path: {
                    /** @description Identifier of any document; threads are documents too. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Related documents, most related first. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RelatedDocs"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/docs/{id}/diff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read one document's change across a commit range
         * @description The unified diff of a single document across a git commit range — what `corpus doc diff <id>` prints, and the escalation a `doc.edited` queue event deliberately does not carry (SPEC.md §4). The event announces *that* a user edit session ended, with its range and change stats; this is the one call that says *what* changed, made only when the agent decides the change is worth reading.
         *
         *     **Bounded, like the context pack.** Reading a diff costs roughly the same however large the document or the change: the body is capped at 16000 characters (`DOC_DIFF_MAX_CHARS`) and a longer diff is **truncated, not refused** — whole hunks are dropped from the end so the answer is still a valid unified diff, `truncated` says so, and `totalChars` says how much was cut. Refusing would leave a caller that already spent a wake-up with nothing; truncating leaves it with the front of the change and an honest measure of the rest.
         *
         *     **Path-scoped**: the diff and the stats cover this document's file alone, so commits in the range that touched other documents contribute nothing — the range may be a commit range, but the answer is about one document.
         *
         *     **The range.** `from` is exclusive and `to` inclusive (`git diff from..to`). Both are optional: `to` defaults to the newest commit that touched this document and `from` to the parent of `to`, so the bare `corpus doc diff <id>` of §4's own sentence reads as *what changed in this document's last commit*, while the pair carried by a `doc.edited` event reads as *what changed in that session*. The resolved values come back in the response, because a caller that omitted one must be able to say what it read.
         *
         *     **Only commit shas.** A syntactically invalid revision — `HEAD~1`, a tag, anything leading with `-` — is a `400` naming the parameter, before a handler and therefore before a `git` process exists. A well-formed sha this repository does not contain is *also* a `400` naming the parameter, never a `404`: the `404` on this route means the **document** is unknown, and conflating the two would have a caller believe its document had been deleted when it had merely mistyped a range.
         *
         *     A document the workspace has never committed — a file not yet committed, or a workspace with no git (SPEC.md §14) — answers `200` with a null range, an empty diff and zero stats: an answer, not an error. Read-only; no acting party.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Base of the range, **exclusive** — `git diff from..to`. Omit it to use the parent of `to`, which reads as that single commit's own change; a `to` with no parent falls back to git's empty tree, so a document introduced by the repository's root commit diffs as wholly added. Must be a commit sha: a named revision is a `400` naming this parameter. */
                    from?: string;
                    /** @description Head of the range, **inclusive**. Omit it to use the newest commit that touched this document. Must be a commit sha, like `from`. */
                    to?: string;
                };
                header?: never;
                path: {
                    /** @description Identifier of any document; threads are documents too. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The resolved range, the change stats, and the diff — truncated to the published bound when the change is larger than it. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocDiff"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/docs/{id}/edit-session/flush": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * End this document's edit session now
         * @description Ends any **user** edit session open on this document immediately, which is SPEC.md §4's `close` path: *the reader closes (the UI flushes the session)*. The session's acknowledgment — one `doc.edited` queue event carrying its commit range and change stats — follows, exactly as it would have when §4's three-minute inactivity window elapsed, with `endedBy: "close"`.
         *
         *     **Idempotent, and that is load-bearing.** The answer is `204` whether or not a session was open: this route asserts a *postcondition* — this document has no open edit session — rather than performing an action, and asserting it twice is asserting it once. The caller cannot know whether a session is open (sessions are opened by the server, on the first editor save that lands a commit, and ended by a timer the client cannot observe), so a `404` for *nothing to flush* would make correct client code impossible to write. Calling it on a document that was only read, or flushing twice because an unload path fired twice, is a no-op.
         *
         *     **The `204` carries no body, and deliberately says nothing about whether an event was emitted.** Two reasons, both of which would make such a field a lie. It is a race — the idle window may have elapsed a millisecond earlier, and the session would then already be gone through the other door. And emission is decided *after* this response: a session whose path-scoped range turns out to be empty — an edit and its undo inside one sitting — or whose auto-commits were all rejected or skipped (SPEC.md §14) correctly produces no event at all. What the caller needs is the postcondition, and that is the whole of what `204` states.
         *
         *     **One event per session, whichever door it leaves by.** The flush path and the inactivity path converge on the same session object, and whichever fires first removes it, so the other finds nothing — which is also why a repeated flush is free. At most one `doc.edited` may ever exist per `sessionId`, and a consumer may drop a repeat on that basis alone.
         *
         *     **Callable from a page-unload path — with `fetch(…, { keepalive: true })`, not with `navigator.sendBeacon`.** Stated here rather than left to be discovered: `keepalive` is the supported spelling, because it is the one that can send the workspace bearer token. `sendBeacon` sets no request headers at all, so it cannot carry `Authorization` (SPEC.md §2.1), and this route is not on §2.1's exception list — the method and the empty body would both have suited it, the auth header is what rules it out. Nothing else stands in `keepalive`'s way here: the request is body-less, so the 64 KiB keepalive budget is never in question, and the UI is served same-origin by this server, so no preflight has to survive the unload. Reach it from `pagehide` or `visibilitychange → hidden`; the generated client accepts `keepalive` and forwards it to `fetch`.
         *
         *     **The `404` means the document is unknown, and it is the only one** — never *no session here*. It catches the client bug worth catching (a stale or wrong id, a thread id, an `undefined` in a template string), which a permissive `204` would hide forever. It is not actionable on an unload path: a caller that gets one has nothing to flush either way and should ignore it.
         *
         *     No acting party. The flush authors nothing — the session's commits landed minutes earlier, authored by the user — so there is no git author to attribute and the route declares no `x-corpus-author`, exactly as `POST /api/check` and `POST /api/index/rebuild` do not. The event's own actor is fixed by its payload schema (`actor: "user"`, always), so who makes this call cannot change what the event says, and a caller that is not the reader cannot manufacture an acknowledgment: with no session open there is nothing to end.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Identifier of any document; threads are documents too. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The document has no open edit session. The same answer whether this call ended one or there was none to end — the postcondition, not a report of what happened. */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/docs/{id}/patch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Edit a document's body by anchored exact string replacement
         * @description Edits the body by naming the text to replace rather than by sending a new body: `old` (an excerpt of the body), `new` (its replacement, possibly empty), and `all` (default `false`). **Prefer it over `PUT /api/docs/{id}` for a change you can quote.** That is most bounded changes and not all of them: a patch **replaces**, so it catches a writer who changed the text you quoted and not one who **inserted** elsewhere — an append that another writer may also be appending to goes back whole under a key instead (SPEC.md §7). The whole-body write prices a one-line edit at the length of the document, and — more than the cost — a body the caller never saw cannot survive a body the caller sends: an edit that never carries the rest of the document cannot destroy the rest of the document.
         *
         *     **`old` must match the body exactly and uniquely.** Matching is **byte-exact against the body as stored** — the same bytes `GET /api/docs/{id}` returned in `body` — with no normalisation, no trimming, no line-ending translation and no regular expressions, so what you read is what you quote. It is a **body** operation: `body` excludes the frontmatter block, so an excerpt quoting frontmatter matches nothing, and frontmatter is changed by naming its fields on `PUT /api/docs/{id}`.
         *
         *     **Zero matches and multiple matches are separate refusals that name the count** — both `409`, distinguished by `reason` and quantified by `matches` — because the recoveries are opposite: re-read the document, versus quote more context. A single *it did not apply* would collapse them and leave the caller guessing. `all: true` lifts the uniqueness requirement and replaces **every occurrence left to right without overlap**; it does not lift the requirement to match at all, so zero occurrences is still refused.
         *
         *     **It presents no key** (SPEC.md §7). It names the text it expects to find, which is a staleness check by another route — sharper where it applies, since a patch whose text has moved is told *which* text is gone rather than *that* the document changed, and requiring a key would refuse a well-anchored patch because an unrelated paragraph moved. **It is not the key by another name**: it covers the text the patch quotes and nothing else, which is why the insertion case above goes back whole under a key instead.
         *
         *     **An ordinary write once applied**: validated before writing (SPEC.md §14), anchors reconciled with remapped and orphaned anchors reported (§6), and one auto-commit attributed to the acting party (§4) — the same response shape `PUT /api/docs/{id}` answers with, plus `replaced`. **A patch whose result is the unchanged body is a no-op that writes nothing**: `new` equal to `old` answers `200` with no file change and no commit, rather than a refusal.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of any document; threads are documents too. */
                    id: string;
                };
                cookie?: never;
            };
            /** @description The text to find and what to put in its place. Mandatory: a patch that names no text is not an edit. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["PatchDocRequest"];
                };
            };
            responses: {
                /** @description The saved document — carrying a fresh `key` — the anchor reconciliation report, §14's warnings, and how many occurrences were `replaced`. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PatchDocResponse"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
                /** @description The document's text refuses the patch, and `matches` says how many times `old` occurs in it. `reason: no-match` (`matches: 0`) — the text is not there; re-read the document. `reason: multiple-matches` — the text is there more than once and the patch did not ask for `all`; quote more surrounding context. The two are separate because the recoveries are opposite. Nothing was written. A `stale_key` here is the other case: an external editor moved the document between the match and the write, so re-quoting against the copy this carries is the recovery. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PatchConflictError"] | components["schemas"]["StaleKeyError"];
                    };
                };
                /** @description The `job` names no event. Nothing was written; retry without it, or with the right id. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnknownJobError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/docs/{id}/move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Move a document to another folder
         * @description Rewrites the file path only (SPEC.md §9.2). **The document id never changes**, so every `[[ref]]`, anchor entry and thread `parent` keeps resolving; the projection re-maps id → path. **A move names its own delta and presents no key** (SPEC.md §7): it rewrites the path, not the content, so it invalidates nobody's key and overwrites nothing.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of any document; threads are documents too. */
                    id: string;
                };
                cookie?: never;
            };
            /** @description The destination folder. A move names one, so the body is mandatory. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["MoveDocRequest"];
                };
            };
            responses: {
                /** @description The document at its new path, and any §14 warnings. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocMutationResponse"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
                /** @description The `job` names no event. Nothing was written; retry without it, or with the right id. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnknownJobError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/docs/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Archive a document
         * @description Flips `status` to `archived` — a reversible organizational act, never a deletion (SPEC.md §7). **The document id never changes** and nothing leaves git. Archived documents drop out of the default result set of `GET /api/docs` and come back with `status=archived`. Archiving a `type: skill` document additionally moves its folder to `.claude/skills-archived/`, which disables it without unindexing it — carrying every file under that folder, including a **nested skill** the request never named, whose id is stamped into it so the move does not change its identity (SERVER-078). That carry **disables the nested skill too** (§7: what disables a skill is where its folder lives), and the response says so: one `carried_skill` warning per carried document, naming it, its path after the move, and that it is now **disabled**. It is a report *about* the act, not a part of it — a document the request never named never becomes a changed document (CONTRACT-047). The id stamp itself is deliberately not reported: it keeps an identity rather than changing one. An archive that carries no other skill document warns nothing. **Archiving names its own delta and presents no key** (SPEC.md §7): it flips `status`, overwriting nothing a reader may have been holding.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of any document; threads are documents too. */
                    id: string;
                };
                cookie?: never;
            };
            /** @description Optional, and optional in every part: §9.2 lets any write name the job it serves, and this route previously took no body at all — so **omit the body entirely** and the call is exactly what it has always been. The only thing it can carry is `job`, which buys attribution rather than an origin: §9.2 records an origin for a document a job *creates*, and this act creates nothing. */
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["JobOnlyRequest"];
                };
            };
            responses: {
                /** @description The document, now archived, any §14 warnings, and what a skill folder move carried. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocMutationResponse"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
                /** @description The `job` names no event. Nothing was written; retry without it, or with the right id. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnknownJobError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/docs/{id}/unarchive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Restore an archived document
         * @description The inverse flip, back to `status: resolved` — the state archiving already implied (§5). **The document id never changes.** Unarchiving a `type: skill` document moves its folder back out of `.claude/skills-archived/`, carrying every file under it — including a **nested skill** the request never named, whose id is stamped into it so the move does not change its identity, and whose `status` is reconciled to the enabled root it now sits in (SERVER-078). Both effects on that carried document are reported (CONTRACT-047): a `carried_skill` warning per carried document, naming it, its path after the move, and that it is now **enabled**, and — only where a stale `status: archived` had to be corrected to `resolved` — a `carried_reconciliation` warning naming the document and the key rewritten. They are reports *about* the act, not parts of it: a document the request never named never becomes a changed document. The id stamp is deliberately not reported, since it keeps an identity rather than changing one. An unarchive that carries no other skill document warns nothing, and one whose carried documents needed no correction carries no `carried_reconciliation`. **Unarchiving names its own delta and presents no key** (SPEC.md §7): it flips `status` back, overwriting nothing a reader may have been holding.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of any document; threads are documents too. */
                    id: string;
                };
                cookie?: never;
            };
            /** @description Optional, and optional in every part: §9.2 lets any write name the job it serves, and this route previously took no body at all — so **omit the body entirely** and the call is exactly what it has always been. The only thing it can carry is `job`, which buys attribution rather than an origin: §9.2 records an origin for a document a job *creates*, and this act creates nothing. */
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["JobOnlyRequest"];
                };
            };
            responses: {
                /** @description The document, restored, any §14 warnings, and what a skill folder move carried. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocMutationResponse"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
                /** @description The `job` names no event. Nothing was written; retry without it, or with the right id. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnknownJobError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Ranked retrieval across the corpus
         * @description Ranked retrieval over documents, threads and turns. `q` is required — a ranked list with nothing to rank is `GET /api/docs`, not a degraded search. The structured filters are the same set with the same semantics as `GET /api/docs`, archived default included, and are declared from the same schema so the two cannot drift; `pinned`, `sort` and `offset` are not among them and are ignored if sent (a ranked set has one order and no pages), and neither is `isParent`, which §9.2's signed parameter string declares on the collection query alone. Each hit is an **address plus a line of context** — the document id, its title, the heading path of the best-matching passage (for a hit inside a thread turn, that turn's heading), and a one-line snippet — and **never a body**: reading one is a separate, deliberate `GET /api/docs/{id}` on a retrieved id. Phase A ranks lexically (FTS5); from Retrieval Phase B, lexical and semantic relevance combine into one list with this exact response shape, and `semanticIndex` reports when that half is not caught up (SPEC.md §9.1) — the response's one Phase B seam, inert today. Read-only; no acting party.
         */
        get: {
            parameters: {
                query: {
                    /** @description The query, and the only required parameter. Phase A matches it lexically (FTS5) across document titles, bodies and turn bodies, exactly as `GET /api/docs`'s `q` does; from Phase B the same string is also matched semantically and the two relevances combine into one ranked list (SPEC.md §9.1). Missing or empty is a `400`, never an unranked everything. */
                    q: string;
                    /** @description Comma-separated document types; values OR together. Core values: note, thread, view, template, skill, agent-def. Open rather than enumerated because plugins define their own types (SPEC.md §5, §10). */
                    type?: string;
                    /** @description Restrict to a lifecycle status. Omitted, the default result set **excludes** `status: archived` (SPEC.md §11); passing `status` explicitly overrides that default, so `status=archived` selects archived documents *only*. To see archived documents **alongside** the rest, use `includeArchived=true` — that is the archived chip, not this parameter. */
                    status?: "open" | "resolved" | "archived";
                    /** @description Lift the default archived exclusion. `true` widens the default result set into the **union** of archived and non-archived documents — the archived chip's "include archived" reading (SPEC.md §11) — where `status=archived` selects archived documents *only*. Absent or `false` keeps today's behaviour. It modifies the **default** and nothing else, so it is a no-op alongside an explicit `status`: `status` already replaces the default filter, and `status=open&includeArchived=true` is just `status=open`. */
                    includeArchived?: boolean;
                    /** @description Comma-separated tags; values OR together. Tags are validated comma-free on write, so the separator needs no escaping scheme. */
                    tag?: string;
                    /** @description Path prefix relative to `data/docs/`, matching the folder and its descendants. Threads inherit their parent document's folder (SPEC.md §11). */
                    folder?: string;
                    /** @description Threads whose `parent` is this document id. Thread-only: it no-ops for non-thread types rather than erroring (SPEC.md §9.2). */
                    parent?: string;
                    /** @description Documents whose body contains `[[<id>]]`, read from the projection's `links` table (SPEC.md §9.1). Powers the backlinks panel and the `references:` filter chip. */
                    references?: string;
                    /** @description Agent participation state from the thread's frontmatter (SPEC.md §6). Thread-only: it no-ops for non-thread types rather than erroring (SPEC.md §9.2). */
                    agent?: "none" | "requested" | "engaged";
                    /** @description Author of the thread's last turn — the "awaiting your answer" half of Attention. Thread-only: it no-ops for non-thread types rather than erroring (SPEC.md §9.2). */
                    author?: "user" | "agent";
                    /** @description ISO 8601 instant; matches documents whose `updated` is strictly after it. Distinct from `due`, which is a calendar date or a keyword. */
                    since?: string;
                    /** @description Either an ISO calendar date (due on or before that date) or one of overdue, today, week. Keywords are resolved server-side against the workspace's clock. */
                    due?: string | ("overdue" | "today" | "week");
                    /** @description Staleness tier (SPEC.md §5), selecting documents at or beyond it — `aging` includes stale and very-stale. Documents with `evergreen: true` never match. */
                    stale?: "aging" | "stale" | "very-stale";
                    /** @description Threads whose last turn is newer than your last-seen mark (SPEC.md §7). Thread-only: it no-ops for non-thread types rather than erroring (SPEC.md §9.2). */
                    unread?: boolean;
                    /** @description The Attention filter (SPEC.md §11). `me` is the union of every reason; the individual reasons (unread-reply, form, due, stale, failed-job) back the per-reason chips. Composes with the other filters by intersection — `needs=me&folder=finance` is Attention within that folder. */
                    needs?: "me" | "unread-reply" | "form" | "due" | "stale" | "failed-job";
                    /** @description How many hits to return (1–50, default 10). Lower than the list endpoints' cap on purpose: retrieval is read by an agent that pays for every line, and a top-ten is what a ranked list is for. There is no `offset` — a ranked result set is a top-k, not a page; widen `limit` or narrow the filters. */
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Hits, best match first; an empty list when nothing matched. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SearchResults"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tree": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The `data/docs/` folder tree with document counts
         * @description Backs folder pickers, folder columns and filter chips (SPEC.md §9.2). `count` is the documents filed directly in a folder; `totalCount` includes its descendants. Threads inherit their parent document's folder, so both are counted where they are filed.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The folder tree, roots first. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FolderTree"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/capture": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Capture text (and attachments) as an inbox document
         * @description The composer's Capture action (SPEC.md §11): creates the document in `data/docs/inbox/` **plus** its whole-document filing thread asking the agent to retitle, move, expand and tag it, in one call. `multipart/form-data`, so a screenshot plus one line is a first-class capture; build the body with `uploadCapture` from `@corpus/contract/client`. The returned `eventId` lets the board show the pending-agent indicator immediately and the console link the job back to the capture. An upload past the workspace's size caps is a `413`.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path?: never;
                cookie?: never;
            };
            /** @description The captured `text`, plus any `files` parts. `text` is mandatory, so the body is. */
            requestBody: {
                content: {
                    "multipart/form-data": components["schemas"]["CaptureRequest"];
                };
            };
            responses: {
                /** @description The created document, its filing thread, and the event. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CaptureResult"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description An attached file, or the request as a whole, is past the workspace's upload caps. `issues` names the offending part and the limit it exceeded. The body is the same `bad_request` shape every other validation failure uses — the status is what distinguishes it. */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/threads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a thread on a selection, a whole document, or standalone
         * @description With a selector, the server writes the anchor entry into the parent's frontmatter and creates the thread file atomically (SPEC.md §6). It presents no key (SPEC.md §7): anchoring adds one `anchors` entry to the parent and replaces nothing.
         *
         *     **The stored anchor's context is the server's, not the caller's.** `exact` is stored verbatim, but `prefix`/`suffix` on the request are used for one thing only — saying which occurrence a repeated quote means — and are never written as sent: the server reads the context off the parent's own bytes around the quote, so the anchor is byte-faithful to the file even when the caller could not produce context (SERVER-071). A quote occurring more than once with nothing to tell the occurrences apart is a `400`, because guessing one would attach the conversation to a passage nobody chose; a quote the document does not contain is **not** refused, since §6 calls that anchor orphaned and orphaned is a normal state of a living corpus rather than a bad request.
         *
         *     Send `application/json` for a plain thread, or `multipart/form-data` to attach files to the first turn — the composer's *Ask* with a screenshot (SPEC.md §8). The multipart form takes the same repeated `files` part as `POST /api/capture`, names the first turn's prose `text` rather than `body`, and carries `selector` as one JSON-encoded part; a first turn may be attachment-only, but a request with neither text nor files is a `400`. Multipart bodies are built by `uploadCreateThread` in `@corpus/contract/client`, since `openapi-fetch` serialises JSON only. Servers mount this route with `mountCreateThread` from `@corpus/contract`, which dispatches validation on `content-type`. An upload past the workspace's size caps is a `413`.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path?: never;
                cookie?: never;
            };
            /** @description The thread and its first turn, as JSON or as multipart. Mandatory: the JSON form demands `body`, a multipart body carrying neither `text` nor `files` is a `400`, and a thread with no first turn is not a thread. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateThreadRequest"];
                    "multipart/form-data": components["schemas"]["MultipartCreateThreadRequest"];
                };
            };
            responses: {
                /** @description The created thread, its anchor, and any enqueued event. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CreateThreadResponse"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
                /** @description An attached file, or the request as a whole, is past the workspace's upload caps. `issues` names the offending part and the limit it exceeded. The body is the same `bad_request` shape every other validation failure uses — the status is what distinguishes it. */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description The `job` names no event. Nothing was written; retry without it, or with the right id. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnknownJobError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/threads/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a thread with its turns
         * @description Thread *lists* go through `GET /api/docs` with `type=thread` (SPEC.md §9.2).
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Identifier of a thread document. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The thread and every turn, oldest first. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Thread"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/threads/{id}/context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The thread's bounded context pack
         * @description A **briefing** for one conversation: the parent-side passage the thread is about, plus the most-related excerpts from across the corpus — each an id, a heading path and a short excerpt, ranked by relatedness to the thread's anchor *and* its text. **Bounded by contract**: reading a pack costs roughly the same however large the corpus grows (SPEC.md §7), so the response caps the excerpt count, each excerpt's length and the parent-side prose, and never carries a body. `shape` discriminates the five thread cases in one field — `anchored` (the quote plus the whole enclosing section), `whole-document` (the parent's title and opening content), `orphaned-anchor` (the preserved quote, no resolved passage, SPEC.md §6), `standalone` (no parent block at all) and `parent-deleted` (the parent was deleted out from under the thread: **still a `200`**, with the id that no longer resolves named, because the conversation is real and a `404` here would make the verb unusable on exactly the threads hardest to reconstruct). A section past the cap is truncated around the anchor and the parent block says so, so an agent knows to escalate to `GET /api/docs/{id}` rather than assume it saw everything. `semanticIndex` reports when the semantic half of ranking is not caught up, the same word `/api/search` and `/api/docs/{id}/related` report for the same workspace (SPEC.md §9.1); a semantic provider that fails degrades the ranking, never the status code. **No query parameters**: the bounds live in the contract, not in a flag. A document that exists but is not a thread is a `404` on this surface rather than a `400`, matching `GET /api/threads/{id}`. Read-only; no acting party.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Identifier of a thread document. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The pack, in whichever of the five shapes the thread has. Always within every cap the schema publishes. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AnchoredContextPack"] | components["schemas"]["WholeDocumentContextPack"] | components["schemas"]["OrphanedAnchorContextPack"] | components["schemas"]["StandaloneContextPack"] | components["schemas"]["DeletedParentContextPack"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/threads/{id}/turns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Append a turn to a thread
         * @description The server owns the turn format and guarantees timestamps are unique and monotonic within the thread (SPEC.md §6). Send `application/json` for a plain turn, or `multipart/form-data` to attach files — a turn may be attachment-only, but one carrying neither text nor files is a `400`. Multipart bodies are built by `uploadTurn` in `@corpus/contract/client`, since `openapi-fetch` serialises JSON only. Servers mount this route with `mountAppendTurn` from `@corpus/contract`, which dispatches validation on `content-type`. An upload past the workspace's size caps is a `413`.
         *
         *     **A form fence in an agent's turn is validated here.** When the actor is the agent, a turn whose ```` ```form ```` block does not parse against the grammar — unreadable YAML, a fourth field kind, duplicate questions, a duplicate option, a `write` field carrying `options`, a question or option carrying a newline — is a `400` and does not reach disk through this route.
         *
         *     **What that is not.** It is not a guarantee that every form fence on disk parses, and a client must not treat it as one. Two limits are deliberate: a turn from any other actor is not checked, because §6 makes a form something an *agent* turn carries and a person quoting a form fence in a reply is quoting rather than asking; and this is not the only route that writes a turn — `POST /api/threads` creates a thread with its first turn and does not run this check. So the reader's rule (§11: an unreadable form renders as the visibly broken code block it is, never as a partial set of controls) is the safety net for every fence this endpoint did not vet — a hand-edited file, an older server, a person's quoted block, a thread's first turn — and not a formality.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a thread document. */
                    id: string;
                };
                cookie?: never;
            };
            /** @description The turn, as JSON or as multipart. Mandatory: the JSON form demands `body`, a multipart body carrying neither `text` nor `files` is a `400`, and a request with no body at all is not a call anyone means to make. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["AppendTurnRequest"];
                    "multipart/form-data": components["schemas"]["MultipartAppendTurnRequest"];
                };
            };
            responses: {
                /** @description The appended turn and the updated thread summary. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AppendTurnResponse"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
                /** @description An attached file, or the request as a whole, is past the workspace's upload caps. `issues` names the offending part and the limit it exceeded. The body is the same `bad_request` shape every other validation failure uses — the status is what distinguishes it. */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description The `job` names no event. Nothing was written; retry without it, or with the right id. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnknownJobError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/threads/{id}/turns/{ts}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a turn (user-only)
         * @description **User-only**: a request carrying `x-corpus-author: agent` is rejected with `403` — the agent never deletes turns (SPEC.md §6). Cascade: deleting a thread's **last** turn deletes the thread itself, and deleting a thread removes its anchor entry from the parent's frontmatter, so no highlight is left pointing at an empty conversation. Git retains the deleted turn. It presents no key (SPEC.md §7): deleting a named turn states its own change, and the cascade rewrites one `anchors` entry rather than replacing anything a reader was holding.
         */
        delete: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a thread document. */
                    id: string;
                    /** @description The turn's timestamp, which is its identity within the thread (SPEC.md §6). An ISO 8601 instant contains `:`, so clients must URL-encode it — `2026-07-19T10%3A05%3A00Z`. */
                    ts: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description What the deletion cascaded to. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DeleteTurnResult"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description The acting party in `x-corpus-author` may not make this call. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ForbiddenError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/threads/{id}/turns/{ts}/form": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Answer the form in an agent turn
         * @description Submits an answer to the ```` ```form ```` block in the turn at `{ts}`: the server appends a structured answer turn naming every field the form asked and what was given for it, and enqueues a `form.respond` event that re-triggers the agent like any engaged-thread reply (SPEC.md §6). The thread then leaves `needs=form`.
         *
         *     **The fence**, settled by CONTRACT-014 as a CommonMark subset: an opening backtick fence at column 0 whose info string is exactly `form` (so ```` ```formula ```` is not one, a tilde fence is not one, and a fence quoted inside an outer fenced block is not one), then the YAML, then a required closing fence — a whole line of at least as many backticks; an unterminated fence is not a form. The first form fence in the body wins, and a turn carries at most one form.
         *
         *     **The grammar** the YAML follows (CONTRACT-038). A form is a list of `fields`, each with its own non-empty `question` — the field's whole identity, so questions are **distinct** within the form and there are no field ids. A field is one of exactly three `kind`s and there are no others: `choose one` and `choose any` carry `options` (at least one, each non-empty, all distinct), `write` carries none. A field is **required unless** it carries `optional: true`. The short spelling stays: a top-level `prompt` plus `options` **is** a form with one required `choose one` field, so every form already written keeps parsing. Nothing else is part of the grammar — no form id, no field ids, no defaults, no placeholders, no per-field validation rules, no sections, no conditional fields.
         *
         *     **Two rules keep the form answerable**, since the answer turn is the durable record of what was answered and is read back a line at a time (PR #28 finding 1). A `question` and an option are each **a single line**. And no option may be spelled `**Note:**`, `_(left blank)_`, or one of this same form's questions wrapped in `**…**`: the answer writes a chosen option on a line of its own, where those three read as the note heading, the blank marker, and a question heading. A form breaking either rule does not parse at all — so it is a `400` on the turn that would write it and, wherever such bytes already exist, a form to nobody: it renders as the broken code block it is (§11) rather than advertising a question no answer could ever clear.
         *
         *     **The answer** carries one entry per field answered, matched to its field by `question` rather than by position, with the value under the key the field's kind names: `option` for `choose one`, `options` for `choose any`, `text` for `write`. A chosen option is matched **verbatim** against that field's `options` — a near miss is a rejection. A field left blank is **omitted from `answers`**, which is legal only when that field is optional — so a form whose fields are all optional accepts an empty `answers`. Submitting is all-or-nothing: there is no partial save and no per-field submit, and a form is unanswered until it is submitted. A `note` is free text about the ask as a whole, and always optional.
         *
         *     **User-only**: a request carrying `x-corpus-author: agent` is rejected with `403` — "only the person answers a form: the agent never answers a form, including its own" (SPEC.md §6). A signal the agent can clear for itself is not a signal, so this is a refusal in the same family as user-only deletion, not a silent no-op.
         *
         *     `400` when the answer does not fit the form — an option a field does not offer, an answer to a field the form does not ask, a required field with no answer, a value under the wrong key for the field's kind, or the same option named twice in one `choose any` — naming every offending entry under `body.answers` in `issues`. Also `400` when the answer's own text would not survive the turn it writes: a `write` answer or a `note` containing a line that reads as a turn heading, one leaving a code fence open, or one spelled exactly like this form's own `**<question>**` heading, `**Note:**` or `_(left blank)_` — the last of these would be recorded under the wrong question while parsing perfectly well, so it is refused rather than rewritten (a rewrite would record an answer nobody gave). `404` when the thread has no such turn, or that turn carries no form; `409` when that form is **already answered** — a form is answered once, and changing your mind is an ordinary reply, not a second answer to the same question (SPEC.md §6, §11). The `409` is deliberate: the request is well formed and the state is what refuses it, so retrying with a different body will not help.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a thread document. */
                    id: string;
                    /** @description Timestamp of the agent turn carrying the form, which is that turn's identity and therefore the form's (SPEC.md §6). An ISO 8601 instant contains `:`, so clients must URL-encode it — `2026-07-19T10%3A05%3A00Z`. */
                    ts: string;
                };
                cookie?: never;
            };
            /** @description The answer. `answers` is mandatory — though it may be empty, for a form whose fields are all optional — so the body is too. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["FormAnswerRequest"];
                };
            };
            responses: {
                /** @description The appended answer turn, the updated thread summary, and the enqueued event. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FormAnswerResponse"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description The acting party in `x-corpus-author` may not make this call. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ForbiddenError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
                /** @description The request conflicts with state that already exists. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ConflictError"];
                    };
                };
                /** @description The `job` names no event. Nothing was written; retry without it, or with the right id. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnknownJobError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/threads/{id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resolve a thread
         * @description Sets `status: resolved`. The thread collapses in the document view and **later turns stop re-triggering the agent** even while it is `engaged` (SPEC.md §8) — resolving is how a conversation is closed without deleting anything. Resolving rewrites the thread file and auto-commits it, so the response carries §14's warnings — a workspace hook that rejects the commit leaves the status change on disk and uncommitted, and that has to be visible.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a thread document. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The updated thread summary, and any warnings raised while writing it. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ThreadMutationResponse"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/threads/{id}/reopen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reopen a resolved thread
         * @description Sets `status: open` again. An `engaged` thread resumes re-triggering the agent on later turns (SPEC.md §8). Like `resolve`, it rewrites and auto-commits the thread file, so the response carries §14's warnings.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a thread document. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The updated thread summary, and any warnings raised while writing it. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ThreadMutationResponse"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/threads/{id}/seen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark a thread read
         * @description Records the last-seen mark in `.corpus/seen.json` and broadcasts an invalidation, so unread badges clear everywhere at once (SPEC.md §7). What counts as read is displayed content only — opening a parent document does not mark its collapsed-chip threads seen. The body is optional in full: a bare `POST` marks the thread read up to its last turn, which is what opening a thread means, and `lastSeenTs`, when given, records a partial read instead.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a thread document. */
                    id: string;
                };
                cookie?: never;
            };
            /** @description Optional partial-read mark; omit the body entirely to mark the whole thread read. */
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["MarkSeenRequest"];
                };
            };
            responses: {
                /** @description The mark now recorded. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MarkSeenResult"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/threads/{id}/reattach": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Re-attach a thread to a range a person chose (user-only)
         * @description Attaches an anchored thread to a range of its parent document's current body, chosen by a **person**. The repair for a comment whose selector never byte-matched, which reconciliation cannot fix: a save only ever carries an anchor forward or orphans it, and an anchor that was never resolvable stays detached for the life of the document (SPEC.md §6).
         *
         *     **The request names a range, never a candidate.** A candidate index would oblige the server to regenerate the same list the UI showed and count into it, so the moment the two lists differ the same index means a different passage — the exact silent misattachment this route exists to prevent. `range` is in `ResolvedAnchor.range`'s coordinate space, so a range read from `GET /api/docs/{id}` can be sent straight back.
         *
         *     **Nothing the caller sends is stored.** The server reads the range's bytes out of the parent and computes the whole selector — `exact` and its `prefix`/`suffix` context — from the document itself, the same rule `POST /api/threads` follows (SERVER-071), so a repaired anchor is in exactly the shape a save would have left it in and the two cannot drift. `expectedText` is a **guard, not a selector**: the server refuses when the parent's live bytes at that range are not what the caller was looking at, because the document may have been saved between the person seeing the range and choosing it.
         *
         *     **User-only**: a request carrying `x-corpus-author: agent` is rejected with `403`. The evidence this route runs on is a person's memory of what they commented on; SERVER-059 showed it does not exist at read time, so a machine calling this would be guessing, and §6 puts a visible orphan above a silent misattachment. The agent also has no need for it — every edit that carries real evidence already reconciles on the save path.
         *
         *     **One action, one commit** (SPEC.md §4): the repair rewrites one `anchors` entry in the parent's frontmatter and lands as a single auto-commit authored by the acting party. Nothing else about the thread changes — not its status, not its turns, not its body. It presents no key (§7): it rewrites one `anchors` entry, and `expectedText` is already the same check by another route — a range whose bytes moved is refused on its own terms below.
         *
         *     **`409`, with a machine-readable `reason`.** `range-changed` — the parent no longer holds `expectedText` at that range, or the range runs past the end of the body; the caller has to re-read and choose again. `range-overlaps` — the range overlaps text another thread's anchor already resolves over; §6 requires that two threads on disjoint text never end up claiming overlapping text, so this is refused rather than merged or silently dropped. The thread's **own** current anchor is not an overlap with itself. `not-anchored` — the thread is standalone or a whole-document comment; giving one an anchor changes the scope of somebody's comment rather than repairing it, and is not this route.
         *
         *     **A thread that already resolves may be re-attached too**, which moves it. A misattached anchor is as wrong as a detached one, and refusing would leave delete-and-recreate — losing the conversation — as the only correction. The guard and the overlap check make the move as safe as the repair.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a thread document. */
                    id: string;
                };
                cookie?: never;
            };
            /** @description The range the person chose, and the bytes they saw there. Mandatory: a re-attach with no range is not a decision. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ReattachThreadRequest"];
                };
            };
            responses: {
                /** @description The repaired anchor — `orphaned: false`, and a `range` equal to the one the request named — with the thread summary and any warnings raised while writing the parent. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReattachThreadResponse"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description The acting party in `x-corpus-author` may not make this call. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ForbiddenError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
                /** @description The document's state refuses the repair; `reason` says which state — the range changed under the caller, it overlaps another thread's text, or the thread has no anchor to repair. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReattachConflictError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/queue/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Halted state and per-status event counts */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Current queue depth and halt state. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["QueueStatus"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/queue/idle": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Long-poll until work is available
         * @description Returns `200` the instant pending work exists or arrives, and `204` with no body when the window expires (default and maximum 480 s) so the skill loop re-invokes it. Both outcomes are normal; `204` is not an error. **Idle reports availability and never claims** — follow a `200` with `POST /api/queue/claim-all`. While the queue is halted, idle parks for the full window and never returns events (SPEC.md §7).
         *
         *     A `200` also carries `inProgress`: what the server still thinks the agent is doing. It is reported here and on `claim-all` — the loop's two entry points — and nowhere else; the `204` that ends an empty window has no body and therefore no list. See `claim-all` for the reconciliation contract.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Seconds to hold the request open, 1–480 (480 is also the default; a longer ask is rejected with a 400 validation error, not clamped). Parking costs the agent zero tokens: it is blocked on a response, not looping. */
                    timeout?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Pending events exist; claim them next. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["IdleResult"];
                    };
                };
                /** @description The window expired with nothing pending. Re-invoke to park again. */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/queue/claim-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Atomically claim every pending event, and report what is already held
         * @description Moves all `pending/*` events to `in-progress/` in one call and returns them as a batch; concurrent claims never hand the same event to two callers. Returns an empty batch while halted (SPEC.md §7).
         *
         *     **The response also reports what the server still thinks the agent is doing**, as `inProgress` — its own field, never mixed into `events`. The two answer different questions, and an agent that confused them would either redo settled work or settle work it never did. Nothing in `inProgress` was claimed by this call: those events were already in `in-progress/` when it arrived.
         *
         *     **The loop is expected to reconcile it** (SPEC.md §7). An event whose work this agent has already done is settled on the spot with the ordinary verbs; one it is genuinely still working is left alone; and an event it **cannot account for is never settled** — closing an unfamiliar event to tidy the list would silently kill a concurrent run's work. Reconciliation is the agent's judgement and never an inference the server draws on its behalf: this endpoint reports, and settles nothing by itself. `reap-stale` remains the recovery for the other case — a session that died with its context — and stays a requeue.
         *
         *     **The list is capped, and says so.** Past the cap it reports the true `total` and sets `truncated`; the complete set is `GET /api/jobs?status=in-progress`. A short list that looked complete would defeat the whole field.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The claimed events — empty while halted or when nothing is pending — beside the events the server already holds `in-progress`. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ClaimBatch"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/queue/reap-stale": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Recover stuck in-progress events
         * @description Moves events left in `in-progress/` by a crashed run back to `pending/`, so a dead agent session cannot strand work (SPEC.md §7).
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The events returned to `pending/`. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReapStaleResult"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/queue/halt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Halt the queue
         * @description Writes the `.corpus/HALT` sentinel. While halted, `claim-all` returns empty and `idle` parks for its full window (SPEC.md §7). The console strip's HALT toggle and `corpus queue halt` both land here. The body is optional in full: a bare `POST` halts, and a `reason`, when given, is recorded in the sentinel beside the halt timestamp. Halting an already-halted queue is not an error — it re-records the sentinel, so a second call may replace, add, or clear the reason: a bare re-halt rewrites the sentinel without one.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path?: never;
                cookie?: never;
            };
            /** @description Optional halt annotation; omit the body entirely to halt without a reason. */
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["HaltQueueRequest"];
                };
            };
            responses: {
                /** @description The queue status, now halted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["QueueStatus"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/queue/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resume the queue
         * @description Removes the `.corpus/HALT` sentinel; parked `idle` calls become live again.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The queue status, no longer halted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["QueueStatus"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/queue/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark a claimed event processed */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a queue event. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The event, now in `processed/`. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["QueueEvent"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/queue/{id}/fail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark a claimed event failed */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a queue event. */
                    id: string;
                };
                cookie?: never;
            };
            /** @description Optional failure annotation; omit the body entirely to fail without a reason. */
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["FailEventRequest"];
                };
            };
            responses: {
                /** @description The event, now in `failed/`. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["QueueEvent"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/queue/{id}/defer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Defer a claimed event while a person is editing that document
         * @description Moves a claimed event to `deferred/` — waiting, not failed (SPEC.md §7). The agent calls it when the work it claimed needs a document a **person** has an edit session open on (`userEditing` on the document read): it replies to the waiting thread, defers the event, and moves on. **A judgement, not a refusal** — nothing stopped it writing; the key would have let the write through. It deferred because it saw.
         *
         *     **The event comes back on its own.** The end of that edit session on `blockedOn` returns it to `pending`, and `corpus queue idle` unparks — no retry call, no operator. Until then it is not claimable: `claim-all` skips deferred events, because handing back work while the person is still typing would put the agent straight back where it decided not to be.
         *
         *     **Nothing is ever silently dropped** (SPEC.md §7). A deferral whose document is never put down stays on disk, stays visible in the queue counts and the console, survives a restart, and stays retryable by hand through `POST /api/jobs/{id}/retry`.
         *
         *     `409` when the event is not `in-progress`: only claimed work can be deferred, since nothing else has looked at the document yet, exactly as only a finished job can be retried. `404` when there is no such event.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a queue event. */
                    id: string;
                };
                cookie?: never;
            };
            /** @description The document being waited on, and optionally why. A deferral that named no document could never re-enter, so the body is mandatory. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["DeferEventRequest"];
                };
            };
            responses: {
                /** @description The event, now in `deferred/`. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["QueueEvent"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
                /** @description The request conflicts with state that already exists. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ConflictError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/queue/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Abandon an event
         * @description Moves the event to `abandoned/` — the give-up terminal state, distinct from `failed/` which a retry can pick up again (SPEC.md §7). The event file is kept; nothing is deleted.
         */
        delete: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a queue event. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The event, now in `abandoned/`. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["QueueEvent"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Recent jobs for the console, or the jobs outstanding on one document
         * @description Two questions on one route. **Unfiltered** it is the console's master list: one row per queue event with its status and last log line (SPEC.md §7, §11), most recently touched first, and `originId` links each row back to the document or thread it came from. **Filtered by `originId` (and usually `status`)** it is a predicate about a single document — *is the agent still working here?* — which SPEC.md §8's pending row and the board row's agent dot both need. That answer is **complete** — `recent` bounds the console list and is ignored once `originId` is given — because a predicate about one document cannot be allowed to be displaced by unrelated queue activity; that displacement is exactly how a deferred job's "working…" row used to vanish while its reply was still coming (CONTRACT-030).
         */
        get: {
            parameters: {
                query?: {
                    /** @description How many of the most recent jobs to return (1–200). **Bounds the console list only, and is ignored once `originId` is given.** A window is the right shape for "what has the queue been doing", which is unbounded, and the wrong shape for "is anything outstanding here", which must be answered completely or not at all: a windowed predicate is wrong less often than an unwindowed one and still wrong, and its failure is the silent direction — a job that fell out of the window is indistinguishable from no job. One document's jobs are bounded by that document's own history, so there is nothing here a window needs to protect the caller from. */
                    recent?: number;
                    /** @description **Restrict to jobs originating from this document or thread** — the `Job.originId` value, matched by the same rule the response field is derived by (first of `threadId`, `parentId`, `docId` in the event payload that names a document the corpus still holds). This is a predicate about one document, not a narrowing of the console list: it exists so a caller can ask *is anything still outstanding here?* and get a **complete** answer — every matching job, in the same order, with `recent` no longer applied. Omitted, the query is the console's list and is unchanged, window and all. */
                    originId?: string;
                    /** @description Comma-separated job statuses; values OR together. Legal values: pending, in-progress, deferred, processed, failed, abandoned. Deliberately a general set rather than a named `outstanding` shorthand: which statuses count as unsettled is a reading of SPEC.md §7's state machine, and baking one caller's reading into the wire would make every other caller live with it. The two callers that ask the outstanding question pass `pending,in-progress,deferred` — the three non-terminal states, `deferred` included, since a job waiting on somebody's editing is still owed. */
                    status?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Console rows, most recent first. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["JobList"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs/{id}/log": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A job's log lines
         * @description Reads `.corpus/jobs/<eventId>.jsonl`. SSE announces only that the log grew (SPEC.md §2.2 rule 3), so the console refetches here — pass the previous `nextCursor` to get just the new lines. Log content is always rendered as plain text, never interpreted.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Lines already held by the caller; pass back `nextCursor` to fetch only new ones. */
                    cursor?: number;
                };
                header?: never;
                path: {
                    /** @description Identifier of a queue event. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Lines from the cursor onwards, plus the next cursor. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["JobLog"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Append a line to a job's log (loopback-only, tokenless)
         * @description **Localhost-only and unauthenticated**, for Claude Code hooks such as `PostToolUse` which hold no token. Appends to the same `.corpus/jobs/<eventId>.jsonl` that `corpus job log` writes through. Hardening (SPEC.md §7): non-loopback peers and requests carrying a browser `Origin` header are rejected with `403`, line length is capped, and appends to unknown job ids are refused with `404`. The log **file** is capped too, and that cap does not fail the call: a line dropped because the log is full still answers `201`, with `appended: false`.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a queue event. */
                    id: string;
                };
                cookie?: never;
            };
            /** @description The line to append. There is nothing to append without one, so the body is mandatory. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["AppendLogRequest"];
                };
            };
            responses: {
                /** @description The append was accepted; `appended` says whether the line actually reached the log. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AppendLogResult"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description The acting party in `x-corpus-author` may not make this call. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ForbiddenError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Retry a failed or deferred job
         * @description Returns the event to `pending/` so the agent picks it up again — the retry action in the console's detail header (SPEC.md §11).
         *
         *     It works on a **deferred** job too, and stays the manual override once deferrals re-enter on their own (SPEC.md §7, CONTRACT-021): automatic re-entry handles the edit session ending, and this handles everything it did not reach — a deferral an operator simply wants back now, or one whose document was put down in a way the server never saw.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a queue event. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The job, queued again. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Job"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
                /** @description The request conflicts with state that already exists. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ConflictError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs/{id}/abandon": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Abandon a failed job
         * @description Gives up on the job, moving its event to `abandoned/` — the other half of the console's failed-job actions. Nothing is deleted.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description Identifier of a queue event. */
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The job, abandoned. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Job"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/db/rebuild": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rebuild the projection from files
         * @description Re-derives every row of `.corpus/cache.db` from the workspace's files alone and swaps the result in atomically, which is what makes §9.1's "derived tables only" checkable rather than merely asserted (SPEC.md §14). The rename is the commit point: an interrupted rebuild leaves the previous database intact. **Takes no request body at all** — there is nothing to configure, and a bodiless `POST` is the whole call. A rebuild of a large corpus is the longest-running call in the API; clients give it a longer timeout than the default. `rebuild` followed by a clean `doctor` is the standing invariant §14 names.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description What the rebuild wrote: per-table row counts, how long it took, and every file it skipped. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RebuildResult"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/db/doctor": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check the projection against the files
         * @description Reports every disagreement between the workspace's files and the projection's rows (SPEC.md §14). Cheap enough for a pre-commit hook: a file whose size and mtime are unchanged is never re-read, and a file that already has a row is never re-parsed. Nothing is mutated and no rebuild is triggered — a drifted projection is reported, never quietly repaired, because the point of the check is that drift is visible. `ok` is the verdict `corpus db doctor` turns into its exit code. Findings that are worth reporting but are not disagreements arrive separately in `warnings`, which never moves `ok`.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The drift report. `ok` is true exactly when `drift` is empty; a drifted projection is a `200` carrying the findings, not an error status. `warnings`, when present, is report-only and leaves `ok` alone. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DoctorReport"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Validate documents against the §14 rules
         * @description Runs the corpus validator and reports what it found, separated into failures and warnings (SPEC.md §14). This is the same validator every server mutation runs before writing — hooks and API share one implementation, which is the whole point of exposing it.
         *
         *     **Two request forms, exactly one per call.** `{ids}` names documents to read from the workspace. `{documents: [{path, content}]}` supplies content that is not on disk — `corpus doc check --staged`, whose bytes come from `git diff --cached`. Sending both keys, or neither, is a `400`: the two forms answer different questions and a request that mixed them would leave the caller guessing which one was honoured. There is deliberately no implicit everything form, so an empty request can never be mistaken for a whole-workspace check; an empty `ids` or `documents` array is legal and returns an empty, `ok` report.
         *
         *     **Cross-document rules see the whole corpus, not just the request.** Duplicate ids, thread parents, anchor claims and `[[refs]]` are judged against the workspace, so checking one file does not report every reference in it as unresolved merely because its target was not submitted.
         *
         *     **Severity is fixed by §14, not by the caller.** Warnings are exactly `anchor-unresolved` (a well-formed anchor whose quote no longer resolves — an orphaned thread, a normal outcome of editing) and `ref-unresolved` (a `[[ref]]` whose target does not exist yet — how a corpus grows). The other twelve codes are errors, `anchor-unused` among them: §14 requires every anchor to belong to an existing thread, so a highlight pointing at no conversation is structural drift. `unterminated-fence` is one too — a fenced code block the body never closes reads as code to the end of the document, so a thread's later turns disappear into the turn before them. `ok` is `errors.length === 0` and is what `corpus doc check` turns into exit 0 or exit 6.
         *
         *     A drifted corpus is a `200` carrying the findings, never an error status — the check succeeded; the corpus is what has the problem.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description Either the document ids to check, or the unsaved `(path, content)` pairs. */
            requestBody: {
                content: {
                    "application/json": {
                        /** @description Documents to read from the workspace and check. An empty array checks nothing and returns an empty report. Ids naming no document contribute no findings — the report describes what was read; use `GET /api/docs/{id}` to ask whether a document exists. */
                        ids: string[];
                    } | {
                        /** @description Content to check without saving it — `corpus doc check --staged`, whose bytes come from `git diff --cached`. An empty array checks nothing and returns an empty report. */
                        documents: components["schemas"]["CheckDocumentInput"][];
                    };
                };
            };
            responses: {
                /** @description The report. `ok` is the verdict; `errors` fails the check and `warnings` does not. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CheckReport"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/index/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Semantic-index health
         * @description Reports the semantic index's coverage — indexed, pending and failed chunk counts — the recorded provider/model identity, whether a full rebuild is in progress, and the single `state` those facts derive to (SPEC.md §9.1). It is the surface that makes asynchronous indexing honest rather than hidden: indexing never blocks a save, so a backlog is normal, and this is where a person sees it draining. A backlog is **staleness, not drift** — `corpus db doctor` stays clean while indexing is in flight (SPEC.md §14), and the two checks answer different questions on purpose. `state` is the same value, from the same schema, that `GET /api/search` reports as `semanticIndex`. Read-only; no acting party.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The index's current health. A workspace with no semantic index answers `disabled` with a null identity and zero counts — an honest answer, never an error. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["IndexStatus"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/index/rebuild": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Discard and asynchronously rebuild the semantic index
         * @description Discards the semantic index and re-queues every chunk — the narrow counterpart of `POST /api/db/rebuild`, which reconstructs the whole projection and likewise queues semantic re-indexing (SPEC.md §9.1). Discarding the vectors is also what frees the **sticky** provider and model: resolution is sticky to the identities the index already records, so an index holding none leaves the next resolution free to pick the current default (SPEC.md §9.1). That re-pick happens when the indexing worker next resolves — *after* this call has returned. **Takes no request body at all**, and carries no acting party: it touches only derived runtime state, so there is no workspace file change and no git commit to attribute (SPEC.md §9.2). **Returns immediately, before the work is done** — hence `202`, and hence a response that reports only what is already true: the `IndexStatus` snapshot taken the moment everything was queued, which is a caller's acknowledgement (`rebuilding` true, `pending` at the full corpus, `indexed` and `identity` emptied by the discard) and never a claim of completion. In particular `identity` is `null` here **always** — it reports what the index's vectors record, and the call just deleted every one of them; the newly picked identity appears in `GET /api/index/status` once the first chunk is embedded. Progress is observed by polling that endpoint; meanwhile ranked search stays fully available on its lexical half and says `indexing` while it waits. This is also how a `failed` chunk gets another attempt: failures do not drain on their own.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Accepted and queued, not completed. The snapshot is true at the moment of the call: `rebuilding` is true, `pending` counts what was just queued, `state` is `indexing`, and `identity` is `null` because the vectors that recorded one were just discarded. */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["IndexStatus"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a skill
         * @description Creates `.claude/skills/{name}/SKILL.md` through the server's ordinary mutation pipeline — the write path SPEC.md §7's skill genesis needs, since the agent reaches the workspace only through the CLI and the server is the sole writer (SPEC.md §9.1).
         *
         *     **The created file carries both frontmatter vocabularies**, which is what makes a skill simultaneously a Claude Code skill and a Corpus document: `name` (equal to the directory name) and `description` for Claude Code's discovery, plus the core document keys the server assigns — `id`, `type: skill`, `title`, `created`, `updated`, `tags`, `status`, `anchors`.
         *
         *     **The skill is named in the body rather than in the path** because the path names a resource that does not exist yet; this is `POST /api/docs`'s convention. The name doubles as the traversal guard: it is validated against a pattern that admits no `/`, `.` or whitespace, so a traversal attempt is a `400` naming `body.name` and never reaches the filesystem.
         *
         *     **The creation lands as a normal auto-commit** (SPEC.md §9.2) and is projected and broadcast like any other write, so the new skill appears on the board and in `GET /api/docs?type=skill` without a restart. If the workspace's git hooks reject the commit, the file stands anyway and the rejection comes back in `warnings` (SPEC.md §14).
         *
         *     `409` means the name is taken — a skill of that name is already installed. Whether a name held only by an *archived* skill (`.claude/skills-archived/{name}/`, where `corpus doc archive` moves one) is likewise taken is answered by the server, and both answers are already describable here: refusing it is this same `409`, allowing it is a plain `201`.
         *
         *     It presents no key (SPEC.md §7): this call's document does not exist until the call succeeds, so there is no version anyone could have read. Editing the skill afterwards goes through `PUT /api/docs/{id}`, which does demand a key for a body write.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path?: never;
                cookie?: never;
            };
            /** @description The skill to create. `name` and `description` are mandatory, so the body is. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["SkillCreateRequest"];
                };
            };
            responses: {
                /** @description The created skill as an ordinary document — its frontmatter, body and workspace-relative path — plus any §14 warnings. The same shape `POST /api/docs` returns, because what was created is the same kind of thing. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocMutationResponse"];
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description The request conflicts with state that already exists. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ConflictError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/upgrade/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Ask, once, whether a newer release exists
         * @description Queries the GitHub Releases API for the newest release of the installed distribution and compares it with the running version (SPEC.md §2.4). **Only when called** — Corpus 'never checks for, downloads, or installs anything in the background, and never phones home', so this endpoint is the *only* thing that reaches GitHub, it reaches it once per request, and it keeps nothing between requests. There is no cache to invalidate and no schedule to disable, because there is neither.
         *
         *     **Read-only in the strictest sense**: nothing is downloaded, nothing is written, no commit is made, and no acting party is declared. Calling it a hundred times changes nothing but the rate-limit budget.
         *
         *     **Two independent verdicts, not one.** `upgradeAvailable` is the version comparison; `verifiable` is whether that release publishes the checksum asset §2.4 requires the upgrade to verify before installing. A newer release without one is not an upgradable target — `POST /api/upgrade` would start an upgrade that refuses — so a client offers its action on both flags, and explains rather than acts when they disagree.
         *
         *     **An unreachable GitHub is a described answer, never a `5xx`.** Offline laptops, captive portals and rate limits are ordinary conditions for a localhost tool, not server faults: the response is a `200` with `reachable` false, the other fields empty, and `detail` saying why in one sentence. The endpoint succeeded; the network is what did not.
         *
         *     **It reports nothing about the workspace's template files**, though §2.4's upgrade syncs them. It cannot: the three-way rule compares against the files the *new* tool ships, and those are not in this workspace until the install has happened. `corpus upgrade --check` answers that question locally, after it has resolved the incoming side.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description What the check found — including the honest 'I could not look', which is `reachable` false rather than an error status. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UpgradeCheck"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/upgrade": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Spawn the detached CLI upgrade, and answer before it finishes
         * @description Asks the server to spawn the installed `corpus upgrade` as a detached process — the UI's 'Upgrade & restart' action (SPEC.md §2.4). The server performs no part of the upgrade itself: the spawned CLI checks, downloads the tarball over HTTPS, verifies its published checksum, reinstalls through the same npm-global path the tool was installed with (refusing with instructions rather than guessing when the install method cannot be detected), brings the workspace's template files up to the new tool's, and — if and only if the server was running when the upgrade began — restarts it against the same workspace.
         *
         *     **Takes no request body at all**, and carries no acting party: this request writes no workspace file and makes no commit. The writes and the single attributed commit belong to the spawned process, which outlives this one by design (it restarts the server, so it cannot be the server's child in any surviving sense).
         *
         *     **`202`, and the gap it names is real.** The response is written before the download begins; it reports that a process exists and nothing more. Success, refusal-to-install and every template-sync verdict are decided long afterwards, and none of them can come back over this connection — which is why the body names `logPath`, the file the detached process writes its report to. That report is where SPEC.md §2.4's requirement lands: what was updated, what was left alone, and, listed apart from both because **a conflict is unresolved work rather than a notice**, every file the workspace edited that the tool also changed, each naming `corpus workspace diff <path>`. Corpus never merges those automatically — a plausible-looking auto-merge of prose that instructs the agent would corrupt the loop.
         *
         *     **Completion is observed, not reported.** §2.4: the UI 'rides out the restart with its normal SSE reconnect and shows the new version on return'. The `/events` stream dropping is the upgrade proceeding; the stream returning with a new `version` from `GET /api/health` is it having finished. There is deliberately no progress endpoint, because the only server that could answer one is the server being replaced.
         *
         *     **One at a time.** A second trigger while an upgrade is in flight is a `409`, not a second process: two concurrent installs racing over the same npm prefix is how a working installation becomes a broken one.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Spawned, not completed. `started` is always `true` — the refusal has its own status — and `logPath` is where the upgrade's report, conflicts included, will be written. */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UpgradeStarted"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description The request conflicts with state that already exists. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ConflictError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Server-sent invalidation stream
         * @description Emits `invalidate` events carrying query keys — never data (SPEC.md §2.2 rule 3). 25 s heartbeat, dead subscribers pruned. Consume via `createEventStream` from `@corpus/contract/client`.
         *
         *     The key vocabulary is **closed** — these ten shapes and no others. Constants and helpers that build them are published as `QUERY_KEY_VOCABULARY` and friends from `@corpus/contract` and `@corpus/contract/client`, so the emitter and the client bridge share one source rather than two copies that drift:
         *
         *     - `["docs"]` — emitted by every document or thread mutation (create, update, move, archive, unarchive, delete, thread create, turn append, resolve/reopen, re-attach, mark-seen) and every out-of-band file change the watcher projects. Refetch: `GET /api/docs` — every board column, the search overlay, Attention, and every autocomplete.
         *     - `["docs", "<docId|threadId>"]` — emitted by a mutation of that one document, and a thread mutation for both the thread and its parent. Refetch: `GET /api/docs/{id}` — the open reader for that document.
         *     - `["tree"]` — emitted by anything that changes the folder hierarchy: create, move, delete, archive of a skill. Refetch: `GET /api/tree` — the folder-column picker.
         *     - `["threads", "<threadId>"]` — emitted by thread creation, turn append, turn deletion, resolve/reopen, and mark-seen for that thread. Refetch: `GET /api/threads/{id}` — the open thread view and its unread badge.
         *     - `["queue"]` — emitted by every queue transition: enqueue, claim, complete, fail, defer, abandon, reap, halt/resume, and the end of an edit session that re-enters a deferred event. Refetch: `GET /api/queue/status` — the console strip's depth and halted state.
         *     - `["jobs"]` — emitted by every queue transition, plus any job-log append (coalesced). Refetch: `GET /api/jobs` — the console's job list.
         *     - `["jobs", "<eventId>"]` — emitted by an append to that job's log — over HTTP or out of band — and its retry/abandon transitions. Refetch: `GET /api/jobs/{id}/log` — the console's live log panel for the selected job.
         *     - `["index"]` — emitted by the embed worker whenever the index's derived state moves: provider adoption, a new disabled or model-download reason, throttled progress while a backlog drains, and the caught-up transition — plus an index rebuild's start and end. Refetch: `GET /api/index/status` — the console strip's index pill.
         */
        get: {
            parameters: {
                query: {
                    /** @description Workspace bearer token; a query parameter because EventSource cannot set headers. Accepted for v1 under the localhost bind (SPEC.md §2.1) — a remote-server deployment must replace this transport (see the route's contract docblock) before leaving loopback. */
                    token: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description An open event stream. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/event-stream": string;
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/attachments/{path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read attachment bytes
         * @description Serves a file from `.corpus/attachments/`. The `path` parameter is slash-bearing (`<thread-id>/<turn-ts>/<filename>`), so servers mount it as a wildcard rather than a single segment. The declared response type is `application/octet-stream`; the actual `content-type` is sniffed from the file, so images render inline in the UI and other files download as chips.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description Attachment path relative to `.corpus/attachments/`, i.e. `<thread-id>/<turn-ts>/<filename>`. Slash-bearing, so it occupies the rest of the URL path. */
                    path: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The attachment bytes. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": string;
                    };
                };
                /** @description The request failed schema validation; `issues` names the offending fields. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationError"];
                    };
                };
                /** @description Missing or invalid workspace bearer token. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnauthorizedError"];
                    };
                };
                /** @description No such resource. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotFoundError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Health: {
            /** @enum {string} */
            status: "ok";
            /** @description Version of the running `corpus` tool. */
            version: string;
            uptimeSeconds: number;
            /** @description Absolute path of the workspace this server owns. */
            workspace: string;
        };
        DocList: {
            items: components["schemas"]["DocRow"][];
            page: components["schemas"]["PageMeta"];
        };
        DocRow: {
            /**
             * @description Identifier of any document; threads are documents too.
             * @example doc_a1b2c3
             */
            id: string;
            /**
             * @description Document type. Core values: note, thread, view, template, skill, agent-def. Plugins define their own.
             * @example note
             */
            type: string;
            title: string;
            path: string;
            /**
             * @description Lifecycle status; meaning is per type. Archiving is a reversible flip, never a deletion.
             * @enum {string}
             */
            status: "open" | "resolved" | "archived";
            tags: string[];
            /**
             * Format: date-time
             * @description When the document was created, or `null` when the file carries no such timestamp — a hand-written skill file legitimately has none. Render it as “—” rather than substituting a date; staleness treats an unknown age as fresh.
             * @example 2026-07-19T10:05:00Z
             */
            created: string | null;
            /**
             * Format: date-time
             * @description When the document was last modified, or `null` when the file carries no such timestamp — a hand-written skill file legitimately has none. Render it as “—” rather than substituting a date; staleness treats an unknown age as fresh.
             * @example 2026-07-19T10:05:00Z
             */
            updated: string | null;
            /**
             * Format: date
             * @example 2026-08-01
             */
            due: string | null;
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            reviewed: string | null;
            evergreen: boolean;
            /**
             * @description The thread this document came from (SPEC.md §7 scope, §9.2 provenance), or null when it came from no job. **Server-assigned**: recorded once, from the job the creating write named, whether or not any thread is designated — scope is computed later, and a fact not recorded at write time cannot be recovered. The only request that may touch it is a doc edit sending `origin: null` (detach, user-only), and a detached document may be claimed again by a later write naming a job.
             * @example th_x9y8z7
             */
            origin: string | null;
            /** @description Leading plain-text excerpt of the body, for list rows. */
            excerpt: string;
            /** @description True pins this `type: view` document to the board as a column (SPEC.md §11). `false` when the file carries no `pinned` key. Filter the column set with `GET /api/docs?pinned=true`. */
            pinned: boolean;
            /** @description Board position of a pinned view, ascending under `sort=order` (SPEC.md §11). `null` when the file carries no `order` key — such a column is still placed, by the documented tiebreak (`order` with nulls last, then `title`, then `id`). Any finite number is legal, so a reorder may write midpoints between neighbours instead of renumbering every column. */
            order: number | null;
            /** @description The stored board query of a `type: view` document (SPEC.md §11): a flat map from `GET /api/docs` parameter names to a value or an array of values — arrays OR together, like the comma-separated wire form (`{type: ["note", "view"]}` ≡ `type=note,view`). The server stores it and never interprets it: the client compiles it into the collection query and renders it as filter chips, so an unknown key degrades in the client, never on the wire. `null` when the file carries no `query` key. */
            query: {
                [key: string]: string | number | boolean | (string | number | boolean)[];
            } | null;
            /** @description Plugin column type rendered for this pinned view, as `"<plugin>/<type>"` (SPEC.md §10) — e.g. `todos/board`. `null` when the view is a plain filtered list. A view referencing an uninstalled plugin keeps its board position and renders a plugin-missing card (SPEC.md §15). */
            column: string | null;
            /** @description Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat and verbatim (SPEC.md §5 — plugins add fields under their own keys; §12 — e.g. a `todo` document's `items`). The server stores and returns these keys and **never interprets them**; meaning belongs to the key's owner (a plugin's own schema), never to this contract. Keys must not name a core frontmatter key (id, type, title, created, updated, tags, status, anchors, due, reviewed, evergreen, origin, parent, anchor, agent, turnModels, pinned, order, query, column) — such a request is rejected with `400`, exact and case-sensitive, so a core field can never be shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) nested at most 8 containers deep, at most 65536 UTF-8 bytes serialized per document; the bounds are enforced at the write boundary. **On update the object is a shallow merge patch** (RFC 7386, applied at the top level): each named key replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte — omit the field to leave every extra key alone, and never read-modify-write the whole object, which would race concurrent writers of other keys. On create, keys are written into the new file's frontmatter and a `null` value is a no-op. **Responses always carry the object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned as `null` and is therefore removed if echoed back through an update. */
            extra: {
                [key: string]: unknown;
            };
            /**
             * @description Staleness tier from SPEC.md §5's age ramp (aging, stale, very-stale), driving the row's age rail, dimming and age chip. **`null` is fresh** — the tiers name degrees of staleness and freshness is their absence, which is also why `stale=` takes a tier and never `fresh`. Always null for `evergreen: true` documents, which opt out of staleness entirely, and for a document whose age is unknown (`updated` and `reviewed` both null): an unknown age is not an old one.
             * @enum {string|null}
             */
            stale: "aging" | "stale" | "very-stale" | null;
            /**
             * @description The commented document, for a thread row. Null on non-threads and on standalone threads (SPEC.md §6) — those two cases are distinguished by `type`, not by this field.
             * @example doc_a1b2c3
             */
            parent: string | null;
            /** @description The current title of whatever `parent` names, or null. Resolved at query time like `Job.originTitle` — never a stored copy, so a rename is reflected immediately. Null whenever `parent` is null, and when the parent no longer resolves (a deleted parent, SPEC.md §9.2). An orphaned thread — `parent` set, title gone — renders an **empty** context cell rather than a raw `doc_*` id, which is not the same as a standalone thread (no `parent` at all) and must not be labelled as one. */
            parentTitle: string | null;
            /**
             * @description Agent participation state (none, requested, engaged, SPEC.md §6, §8), backing the pending-agent indicator. Null on non-threads.
             * @enum {string|null}
             */
            agent: "none" | "requested" | "engaged" | null;
            /** @description The anchored text this thread hangs off, pinned at the top of a thread row (SPEC.md §11). Null on non-threads, on whole-document threads, and on standalone threads. */
            anchorQuote: string | null;
            /** @description Number of turns in the thread. Null on non-threads. */
            turnCount: number | null;
            /**
             * @description Author of the thread's last turn — the `author=` filter's column, and the other half of "awaiting your answer". Null on non-threads and on a thread with no turns.
             * @example user
             * @enum {string|null}
             */
            lastAuthor: "user" | "agent" | null;
            /** @description Plain-text preview of the thread's last turn, for the row's second line (SPEC.md §11). Null on non-threads and on a thread with no turns. */
            lastTurn: string | null;
            /** @description True when the thread's last turn is newer than your last-seen mark (SPEC.md §7) — the unread badge. Null on non-threads. */
            unread: boolean | null;
            /** @description True when the agent has been drawn into an open thread and the last turn is not yet its reply — the pending-agent indicator (SPEC.md §8). Null on non-threads. */
            awaitingAgent: boolean | null;
            /** @description How many of **this document's own threads** are currently unread for the user (SPEC.md §7) — the aggregate behind a document row's unread pill. It counts child threads whose last turn is newer than your last-seen mark, which is exactly the comparison the per-thread `unread` flag makes, so the two agree by construction: this equals the item count of `?parent=<id>&type=thread&unread=true`, and a thread marked seen at a `lastSeenTs` before its last turn (a partial read) still counts as unread in both. It rides on every row so a list never issues one such query per row. **`0` on a thread row** — a thread does not aggregate its own child threads here — **and `0` on a document with no threads.** Never null and never absent, so `0` always means "nothing unread" and never "unknown". */
            unreadThreads: number;
            /** @description How many **unanswered forms** this thread still holds (SPEC.md §6, §11) — the number behind Attention's "how many are still open". It counts the thread's agent turns carrying an answerable `form` block that no later turn has answered, which is exactly the set the `form` attention reason tests for the existence of, under the same open-thread guard. **The two agree in both directions**: this is non-zero **iff** `attention` contains `form`. Left to right, a form counted here is a form that existence test finds; right to left, the reason cannot hold with nothing to count — one derivation produces both, so neither can move without the other. The `needs=form` filter tests that same predicate, so a filtered list never disagrees with the rows in it about which threads are waiting (it filters, so the rest of the query — including the default archived exclusion — still applies to which rows are returned at all). **Resolving the thread takes it to `0`** along with the reason: a resolved conversation is not waiting for an answer (SPEC.md §6). **`POST /api/threads/{id}/seen` leaves it untouched** — an unanswered form's row is the one that survives being read (SPEC.md §11), the opposite of `unread` and `unreadThreads`, which being read is precisely what clears. It rides on every row so no list has to fetch each thread to count its forms. **`0` on a thread with no unanswered form, and `0` on every non-thread row** — never null and never absent, so `0` always means "none" and never "unknown". Rendering is the consumer's: §11 asks for the number only when it is greater than one. */
            unansweredForms: number;
            /** @description Attention reasons for this row, populated on every response rather than only under `needs=`, so any list can render reason chips. Empty when nothing applies; never contains `me`, which is the union filter and not a reason. Entries stay bare codes: the one reason with a number to report carries it in the sibling `unansweredForms`, because plugins extend this list (SPEC.md §10) and a code is what every consumer of every reason already reads. */
            attention: ("unread-reply" | "form" | "due" | "stale" | "failed-job")[];
            /** @description Search highlights for this row; empty when the query carried no `q`. */
            snippets: components["schemas"]["Snippet"][];
        };
        Snippet: {
            /**
             * @description Which indexed field the excerpt came from.
             * @enum {string}
             */
            field: "title" | "body" | "turn";
            /**
             * @description Set only for `turn` snippets, naming the thread the matching turn belongs to.
             * @example th_x9y8
             */
            threadId?: string;
            /** @description Alternating unmatched/matched runs; concatenating `text` yields the excerpt. */
            segments: components["schemas"]["SnippetSegment"][];
        };
        SnippetSegment: {
            text: string;
            /** @description True for the segments the query matched; render those highlighted. */
            match: boolean;
        };
        PageMeta: {
            /** @description Total rows matching the query, ignoring pagination. */
            total: number;
            limit: number;
            offset: number;
        };
        ValidationError: {
            /** @enum {string} */
            code: "bad_request";
            message: string;
            issues: components["schemas"]["ValidationIssue"][];
        };
        ValidationIssue: {
            /** @description Dotted path to the offending field, e.g. `body.title`. */
            path: string;
            message: string;
        };
        UnauthorizedError: {
            /** @enum {string} */
            code: "unauthorized";
            message: string;
        };
        DocMutationResponse: {
            doc: components["schemas"]["Doc"];
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        Doc: {
            frontmatter: components["schemas"]["DocFrontmatter"];
            /** @description Markdown body, without the frontmatter block. */
            body: string;
            /** @description Path relative to the workspace root. Presentation only — `id` is identity. */
            path: string;
            anchors: components["schemas"]["ResolvedAnchor"][];
            /**
             * @description The **key** naming the version of this document that was read (SPEC.md §7). Present it on a write that replaces the document's body, and the write is refused with `409` if the document has changed since — carrying the document as it now stands, and a fresh key for it, so a refusal is one exchange rather than two. **A refusal is never a lost edit**: nothing was written, and the content you tried to save is yours to resend.
             *
             *     **It is opaque. Echo it back exactly as received.** It is *derived from the document's stored content*, which is what makes it need no acquiring, releasing, expiry or reaping: an edit made outside the app invalidates it for free, and it survives a server restart. How it is derived is not contract and is deliberately unpublished. **Never compute, construct, parse, truncate or order a key** — a key is evidence that you read a version, and evidence you manufactured is not evidence; two keys are only ever equal or unequal. It is not a claim, a lease or a handle: there is nothing to release, and holding one confers nothing on you. Every write that lands answers with the document it wrote, carrying a fresh key for the next one.
             *
             *     Always present on a document read: a read that carried no key would leave a writer with nothing to present, and the only way to write would be not to have read.
             * @example 3b2ec1f04d75a2c6ef2b8b9a1f0c4d3e5a6b7c8d9e0f1a2b3c4d5e6f708192a3
             */
            key: string;
            /**
             * @description True when a **person** currently has an edit session open on this document (SPEC.md §4's edit session — the same one that ends in an acknowledgment; SPEC.md §7's *someone is editing this*).
             *
             *     **Information, never a gate.** Nothing is refused because of it, there is nothing to acquire and nothing to release, and no document is ever read-only. Correctness is the `key`'s job; this is politeness — a writer that ignores it is impolite, not incorrect. The agent is expected to leave the document alone and come back, and may defer its claimed queue event (`POST /api/queue/{id}/defer`, `blockedOn` this document) to say so; that deferral returns to `pending` on its own once the session ends.
             *
             *     **Asymmetric on purpose**, because the two writers are: a person's editing is a session the server tracks, while the agent's writing is a sequence of one-shot commands with no session to report. So this never reports the agent, and the person instead sees the agent's writes land live (SPEC.md §9.4). Neither is a lock in the other direction.
             */
            userEditing: boolean;
        };
        DocFrontmatter: {
            /**
             * @description Identifier of any document; threads are documents too.
             * @example doc_a1b2c3
             */
            id: string;
            /**
             * @description Document type. Core values: note, thread, view, template, skill, agent-def. Plugins define their own.
             * @example note
             */
            type: string;
            title: string;
            /**
             * Format: date-time
             * @description When the document was created, or `null` when the file carries no such timestamp — a hand-written skill file legitimately has none. Render it as “—” rather than substituting a date; staleness treats an unknown age as fresh.
             * @example 2026-07-19T10:05:00Z
             */
            created: string | null;
            /**
             * Format: date-time
             * @description When the document was last modified, or `null` when the file carries no such timestamp — a hand-written skill file legitimately has none. Render it as “—” rather than substituting a date; staleness treats an unknown age as fresh.
             * @example 2026-07-19T10:05:00Z
             */
            updated: string | null;
            tags: string[];
            /**
             * @description Lifecycle status; meaning is per type. Archiving is a reversible flip, never a deletion.
             * @enum {string}
             */
            status: "open" | "resolved" | "archived";
            /** @description Text-quote selectors for threads on this document, keyed by anchor id. */
            anchors: {
                [key: string]: components["schemas"]["TextQuoteSelector"];
            };
            /**
             * Format: date
             * @description Optional deadline on any type; surfaces in Attention and filters.
             * @example 2026-08-01
             */
            due: string | null;
            /**
             * Format: date-time
             * @description Last explicit "still current" confirmation; staleness runs from max(updated, reviewed).
             * @example 2026-07-19T10:05:00Z
             */
            reviewed: string | null;
            /** @description True opts the document out of staleness entirely. */
            evergreen: boolean;
            /**
             * @description The thread this document came from (SPEC.md §7 scope, §9.2 provenance), or null when it came from no job. **Server-assigned**: recorded once, from the job the creating write named, whether or not any thread is designated — scope is computed later, and a fact not recorded at write time cannot be recovered. The only request that may touch it is a doc edit sending `origin: null` (detach, user-only), and a detached document may be claimed again by a later write naming a job.
             * @example th_x9y8z7
             */
            origin: string | null;
            /** @description True pins this `type: view` document to the board as a column (SPEC.md §11). `false` when the file carries no `pinned` key. Filter the column set with `GET /api/docs?pinned=true`. */
            pinned: boolean;
            /** @description Board position of a pinned view, ascending under `sort=order` (SPEC.md §11). `null` when the file carries no `order` key — such a column is still placed, by the documented tiebreak (`order` with nulls last, then `title`, then `id`). Any finite number is legal, so a reorder may write midpoints between neighbours instead of renumbering every column. */
            order: number | null;
            /** @description The stored board query of a `type: view` document (SPEC.md §11): a flat map from `GET /api/docs` parameter names to a value or an array of values — arrays OR together, like the comma-separated wire form (`{type: ["note", "view"]}` ≡ `type=note,view`). The server stores it and never interprets it: the client compiles it into the collection query and renders it as filter chips, so an unknown key degrades in the client, never on the wire. `null` when the file carries no `query` key. */
            query: {
                [key: string]: string | number | boolean | (string | number | boolean)[];
            } | null;
            /** @description Plugin column type rendered for this pinned view, as `"<plugin>/<type>"` (SPEC.md §10) — e.g. `todos/board`. `null` when the view is a plain filtered list. A view referencing an uninstalled plugin keeps its board position and renders a plugin-missing card (SPEC.md §15). */
            column: string | null;
            /** @description Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat and verbatim (SPEC.md §5 — plugins add fields under their own keys; §12 — e.g. a `todo` document's `items`). The server stores and returns these keys and **never interprets them**; meaning belongs to the key's owner (a plugin's own schema), never to this contract. Keys must not name a core frontmatter key (id, type, title, created, updated, tags, status, anchors, due, reviewed, evergreen, origin, parent, anchor, agent, turnModels, pinned, order, query, column) — such a request is rejected with `400`, exact and case-sensitive, so a core field can never be shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) nested at most 8 containers deep, at most 65536 UTF-8 bytes serialized per document; the bounds are enforced at the write boundary. **On update the object is a shallow merge patch** (RFC 7386, applied at the top level): each named key replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte — omit the field to leave every extra key alone, and never read-modify-write the whole object, which would race concurrent writers of other keys. On create, keys are written into the new file's frontmatter and a `null` value is a no-op. **Responses always carry the object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned as `null` and is therefore removed if echoed back through an update. */
            extra: {
                [key: string]: unknown;
            };
        };
        TextQuoteSelector: {
            /** @description The quoted text the thread is attached to. */
            exact: string;
            /**
             * @description Text immediately preceding `exact`, for disambiguation.
             * @default
             */
            prefix: string;
            /**
             * @description Text immediately following `exact`, for disambiguation.
             * @default
             */
            suffix: string;
        };
        ResolvedAnchor: {
            /**
             * @description Identifier of an anchor entry, unique within its document.
             * @example anc_k4f7
             */
            anchorId: string;
            selector: components["schemas"]["TextQuoteSelector"];
            /**
             * @description Identifier of a thread document.
             * @example th_x9y8
             */
            threadId: string;
            /**
             * @description Resolved threads collapse in the document view and stop re-triggering the agent (SPEC.md §8).
             * @enum {string}
             */
            threadStatus: "open" | "resolved";
            /** @description Character range in the current body, or null when the selector no longer resolves. The same coordinate space `POST /api/threads/{id}/reattach` accepts, so a range read here can be sent straight back. */
            range: {
                /** @description Offset of the first character, inclusive. */
                start: number;
                /** @description Offset one past the last character, exclusive. */
                end: number;
            } | null;
            /** @description True when the selector did not resolve; the thread is still fully functional but detached. */
            orphaned: boolean;
        };
        Warning: {
            /**
             * @description `commit_failed`: the workspace's git hooks rejected the auto-commit, or git itself failed — the write is on disk and uncommitted. `commit_skipped`: no commit was attempted, because the workspace is not a git repository or no `git` is on the server's PATH. `orphaned_anchor`: an anchor entry is well-formed but its quote no longer resolves in the body, so its thread is detached (SPEC.md §6). `unresolved_ref`: a `[[ref]]` in the body names no document. `carried_skill`: this act moved a skill folder, and the move **enabled or disabled a skill document the act did not itself archive or unarchive** — SPEC.md §7 makes a skill's location its enablement, so a nested `SKILL.md` carried along by the folder changes state without being asked. One warning per carried document, naming its id, its path after the move, and which way its enablement went. `carried_reconciliation`: a carried document's **own frontmatter was rewritten** to agree with where it now sits — a stale `status: archived`, left by a previous independent archive of that nested skill, corrected to `open` because the folder move landed it back under the enabled root, where frontmatter is what status is read from. One warning per document reconciled, naming its id and the key. It arises on unarchive only: the archived root reads status from the root itself and never consults the key, so a move in that direction leaves the key exactly as its author wrote it. Both are silent when there is nothing to say — an act that carried no other skill document emits neither, and a carried document whose frontmatter needed no correction emits `carried_skill` alone. Neither ever describes a document whose **own archive or unarchive landed in this act**: that document is the response's own subject on the single-document routes, or a `changed` entry carrying that verb in a bulk result, and the move is exactly what it asked for. **Being named is not enough** — a staged row that was refused, that was already in the state it asked for, or that carried some other verb (a `tag` on the skill an `archive` in the same Save disabled) is still described here, because nothing in the answer it did get says the act moved its folder.
             * @enum {string}
             */
            code: "commit_failed" | "commit_skipped" | "orphaned_anchor" | "unresolved_ref" | "carried_skill" | "carried_reconciliation";
            /** @description Human-readable specifics — the hook's own output, the offending anchor id, the unresolved ref, the carried document's id and path. Rendered verbatim in the console; never parsed, which is why every distinction a client must act on lives in `code`. */
            detail: string;
        };
        UnknownJobError: {
            /** @enum {string} */
            code: "unknown_job";
            message: string;
            /**
             * @description The id that resolved to no event.
             * @example evt_7c1d
             */
            job: string;
        };
        CreateDocRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to the lane's root thread and records that as the created document's `origin`, which is what makes scope membership computable (§7). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /**
             * @description Document type. Core values: note, thread, view, template, skill, agent-def. Plugins define their own.
             * @example note
             */
            type: string;
            title: string;
            /** @description Omit to pre-fill from the type's `template` document when one exists. */
            body?: string;
            /** @description Folder under `data/docs/`, accepted either as a bare name (`finance`) or as the full prefix (`data/docs/finance`). Defaults to `inbox` — creation is inbox-first (SPEC.md §11), and the agent files inbox arrivals per its skill. */
            folder?: string;
            /** @description Defaults to no tags. */
            tags?: string[];
            /**
             * @description Defaults to `open`.
             * @enum {string}
             */
            status?: "open" | "resolved" | "archived";
            /**
             * Format: date
             * @description Optional deadline. Defaults to `null` — no deadline.
             * @example 2026-08-01
             */
            due?: string | null;
            /** @description True opts the document out of staleness entirely. Defaults to `false`. */
            evergreen?: boolean;
            /** @description True pins this `type: view` document to the board as a column (SPEC.md §11). `false` when the file carries no `pinned` key. Filter the column set with `GET /api/docs?pinned=true`. Defaults to `false` — a view renders as a board column only once pinned. */
            pinned?: boolean;
            /** @description Board position of a pinned view, ascending under `sort=order` (SPEC.md §11). `null` when the file carries no `order` key — such a column is still placed, by the documented tiebreak (`order` with nulls last, then `title`, then `id`). Any finite number is legal, so a reorder may write midpoints between neighbours instead of renumbering every column. Null is the same as omitting it: no `order` key. */
            order?: number | null;
            /** @description The stored board query of a `type: view` document (SPEC.md §11): a flat map from `GET /api/docs` parameter names to a value or an array of values — arrays OR together, like the comma-separated wire form (`{type: ["note", "view"]}` ≡ `type=note,view`). The server stores it and never interprets it: the client compiles it into the collection query and renders it as filter chips, so an unknown key degrades in the client, never on the wire. `null` when the file carries no `query` key. Null is the same as omitting it: no `query` key. */
            query?: {
                [key: string]: string | number | boolean | (string | number | boolean)[];
            } | null;
            /** @description Plugin column type rendered for this pinned view, as `"<plugin>/<type>"` (SPEC.md §10) — e.g. `todos/board`. `null` when the view is a plain filtered list. A view referencing an uninstalled plugin keeps its board position and renders a plugin-missing card (SPEC.md §15). Null is the same as omitting it: no `column` key. */
            column?: string | null;
            /** @description Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat and verbatim (SPEC.md §5 — plugins add fields under their own keys; §12 — e.g. a `todo` document's `items`). The server stores and returns these keys and **never interprets them**; meaning belongs to the key's owner (a plugin's own schema), never to this contract. Keys must not name a core frontmatter key (id, type, title, created, updated, tags, status, anchors, due, reviewed, evergreen, origin, parent, anchor, agent, turnModels, pinned, order, query, column) — such a request is rejected with `400`, exact and case-sensitive, so a core field can never be shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) nested at most 8 containers deep, at most 65536 UTF-8 bytes serialized per document; the bounds are enforced at the write boundary. **On update the object is a shallow merge patch** (RFC 7386, applied at the top level): each named key replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte — omit the field to leave every extra key alone, and never read-modify-write the whole object, which would race concurrent writers of other keys. On create, keys are written into the new file's frontmatter and a `null` value is a no-op. **Responses always carry the object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned as `null` and is therefore removed if echoed back through an update. */
            extra?: {
                [key: string]: unknown;
            };
        };
        BulkActionResult: {
            /** @description Documents the act changed, each with the verb that changed it — §11's first part. Every one of them has a file in `commit` (§4); the containment runs this way only, since a commit may also carry files for documents the act did not name (§6's anchor cascade reaching a surviving parent, a skill folder move carrying a nested skill — reported in `warnings`, never as an entry here, since these lists partition the requested ids). Empty is a legal outcome: every document was already in the target state, or every one was refused. */
            changed: components["schemas"]["BulkActionOutcome"][];
            /** @description Documents that were **already in that state** — §11's second part, explicitly a no-op and **not a failure**: "a document already archived is a no-op, not a failure". They contribute nothing to the commit, and a board must not colour them as errors. This is also where a row that reached its staged state between staging and saving lands: §11 keeps such a row staged and says it is already done, and this part is what says it. The `review` act populates it only when the instant it would write is the one already there: instants are second-precision, so repeating `review` on the same document inside one second genuinely moves no bytes. Reporting it as changed would put an id in `changed` that `git show --name-only` does not list, and that containment is the stronger, testable invariant (SERVER-077). */
            alreadyInState: components["schemas"]["BulkActionOutcome"][];
            /** @description Documents that **did not change, and why** — §11's third part, listed apart from both others because it is the part worth re-reading. After the act, §11 reduces the staged set to exactly these, so retrying what was refused is one gesture. */
            refused: components["schemas"]["BulkActionRefusal"][];
            /** @description Threads left as **orphaned records** by a `delete`, totalled across every document actually deleted (SPEC.md §9.2 — they keep their `parent` id and stay readable; their anchors no longer resolve). Drop their caches. Empty when the act deleted nothing. §11's confirm needs this count *before* the act, which is a `GET /api/docs?type=thread&parent=<ids>` the caller makes itself — this field is what the act actually did. */
            orphanedThreadIds: string[];
            /** @description The **single** auto-commit this act landed as (SPEC.md §4), authored by the acting party. One sha, never a list, **whatever mix of verbs the act carried**: §4 is explicit that "a Save carrying a mix of verbs is still one act and still one commit", so a server that grouped by verb would have no honest value to put here. Null in three cases, none of them an error — `changed` is empty, so there was nothing to commit and a commit containing nothing is not one; the workspace is not a git repository (`commit_skipped` in `warnings`); or the workspace's hooks rejected the commit, leaving the writes on disk and uncommitted (`commit_failed` in `warnings`, §14). */
            commit: string | null;
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        /** @description One document the act reached, and what was done to it. Carried in `changed` and in `alreadyInState`; `BulkActionRefusal` is the same pair plus why it did not change. */
        BulkActionOutcome: {
            /**
             * @description The document this outcome is about.
             * @example doc_a1b2c3
             */
            id: string;
            /**
             * @description Which act was applied to **this** document. Carried per document rather than once per request because a Save may hold a mix of verbs (SPEC.md §4, §11: each row carries its own staged action), so the report reads on its own and never has to be paired back to the call that produced it — including for documents a `wholeResultSet` entry covered, which the caller never enumerated. The eight are SPEC.md §11's selection actions except "Ask the agent about these", which changes no document and goes through `POST /api/threads`.
             * @example archive
             * @enum {string}
             */
            action: "archive" | "unarchive" | "resolve" | "reopen" | "move" | "tag" | "review" | "delete";
        };
        BulkActionRefusal: {
            /**
             * @description The document this outcome is about.
             * @example doc_a1b2c3
             */
            id: string;
            /**
             * @description Which act was applied to **this** document. Carried per document rather than once per request because a Save may hold a mix of verbs (SPEC.md §4, §11: each row carries its own staged action), so the report reads on its own and never has to be paired back to the call that produced it — including for documents a `wholeResultSet` entry covered, which the caller never enumerated. The eight are SPEC.md §11's selection actions except "Ask the agent about these", which changes no document and goes through `POST /api/threads`.
             * @example archive
             * @enum {string}
             */
            action: "archive" | "unarchive" | "resolve" | "reopen" | "move" | "tag" | "review" | "delete";
            /**
             * @description Which class of refusal this is. `not-found`: no document has that id; the other documents are not the caller's mistake, so it is an entry here rather than a `404` for the whole request. `not-applicable`: the act does not apply to this document (resolving something that is not a thread) — §11 offers an action only on the rows that can take it, so for an enumerated row this means the corpus changed between staging and saving, and for a `wholeResultSet` entry it is the ordinary case of one act covering a mixed result set. `invalid`: the write would leave the document failing §14 validation, refused with its reason. `write-failed`: the file could not be written; nothing about this document reached the commit.
             * @example not-applicable
             * @enum {string}
             */
            reason: "not-found" | "not-applicable" | "invalid" | "write-failed";
            /** @description Human-readable specifics for this document — which act found nothing to apply, the validator's own finding, the write error. Rendered verbatim beside the document's title; never parsed. Always present: §11 requires every entry in this part to carry its reason, and a class alone does not tell a person what to do next. */
            message: string;
        };
        ForbiddenError: {
            /** @enum {string} */
            code: "forbidden";
            message: string;
        };
        BulkActionRequest: {
            /** @description The individually staged rows — one entry per document, each carrying its own act. **An id may appear at most once**: a row carries exactly one staged action (SPEC.md §11 — re-choosing *replaces* a row's staged action), so a repeat is a caller bug rather than something to resolve. Two entries for one id with **different** acts are refused naming both, because picking one would be a silent choice about someone's documents; two with the same act are refused too, and the message says which id. May be empty **only** when `wholeResultSet` is present — an act on nothing is a caller bug, and a `200` carrying three empty lists would let a broken board look healthy. Deliberately uncapped: a column's query legitimately matches thousands, and a limit the spec does not state would refuse a selection §11 allows the board to offer. */
            entries: components["schemas"]["BulkStagedEntry"][];
            wholeResultSet?: components["schemas"]["BulkWholeResultSetEntry"];
        };
        /** @description One staged row: the document, and the act staged against it. A request holds any number of these and any mix of verbs, and applies them as one act and one commit (SPEC.md §4). */
        BulkStagedEntry: {
            /**
             * @description The document this row stages an action against. Thread ids belong here too (threads are documents, SPEC.md §6), which is what lets `resolve`/`reopen` ride this route.
             * @example doc_a1b2c3
             */
            id: string;
            /** @description The act staged against this one document, discriminated on `action`. **Each row carries its own** (SPEC.md §11): archiving three documents and resolving two is one Save, so a request may hold any mix of verbs and is still one act and one commit (§4). */
            action: {
                /** @enum {string} */
                action: "archive";
            } | {
                /** @enum {string} */
                action: "unarchive";
            } | {
                /** @enum {string} */
                action: "resolve";
            } | {
                /** @enum {string} */
                action: "reopen";
            } | {
                /** @enum {string} */
                action: "move";
                /** @description Destination folder under `data/docs/`, accepted either as a bare name (`finance`) or as the full prefix (`data/docs/finance`) — the same spelling `POST /api/docs/{id}/move` takes. Each document keeps its id, so every `[[ref]]`, anchor entry and thread `parent` survives the move. */
                folder: string;
            } | {
                /** @enum {string} */
                action: "tag";
                /** @description Tags to add where absent. Adding a tag a document already carries is a no-op for that document, not a failure. */
                add?: string[];
                /** @description Tags to remove where present. Removing a tag a document does not carry is a no-op for that document, not a failure. */
                remove?: string[];
            } | {
                /** @enum {string} */
                action: "review";
            } | {
                /** @enum {string} */
                action: "delete";
            };
        };
        /** @description §11's whole-result-set selection, staged as a **single entry** carrying one action for everything the column's query matches rather than for enumerated ids. At most one — the field is singular rather than a member of `entries`, so "at most one" is structural and `delete` is inexpressible. Omit it for an ordinary staged set, which is the common case. The ids it resolves to are not in the request, so the result's three parts are the only place the caller learns them. */
        BulkWholeResultSetEntry: {
            /** @description The column's query, in the same flat parameter map a `type: view` document stores (SPEC.md §11) — `{type: ["note", "view"], tag: "finance"}` ≡ `type=note,view&tag=finance`. The server compiles it into `GET /api/docs` and applies the act to **everything it matches when the Save runs**, re-evaluated then and not before (§11). Unlike a stored view's query an unrecognised key or an unacceptable value is a `400` here rather than a silent degrade: this query decides what gets written. Documents that `entries` names individually are **excluded** — a row someone staged by hand keeps the verb they chose, so no document is ever covered twice and the request needs no precedence rule at write time. */
            query: {
                [key: string]: string | number | boolean | (string | number | boolean)[];
            };
            /** @description The one act carried for everything the query matches. **`delete` is not among them**: §11 forbids deleting a whole-result-set selection, because "all 412 matching" is not a set anyone read before confirming. Rows the act does not apply to come back `refused` with `not-applicable`, exactly as an enumerated row would. */
            action: {
                /** @enum {string} */
                action: "archive";
            } | {
                /** @enum {string} */
                action: "unarchive";
            } | {
                /** @enum {string} */
                action: "resolve";
            } | {
                /** @enum {string} */
                action: "reopen";
            } | {
                /** @enum {string} */
                action: "move";
                /** @description Destination folder under `data/docs/`, accepted either as a bare name (`finance`) or as the full prefix (`data/docs/finance`) — the same spelling `POST /api/docs/{id}/move` takes. Each document keeps its id, so every `[[ref]]`, anchor entry and thread `parent` survives the move. */
                folder: string;
            } | {
                /** @enum {string} */
                action: "tag";
                /** @description Tags to add where absent. Adding a tag a document already carries is a no-op for that document, not a failure. */
                add?: string[];
                /** @description Tags to remove where present. Removing a tag a document does not carry is a no-op for that document, not a failure. */
                remove?: string[];
            } | {
                /** @enum {string} */
                action: "review";
            };
        };
        NotFoundError: {
            /** @enum {string} */
            code: "not_found";
            message: string;
        };
        RelatedDocs: {
            /** @description Most related first, ties broken deterministically. Never contains the document itself, and empty when nothing relates to it. */
            related: components["schemas"]["RelatedDoc"][];
            /**
             * @description Whether the semantic half of ranking is caught up (SPEC.md §9.1) — **Retrieval Phase B's seam, inert in Phase A**, where it is absent or `current` and nothing computes it. Treat **any** value other than `current` as degraded ranking worth telling the caller about, rather than matching the values exhaustively: `indexing` (a rebuild or backfill is running), `stale` (documents are still pending), `disabled` (no semantic index is configured — lexical ranking only). Absent means the server makes no claim, which is Phase A's normal answer. `GET /api/index/status` is the detailed surface behind this one word — the same value with the counts, the recorded provider/model identity and the rebuild flag it derives from.
             * @enum {string}
             */
            semanticIndex?: "current" | "indexing" | "stale" | "disabled";
        };
        RelatedDoc: {
            /**
             * @description The related document. Always a document that exists: the `links` table deliberately stores references to documents that have not been created yet (SPEC.md §9.1), and handing the agent an id it cannot then read would be worse than omitting the row.
             * @example doc_a1b2c3
             */
            id: string;
            /** @description The related document's current title. */
            title: string;
            /** @description A single plain-text line from the start of the document — enough to recognise it, never enough to read it. Distinct from a list row's `excerpt`, which is a multi-line leading slice: this one is collapsed to one line so a client prints one row per line. */
            excerpt: string;
            /**
             * @description How this document is related: `linked` — the reference graph connects them (an outgoing `[[ref]]`, a backlink, or both directions); `similar` — semantic similarity only; `both` — linked *and* semantically similar. **Retrieval Phase A emits only `linked`**; the other two arrive with the semantic index (SPEC.md §9.1) and are in the vocabulary now so their arrival changes no shape.
             * @enum {string}
             */
            relation: "linked" | "similar" | "both";
        };
        DocDiff: {
            /**
             * @description The document the diff is for.
             * @example doc_a1b2c3
             */
            id: string;
            /** @description Workspace-relative path of the document's file, e.g. `data/docs/finance/mortgage.md` — the path the diff was taken at, and what a `--- a/… +++ b/…` header in `diff` names. */
            path: string;
            /**
             * @description The resolved base of the range, exclusive — the value used, whether supplied or defaulted. `EMPTY_TREE_OBJECT_ID` when `to` has no parent. `null` only in the no-history case below, where `to` is null too.
             * @example 9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456
             */
            from: string | null;
            /**
             * @description The resolved head of the range, inclusive. **`null` exactly when the workspace has no committed history for this document** — a file written but not yet committed, or a workspace with no git at all (SPEC.md §14). In that case `from` is null too, `diff` is empty, `stats` are zero and `truncated` is false: an answer, not an error, because a document that has never been committed genuinely has no change to show.
             * @example 9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456
             */
            to: string | null;
            stats: components["schemas"]["DocChangeStats"];
            /** @description The unified diff of this document's file across the range, at most 16000 characters (`DOC_DIFF_MAX_CHARS`). Path-scoped, so commits in the range that touched other documents contribute nothing. Plain text, rendered as-is and never interpreted — a diff of a markdown document contains markdown, and a client that renders it would be rendering the user's document instead of showing the change to it. Empty when nothing changed in the range, which is a legitimate answer. */
            diff: string;
            /** @description `true` when the diff was cut to `DOC_DIFF_MAX_CHARS`. The cut is **hunk-aligned**: whole hunks are dropped from the end so that what is returned is always a valid unified diff a person or a tool can read, rather than a fragment ending mid-line. A single hunk larger than the whole bound is the one exception — it is cut at a line boundary, never mid-line. Stated rather than silent (the rule the context pack's own `truncated` sets): an agent acting on half a change while believing it saw all of it is the failure this flag exists to prevent, and `stats` plus `totalChars` say how much is missing. */
            truncated: boolean;
            /** @description Length in characters of the **full** diff before truncation; equal to `diff`'s length whenever `truncated` is false. Lets a caller report the scale of what it did not get (`showing 16000 of 42311 characters`) and decide whether to narrow the range and ask again. */
            totalChars: number;
        };
        /** @description How much changed across the **whole** range, even when `diff` below was truncated. The same shape a `doc.edited` event carries, so a caller can compare what it was told with what it fetched. */
        DocChangeStats: {
            /** @description Commits in the range that touched this document. Normally **1**: §4 folds an editing session's repeated autosaves into a single auto-commit, so a session is usually one commit and its range is a range of one. More than one means the squash did not fold them — saves either side of the squash idle window, or a save that started a fresh commit for another of §4's reasons. `0` is reachable only on `GET /api/docs/{id}/diff` for a document with no committed history; a `doc.edited` event never carries it, because a session that produced no commit produces no event. */
            commits: number;
            /** @description Lines added across the range, path-scoped to this document's file. */
            insertions: number;
            /** @description Lines removed across the range, path-scoped to this document's file. */
            deletions: number;
        };
        UpdateDocResponse: {
            doc: components["schemas"]["Doc"];
            anchors: components["schemas"]["AnchorReconciliation"];
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        AnchorReconciliation: {
            /** @description Anchors whose selector was recomputed against the new body. */
            remapped: string[];
            /** @description Anchors whose text was removed; their threads are now detached. */
            orphaned: string[];
        };
        StaleKeyError: {
            /** @enum {string} */
            code: "stale_key";
            message: string;
            doc: components["schemas"]["Doc"] & unknown;
        };
        UpdateDocRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to the lane's root thread and records that as the created document's `origin`, which is what makes scope membership computable (§7). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /**
             * @description Detach: clears this document's `origin`, removing it from its conversation's scope (SPEC.md §9.2). **`null` is the only accepted value** — an origin is never set by a caller, and a request naming a thread here is a `400` — and it is **user-only**, refused for an agent actor. A detached document may be claimed again by a later write that names a job, so this is a correction rather than a lock.
             * @example th_x9y8
             */
            origin?: string | null;
            /**
             * @description The **key** naming the version of this document that was read (SPEC.md §7). Present it on a write that replaces the document's body, and the write is refused with `409` if the document has changed since — carrying the document as it now stands, and a fresh key for it, so a refusal is one exchange rather than two. **A refusal is never a lost edit**: nothing was written, and the content you tried to save is yours to resend.
             *
             *     **It is opaque. Echo it back exactly as received.** It is *derived from the document's stored content*, which is what makes it need no acquiring, releasing, expiry or reaping: an edit made outside the app invalidates it for free, and it survives a server restart. How it is derived is not contract and is deliberately unpublished. **Never compute, construct, parse, truncate or order a key** — a key is evidence that you read a version, and evidence you manufactured is not evidence; two keys are only ever equal or unequal. It is not a claim, a lease or a handle: there is nothing to release, and holding one confers nothing on you. Every write that lands answers with the document it wrote, carrying a fresh key for the next one.
             *
             *     **Required when this request carries `body`**, which is the write that replaces a block without naming what it changes; a `body` with no key is a `400` naming this field. **Not required by a write that names its own delta** — a tag, a status, `reviewed`, a view key — which merges with whatever else happened rather than overwriting it. Sending one anyway is welcome and is **still checked**: presenting a key always means *I am writing against this version*, so a stale one is refused whatever else the request changes. A caller that always sends what it read therefore needs no rule about which fields are which.
             * @example 3b2ec1f04d75a2c6ef2b8b9a1f0c4d3e5a6b7c8d9e0f1a2b3c4d5e6f708192a3
             */
            key?: string;
            title?: string;
            body?: string;
            tags?: string[];
            /** @enum {string} */
            status?: "open" | "resolved" | "archived";
            /**
             * Format: date
             * @example 2026-08-01
             */
            due?: string | null;
            /**
             * Format: date-time
             * @description Set to the current instant to record "still current" (SPEC.md §5).
             * @example 2026-07-19T10:05:00Z
             */
            reviewed?: string | null;
            evergreen?: boolean;
            /** @description True pins this `type: view` document to the board as a column (SPEC.md §11). `false` when the file carries no `pinned` key. Filter the column set with `GET /api/docs?pinned=true`. */
            pinned?: boolean;
            /** @description Board position of a pinned view, ascending under `sort=order` (SPEC.md §11). `null` when the file carries no `order` key — such a column is still placed, by the documented tiebreak (`order` with nulls last, then `title`, then `id`). Any finite number is legal, so a reorder may write midpoints between neighbours instead of renumbering every column. On update, `null` clears the key from the file. */
            order?: number | null;
            /** @description The stored board query of a `type: view` document (SPEC.md §11): a flat map from `GET /api/docs` parameter names to a value or an array of values — arrays OR together, like the comma-separated wire form (`{type: ["note", "view"]}` ≡ `type=note,view`). The server stores it and never interprets it: the client compiles it into the collection query and renders it as filter chips, so an unknown key degrades in the client, never on the wire. `null` when the file carries no `query` key. On update, `null` clears the key from the file. */
            query?: {
                [key: string]: string | number | boolean | (string | number | boolean)[];
            } | null;
            /** @description Plugin column type rendered for this pinned view, as `"<plugin>/<type>"` (SPEC.md §10) — e.g. `todos/board`. `null` when the view is a plain filtered list. A view referencing an uninstalled plugin keeps its board position and renders a plugin-missing card (SPEC.md §15). On update, `null` clears the key from the file. */
            column?: string | null;
            /** @description Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat and verbatim (SPEC.md §5 — plugins add fields under their own keys; §12 — e.g. a `todo` document's `items`). The server stores and returns these keys and **never interprets them**; meaning belongs to the key's owner (a plugin's own schema), never to this contract. Keys must not name a core frontmatter key (id, type, title, created, updated, tags, status, anchors, due, reviewed, evergreen, origin, parent, anchor, agent, turnModels, pinned, order, query, column) — such a request is rejected with `400`, exact and case-sensitive, so a core field can never be shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) nested at most 8 containers deep, at most 65536 UTF-8 bytes serialized per document; the bounds are enforced at the write boundary. **On update the object is a shallow merge patch** (RFC 7386, applied at the top level): each named key replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte — omit the field to leave every extra key alone, and never read-modify-write the whole object, which would race concurrent writers of other keys. On create, keys are written into the new file's frontmatter and a `null` value is a no-op. **Responses always carry the object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned as `null` and is therefore removed if echoed back through an update. */
            extra?: {
                [key: string]: unknown;
            };
        };
        PatchDocResponse: {
            doc: components["schemas"]["Doc"];
            anchors: components["schemas"]["AnchorReconciliation"];
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
            /**
             * @description How many occurrences of `old` were replaced, counted left to right without overlap. Always `1` unless the request set `all`, and never `0` — a patch that matched nothing is the `409` refusal, not a `200` that changed nothing.
             *
             *     A **no-op** (`new` equal to `old`) still reports the occurrences it covered and writes nothing: no file change, no commit. The caller can see that case in its own request, so nothing here has to name it separately.
             */
            replaced: number;
        };
        PatchConflictError: {
            /** @enum {string} */
            code: "conflict";
            message: string;
            /**
             * @description Which state refused the patch: the status code says the document's text did, this says how. `no-match`: `old` does not occur in the body at all (`matches` is `0`) — the document is not what you last read, or the excerpt was never in the body (frontmatter is not part of it). Re-read the document and quote from what it says now. `multiple-matches`: `old` occurs more than once (`matches` says how many) and the patch did not ask for `all` — quote more surrounding context until the excerpt is unique, or send `all: true` if replacing every occurrence is genuinely what you meant.
             * @enum {string}
             */
            reason: "no-match" | "multiple-matches";
            /** @description How many times `old` occurs in the document's body, counted left to right without overlap — the count both refusals name, because the two have different recoveries and a caller must be able to tell them apart without reading English. `0` for `no-match`; two or more for `multiple-matches`. Nothing was written. */
            matches: number;
        };
        PatchDocRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to the lane's root thread and records that as the created document's `origin`, which is what makes scope membership computable (§7). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /**
             * @description The excerpt of the document's body to replace, quoted **exactly** as it is stored — the same bytes `GET /api/docs/{id}` returned in `body`. Matching is byte-exact: no trimming, no whitespace collapsing, no line-ending translation, no case folding, and no regular expressions. Whitespace and indentation are significant.
             *
             *     It must match **exactly once**, or the patch is refused with `409` naming how many times it did match — `0` means re-read the document, more than one means quote more surrounding context until the excerpt is unique (or pass `all`). The body here is the markdown **without the frontmatter block**, so an excerpt that quotes frontmatter matches nothing; frontmatter is changed by naming its fields on `PUT /api/docs/{id}`.
             */
            old: string;
            /**
             * @description What to put in `old`'s place. **May be empty**, which deletes the quoted text — that is the spelling of a deletion, and it is not a refusal.
             *
             *     Sending it equal to `old` is a **no-op**: the resulting body is the body it started as, so nothing is written and no commit is made (SPEC.md §9.2). It is answered `200` rather than refused, because a caller that asks for a change already present has got what it asked for.
             */
            new: string;
            /**
             * @description Replace **every** occurrence of `old` instead of requiring it to be unique. Defaults to `false` — the server applies the default, so omit the field rather than sending `false`.
             *
             *     Occurrences are found **left to right and never overlap**: after a match, scanning resumes at the end of the text that matched, so `old: "aa"` finds one occurrence in `"aaa"` and two in `"aaaa"`. The same scan is what counts matches for a refusal, so the number the server reports and the number a caller counts for itself agree.
             *
             *     **It lifts uniqueness, never the requirement to match at all**: an `old` that occurs zero times is refused with `409` whether or not `all` is set.
             */
            all?: boolean;
        };
        DeleteDocResult: {
            /**
             * @description Identifier of any document; threads are documents too.
             * @example doc_a1b2c3
             */
            deletedId: string;
            /** @description Threads that named the deleted document as `parent`. They keep that id and remain readable; their anchors no longer resolve. Drop their caches. */
            orphanedThreadIds: string[];
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        MoveDocRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to the lane's root thread and records that as the created document's `origin`, which is what makes scope membership computable (§7). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /** @description Folder under `data/docs/`, accepted either as a bare name (`finance`) or as the full prefix (`data/docs/finance`). Defaults to `inbox` — creation is inbox-first (SPEC.md §11), and the agent files inbox arrivals per its skill. */
            folder: string;
        };
        JobOnlyRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to the lane's root thread and records that as the created document's `origin`, which is what makes scope membership computable (§7). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
        };
        SearchResults: {
            /** @description Best match first, ties broken deterministically so the same query twice returns the same order. Empty when nothing matched — an empty ranking, never an error. */
            hits: components["schemas"]["SearchHit"][];
            /**
             * @description Whether the semantic half of ranking is caught up (SPEC.md §9.1) — **Retrieval Phase B's seam, inert in Phase A**, where it is absent or `current` and nothing computes it. Treat **any** value other than `current` as degraded ranking worth telling the caller about, rather than matching the values exhaustively: `indexing` (a rebuild or backfill is running), `stale` (documents are still pending), `disabled` (no semantic index is configured — lexical ranking only). Absent means the server makes no claim, which is Phase A's normal answer. `GET /api/index/status` is the detailed surface behind this one word — the same value with the counts, the recorded provider/model identity and the rebuild flag it derives from.
             * @enum {string}
             */
            semanticIndex?: "current" | "indexing" | "stale" | "disabled";
        };
        SearchHit: {
            /**
             * @description The document the passage lives in — a thread id for a hit inside a thread, since threads are documents (SPEC.md §6). One hit per document: a document matching in several places is ranked by its best passage and reported once.
             * @example doc_a1b2c3
             */
            id: string;
            /** @description The document's current title, for a line the agent can read. */
            title: string;
            /** @description Where inside the document the best-matching passage sits — its address, rendered as the enclosing headings from outermost to innermost joined by ` › ` (`HEADING_PATH_SEPARATOR`). A passage with no heading above it reports the document's title, so a hit always has an address. For a hit inside a thread turn it is that turn's heading (SPEC.md §6, §9.2). A **display join**: print it, never split it. */
            headingPath: string;
            /** @description One line of context around the match, in plain text: a single line — no newline, and none of the delimiters the full-text index marks matches with — short enough that a client prints one hit per row. It is a *taste* of the passage and never the passage: no client should try to reconstruct content from it, and no server should widen it into one. */
            snippet: string;
        };
        FolderTree: {
            /** @description Top-level folders under `data/docs/`. */
            folders: components["schemas"]["FolderNode"][];
        };
        FolderNode: {
            /** @description Path relative to `data/docs/`; empty for the root. */
            path: string;
            name: string;
            /** @description Documents filed directly in this folder. */
            count: number;
            /** @description `count` plus every descendant folder's count. */
            totalCount: number;
            children: components["schemas"]["FolderNode"][];
        };
        CaptureResult: {
            /**
             * @description The created document, filed in `data/docs/inbox/`.
             * @example doc_a1b2c3
             */
            docId: string;
            /**
             * @description The whole-document filing thread created alongside it (no anchor).
             * @example th_x9y8
             */
            threadId: string;
            /**
             * @description Enqueued `comment.created` event, so the UI can show the pending-agent indicator immediately and the console can link the job back to this capture. Null when nothing was enqueued, which an explicit `requestsAgent: false` always produces.
             * @example evt_7c1d
             */
            eventId: string | null;
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        CaptureRequest: {
            /** @description The captured text. Becomes the inbox document's body and its filing thread's first turn. */
            text: string;
            /** @description Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. Omitted: the server requests the agent — filing is the whole point of a capture — unless the text carries its own mention or skill invocation, which routes it instead. `true`: request the agent. `false`: "note only" — suppress the enqueue even when the thread is engaged. */
            requestsAgent?: boolean;
            /** @description The weight this request's work should be done at (SPEC.md §7) — **a directive, not a hint**. The value is a **level's key from the workspace's own agent guidance, verbatim** — the key column of the guidance's tier table, not the label beside it, because the label is prose a person may reword and the key is what survives that (AGENT-015). This contract never enumerates the levels: §7 keeps model tiers in the orchestrate skill, and §2.4 lets a workspace edit that document on its own schedule, so a published enum would reject a workspace's own vocabulary and could only be fixed by a release. The value is therefore validated for **shape only** — non-blank, single line, at most 100 characters — and never for meaning: the server records it and interprets nothing about it. **Honoured, not weighed again**: the work is dispatched at the stated weight rather than at the one the orchestrator would have picked, and is **never silently substituted in either direction** — running stronger than asked spends against an explicit instruction exactly as running weaker falls short of one. When a stated weight **cannot be honoured** (the installed agent does not offer that model, the level no longer exists in the guidance) the work is still done, at what the orchestrator judges best, and the deviation is stated: in the job's log while it runs, and in the reply the request receives. It **rides with the request to whatever does the work** (§11) — onto the queue event this call enqueues, under the payload key `weight`, which is what the dispatch reads. **Omit it to state no weight, which means the orchestrator decides** — its own judgment, unchanged, and never a default level: absence of a choice is the ordinary case, and this field has no default and takes no `null`. An empty string is a `400` rather than a second spelling of silence. A weight is **inert** on a request that enqueues nothing (an explicit `requestsAgent: false`): it is not rejected there — §8 alone decides what reaches the agent, and stating a weight neither asks the agent nor stops it being asked — it simply governs no work. */
            weight?: string;
            /** @description Attached files, sent as repeated `files` parts. Bytes are stored under `.corpus/attachments/<thread-id>/<turn-ts>/` and referenced from the turn body by relative markdown links (SPEC.md §6). */
            files?: string[];
        };
        CreateThreadResponse: {
            thread: components["schemas"]["Thread"];
            /**
             * @description Anchor written into the parent, when a selector was given.
             * @example anc_k4f7
             */
            anchorId: string | null;
            /**
             * @description Enqueued `comment.created` event; null when nothing was enqueued. Non-null when `requestsAgent` was true, or when it was omitted and the first turn carries a mention or skill invocation; always null when `requestsAgent` was explicitly false ("note only").
             * @example evt_7c1d
             */
            eventId: string | null;
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        Thread: {
            /**
             * @description Identifier of a thread document.
             * @example th_x9y8
             */
            id: string;
            title: string;
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            created: string;
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            updated: string;
            /**
             * @description Resolved threads collapse in the document view and stop re-triggering the agent (SPEC.md §8).
             * @enum {string}
             */
            status: "open" | "resolved";
            tags: string[];
            /**
             * @description The commented document, which may itself be a thread; null for a standalone thread.
             * @example doc_a1b2c3
             */
            parent: string | null;
            /**
             * @description Anchor entry in the parent's frontmatter; null for a whole-document or standalone thread.
             * @example anc_k4f7
             */
            anchor: string | null;
            /** @enum {string} */
            agent: "none" | "requested" | "engaged";
            turns: components["schemas"]["Turn"][];
        };
        Turn: {
            /**
             * @description The acting party for a request. Becomes the git author of the auto-commit the server makes for the mutation (SPEC.md §4, §7).
             * @example user
             * @enum {string}
             */
            author: "user" | "agent";
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            ts: string;
            /** @description Markdown body of the turn, without its `## author · ts` heading. */
            body: string;
            /** @description Display name of the model that wrote this turn (SPEC.md §11) — a **display string, not an enum**: §7 keeps model names in the orchestrator skill, so this contract never enumerates them and a workspace that changes its tiers changes nothing here. **One model, never a list.** Where a request ran in stages at different weights (§7), this names the model of the **deciding** stage — the one that drew the conclusion or wrote the words. It does not accumulate the stages, and a reader must not treat it as the whole account of what ran: the per-stage record is the job's log, for as long as that log lasts. **It is not a weight.** A weight is an instruction stated before the work (§7, honoured and not weighed again); this is a fact about what happened. The two are deliberately separate fields of separate things (CONTRACT-039) and merging them would make §7's guarantee unverifiable. At most 200 characters, non-blank, and on one line: it is persisted as a plain YAML scalar in the thread document's frontmatter. **`null` when no model is named** — a turn a person wrote, or a turn appended before the server recorded this. Null is the honest answer and never a default: an unknown that says so is worth more than a plausible attribution nobody can check. Clients render nothing for it, never a placeholder such as "unknown". */
            model: string | null;
        };
        CreateThreadRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to the lane's root thread and records that as the created document's `origin`, which is what makes scope membership computable (§7). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /**
             * @description Document being commented on. Omitted or null creates a standalone thread.
             * @example doc_a1b2c3
             */
            parent?: string | null;
            /** @description Text-quote selector captured from the user's selection. The server writes the anchor entry into the parent's frontmatter and creates the thread file atomically. Omitted or null anchors the thread to the whole document, or to nothing when `parent` is null. */
            selector?: {
                /** @description The quoted text the thread is attached to. */
                exact: string;
                /** @description Text immediately preceding `exact`, for disambiguation. **Not stored as sent**: on a request it only says which occurrence a repeated quote means. The context written into the parent's frontmatter is read off the parent document's own bytes around the quote, so omitting this costs nothing whenever the quote occurs once. */
                prefix?: string;
                /** @description Text immediately following `exact`, for disambiguation. **Not stored as sent**: on a request it only says which occurrence a repeated quote means. The context written into the parent's frontmatter is read off the parent document's own bytes around the quote, so omitting this costs nothing whenever the quote occurs once. */
                suffix?: string;
            } | null;
            /** @description Defaults to the anchor quote or the first turn. */
            title?: string;
            /** @description Body of the thread's first turn. */
            body: string;
            /** @description Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. Omitted: the server enqueues only when the body carries an explicit `@agent` mention, a targeted `@<subagent>` mention or a `/<skill>` invocation. `true`: request the agent. `false`: "note only" — suppress the enqueue even when the thread is engaged. */
            requestsAgent?: boolean;
            /** @description Display name of the model that wrote this turn (SPEC.md §11) — a **display string, not an enum**: §7 keeps model names in the orchestrator skill, so this contract never enumerates them and a workspace that changes its tiers changes nothing here. **One model, never a list.** Where a request ran in stages at different weights (§7), this names the model of the **deciding** stage — the one that drew the conclusion or wrote the words. It does not accumulate the stages, and a reader must not treat it as the whole account of what ran: the per-stage record is the job's log, for as long as that log lasts. **It is not a weight.** A weight is an instruction stated before the work (§7, honoured and not weighed again); this is a fact about what happened. The two are deliberately separate fields of separate things (CONTRACT-039) and merging them would make §7's guarantee unverifiable. At most 200 characters, non-blank, and on one line: it is persisted as a plain YAML scalar in the thread document's frontmatter. Omit it when no model wrote the turn. Supplying it on a turn authored by anyone but `agent` (`x-corpus-author`) is a `400`: §11 says a person's turn names no model, and a server that accepted one would be publishing an attribution nobody made. The server records the value verbatim and interprets nothing about it. */
            model?: string;
            /** @description The weight this request's work should be done at (SPEC.md §7) — **a directive, not a hint**. The value is a **level's key from the workspace's own agent guidance, verbatim** — the key column of the guidance's tier table, not the label beside it, because the label is prose a person may reword and the key is what survives that (AGENT-015). This contract never enumerates the levels: §7 keeps model tiers in the orchestrate skill, and §2.4 lets a workspace edit that document on its own schedule, so a published enum would reject a workspace's own vocabulary and could only be fixed by a release. The value is therefore validated for **shape only** — non-blank, single line, at most 100 characters — and never for meaning: the server records it and interprets nothing about it. **Honoured, not weighed again**: the work is dispatched at the stated weight rather than at the one the orchestrator would have picked, and is **never silently substituted in either direction** — running stronger than asked spends against an explicit instruction exactly as running weaker falls short of one. When a stated weight **cannot be honoured** (the installed agent does not offer that model, the level no longer exists in the guidance) the work is still done, at what the orchestrator judges best, and the deviation is stated: in the job's log while it runs, and in the reply the request receives. It **rides with the request to whatever does the work** (§11) — onto the queue event this call enqueues, under the payload key `weight`, which is what the dispatch reads. **Omit it to state no weight, which means the orchestrator decides** — its own judgment, unchanged, and never a default level: absence of a choice is the ordinary case, and this field has no default and takes no `null`. An empty string is a `400` rather than a second spelling of silence. A weight is **inert** on a request that enqueues nothing (an explicit `requestsAgent: false`): it is not rejected there — §8 alone decides what reaches the agent, and stating a weight neither asks the agent nor stops it being asked — it simply governs no work. */
            weight?: string;
        };
        MultipartCreateThreadRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to the lane's root thread and records that as the created document's `origin`, which is what makes scope membership computable (§7). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /**
             * @description Document being commented on. Omitted creates a standalone thread.
             * @example doc_a1b2c3
             */
            parent?: string;
            /** @description Text-quote selector as a JSON object encoded into one part, e.g. `{"exact":"assume a 30-year fixed at 6.1%","prefix":"the model we "}`. Same fields and same meaning as the JSON body's `selector`. Omit it to anchor the thread to the whole document, or to nothing when `parent` is absent. */
            selector?: string;
            /** @description Defaults to the anchor quote or the first turn. */
            title?: string;
            /** @description Body of the thread's first turn. Optional: a first turn may be attachment-only. */
            text?: string;
            /** @description Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. Omitted: the server enqueues only when the body carries an explicit `@agent` mention, a targeted `@<subagent>` mention or a `/<skill>` invocation. `true`: request the agent. `false`: "note only" — suppress the enqueue even when the thread is engaged. */
            requestsAgent?: boolean;
            /** @description Display name of the model that wrote this turn (SPEC.md §11) — a **display string, not an enum**: §7 keeps model names in the orchestrator skill, so this contract never enumerates them and a workspace that changes its tiers changes nothing here. **One model, never a list.** Where a request ran in stages at different weights (§7), this names the model of the **deciding** stage — the one that drew the conclusion or wrote the words. It does not accumulate the stages, and a reader must not treat it as the whole account of what ran: the per-stage record is the job's log, for as long as that log lasts. **It is not a weight.** A weight is an instruction stated before the work (§7, honoured and not weighed again); this is a fact about what happened. The two are deliberately separate fields of separate things (CONTRACT-039) and merging them would make §7's guarantee unverifiable. At most 200 characters, non-blank, and on one line: it is persisted as a plain YAML scalar in the thread document's frontmatter. Omit it when no model wrote the turn. Supplying it on a turn authored by anyone but `agent` (`x-corpus-author`) is a `400`: §11 says a person's turn names no model, and a server that accepted one would be publishing an attribution nobody made. The server records the value verbatim and interprets nothing about it. */
            model?: string;
            /** @description The weight this request's work should be done at (SPEC.md §7) — **a directive, not a hint**. The value is a **level's key from the workspace's own agent guidance, verbatim** — the key column of the guidance's tier table, not the label beside it, because the label is prose a person may reword and the key is what survives that (AGENT-015). This contract never enumerates the levels: §7 keeps model tiers in the orchestrate skill, and §2.4 lets a workspace edit that document on its own schedule, so a published enum would reject a workspace's own vocabulary and could only be fixed by a release. The value is therefore validated for **shape only** — non-blank, single line, at most 100 characters — and never for meaning: the server records it and interprets nothing about it. **Honoured, not weighed again**: the work is dispatched at the stated weight rather than at the one the orchestrator would have picked, and is **never silently substituted in either direction** — running stronger than asked spends against an explicit instruction exactly as running weaker falls short of one. When a stated weight **cannot be honoured** (the installed agent does not offer that model, the level no longer exists in the guidance) the work is still done, at what the orchestrator judges best, and the deviation is stated: in the job's log while it runs, and in the reply the request receives. It **rides with the request to whatever does the work** (§11) — onto the queue event this call enqueues, under the payload key `weight`, which is what the dispatch reads. **Omit it to state no weight, which means the orchestrator decides** — its own judgment, unchanged, and never a default level: absence of a choice is the ordinary case, and this field has no default and takes no `null`. An empty string is a `400` rather than a second spelling of silence. A weight is **inert** on a request that enqueues nothing (an explicit `requestsAgent: false`): it is not rejected there — §8 alone decides what reaches the agent, and stating a weight neither asks the agent nor stops it being asked — it simply governs no work. */
            weight?: string;
            /** @description Attached files, sent as repeated `files` parts. Bytes are stored under `.corpus/attachments/<thread-id>/<turn-ts>/` and referenced from the turn body by relative markdown links (SPEC.md §6). */
            files?: string[];
        };
        AnchoredContextPack: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            shape: "anchored";
            /**
             * @description The thread this pack briefs.
             * @example th_x9y8
             */
            threadId: string;
            /** @description The most-related excerpts from across the corpus, most related first, at most 10 of them (`CONTEXT_MAX_EXCERPTS`), ties broken deterministically. Ranked by relatedness to the thread's anchor **and** its text (SPEC.md §7), through the reference graph and — from Retrieval Phase B — semantic similarity. Empty when nothing relates, which is an answer rather than an error. Never contains the thread itself or its parent. */
            excerpts: components["schemas"]["ContextExcerpt"][];
            /**
             * @description Whether the semantic half of ranking is caught up (SPEC.md §9.1) — **Retrieval Phase B's seam, inert in Phase A**, where it is absent or `current` and nothing computes it. Treat **any** value other than `current` as degraded ranking worth telling the caller about, rather than matching the values exhaustively: `indexing` (a rebuild or backfill is running), `stale` (documents are still pending), `disabled` (no semantic index is configured — lexical ranking only). Absent means the server makes no claim, which is Phase A's normal answer. `GET /api/index/status` is the detailed surface behind this one word — the same value with the counts, the recorded provider/model identity and the rebuild flag it derives from.
             * @enum {string}
             */
            semanticIndex?: "current" | "indexing" | "stale" | "disabled";
            /** @description The passage the conversation is about, and the section it lives in. */
            parent: {
                /**
                 * @description The parent document this thread hangs off.
                 * @example doc_a1b2c3
                 */
                id: string;
                /** @description The parent's current title. */
                title: string;
                /** @description Where the anchored passage sits in the parent, joined by ` › ` like every other heading path here, falling back to the parent's title for a passage above the first heading. */
                headingPath: string;
                /** @description The anchor's own text — what the user selected when the thread was opened (SPEC.md §6) — at most 1000 characters (`CONTEXT_MAX_QUOTE_CHARS`). */
                quote: string;
                /** @description The **whole heading section enclosing the quote**, from its heading line to the heading that closes it — not a window around the match, and not one chunk of a section (a section may span several). At most 4000 characters (`CONTEXT_MAX_SECTION_CHARS`); past that it is truncated around the quote and `truncated` says so. */
                section: string;
                /** @description `true` when the text above was cut to fit `CONTEXT_MAX_SECTION_CHARS` or `CONTEXT_MAX_QUOTE_CHARS`. The pack is a briefing, so the cut is a normal outcome for a large section rather than an error — but it is **stated**, never silent: an agent that needs the rest reads the parent with `corpus doc show`, and an agent editing against a section must know whether it saw all of it. Truncation is anchored on the anchor, so the quote and its immediate surroundings always survive the cut. */
                truncated: boolean;
            };
        };
        ContextExcerpt: {
            /**
             * @description The document the excerpt was taken from — a thread id when the passage lives in a thread, since threads are documents (SPEC.md §6). Never the thread this pack is about, and never its parent: the pack is context *around* the conversation, and both are already in it.
             * @example doc_a1b2c3
             */
            id: string;
            /** @description Where inside that document the excerpt sits, rendered as the enclosing headings from outermost to innermost joined by ` › ` (`HEADING_PATH_SEPARATOR`) — the same address a search hit carries, built the same way. A passage with no heading above it reports the document's title, so a row always has an address a human can read. A **display join**: print it, never split it. */
            headingPath: string;
            /** @description The matching passage, in plain text, at most 320 characters (`CONTEXT_MAX_EXCERPT_CHARS`) — enough to judge whether the document is worth opening, never enough to replace opening it. A longer passage is **truncated to the cap, not dropped**, so a well-ranked row never disappears for being verbose. Reading the document is a separate, deliberate `GET /api/docs/{id}` on this row's id. */
            excerpt: string;
            /**
             * @description How this document is related: `linked` — the reference graph connects them (an outgoing `[[ref]]`, a backlink, or both directions); `similar` — semantic similarity only; `both` — linked *and* semantically similar. **Retrieval Phase A emits only `linked`**; the other two arrive with the semantic index (SPEC.md §9.1) and are in the vocabulary now so their arrival changes no shape.
             * @enum {string}
             */
            relation: "linked" | "similar" | "both";
        };
        WholeDocumentContextPack: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            shape: "whole-document";
            /**
             * @description The thread this pack briefs.
             * @example th_x9y8
             */
            threadId: string;
            /** @description The most-related excerpts from across the corpus, most related first, at most 10 of them (`CONTEXT_MAX_EXCERPTS`), ties broken deterministically. Ranked by relatedness to the thread's anchor **and** its text (SPEC.md §7), through the reference graph and — from Retrieval Phase B — semantic similarity. Empty when nothing relates, which is an answer rather than an error. Never contains the thread itself or its parent. */
            excerpts: components["schemas"]["ContextExcerpt"][];
            /**
             * @description Whether the semantic half of ranking is caught up (SPEC.md §9.1) — **Retrieval Phase B's seam, inert in Phase A**, where it is absent or `current` and nothing computes it. Treat **any** value other than `current` as degraded ranking worth telling the caller about, rather than matching the values exhaustively: `indexing` (a rebuild or backfill is running), `stale` (documents are still pending), `disabled` (no semantic index is configured — lexical ranking only). Absent means the server makes no claim, which is Phase A's normal answer. `GET /api/index/status` is the detailed surface behind this one word — the same value with the counts, the recorded provider/model identity and the rebuild flag it derives from.
             * @enum {string}
             */
            semanticIndex?: "current" | "indexing" | "stale" | "disabled";
            /** @description The parent, identified and opened — there is no anchored passage to show. */
            parent: {
                /**
                 * @description The parent document this thread hangs off.
                 * @example doc_a1b2c3
                 */
                id: string;
                /** @description The parent's current title. */
                title: string;
                /** @description The parent's opening content — the preamble above its first heading, or its first section when there is no preamble. Whole units of prose, never a character slice of the body. At most 4000 characters (`CONTEXT_MAX_SECTION_CHARS`), with `truncated` set when the cap cut it. */
                opening: string;
                /** @description `true` when the text above was cut to fit `CONTEXT_MAX_SECTION_CHARS` or `CONTEXT_MAX_QUOTE_CHARS`. The pack is a briefing, so the cut is a normal outcome for a large section rather than an error — but it is **stated**, never silent: an agent that needs the rest reads the parent with `corpus doc show`, and an agent editing against a section must know whether it saw all of it. Truncation is anchored on the anchor, so the quote and its immediate surroundings always survive the cut. */
                truncated: boolean;
            };
        };
        OrphanedAnchorContextPack: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            shape: "orphaned-anchor";
            /**
             * @description The thread this pack briefs.
             * @example th_x9y8
             */
            threadId: string;
            /** @description The most-related excerpts from across the corpus, most related first, at most 10 of them (`CONTEXT_MAX_EXCERPTS`), ties broken deterministically. Ranked by relatedness to the thread's anchor **and** its text (SPEC.md §7), through the reference graph and — from Retrieval Phase B — semantic similarity. Empty when nothing relates, which is an answer rather than an error. Never contains the thread itself or its parent. */
            excerpts: components["schemas"]["ContextExcerpt"][];
            /**
             * @description Whether the semantic half of ranking is caught up (SPEC.md §9.1) — **Retrieval Phase B's seam, inert in Phase A**, where it is absent or `current` and nothing computes it. Treat **any** value other than `current` as degraded ranking worth telling the caller about, rather than matching the values exhaustively: `indexing` (a rebuild or backfill is running), `stale` (documents are still pending), `disabled` (no semantic index is configured — lexical ranking only). Absent means the server makes no claim, which is Phase A's normal answer. `GET /api/index/status` is the detailed surface behind this one word — the same value with the counts, the recorded provider/model identity and the rebuild flag it derives from.
             * @enum {string}
             */
            semanticIndex?: "current" | "indexing" | "stale" | "disabled";
            /** @description The parent, and the quote that no longer resolves inside it. No resolved passage is reported, because there is none. */
            parent: {
                /**
                 * @description The parent document this thread hangs off.
                 * @example doc_a1b2c3
                 */
                id: string;
                /** @description The parent's current title. */
                title: string;
                /** @description The preserved anchor text: what the user selected when the thread was opened, kept even though the parent no longer contains it verbatim. The parent's current text is a `GET /api/docs/{id}` away — the pack does not guess where the passage went, because guessing is exactly the misattachment exact-only resolution exists to prevent. */
                quote: string;
                /** @description `true` when the text above was cut to fit `CONTEXT_MAX_SECTION_CHARS` or `CONTEXT_MAX_QUOTE_CHARS`. The pack is a briefing, so the cut is a normal outcome for a large section rather than an error — but it is **stated**, never silent: an agent that needs the rest reads the parent with `corpus doc show`, and an agent editing against a section must know whether it saw all of it. Truncation is anchored on the anchor, so the quote and its immediate surroundings always survive the cut. */
                truncated: boolean;
            };
        };
        StandaloneContextPack: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            shape: "standalone";
            /**
             * @description The thread this pack briefs.
             * @example th_x9y8
             */
            threadId: string;
            /** @description The most-related excerpts from across the corpus, most related first, at most 10 of them (`CONTEXT_MAX_EXCERPTS`), ties broken deterministically. Ranked by relatedness to the thread's anchor **and** its text (SPEC.md §7), through the reference graph and — from Retrieval Phase B — semantic similarity. Empty when nothing relates, which is an answer rather than an error. Never contains the thread itself or its parent. */
            excerpts: components["schemas"]["ContextExcerpt"][];
            /**
             * @description Whether the semantic half of ranking is caught up (SPEC.md §9.1) — **Retrieval Phase B's seam, inert in Phase A**, where it is absent or `current` and nothing computes it. Treat **any** value other than `current` as degraded ranking worth telling the caller about, rather than matching the values exhaustively: `indexing` (a rebuild or backfill is running), `stale` (documents are still pending), `disabled` (no semantic index is configured — lexical ranking only). Absent means the server makes no claim, which is Phase A's normal answer. `GET /api/index/status` is the detailed surface behind this one word — the same value with the counts, the recorded provider/model identity and the rebuild flag it derives from.
             * @enum {string}
             */
            semanticIndex?: "current" | "indexing" | "stale" | "disabled";
        };
        DeletedParentContextPack: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            shape: "parent-deleted";
            /**
             * @description The thread this pack briefs.
             * @example th_x9y8
             */
            threadId: string;
            /** @description The most-related excerpts from across the corpus, most related first, at most 10 of them (`CONTEXT_MAX_EXCERPTS`), ties broken deterministically. Ranked by relatedness to the thread's anchor **and** its text (SPEC.md §7), through the reference graph and — from Retrieval Phase B — semantic similarity. Empty when nothing relates, which is an answer rather than an error. Never contains the thread itself or its parent. */
            excerpts: components["schemas"]["ContextExcerpt"][];
            /**
             * @description Whether the semantic half of ranking is caught up (SPEC.md §9.1) — **Retrieval Phase B's seam, inert in Phase A**, where it is absent or `current` and nothing computes it. Treat **any** value other than `current` as degraded ranking worth telling the caller about, rather than matching the values exhaustively: `indexing` (a rebuild or backfill is running), `stale` (documents are still pending), `disabled` (no semantic index is configured — lexical ranking only). Absent means the server makes no claim, which is Phase A's normal answer. `GET /api/index/status` is the detailed surface behind this one word — the same value with the counts, the recorded provider/model identity and the rebuild flag it derives from.
             * @enum {string}
             */
            semanticIndex?: "current" | "indexing" | "stale" | "disabled";
            /**
             * @description The document id the thread still names, which no longer resolves — deleted while the thread survived it. Reading it is a `404`; git retains its history. No parent block accompanies it, because there is no parent content left to carry.
             * @example doc_a1b2c3
             */
            deletedParent: string;
        };
        AppendTurnResponse: {
            thread: components["schemas"]["ThreadSummary"];
            turn: components["schemas"]["Turn"];
            /**
             * @description Enqueued `comment.created` event; null when nothing was enqueued. Non-null when `requestsAgent` was true, or when it was omitted and the thread is already engaged; always null when `requestsAgent` was explicitly false ("note only", SPEC.md §8).
             * @example evt_7c1d
             */
            eventId: string | null;
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        ThreadSummary: {
            /**
             * @description Identifier of a thread document.
             * @example th_x9y8
             */
            id: string;
            title: string;
            /**
             * @description Resolved threads collapse in the document view and stop re-triggering the agent (SPEC.md §8).
             * @enum {string}
             */
            status: "open" | "resolved";
            /**
             * @description Identifier of any document; threads are documents too.
             * @example doc_a1b2c3
             */
            parent: string | null;
            /**
             * @description Identifier of an anchor entry, unique within its document.
             * @example anc_k4f7
             */
            anchor: string | null;
            /** @enum {string} */
            agent: "none" | "requested" | "engaged";
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            created: string;
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            updated: string;
            turnCount: number;
            /**
             * @description The acting party for a request. Becomes the git author of the auto-commit the server makes for the mutation (SPEC.md §4, §7).
             * @example user
             * @enum {string}
             */
            lastAuthor: "user" | "agent";
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            lastTs: string;
        };
        AppendTurnRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to the lane's root thread and records that as the created document's `origin`, which is what makes scope membership computable (§7). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            body: string;
            /** @description Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. Omitted: the server enqueues when the thread is already `engaged`, and otherwise only on an explicit mention or skill invocation. `true`: request the agent. `false`: "note only" — suppress the enqueue even when the thread is engaged. */
            requestsAgent?: boolean;
            /** @description Display name of the model that wrote this turn (SPEC.md §11) — a **display string, not an enum**: §7 keeps model names in the orchestrator skill, so this contract never enumerates them and a workspace that changes its tiers changes nothing here. **One model, never a list.** Where a request ran in stages at different weights (§7), this names the model of the **deciding** stage — the one that drew the conclusion or wrote the words. It does not accumulate the stages, and a reader must not treat it as the whole account of what ran: the per-stage record is the job's log, for as long as that log lasts. **It is not a weight.** A weight is an instruction stated before the work (§7, honoured and not weighed again); this is a fact about what happened. The two are deliberately separate fields of separate things (CONTRACT-039) and merging them would make §7's guarantee unverifiable. At most 200 characters, non-blank, and on one line: it is persisted as a plain YAML scalar in the thread document's frontmatter. Omit it when no model wrote the turn. Supplying it on a turn authored by anyone but `agent` (`x-corpus-author`) is a `400`: §11 says a person's turn names no model, and a server that accepted one would be publishing an attribution nobody made. The server records the value verbatim and interprets nothing about it. */
            model?: string;
            /** @description The weight this request's work should be done at (SPEC.md §7) — **a directive, not a hint**. The value is a **level's key from the workspace's own agent guidance, verbatim** — the key column of the guidance's tier table, not the label beside it, because the label is prose a person may reword and the key is what survives that (AGENT-015). This contract never enumerates the levels: §7 keeps model tiers in the orchestrate skill, and §2.4 lets a workspace edit that document on its own schedule, so a published enum would reject a workspace's own vocabulary and could only be fixed by a release. The value is therefore validated for **shape only** — non-blank, single line, at most 100 characters — and never for meaning: the server records it and interprets nothing about it. **Honoured, not weighed again**: the work is dispatched at the stated weight rather than at the one the orchestrator would have picked, and is **never silently substituted in either direction** — running stronger than asked spends against an explicit instruction exactly as running weaker falls short of one. When a stated weight **cannot be honoured** (the installed agent does not offer that model, the level no longer exists in the guidance) the work is still done, at what the orchestrator judges best, and the deviation is stated: in the job's log while it runs, and in the reply the request receives. It **rides with the request to whatever does the work** (§11) — onto the queue event this call enqueues, under the payload key `weight`, which is what the dispatch reads. **Omit it to state no weight, which means the orchestrator decides** — its own judgment, unchanged, and never a default level: absence of a choice is the ordinary case, and this field has no default and takes no `null`. An empty string is a `400` rather than a second spelling of silence. A weight is **inert** on a request that enqueues nothing (an explicit `requestsAgent: false`): it is not rejected there — §8 alone decides what reaches the agent, and stating a weight neither asks the agent nor stops it being asked — it simply governs no work. */
            weight?: string;
        };
        MultipartAppendTurnRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to the lane's root thread and records that as the created document's `origin`, which is what makes scope membership computable (§7). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /** @description Markdown body of the turn. Optional: a turn may be attachment-only. */
            text?: string;
            /** @description Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. Omitted: the server enqueues when the thread is already `engaged`, and otherwise only on an explicit mention or skill invocation. `true`: request the agent. `false`: "note only" — suppress the enqueue even when the thread is engaged. */
            requestsAgent?: boolean;
            /** @description Display name of the model that wrote this turn (SPEC.md §11) — a **display string, not an enum**: §7 keeps model names in the orchestrator skill, so this contract never enumerates them and a workspace that changes its tiers changes nothing here. **One model, never a list.** Where a request ran in stages at different weights (§7), this names the model of the **deciding** stage — the one that drew the conclusion or wrote the words. It does not accumulate the stages, and a reader must not treat it as the whole account of what ran: the per-stage record is the job's log, for as long as that log lasts. **It is not a weight.** A weight is an instruction stated before the work (§7, honoured and not weighed again); this is a fact about what happened. The two are deliberately separate fields of separate things (CONTRACT-039) and merging them would make §7's guarantee unverifiable. At most 200 characters, non-blank, and on one line: it is persisted as a plain YAML scalar in the thread document's frontmatter. Omit it when no model wrote the turn. Supplying it on a turn authored by anyone but `agent` (`x-corpus-author`) is a `400`: §11 says a person's turn names no model, and a server that accepted one would be publishing an attribution nobody made. The server records the value verbatim and interprets nothing about it. */
            model?: string;
            /** @description The weight this request's work should be done at (SPEC.md §7) — **a directive, not a hint**. The value is a **level's key from the workspace's own agent guidance, verbatim** — the key column of the guidance's tier table, not the label beside it, because the label is prose a person may reword and the key is what survives that (AGENT-015). This contract never enumerates the levels: §7 keeps model tiers in the orchestrate skill, and §2.4 lets a workspace edit that document on its own schedule, so a published enum would reject a workspace's own vocabulary and could only be fixed by a release. The value is therefore validated for **shape only** — non-blank, single line, at most 100 characters — and never for meaning: the server records it and interprets nothing about it. **Honoured, not weighed again**: the work is dispatched at the stated weight rather than at the one the orchestrator would have picked, and is **never silently substituted in either direction** — running stronger than asked spends against an explicit instruction exactly as running weaker falls short of one. When a stated weight **cannot be honoured** (the installed agent does not offer that model, the level no longer exists in the guidance) the work is still done, at what the orchestrator judges best, and the deviation is stated: in the job's log while it runs, and in the reply the request receives. It **rides with the request to whatever does the work** (§11) — onto the queue event this call enqueues, under the payload key `weight`, which is what the dispatch reads. **Omit it to state no weight, which means the orchestrator decides** — its own judgment, unchanged, and never a default level: absence of a choice is the ordinary case, and this field has no default and takes no `null`. An empty string is a `400` rather than a second spelling of silence. A weight is **inert** on a request that enqueues nothing (an explicit `requestsAgent: false`): it is not rejected there — §8 alone decides what reaches the agent, and stating a weight neither asks the agent nor stops it being asked — it simply governs no work. */
            weight?: string;
            /** @description Attached files, sent as repeated `files` parts. Bytes are stored under `.corpus/attachments/<thread-id>/<turn-ts>/` and referenced from the turn body by relative markdown links (SPEC.md §6). */
            files?: string[];
        };
        DeleteTurnResult: {
            /** @enum {boolean} */
            deletedTurn: true;
            /** @description True when the deleted turn was the thread's last, taking the thread with it. */
            deletedThread: boolean;
            /**
             * @description Anchor entry removed from the parent's frontmatter, when the cascade reached that far.
             * @example anc_k4f7
             */
            removedAnchor: string | null;
            /**
             * @description The thread's parent, whose frontmatter and anchor list may now differ. Null for a standalone thread.
             * @example doc_a1b2c3
             */
            parentId: string | null;
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        FormAnswerResponse: {
            thread: components["schemas"]["ThreadSummary"];
            turn: components["schemas"]["Turn"] & unknown;
            /**
             * @description The enqueued `form.respond` event, which re-triggers the agent like any engaged-thread reply (SPEC.md §6). Null when the answer does not re-trigger it — which, since only the person answers a form, is exactly the thread the agent is not engaged in. A **resolved** thread does not stay silent: a person's answer reopens it and then re-triggers on §8's ordinary terms (SHARED-019 Amendment 1, corrected by SERVER-062).
             * @example evt_7c1d
             */
            eventId: string | null;
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        ConflictError: {
            /** @enum {string} */
            code: "conflict";
            message: string;
        };
        FormAnswerRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to the lane's root thread and records that as the created document's `origin`, which is what makes scope membership computable (§7). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /** @description One entry per field answered, in any order — entries are matched to fields by question, not by position. A field left blank has no entry, which is a `400` unless that field is optional. Submitting is all-or-nothing: there is no partial save and no per-field submit (SPEC.md §6). */
            answers: components["schemas"]["FormFieldAnswer"][];
            /** @description Free-text note about the ask as a whole, recorded beside the answers (SPEC.md §6). Optional, and never a field's answer. */
            note?: string;
        };
        FormFieldAnswer: {
            /** @description The field's question, verbatim from the form. A question the form does not ask is a `400`. */
            question: string;
            /** @description `choose one`: the chosen option, verbatim from that field's `options`. */
            option?: string;
            /** @description `choose any`: the chosen options, each verbatim from that field's `options` and each named at most once. Selecting nothing is spelled by omitting the entry, not by an empty list. */
            options?: string[];
            /** @description `write`: the text written. */
            text?: string;
        };
        ThreadMutationResponse: {
            thread: components["schemas"]["ThreadSummary"];
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        MarkSeenResult: {
            /**
             * @description Identifier of a thread document.
             * @example th_x9y8
             */
            threadId: string;
            /**
             * Format: date-time
             * @description The mark now recorded for this thread.
             * @example 2026-07-19T10:05:00Z
             */
            lastSeenTs: string;
            /** @description Whether the thread is *still* unread after this mark — that is, whether any turn is newer than `lastSeenTs` (SPEC.md §7). False for the ordinary case of a bare `POST`, which marks the thread read up to its last turn. **True when `lastSeenTs` names an earlier turn**: a partial read leaves later turns unseen, and the badge stays lit. A client updates its unread state from this flag, not from the fact that the call succeeded. */
            unread: boolean;
        };
        MarkSeenRequest: {
            /**
             * Format: date-time
             * @description Turn timestamp to mark seen up to. Defaults to the thread's last turn, which is what opening a thread means; pass it explicitly only to record a partial read.
             * @example 2026-07-19T10:05:00Z
             */
            lastSeenTs?: string;
        };
        ReattachThreadResponse: {
            thread: components["schemas"]["ThreadSummary"];
            anchor: components["schemas"]["ResolvedAnchor"];
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        ReattachConflictError: {
            /** @enum {string} */
            code: "conflict";
            message: string;
            /**
             * @description Which state refused the request: the status code says a state did, this says which. `range-changed`: the parent's body no longer holds `expectedText` at that range — it was edited between the person seeing the range and choosing it (a range running past the end of the body is the same fact, reported the same way). Re-read the document and choose again. `range-overlaps`: the range overlaps text another thread's anchor already resolves over, and SPEC.md §6 forbids two threads on disjoint text ending up claiming overlapping text; choose a range that does not. `not-anchored`: the thread has no anchor to repair — it is standalone or a whole-document comment — and giving one an anchor is a change of scope rather than a repair, which this route does not perform.
             * @enum {string}
             */
            reason: "range-changed" | "range-overlaps" | "not-anchored";
        };
        ReattachThreadRequest: {
            /** @description The range of the parent document's **current** body the thread should attach to, in the same coordinate space `ResolvedAnchor.range` reports — offsets into `Doc.body` (the markdown without the frontmatter block), measured in UTF-16 code units, `[start, end)`. Must be non-empty: an anchor quotes text. */
            range: {
                /** @description Offset of the first character, inclusive. */
                start: number;
                /** @description Offset one past the last character, exclusive. */
                end: number;
            };
            /** @description The bytes the caller believes the range currently holds — a **guard, not the stored selector**. The server compares it against the parent's live body and refuses with `409` (`range-changed`) if they differ, because a document edited between the person seeing the range and choosing it would otherwise re-attach the thread to whatever slid into those offsets. Its length must equal `end - start`, which is checked at validation time. Never written: the selector is read off the document's own bytes (SERVER-071). */
            expectedText: string;
        };
        QueueStatus: {
            /** @description True while the `.corpus/HALT` sentinel exists; claims return empty. */
            halted: boolean;
            pending: number;
            inProgress: number;
            /** @description Events parked while a person is editing the document they need (SPEC.md §7). Counted separately from `failed` because a deferral is not a failure — a non-zero count here is work that will resume by itself, and the console strip must not read it as breakage. */
            deferred: number;
            processed: number;
            failed: number;
            abandoned: number;
        };
        IdleResult: {
            /** @description Pending events, still in `pending/`. Claim them with `POST /api/queue/claim-all`. */
            events: components["schemas"]["QueueEvent"][];
            inProgress: components["schemas"]["InProgressSet"];
        };
        QueueEvent: {
            /**
             * @description Identifier of a queue event.
             * @example evt_7c1d
             */
            id: string;
            /** @description Event type. Core values: comment.created, form.respond, doc.edited, agent.done. Plugins define their own. */
            type: string;
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            created: string;
            /** @description What produced the event, e.g. `ui` or `cli`. */
            source: string;
            /**
             * @description Type-specific payload; plugins own the shape of their own event types, which is why this stays open rather than becoming a union keyed on `type` (SPEC.md §7). The core payloads are declared beside their features: `form.respond` carries `{threadId, formTs, answers, note}`, where `answers` holds one entry per field of the answered form (SPEC.md §6, §7).
             *
             *     **One key crosses every type: `weight`.** When the request that enqueued the event stated the weight its work should be done at (SPEC.md §7, §11), that level name rides here verbatim, and the dispatch honours it rather than weighing the work again. It is **absent** when the request stated nothing, which means the orchestrator decides — never a default level, and never `null`. It is deliberately not part of any one payload shape: a weight is a property of *a request that asked for work*, so a plugin's own event type carries it the same way with no contract change.
             */
            payload: {
                [key: string]: unknown;
            };
        };
        /** @description What the server still thinks the agent is doing (SPEC.md §7) — reported beside a claim as **its own field, never mixed into the claimed events**. The two answer different questions, and an agent that confused them would either redo settled work or settle work it never did. Nothing here was claimed by the call that returned it: these events were already in `in-progress/` when it arrived. The loop reconciles: settle what you have already done with the ordinary verbs, leave what you are still working, and never settle an event you cannot account for. The server reports and settles nothing by itself. */
        InProgressSet: {
            /** @description The held events, most recently claimed first, capped at 20. **Disjoint from the events just claimed** — an event cannot be in both, since a claim moves it out of `pending/` and this list is read from `in-progress/` as it stood beforehand. When the cap bites, the newest are kept: those are the ones this session can still account for, and the ancient ones are `reap-stale`'s job. */
            events: components["schemas"]["InProgressEvent"][];
            /** @description How many events the server holds `in-progress` **in total**, equal to `events.length` whenever `truncated` is false. It is the "and N more" the cap owes the caller: subtract the list's length to get it. For the complete set past 20, ask `GET /api/jobs?status=in-progress` — the cap bounds this report, never the caller's reach. */
            total: number;
            /** @description True when the cap cut the list — `total` is then greater than `events.length`. Stated rather than left to be derived (the rule `DocDiff.truncated` sets): this is the flag that stops a capped list from reading as a complete one, and a caller must not have to compute the one fact that keeps it honest. */
            truncated: boolean;
        };
        InProgressEvent: {
            /**
             * @description Identifier of a queue event.
             * @example evt_7c1d
             */
            id: string;
            /** @description The held event's type — the same open string `QueueEvent.type` and `Job.type` carry, for the same reason: plugins define their own. Core values: comment.created, form.respond, doc.edited, agent.done. It is half of what makes the row checkable: an agent recognises *what kind of work* it is being told it still owes. */
            type: string;
            /**
             * Format: date-time
             * @description **When the event was claimed**, as an instant — not how long ago that was. An instant is still true after the agent has sat on this response for a turn, and it lets the caller compute the age against whichever clock it trusts instead of inheriting the server's. Rendering it as `held 3h` is the CLI's job (SPEC.md §7).
             * @example 2026-07-19T10:05:00Z
             */
            heldSince: string;
            /**
             * @description Document or thread the held event originated from, or null — **the same field `Job.originId` is, derived by the same rule**: the first of `threadId`, `parentId`, `docId` in the event payload that names a document the corpus still holds. `form.respond` names a thread; a plugin event may name nothing, which is what null is for.
             * @example doc_a1b2c3
             */
            originId: string | null;
            /** @description **The current title of whatever `originId` names, or null** — null exactly when `originId` is null, or when the document it names no longer exists. Read at response time rather than stored, exactly as `Job.originTitle` is. This is the field that makes the row *checkable* rather than merely present: "you are apparently still working on `comment.created` for **Re: the rate assumption**" is a sentence an agent can hold against its own memory, and a bare event id is not. */
            originTitle: string | null;
        };
        ClaimBatch: {
            events: components["schemas"]["QueueEvent"][];
            inProgress: components["schemas"]["InProgressSet"];
        };
        ReapStaleResult: {
            /** @description Events recovered from `in-progress/` back to `pending/` after a crashed run. */
            reaped: string[];
            /** @description Events the reap gave up on rather than recovering, having exhausted their attempts. They are **not** in `reaped`: the two arrays are disjoint, and an empty one is the normal case. */
            failed: string[];
        };
        HaltQueueRequest: {
            /** @description Human-readable halt reason, recorded in the `.corpus/HALT` sentinel. */
            reason?: string;
        };
        FailEventRequest: {
            /** @description Human-readable failure reason, shown in the console. */
            reason?: string;
        };
        DeferEventRequest: {
            /**
             * @description The document being edited that the work is waiting on. The end of that edit session returns this event to `pending` automatically (SPEC.md §7), so a deferral that named the wrong document would wait forever.
             * @example doc_a1b2c3
             */
            blockedOn: string;
            /** @description Human-readable deferral note, shown in the console beside the blocking document. No `deferred:` prefix is needed or wanted — the status says that now. */
            reason?: string;
        };
        JobList: {
            /** @description Console rows, most recent first. */
            jobs: components["schemas"]["Job"][];
        };
        Job: {
            /**
             * @description Identifier of a queue event.
             * @example evt_7c1d
             */
            eventId: string;
            /** @description The type of the queue event this job is running — the same value as `QueueEvent.type`, read from the projection rather than re-derived. Core values: comment.created, form.respond, doc.edited, agent.done. Open rather than enumerated for the same reason `QueueEvent.type` is: plugins define their own event types (SPEC.md §7, §10). The console's collapsed job row reads `<type> · <originTitle>`, so this is what tells the user *what* is running, not just what it is running on (SPEC.md §11). */
            type: string;
            /**
             * @description Mirrors the `.corpus/queue/<status>/` directory the event file currently lives in. `pending` and `in-progress` are the live states; `processed`, `failed` and `abandoned` are terminal. **`deferred` is neither** (SPEC.md §7): the event was claimed and the agent parked it because a person had an edit session open on the document it needs, so it waits — not claimable, not failed — and returns to `pending` automatically when that session ends. Nothing refused it: the agent deferred because it saw, not because it was blocked.
             * @enum {string}
             */
            status: "pending" | "in-progress" | "deferred" | "processed" | "failed" | "abandoned";
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            started: string;
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            updated: string;
            /** @description Most recent log line, for the collapsed console row. */
            lastLine: string | null;
            /**
             * @description Document or thread the job originated from, so the console can link through.
             * @example doc_a1b2c3
             */
            originId: string | null;
            /** @description **The current title of whatever `originId` names, or null.** Null exactly when `originId` is null, or when the document it names no longer exists. It rides along so the console can label a job row without a second fetch per row; it is a denormalised copy read at response time, never a stored field, so a renamed document shows its new title on the next read. */
            originTitle: string | null;
            /**
             * @description **The document being edited that this job is waiting on**, or null — non-null exactly when `status` is `deferred` (SPEC.md §7, CONTRACT-021). It is the document supplied at defer time, and the one whose edit session ending returns the job to `pending` automatically. The console needs it to say what a waiting row is waiting *for*: a deferred job that names no document is indistinguishable from a stuck one.
             * @example doc_a1b2c3
             */
            blockedOn: string | null;
            /** @description **The current title of whatever `blockedOn` names, or null** — the same denormalised copy `originTitle` is, read at response time rather than stored, so a renamed document shows its new title on the next read. Null exactly when `blockedOn` is null, or when the document it names no longer exists. */
            blockedOnTitle: string | null;
        };
        JobLog: {
            /** @description Log lines from `cursor` onwards, oldest first. */
            lines: components["schemas"]["JobLogLine"][];
            /** @description Cursor to pass on the next fetch; equals the total line count. */
            nextCursor: number;
        };
        /** @description One line of `.corpus/jobs/<eventId>.jsonl`. Always rendered as plain text, never interpreted. */
        JobLogLine: {
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            ts: string;
            line: string;
        };
        AppendLogResult: {
            /**
             * @description Identifier of a queue event.
             * @example evt_7c1d
             */
            eventId: string;
            /** @description True when the line reached the log file. **False when the log is at its size cap** and the line was dropped (SPEC.md §7): the call still succeeds with `201`, because the request was well formed and nothing about it can be retried differently — but the line is not there. A caller that reports progress from this endpoint reports the flag, not the status code. */
            appended: boolean;
        };
        AppendLogRequest: {
            /** @description One progress line. Rendered as plain text and never interpreted; the server caps its length (SPEC.md §7). */
            line: string;
        };
        RebuildResult: {
            /** @description Absolute path of the database this rebuild produced — `.corpus/cache.db`, which the rebuild replaced atomically by rename. */
            path: string;
            /** @description Rows written to `documents` by this rebuild. */
            documents: number;
            /** @description Rows written to `threads` by this rebuild. */
            threads: number;
            /** @description Rows written to `turns` by this rebuild. */
            turns: number;
            /** @description Rows written to `anchors` by this rebuild. */
            anchors: number;
            /** @description Rows written to `links` by this rebuild. */
            links: number;
            /** @description Rows written to `events` by this rebuild. */
            events: number;
            /** @description Rows written to `jobs` by this rebuild. */
            jobs: number;
            /** @description Rows written to `seen` by this rebuild. */
            seen: number;
            /** @description Wall-clock time the rebuild took, so `corpus db rebuild` can report it. */
            durationMs: number;
            /** @description Files that are documents by location but produced no row. Empty is the good case. */
            skipped: components["schemas"]["SkippedFile"][];
        };
        SkippedFile: {
            /** @description Workspace-relative path of the file that produced no row. */
            path: string;
            /** @description Why it was skipped. Rendered verbatim; never parsed. */
            reason: string;
        };
        DoctorReport: {
            /** @description True exactly when `drift` is empty. The single flag `corpus db doctor` turns into its exit code, so a caller never has to re-derive the verdict from the list. `warnings` never moves it. */
            ok: boolean;
            /** @description Every disagreement found between the files and the projection. Empty when `ok`. */
            drift: components["schemas"]["ProjectionDrift"][];
            stats: components["schemas"]["DoctorStats"];
            /** @description Report-only findings that are not drift: things worth a person's attention that the projection is nonetheless correct about. **Never moves `ok` and never changes the exit code** — SPEC.md §14's standing `rebuild && doctor` clean invariant is about drift, and a warning that flipped the verdict would fail a routine check on workspaces where nothing is wrong with the projection. Absent and empty mean the same thing: a server that runs no warning pass omits the key entirely, which is what keeps this field additive for clients generated before it existed. */
            warnings?: components["schemas"]["DoctorWarning"][];
        };
        ProjectionDrift: {
            /**
             * @description `missing_row`: a document file exists but the projection has no row for it. `orphan_row`: the projection has a row for a path that no longer exists. `content_mismatch`: the file's bytes no longer hash to what was projected. `count_mismatch`: a table the projection keeps no per-item detail for disagrees with the files by count. `unparseable`: the file is a document by location but neither it nor its frontmatter can be read — the bytes are unreadable (an unreadable file, a permission error) or the frontmatter they carry is not valid. `duplicate_id`: two files claim one id; only the first by path order is projected.
             * @enum {string}
             */
            kind: "missing_row" | "orphan_row" | "content_mismatch" | "count_mismatch" | "unparseable" | "duplicate_id";
            /** @description Workspace-relative path this drift concerns. Null when it concerns no single file, which today is exactly `count_mismatch`. */
            path: string | null;
            /** @description Human-readable specifics, rendered verbatim by `corpus db doctor`; never parsed. */
            detail: string;
        };
        DoctorStats: {
            /** @description Document files found under the workspace roots. */
            files: number;
            /** @description `documents` rows the projection holds. */
            documents: number;
            /** @description Files whose bytes had to be read and hashed. Zero on a warm, untouched workspace — doctor skips any file whose size and mtime are unchanged, which is what keeps it inside a pre-commit hook's budget. */
            hashed: number;
            /** @description Files that had to be parsed, i.e. those with no row to explain them. */
            parsed: number;
            /** @description Wall-clock time the check took. */
            durationMs: number;
        };
        DoctorWarning: {
            /** @description What kind of report-only finding this is. **Open by design**, unlike `ProjectionDrift.kind`: a warning carries no verdict, so a consumer that does not recognise the kind still renders `detail` and loses nothing, and the server can add a finding without a contract release. Core values: unindexable_file. `unindexable_file`: a markdown file the projection will never index because its path lies under a segment the document walk skips, so the corpus can never show it (SPEC.md §5). Constrained to a lowercase snake_case token of at most 64 characters — it is a key to switch on, not prose. */
            kind: string;
            /** @description Workspace-relative path this warning concerns. Null when it concerns no single file. */
            path: string | null;
            /** @description Human-readable specifics — what was found and what a person can do about it. Rendered verbatim by `corpus db doctor`; never parsed. Named `detail` to match `ProjectionDrift.detail` and `Warning.detail`, so the render-verbatim string has one name across the whole contract. */
            detail: string;
            /** @description Sha of the commit that introduced whatever this warning names — `git show <commit>` is where it came from, which is the difference between a finding a person can act on and a path they must go hunting for. `null` when there is no such commit: the file is uncommitted, the workspace has no git, or the kind concerns no single file. */
            commit: string | null;
        };
        CheckReport: {
            /** @description True exactly when `errors` is empty — the verdict `corpus doc check` turns into its exit code (0, or 6 for a check-style failure). Warnings never affect it. */
            ok: boolean;
            /** @description Findings that fail the check. Empty when `ok`. */
            errors: components["schemas"]["CheckFinding"][];
            /** @description Findings that do not fail the check: orphaned anchors and unresolved `[[refs]]` (§14). Unrelated to the `Warning` shape mutation responses carry for a rejected auto-commit — this route writes nothing and can produce none. */
            warnings: components["schemas"]["CheckFinding"][];
        };
        CheckFinding: {
            /**
             * @description Which §14 rule the finding reports. Warnings are exactly `anchor-unresolved` (an orphaned thread) and `ref-unresolved` (a `[[ref]]` whose target does not exist yet); the other twelve are errors, `anchor-unused` and `unterminated-fence` among them.
             * @example ref-unresolved
             * @enum {string}
             */
            code: "frontmatter-unparseable" | "frontmatter-invalid" | "id-prefix-mismatch" | "duplicate-id" | "anchor-malformed" | "duplicate-anchor-id" | "thread-parent-missing" | "thread-anchor-missing" | "anchor-claimed-twice" | "anchor-unused" | "duplicate-turn-timestamp" | "unterminated-fence" | "anchor-unresolved" | "ref-unresolved";
            /**
             * @description `error` fails the check (the CLI's exit 6); `warning` is reported and does not. Derivable from `code`, and sent anyway so a consumer never has to hold the partition itself.
             * @enum {string}
             */
            severity: "error" | "warning";
            /** @description Id of the offending document as written in its frontmatter, or null when the file could not be read. Reported verbatim and deliberately unvalidated — a malformed id is one of the things a finding reports. */
            docId: string | null;
            /** @description Workspace-relative path of the offending file. */
            path: string;
            /** @description Human-readable specifics, rendered verbatim by `corpus doc check`; never parsed. */
            detail: string;
        };
        CheckDocumentInput: {
            /** @description Workspace-relative path the content would be saved at. Used for path-derived rules and echoed on every finding, so it must be the real destination path even when the bytes come from the index. */
            path: string;
            /** @description The whole file, frontmatter and body, exactly as it would be written. Empty is legal and reports as unparseable frontmatter, which is what saving it would do. */
            content: string;
        };
        IndexStatus: {
            /** @description Content chunks that have a usable vector recorded under `identity`. With `pending` and `failed` it accounts for every chunk in the corpus, so there is no separate total: a fourth number that must equal the sum of three others is a number that can be wrong. */
            indexed: number;
            /** @description Chunks queued for embedding and not yet embedded — the backlog. Indexing is asynchronous and never blocks a write (SPEC.md §9.1: **no save ever waits on indexing**), so a non-zero backlog is the normal state right after an edit, an import or a rebuild. It is staleness, not drift: `corpus db doctor` stays clean while this drains, and this is the surface that makes it visible instead of hidden. */
            pending: number;
            /** @description Chunks whose embedding failed and that the server has stopped retrying. Counted rather than dropped: a chunk that vanished quietly would leave a corpus that is silently less searchable than it looks. Unlike `pending`, this number does not drain on its own — `POST /api/index/rebuild` is what re-queues them, after whatever made them fail is fixed. */
            failed: number;
            /** @description The provider and model that produced this index's vectors, recorded on the first write and **sticky** thereafter (SPEC.md §9.1: one index, one model — results from different models are never mixed, and the effective model changes only through an explicit act). Rendered verbatim and compared for equality, never parsed: the server writes it as `provider/model@dim` (e.g. `ollama/nomic-embed-text@768`), with the dimension read from the provider's own first response rather than assumed from a table. `null` when nothing has been indexed yet — a fresh workspace has no identity, which is not the same claim as `disabled`. */
            identity: string | null;
            /** @description Whether a **full** rebuild is in flight — `POST /api/index/rebuild`, or the invalidation a changed provider/model identity forces. It is what separates `indexing` from `stale`: both have work pending, but only one of them is starting over, and an operator watching a backlog wants to know which. False during ordinary incremental catch-up, however large the backlog. */
            rebuilding: boolean;
            /**
             * @description How caught-up the semantic half of ranking is — the same value, from the same schema, that `GET /api/search` and `GET /api/docs/{id}/related` report as `semanticIndex`, so no two surfaces can describe one workspace differently. **Derived from the fields above rather than stored**, by exactly this mapping: `current` — an identity is recorded and `pending` is 0 with no rebuild in flight; `indexing` — `rebuilding` is true, which outranks `stale` even though both have work pending; `stale` — an incremental backlog only (`pending > 0`, no rebuild in flight); `disabled` — no provider resolved, no recorded identity, or no usable vectors, which means lexical ranking only and is an honest answer rather than an error (SPEC.md §9.1's local-first default). Required here, unlike the optional `semanticIndex` on the retrieval envelopes: this response *is* the claim, so there is nothing for its absence to mean.
             * @enum {string}
             */
            state: "current" | "indexing" | "stale" | "disabled";
            /** @description One human sentence explaining the state, when there is something to explain — a model still downloading (`downloading the all-MiniLM-L6-v2 embedding model (10.4 MiB of 22.6 MiB, 46%) — semantic ranking starts once it is cached`), a model that has not been downloaded yet, a configured endpoint that did not answer, or an index whose vectors were produced by a model that is not the one resolving now. Without it a workspace whose model is 46% downloaded and one that will never have a model both read as a bare `disabled`, which is the same word for a wait and for a dead end. **Rendered, never parsed**: the wording is the server's, it changes with the reason, and nothing may branch on it — `state` is the field a client decides with. **Absent when there is nothing to add**, which is why it is optional rather than an empty string: a caught-up index explains itself through the counts, and a field that is always present has to invent something to say. */
            detail?: string;
        };
        SkillCreateRequest: {
            /**
             * @description The skill's name, which is its directory name under `.claude/skills/` and the `name` in its frontmatter. Lowercase letters, digits and single hyphens, at most 64 characters — it becomes a directory name, and no real skill name comes close to the bound.
             * @example orchestrate
             */
            name: string;
            /** @description One-line description of when to use the skill, written into the frontmatter `description` Claude Code discovers it by. Required: a skill without one is installed but never invoked. */
            description: string;
            /** @description Corpus document title, shown on the board (SPEC.md §5). Defaults to the skill's `name`. */
            title?: string;
            /** @description Markdown body below the frontmatter — the skill's instructions. Omit it to pre-fill from the `skill` type's `template` document when the workspace defines one, the same rule `POST /api/docs` follows; a workspace with no skill template gets an empty body, which the agent then edits like any other document. */
            body?: string;
            /** @description Defaults to no tags. */
            tags?: string[];
        };
        UpgradeCheck: {
            /** @description The version of the tool this server is running — the same value `GET /api/health` reports as `version`. Always known, including when the check could not reach GitHub: it is a fact about this process, not about the release list. */
            installed: string;
            /** @description The version of the newest published release of the installed distribution, exactly as the GitHub Releases API named it. `null` when there is none to report — either the check could not read the release list (`reachable` false) or the distribution has published nothing yet (`reachable` true). Compared by the server, never by the client: the comparison's verdict is `upgradeAvailable`, and a client that re-derived it from these two strings would be writing a second version parser. */
            latest: string | null;
            /** @description Whether `latest` is newer than `installed` — the version comparison and nothing else. Always `false` when `latest` is `null`, because an unknown latest is not a newer one. **Not sufficient on its own to offer an upgrade**: check `verifiable` too, or the action offered here is one the upgrade will refuse. */
            upgradeAvailable: boolean;
            /** @description Whether the release `latest` names publishes the checksum the upgrade verifies before installing — the `corpus-<version>.tgz.sha256` asset, in `shasum -a 256` two-field format, that the release workflow attaches beside the tarball (INFRA-016). §2.4 has `corpus upgrade` verify the published checksum, so a release without one is not an upgradable target and the upgrade refuses rather than installing unverified bytes. `false` whenever `latest` is `null` — there is no asset list to have looked at. A client seeing `upgradeAvailable` true and this `false` should say a newer release exists and cannot be installed automatically, rather than offering an action that will fail. */
            verifiable: boolean;
            /** @description Absolute URL of the release notes for `latest` — the release's own page, for a client to link so a person can read what is changing before accepting it. `null` whenever there is no `latest`, and tolerated as `null` for a release that exposes no page. Rendered as a link, never fetched by the client: this server is the only thing that talks to GitHub, and it does so only when asked. */
            notesUrl: string | null;
            /** @description Whether the GitHub Releases API answered. `false` is the modelled failure that §2.4's on-demand check has to be able to report — an offline laptop, a captive portal, a rate-limited API — and it arrives as a `200` carrying this flag, never as a `5xx`: the endpoint did its job and the network is what did not. When `false`, `latest`, `upgradeAvailable`, `verifiable` and `notesUrl` carry nothing (`null` / `false`) and `detail` says why in one sentence. */
            reachable: boolean;
            /** @description One human sentence about this answer when there is something to add — chiefly why an unreachable check failed, but also why an available release is not verifiable, or that the distribution has published no releases yet. **Rendered, never parsed**: the wording is the server's and changes with the reason; every decision a client makes comes from the booleans above. `null` when there is nothing to add, which is the normal case for a workspace that is simply up to date. Nullable rather than optional so that every key on this small object is always present, like the two nullable fields beside it — one way to say 'nothing', not two. */
            detail: string | null;
        };
        UpgradeStarted: {
            /**
             * @description Always `true`. The upgrade process was spawned; nothing here claims it will succeed, and it has not finished — the response is written before the download begins. The only other outcome of this call is the `409` refusal, so there is no `false` to send.
             * @enum {boolean}
             */
            started: true;
            /** @description Workspace-relative path of the file the detached upgrade writes its output to, e.g. `.corpus/upgrade.log` — workspace-relative, the spelling every path on this surface uses. This is where SPEC.md §2.4's report lands: what the tool install did, what the workspace template sync updated, what it left alone, and — listed apart from all of that, because a conflict is unresolved work rather than a notice — every file the workspace edited and the tool also changed, each naming `corpus workspace diff <path>`. The connection this response arrives on does not survive to carry any of it: the upgrade outlives the server it restarts. A client that shows an upgrade as finished without pointing at this file has told the operator less than the upgrade knows. */
            logPath: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
