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
         * @description Structured filters compose with optional full-text search: values OR within a comma-separated parameter and AND across parameters. The default result set excludes `status: archived` (SPEC.md §10) unless `status` is passed explicitly. The thread-only filters — `parent`, `agent`, `author` and `unread` — no-op for non-thread types rather than erroring (SPEC.md §9.2). `isParent` is not one of them: it selects roots — documents with no parent — for every type, and is the one filter that is **refused** in combination, since `parent=<id>` with `isParent=true` is a contradiction and answers `400`. `folder` matches a folder and everything under it, threads included through their parents, unless `folderScope=self` narrows it to the documents filed directly in that folder — a modifier, so it too answers `400` when it arrives without a `folder`. Every row carries its Attention reasons; rows carry search snippets when `q` is set.
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
                    /** @description Comma-separated document types; values OR together. Core values: note, thread, view, board, template, skill, agent-def. Open rather than enumerated because a workspace may hold documents of a type this build has never heard of, and they are searchable like any other (SPEC.md §5, §12's M6). */
                    type?: string;
                    /** @description Restrict to a lifecycle status. Omitted, the default result set **excludes** `status: archived` (SPEC.md §10); passing `status` explicitly overrides that default, so `status=archived` selects archived documents *only*. To see archived documents **alongside** the rest, use `includeArchived=true` — that is the archived chip, not this parameter. */
                    status?: "open" | "resolved" | "archived";
                    /** @description Comma-separated stage values (SPEC.md §5); values OR together like `type` and `tag`, and each is an **exact** match. **An empty element selects documents with no `stage` at all** — the null sentinel — so a kanban's first column, which holds its first stage *and* everything unstaged (SPEC.md §10), is one request: `stage=,triage`. It can never collide with a real stage, because a written stage is a non-empty comma-free string, so the empty element names a value no document can hold. `stage=` on its own therefore selects the unstaged, and omitting the parameter filters nothing at all. Duplicate elements collapse. **Not thread-only**: any document may carry a stage. A kanban over `status` needs none of this — every document has a status — and draws its columns with `status=`. */
                    stage?: string;
                    /** @description Lift the default archived exclusion. `true` widens the default result set into the **union** of archived and non-archived documents — the archived chip's "include archived" reading (SPEC.md §10) — where `status=archived` selects archived documents *only*. Absent or `false` keeps today's behaviour. It modifies the **default** and nothing else, so it is a no-op alongside an explicit `status`: `status` already replaces the default filter, and `status=open&includeArchived=true` is just `status=open`. */
                    includeArchived?: boolean;
                    /** @description Comma-separated tags; values OR together. Tags are validated comma-free on write, so the separator needs no escaping scheme. */
                    tag?: string;
                    /** @description Path prefix relative to `data/docs/`, matching the folder and its descendants. Threads inherit their parent document's folder (SPEC.md §10). How far down it reaches is `folderScope`'s to say on the collection query, which defaults to the tree. */
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
                    /** @description Whether the document is a **child of something** (SPEC.md §9.2). `true` selects **roots** — documents whose `parent` is null or absent — which is what lets a view show top-level documents without their child threads mixed in among them; `false` selects documents that **are** a child. Absent filters nothing, exactly like every other optional filter: there is no default of `true`, so a view that never sets it shows what it always showed. **It does not mean "has children."** A standalone note that nothing hangs off still matches `isParent=true` — the filter asks what a document is *under*, never what is *under it*. The "has at least one child" reading matches the name more literally and was considered and **rejected** (a parents-only view that hid every uncommented note would be nearly empty); the name is the one the user asked for and is kept deliberately, so do not "fix" it into the other meaning. **Not thread-only**, unlike `parent`: a non-thread document has no parent at all, so `isParent=true` genuinely matches it and `isParent=false` genuinely excludes it — an answer, not a no-op, and a mixed top-level list of notes and standalone threads is the point. `parent=<id>` together with `isParent=true` is a contradiction and is **refused with `400`** rather than answered with an empty set: `parent` no-ops for non-thread types, so an intersection would quietly return every root document that is not a thread — a confident answer to a question nobody asked. `parent=<id>&isParent=false` is merely redundant and is accepted. */
                    isParent?: boolean;
                    /** @description How far under `folder` the listing reaches — a **modifier of `folder`**, meaningless without it. `tree` (the default, and what `folder` has always meant) matches the folder and every descendant, plus the threads whose parent document is filed under it: a folder column shows a folder's work *and* the conversations about it (SPEC.md §10). `self` matches the documents filed **directly** in the folder — a path with no further `/` after the prefix — and inherits nothing, so a thread whose parent sits in the folder while its own file does not is **absent**: a thread is a document, and its own path decides where it is filed. `self` is the explorer's reading, one row per folder with that folder's own documents under it (SPEC.md §10, rider 1), and it is what keeps one document from being drawn under every expanded ancestor at once. `page.total` counts the same set the page draws from at either scope, so a `self` listing's bound line is about the folder's own documents and not its subtree's. **Sent without `folder` it is a `400` naming `folder`**, rather than a silent no-op over the whole corpus: there is no folder for it to stop at. A `folder` naming nothing answers an empty page at either scope, and the root — `folder` spelled as `data/docs` or `/`, since the parameter is non-empty — with `self` is the documents at the top of the tree. */
                    folderScope?: "tree" | "self";
                    /** @description The Attention filter (SPEC.md §10). `me` is the union of every reason; the individual reasons (unread-reply, form, due, stale, failed-job) back the per-reason chips. Composes with the other filters by intersection — `needs=me&folder=finance` is Attention within that folder. */
                    needs?: "me" | "unread-reply" | "form" | "due" | "stale" | "failed-job";
                    /** @description Sort key; defaults to `-updated`. `relevance` requires `q` and is rejected with `400` without it, rather than silently falling back. `order` sorts ascending by the §10 key — a **board's position among boards** — with the documented tiebreak: `order` with nulls last (a board with no `order` key is placed, never dropped), then `title`, then `id`. The board bar's whole set is therefore one bounded query, `type=board&sort=order`, with each board's `columns`, `kanban` and `defaultOpen` on the rows. */
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
         * @description The body is pre-filled from the type's `template` document when one exists and no body is given (SPEC.md §9.2). The server assigns the id; it is immutable thereafter. Creation is inbox-first: an omitted `folder` files the document in `data/docs/inbox/` — **except for a type whose own document root takes ordinary markdown documents**, which is where an omitted `folder` files it instead. There are two: a `type: agent-def` document lands in `.claude/agents/` (SPEC.md §7) and not in the inbox, and a `type: thread` document is flat at `data/threads/<id>.md`, named by its id (SPEC.md §4) — a `folder` sent with a thread is still checked by the same rules as any other create, so one that fails them is still a `400`, and one that passes never changes where the thread lands. `type: skill` is **not** one of them, though §7 gives it a root too: `.claude/skills` indexes `SKILL.md` files alone, so a skill created here with no folder still lands in the inbox. See `folder` for that grammar in full, including which roots a request may name outright. A create can also be refused on its `title`: in a root where a document's filename is the name it answers to, a name already taken is a `400` rather than the deduped filename a title collision gets under `data/docs/`.
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
                /** @description The created document, and any §11 warnings. */
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
         * @description Applies a **staged set** to several documents and answers for all of them — the board makes one request per Save, never one per document and never one per verb. **Each entry carries its own action** (SPEC.md §10: in bulk mode each row carries its own staged action), so archiving three documents and resolving two is one request. **The act lands as a single auto-commit** (SPEC.md §4, "One action, one commit"), authored by the acting party like any other mutation: archiving twenty documents is one commit, not twenty, so reverting the action is one `git revert` and `git log` never records an effect the user was told did not happen. §4 is explicit that this survives a mixed set — **a Save carrying a mix of verbs is still one act and still one commit**, not one commit per verb — so grouping the staged set by verb and writing each group is wrong even though it would produce the same files. **Every document `changed` names has a file in that commit**, and `git show --name-only` lists it: only a write that landed puts an id in `changed`, and only those writes are staged, so a document that was refused or was already in the target state wrote nothing **of its own**. Its files may still be in the commit, carried there by another document's act — archiving a skill that nests a second requested skill moves the nested one's file while refusing it by id. That containment is the invariant, and it holds in one direction only — **the commit may also carry files for documents the act did not name**, because the result's three parts partition the **requested** ids and nothing else. Two things do that today, both required by the spec rather than incidental, and both shared with the single-document routes: §6's anchor cascade rewrites the `anchors` map of a deleted thread's parent in the same commit, and that parent survives the act and need not even have been requested; and archiving or unarchiving a skill moves its whole folder, carrying every file under it — including the `SKILL.md` of a nested skill, which the move disables (§7: what disables a skill is where its folder lives) without the act ever naming it. The commit message names the actions the act carried and the documents each one changed. It is its own entry in the history: it never folds into a preceding editing session's squashed commit, and no later save folds into it (§4's squashing is about repeated saves of *one* document, never about one act across many). An implementation that loops the single-document write path is therefore wrong rather than merely slower — it produces N commits and has nothing honest to put in `commit`.
         *
         *     **A whole-result-set selection is one entry, not a list of ids.** §10: because there is no per-row gesture for rows nobody enumerated, such a selection stages as a **single entry** carrying one action for everything the column's query matches. `wholeResultSet` is that entry — at most one, beside any number of enumerated `entries` — and **the count is re-evaluated when the Save runs**, not when it was staged, which is why it travels as a query rather than as ids the caller resolved earlier. It covers everything the query matches **except** the ids `entries` names individually, so no document is ever acted on twice and a hand-staged row keeps the verb the person chose. **`delete` cannot be spelled on it at all** (§10: "all 412 matching" is not a set anyone read before confirming), which is a type error in the generated client rather than a runtime refusal. The ids it resolves to appear in the result like any other, which is the only place the caller learns them.
         *
         *     **Partial application is the normal case, and it is a `200`.** §10: a Save "applies to what it can and reports what it could not" and "never refuses the whole set because of one document". The result states three parts — what `changed`, what was `alreadyInState` (a document already archived is a no-op, **not** a failure), and, listed apart from both, what was `refused` and why, each named individually **with the verb that applied to it**. One that fails validation is refused with its reason (§11); an unknown id is refused as `not-found`; a row the act does not apply to is refused as `not-applicable`; one whose file could not be written is refused as `write-failed`; the rest go through. **There is no staleness refusal**: every act here names its own delta, so none presents a key (SPEC.md §7) and this route is given no version to compare. There is no `404` either: an unknown id is a per-document outcome here, not a verdict on the request. Every requested id appears exactly once across the three parts, so the caller can compare the total against the count it showed.
         *
         *     **`delete` is user-only** (SPEC.md §7, §9.2): a Save carrying a `delete` entry with `x-corpus-author: agent` is rejected with `403` for the **whole request** — the refusal is the request's, not a per-document outcome — exactly as `DELETE /api/docs/{id}` rejects it. The agent archives, never deletes. Every other act is available to both parties.
         *
         *     **A `400` answers a staged set that cannot be applied as written**: nothing staged at all (no `entries` and no `wholeResultSet`), or one id staged twice. §10 makes a row carry exactly one staged action, so a repeated id means the staged set was keyed wrong; where the two entries name different verbs the message says both, because choosing one silently would be a choice about someone's documents and applying both would write one document twice inside an act that promises to be one commit of exactly what changed. Every document already being in the target state is a different thing entirely — a legal, successful act that changes nothing and therefore makes **no commit at all**: `200`, empty `changed`, null `commit`. The single-document routes are unchanged and remain the path for the reader's ⋯ menu and per-row quick actions (§10) — this route is for a selection, and the difference between them is the commit.
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
            /** @description The staged set: the individually staged rows, each with its own act, and optionally §10's single whole-result-set entry. `entries` is mandatory, so the body is too. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["BulkActionRequest"];
                };
            };
            responses: {
                /** @description What changed, what was already in that state, what did not change and why — each named with the verb that applied to it, plus the single commit the act landed as, and any §11 warnings. */
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
         *
         *     **One field on this route is user-only, and it answers `403`**: `origin: null`, the detach (SPEC.md §9.2). A request carrying it under `x-corpus-author: agent` is **rejected** with `403` and writes nothing, because detaching is a person's correction of where their work was filed and an agent that could undo it could quietly move an artifact out of the scope it belongs to. Every other field on this route is open to both parties, so the `403` is about that one key and never about editing.
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
                /** @description The deleted id, the threads it orphaned, and any §11 warnings. */
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
                    /** @description Lift the default archived exclusion. Archived documents are left out of the related set by default, like every list (SPEC.md §10); `true` widens it into the **union**. Archiving is organizational rather than deletion, so an archived neighbour is still a real relation — it is just not what an agent expanding from a live document usually wants first. */
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
         *     **Bounded, like the context pack.** Reading a diff costs roughly the same however large the document or the change: the body is capped at 16000 characters (`DOC_DIFF_MAX_CHARS`) and a longer diff is **truncated, not refused** — whole hunks are dropped from the end while that fits, and the hunk that straddles the bound is cut at a line boundary (SPEC.md §9.2). So the last hunk may be a **prefix of itself**, and its header can promise more lines than follow: read a truncated diff, do not apply one. `truncated` says so, and `totalChars` says how much was cut. Refusing would leave a caller that already spent a wake-up with nothing; truncating leaves it with the front of the change and an honest measure of the rest.
         *
         *     **Path-scoped**: the diff and the stats cover this document's file alone, so commits in the range that touched other documents contribute nothing — the range may be a commit range, but the answer is about one document.
         *
         *     **The range.** `from` is exclusive and `to` inclusive (`git diff from..to`). Both are optional, and **both defaults walk this document's history rather than the branch's**: `to` is the newest commit that touched this document, and `from` the newest commit *before `to`* that touched this document — with git's empty tree (`4b825dc642cb6eb9a060e54bf8d69288fbee4904`) when nothing before `to` ever touched it, so a document's first change diffs as wholly added. The bare `corpus doc diff <id>` of §4's own sentence therefore reads as *what changed in this document's last commit*, while the pair carried by a `doc.edited` event reads as *what changed in that session*. The resolved values come back in the response, because a caller that omitted one must be able to say what it read.
         *
         *     **`from` is not `to`'s parent**, and a client that computes it that way will read a different range and be told nothing about the difference — both answers are well-formed diffs. §4's commit windows are party-scoped: one commit gathers everything a party saved while its window was open, so the commit sitting immediately before this document's newest one is routinely the *other* party's save to a *different* file, at which this document may not even have existed. Since every read here is path-scoped the two bases usually agree on the numbers and the bytes — what differs is the claim `from` makes about where this document came from, and that claim is published.
         *
         *     **Only commit shas.** A syntactically invalid revision — `HEAD~1`, a tag, anything leading with `-` — is a `400` naming the parameter, before a handler and therefore before a `git` process exists. A well-formed sha this repository does not contain is *also* a `400` naming the parameter, never a `404`: the `404` on this route means the **document** is unknown, and conflating the two would have a caller believe its document had been deleted when it had merely mistyped a range.
         *
         *     A document the workspace has never committed — a file not yet committed, or a workspace with no git (SPEC.md §11) — answers `200` with a null range, an empty diff and zero stats: an answer, not an error. Read-only; no acting party.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Base of the range, **exclusive** — `git diff from..to`. Omit it to use the newest commit **before `to` that touched this document**, which reads as that one commit's own change to it; when nothing before `to` ever touched this document the base is git's empty tree, so a document's first change diffs as wholly added. Deliberately **not `to`'s parent**: §4's commit windows are party-scoped and gather a party's saves across documents, so the parent of a window commit is routinely another party's save to a different file rather than this document's previous state. Must be a commit sha: a named revision is a `400` naming this parameter. */
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
         *     **The `204` carries no body, and deliberately says nothing about whether an event was emitted.** Two reasons, both of which would make such a field a lie. It is a race — the idle window may have elapsed a millisecond earlier, and the session would then already be gone through the other door. And emission is decided *after* this response: a session whose path-scoped range turns out to be empty — an edit and its undo inside one sitting — or whose auto-commits were all rejected or skipped (SPEC.md §11) correctly produces no event at all. What the caller needs is the postcondition, and that is the whole of what `204` states.
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
         *     **An ordinary write once applied**: validated before writing (SPEC.md §11), anchors reconciled with remapped and orphaned anchors reported (§6), and one auto-commit attributed to the acting party (§4) — the same response shape `PUT /api/docs/{id}` answers with, plus `replaced`. **A patch whose result is the unchanged body is a no-op that writes nothing**: `new` equal to `old` answers `200` with no file change and no commit, rather than a refusal.
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
                /** @description The saved document — carrying a fresh `key` — the anchor reconciliation report, §11's warnings, and how many occurrences were `replaced`. */
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
         * @description Rewrites the file path only (SPEC.md §9.2). **The document id never changes**, so every `[[ref]]`, anchor entry and thread `parent` keeps resolving; the projection re-maps id → path. **A move names its own delta and presents no key** (SPEC.md §7): it rewrites the path, not the content, so it invalidates nobody's key and overwrites nothing. **Only a document already under `data/docs/` can be moved**, and its source is checked before the destination is resolved, so a document that can never move says so rather than complaining about the folder. A `type: thread` document is flat at `data/threads/<id>.md` (SPEC.md §4) — its filename is its id, so there is nowhere to move it to — and the `400` reads *threads are flat under data/threads/ and cannot be moved*. A document under any other root — an `agent-def` in `.claude/agents/`, a skill under `.claude/skills/` — reads *<path> is not under data/docs/ and cannot be moved*. That holds in both directions, since `folder` reaches no root either: this route never takes a document out of a SPEC.md §7 root and never files one into it. **A persona written to the wrong place is repaired by creating it in `.claude/agents/`** (`POST /api/docs`, whose `folder` may name a root), not by moving the misfiled one.
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
                /** @description The document at its new path, and any §11 warnings. */
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
                /** @description The document, now archived, any §11 warnings, and what a skill folder move carried. */
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
                /** @description The document, restored, any §11 warnings, and what a skill folder move carried. */
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
         * @description Ranked retrieval over documents, threads and turns. `q` is required — a ranked list with nothing to rank is `GET /api/docs`, not a degraded search. The structured filters are the same set with the same semantics as `GET /api/docs`, archived default included, and are declared from the same schema so the two cannot drift; `sort` and `offset` are not among them and are ignored if sent (a ranked set has one order and no pages), and neither is `isParent`, which §9.2's signed parameter string declares on the collection query alone. `folderScope` is held back for that same reason and no other, so `folder` here always means the folder and its descendants. Each hit is an **address plus a line of context** — the document id, its title, the heading path of the best-matching passage (for a hit inside a thread turn, that turn's heading), and a one-line snippet — and **never a body**: reading one is a separate, deliberate `GET /api/docs/{id}` on a retrieved id. Phase A ranks lexically (FTS5); from Retrieval Phase B, lexical and semantic relevance combine into one list with this exact response shape, and `semanticIndex` reports when that half is not caught up (SPEC.md §9.1) — the response's one Phase B seam, inert today. Read-only; no acting party.
         */
        get: {
            parameters: {
                query: {
                    /** @description The query, and the only required parameter. Phase A matches it lexically (FTS5) across document titles, bodies and turn bodies, exactly as `GET /api/docs`'s `q` does; from Phase B the same string is also matched semantically and the two relevances combine into one ranked list (SPEC.md §9.1). Missing or empty is a `400`, never an unranked everything. */
                    q: string;
                    /** @description Comma-separated document types; values OR together. Core values: note, thread, view, board, template, skill, agent-def. Open rather than enumerated because a workspace may hold documents of a type this build has never heard of, and they are searchable like any other (SPEC.md §5, §12's M6). */
                    type?: string;
                    /** @description Restrict to a lifecycle status. Omitted, the default result set **excludes** `status: archived` (SPEC.md §10); passing `status` explicitly overrides that default, so `status=archived` selects archived documents *only*. To see archived documents **alongside** the rest, use `includeArchived=true` — that is the archived chip, not this parameter. */
                    status?: "open" | "resolved" | "archived";
                    /** @description Comma-separated stage values (SPEC.md §5); values OR together like `type` and `tag`, and each is an **exact** match. **An empty element selects documents with no `stage` at all** — the null sentinel — so a kanban's first column, which holds its first stage *and* everything unstaged (SPEC.md §10), is one request: `stage=,triage`. It can never collide with a real stage, because a written stage is a non-empty comma-free string, so the empty element names a value no document can hold. `stage=` on its own therefore selects the unstaged, and omitting the parameter filters nothing at all. Duplicate elements collapse. **Not thread-only**: any document may carry a stage. A kanban over `status` needs none of this — every document has a status — and draws its columns with `status=`. */
                    stage?: string;
                    /** @description Lift the default archived exclusion. `true` widens the default result set into the **union** of archived and non-archived documents — the archived chip's "include archived" reading (SPEC.md §10) — where `status=archived` selects archived documents *only*. Absent or `false` keeps today's behaviour. It modifies the **default** and nothing else, so it is a no-op alongside an explicit `status`: `status` already replaces the default filter, and `status=open&includeArchived=true` is just `status=open`. */
                    includeArchived?: boolean;
                    /** @description Comma-separated tags; values OR together. Tags are validated comma-free on write, so the separator needs no escaping scheme. */
                    tag?: string;
                    /** @description Path prefix relative to `data/docs/`, matching the folder and its descendants. Threads inherit their parent document's folder (SPEC.md §10). How far down it reaches is `folderScope`'s to say on the collection query, which defaults to the tree. */
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
                    /** @description The Attention filter (SPEC.md §10). `me` is the union of every reason; the individual reasons (unread-reply, form, due, stale, failed-job) back the per-reason chips. Composes with the other filters by intersection — `needs=me&folder=finance` is Attention within that folder. */
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
    "/api/folders/rename": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rename or move a folder, and every document in it
         * @description Moves `data/docs/<from>` to `data/docs/<to>`, carrying every document and thread under it (SPEC.md §9.2). **Ids never change** — the path is presentation and the id is identity (§5) — so every `[[ref]]`, anchor entry and thread `parent` keeps resolving, and the response lists each document's new path rather than a new id. **The paths are in the body, not the URL**, because a folder path carries slashes. `404` when `from` names no folder, `409` when `to` already exists — a rename never merges two folders — and `400` when either path is malformed or `to` is inside `from`. It lands as the single auto-commit §4 requires, authored by the acting party.
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
            /** @description The folder to rename and where it is going. A rename names both. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["RenameFolderRequest"];
                };
            };
            responses: {
                /** @description Every document the rename moved, each at its new path, and any §11 warnings. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RenameFolderResult"];
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
    "/api/folders/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Archive every document in a folder
         * @description Flips `status` to `archived` on every document and thread under `data/docs/<path>` (SPEC.md §9.2, rider 7). **It moves nothing**: archiving a folder is a status act, not a relocation, so the folder stays where it is and every path is unchanged — which is what makes it reversible by `POST /api/folders/unarchive` rather than by remembering where things were. A document already archived is left as it is and is still listed, because the act applied to it. A document the flip could not be applied to is named in `refused` with why, and the act stands for every other document — §10's bulk rule, so one file the write lane could not take never refuses the folder. `404` when the folder is unknown. One action, one commit (§4), authored by the acting party.
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
            /** @description The folder to archive. An act on a folder names one, so the body is mandatory. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["FolderPathRequest"];
                };
            };
            responses: {
                /** @description Every document in the folder with its status after the act, the ones the act could not apply to, and any §11 warnings. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FolderStatusResult"];
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
    "/api/folders/unarchive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Restore every archived document in a folder
         * @description The inverse flip, back to `status: resolved` — the state archiving already implied (SPEC.md §5) — on every document and thread under `data/docs/<path>`. It moves nothing, for the reason archiving moves nothing. A document that was not archived is left as it is and is still listed, and one the flip could not be applied to is named in `refused` with why. `404` when the folder is unknown. One action, one commit (§4), authored by the acting party.
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
            /** @description The folder to restore. An act on a folder names one, so the body is mandatory. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["FolderPathRequest"];
                };
            };
            responses: {
                /** @description Every document in the folder with its status after the act, the ones the act could not apply to, and any §11 warnings. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FolderStatusResult"];
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
    "/api/folders/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Delete a folder and every document in it (user-only)
         * @description **User-only**, exactly as deleting a document is (SPEC.md §9.2, rider 7): a request carrying `x-corpus-author: agent` is rejected with `403` — the agent archives, never deletes (§7). Nothing is hard-deleted from history; git preserves every file and every version of it, and the threads of a deleted document become orphaned records that still name it as `parent` (§9.2). The response lists the ids and nothing more, because there is no field left to report: a client drops those rows. A document that could not be deleted is named in `refused` with why, and still exists — the delete stands for every other document. `404` when the folder is unknown. **A `POST`, not a `DELETE`**, for the reason the whole family is: the folder is named in the body because a folder path carries slashes, and a `DELETE` with a body is a request intermediaries are entitled to strip.
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
            /** @description The folder to delete. An act on a folder names one, so the body is mandatory. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["FolderPathRequest"];
                };
            };
            responses: {
                /** @description The ids of every document the delete removed, the ones it could not remove, and any §11 warnings. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DeleteFolderResult"];
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
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/boards/order": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set the order of the board bar, in one commit
         * @description Renumbers the boards named in the body to `1 … n`, in the order given, and lands every write as the **single** auto-commit SPEC.md §4 requires — rider 2's "reordering boards writes `order` on every board, in one commit". A board already at the position it would be given is left alone, so the commit contains exactly the documents whose position changed (§4) and a bar dragged back where it started writes nothing at all.
         *
         *     **All or nothing.** The whole request is refused before anything is written when an id names no document (`404`) or names a document that is not a `type: board` (`400` — rider 2: a view document has no `order`), and the file writes are applied as one group that rolls back if any of them fails. No caller can observe half an order, which is the failure one-`PUT`-per-board could not rule out.
         *
         *     **It names the bar, not the corpus.** Boards the body does not name keep the `order` they carry, so a client showing only unarchived boards states its own order without inventing positions for boards nobody can see. Two boards may then tie, which is the state a hand-edited file can be in anyway, and `GET /api/docs?sort=order` breaks a tie by title and then by id.
         *
         *     Authored by the acting party like every other write (§4), and the commit folds in neither direction: it is an act over a set, so it never joins a preceding editing session and no later save joins it.
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
            /** @description The board bar, in the order it should be in. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ReorderBoardsRequest"];
                };
            };
            responses: {
                /** @description Every board named, with the position it now carries and whether this act wrote it, plus the one commit and any §11 warnings. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReorderBoardsResult"];
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
         * @description The composer's Capture action (SPEC.md §10): creates the document in `data/docs/inbox/` **plus** its whole-document filing thread asking the agent to retitle, move, expand and tag it, in one call. `multipart/form-data`, so a screenshot plus one line is a first-class capture; build the body with `uploadCapture` from `@corpus/contract/client`. The returned `eventId` lets the board show the pending-agent indicator immediately and the console link the job back to the capture. An upload past the workspace's size caps is a `413`.
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
         *
         *     **A standalone thread is created with a resident, unless the caller says otherwise** (SPEC.md §7, rider signed 2026-08-25). Omitting `resident` designates a **general resident**, because a conversation is a thing an agent owns and owning it is what happens when nobody chose. `{name}` designates that profile, resolved exactly as `POST /api/threads/{id}/resident` resolves it. **`null` means no resident at all**, and it is the one field on this body where `null` and omitted differ — `parent` and `selector` treat them alike, this does not, and a caller spelling a missing variable as `null` gets the opposite of the default.
         *
         *     **`resident` is not `recipient`.** A recipient routes one message and rewires nothing; a designation hands over the conversation and everything that grows out of it. Both may ride one request. **A `resident` on a thread with a `parent` is a `400`**: §7 lets only a standalone thread designate, since a thread on a document is about that document and a resident owns a conversation rather than a passage.
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
                /** @description The request names something that does not exist: `unknown_job` — a `job` resolving to no event, or to work already settled — or `unknown_recipient` — a `recipient` naming a thread this workspace does not hold, or one that holds no resident and is therefore not a lane. Nothing was written in either case. Retry without the offending field, or with a value that resolves. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnknownJobError"] | components["schemas"]["UnknownRecipientError"];
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
         * @description Thread *lists* go through `GET /api/docs` with `type=thread` (SPEC.md §9.2). **The response answers read state itself**: `unread` is the same comparison `DocRow.unread` makes, against the same server-side mark, so a reader that reached this conversation without a list row — a standalone thread, or one past the first page of a busy parent — does not have to guess. SPEC.md §10 makes read state an input to a placement and not only to a badge (CONTRACT-036).
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
    "/api/threads/{id}/scope": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * What a designated thread's resident owns
         * @description The **scope** of a designated thread (SPEC.md §7): the thread itself, every thread whose parent chain reaches it, every document whose `origin` reaches it, and every thread on such a document — that is, everything whose events are stamped with this thread's lane. **One frugal line per member and never a body** (§7's retrieval discipline): id, kind, current title, status, and the edge it reached the scope by (`self` for the root, `parent`, `origin`).
         *
         *     **Computed per request, by the same walk the queue routes with** — `scope` is computed, never stored (SPEC.md §7), so nothing here is a projection table or a cache: the server runs the identical `walkScope` that decides an event's lane over the corpus and keeps what lands on this one. A document created *before* the thread was designated is therefore listed when its origin reaches it, exactly as the queue would route a comment on it; an archived document is listed with `status: "archived"`, because archiving does not touch origin or parent and detaching is the only way out of a scope. A person asks this to see what an agent owns (SPEC.md §10); a resident asks it to learn what it owns — reading your own lane is not a sweep.
         *
         *     **Bounded at 200 members, with no cursor and no total.** The root thread comes first, then the most recently updated members first, so a truncated page holds the live end of the scope; `truncated` says when the cut happened. The bound exists so that a scope cannot be an enumeration (§7 forbids the agent the sweep), not to make paging a feature — a caller that needs one particular member reads it by id.
         *
         *     **`409` for a thread with no resident: the orchestrator's lane is not a scope.** §7 defines scope only for a designated thread; everything outside every scope falls on the orchestrator's lane by default, so an undesignated thread has no scope to list rather than an empty one, and answering `[]` or the thread alone would invent a scope the queue does not route by. The message says so and names the remedy: designate a resident, or read `GET /api/agents` for the lanes that exist. `404` when the thread is unknown, and when the id names a document that is not a thread, matching `GET /api/threads/{id}`. **No query parameters**: the bound lives in the contract, not in a flag. Read-only; no acting party.
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
                /** @description The scope, root first, at most 200 members, with `truncated` set when the cap cut it. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ThreadScope"];
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
         *     **What that is not.** It is not a guarantee that every form fence on disk parses, and a client must not treat it as one. Two limits are deliberate: a turn from any other actor is not checked, because §6 makes a form something an *agent* turn carries and a person quoting a form fence in a reply is quoting rather than asking; and this is not the only route that writes a turn — `POST /api/threads` creates a thread with its first turn and does not run this check. So the reader's rule (§10: an unreadable form renders as the visibly broken code block it is, never as a partial set of controls) is the safety net for every fence this endpoint did not vet — a hand-edited file, an older server, a person's quoted block, a thread's first turn — and not a formality.
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
                /** @description The request names something that does not exist: `unknown_job` — a `job` resolving to no event, or to work already settled — or `unknown_recipient` — a `recipient` naming a thread this workspace does not hold, or one that holds no resident and is therefore not a lane. Nothing was written in either case. Retry without the offending field, or with a value that resolves. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnknownJobError"] | components["schemas"]["UnknownRecipientError"];
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
         *     **Two rules keep the form answerable**, since the answer turn is the durable record of what was answered and is read back a line at a time (PR #28 finding 1). A `question` and an option are each **a single line**. And no option may be spelled `**Note:**`, `_(left blank)_`, or one of this same form's questions wrapped in `**…**`: the answer writes a chosen option on a line of its own, where those three read as the note heading, the blank marker, and a question heading. A form breaking either rule does not parse at all — so it is a `400` on the turn that would write it and, wherever such bytes already exist, a form to nobody: it renders as the broken code block it is (§10) rather than advertising a question no answer could ever clear.
         *
         *     **The answer** carries one entry per field answered, matched to its field by `question` rather than by position, with the value under the key the field's kind names: `option` for `choose one`, `options` for `choose any`, `text` for `write`. A chosen option is matched **verbatim** against that field's `options` — a near miss is a rejection. A field left blank is **omitted from `answers`**, which is legal only when that field is optional — so a form whose fields are all optional accepts an empty `answers`. Submitting is all-or-nothing: there is no partial save and no per-field submit, and a form is unanswered until it is submitted. A `note` is free text about the ask as a whole, and always optional.
         *
         *     **User-only**: a request carrying `x-corpus-author: agent` is rejected with `403` — "only the person answers a form: the agent never answers a form, including its own" (SPEC.md §6). A signal the agent can clear for itself is not a signal, so this is a refusal in the same family as user-only deletion, not a silent no-op.
         *
         *     `400` when the answer does not fit the form — an option a field does not offer, an answer to a field the form does not ask, a required field with no answer, a value under the wrong key for the field's kind, or the same option named twice in one `choose any` — naming every offending entry under `body.answers` in `issues`. Also `400` when the answer's own text would not survive the turn it writes: a `write` answer or a `note` containing a line that reads as a turn heading, one leaving a code fence open, or one spelled exactly like this form's own `**<question>**` heading, `**Note:**` or `_(left blank)_` — the last of these would be recorded under the wrong question while parsing perfectly well, so it is refused rather than rewritten (a rewrite would record an answer nobody gave). `404` when the thread has no such turn, or that turn carries no form; `409` when that form is **already answered** — a form is answered once, and changing your mind is an ordinary reply, not a second answer to the same question (SPEC.md §6, §10). The `409` is deliberate: the request is well formed and the state is what refuses it, so retrying with a different body will not help.
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
                /** @description The request names something that does not exist: `unknown_job` — a `job` resolving to no event, or to work already settled — or `unknown_recipient` — a `recipient` naming a thread this workspace does not hold, or one that holds no resident and is therefore not a lane. Nothing was written in either case. Retry without the offending field, or with a value that resolves. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnknownJobError"] | components["schemas"]["UnknownRecipientError"];
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
         * @description Sets `status: resolved`. The thread collapses in the document view and **later turns stop re-triggering the agent** even while it is `engaged` (SPEC.md §8) — resolving is how a conversation is closed without deleting anything. Resolving rewrites the thread file and auto-commits it, so the response carries §11's warnings — a workspace hook that rejects the commit leaves the status change on disk and uncommitted, and that has to be visible.
         *
         *     **Resolving releases the thread's resident with it** (SPEC.md §7): a settled conversation has nobody to keep resident, so the response's `resident` is null whenever there was one. Nothing already queued moves — a lane is stamped once, at enqueue time — and everything enqueued afterwards routes as it did before there was a resident.
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
         * @description Sets `status: open` again. An `engaged` thread resumes re-triggering the agent on later turns (SPEC.md §8). Like `resolve`, it rewrites and auto-commits the thread file, so the response carries §11's warnings.
         *
         *     **Reopening does not restore a resident** (SPEC.md §8): resolving released it, and the conversation resumes on the orchestrator's lane. Designating again is a deliberate act, as the first designation was — the alternative would make releasing conditional on nobody ever replying.
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
    "/api/threads/{id}/resident": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Designate a thread's resident agent (user-only)
         * @description Gives a **standalone** thread a resident: a long-lived agent that owns that conversation and everything that grows out of it, rather than being dispatched to one message at a time (SPEC.md §7). From then on, work falling in that thread's **scope** — the thread, every thread whose parent chain reaches it, every document whose `origin` reaches it, and every thread on such a document — is enqueued on that scope's lane instead of the orchestrator's.
         *
         *     **The body is optional in full: a bare `POST` designates a *general resident*** — an agent with no persona document, working the conversation as the workspace's ordinary agent does. §7 calls that the ordinary case, and it requires nothing to exist in the workspace first, so a fresh workspace with no `agent-def` documents can designate on its first day.
         *
         *     **Naming a profile is the refinement.** `name`, when given, is the invocable name `@<subagent>` mentions already use (SPEC.md §8) — for a `type: agent-def` document **under `.claude/agents/`**, its filename stem or its title, case-insensitively, never a document id — and is how a conversation gets an agent that behaves differently from the default. `404` when the thread is unknown, and `404` when the name resolves to no such document: a name that misses is refused rather than degraded to a general resident, because a typo that looked like it worked is the worse outcome. An `agent-def` filed outside that root is one of those misses — it is a document *about* a persona, nothing loads it as a subagent, and it answers to neither spelling — and where an off-root `agent-def` is titled the name given, that `404` names its path, because moving the file into `.claude/agents/` is what makes it designatable. **Only the title reaches that refusal**: off root there is no filename stem to answer to, so `legacy-analyst` for a document titled `Legacy Analyst` in the inbox is the bare `404` — its title is the spelling that says where it is. A **blank** name (`""`, `"   "`) is a `400` and not absence, for the same reason.
         *
         *     **Everything else about a resident is identical either way** (SPEC.md §7) — the lane, the scope, presence, the lapse fallback, release, and resolution releasing it — because a profile says *how* the agent works and nothing about *what it owns*. The response carries the resolved `Resident`, whose `name` is null for a general one and whose `docId` is null when there is no profile document to point at, so the caller never repeats the lookup.
         *
         *     **The designation is where the resident's weight is chosen** (SPEC.md §7, rider signed 2026-08-19: a resident's weight is set when it is designated, not per message). `weight`, when given, is a level's key from the workspace's own agent guidance — the same token a message's `weight` carries, never a model name — and it governs the resident's own turns; a weight stated on a message still governs what the resident hands off (SPEC.md §7, rider signed 2026-08-19). Omit it to choose nothing, which is today's behaviour exactly: the launcher decides, `Resident.weight` reads null, and the launcher says what it chose. The server records the value and interprets nothing about it; a level the launcher cannot meet is reported in the listener's first reply, not refused here. `Resident.weight` carries it back on the thread, the roster row and the `resident.designated` payload, so the choice is never write-only. A composer addressing this lane offers no per-turn weight and says why (SPEC.md §10).
         *
         *     **Single-valued, so designating again replaces.** A thread has one resident or none, and nothing has to arbitrate between two; designating a thread that already has one is a replacement rather than a `409` — and a replacement is a release of the old occupant, so it enqueues a `resident.released` with `reason: "replaced"` beside the newcomer's `resident.designated`. What is refused is designating a thread that may not have a resident at all: `409` for a thread with a parent — anchored or whole-document — because a thread on a document is *about* that document, and a resident owns a conversation rather than a passage.
         *
         *     **A second `409`, and it is the opposite of that one** (SPEC.md §7, rider signed 2026-08-25). Releasing a resident hands its lane's pending events to the orchestrator, and designating again before those settle would put a listener on the same lane while the orchestrator is working them — the same turns answered twice, which is the one seam the no-fallback rule leaves. So a thread whose release is **still draining** refuses, with `code: "draining"` and `outstanding`, the number of events still being worked. The two refusals are told apart at the `code` and never at the status, because a thread with a parent can *never* have a resident while this one is about to have one again in seconds: the condition is transient, self-clearing, and a fact about outstanding work rather than a state of the thread.
         *
         *     **A replacement is identified, not only announced** (CONTRACT-071). Every designation that changes what the thread has gets a fresh `Resident.designationId`, and one that asks for the state already in force writes nothing and keeps the id it had. That is what lets the listener launched by an earlier designation find out it was replaced: it compares the id it was launched with against the id the lane carries now. Before this field the comparison had no honest input — a replacement naming a different profile at the same weight leaves the lane live and the roster row in place, and the row's rendered resident cell is written for a person and must never be parsed.
         *
         *     **User-only**: a request carrying `x-corpus-author: agent` is rejected with `403`. A resident claims a conversation and every artifact that grows out of it, and an agent that could designate would be choosing who answers a person's messages (SPEC.md §7 — designation is user-only state).
         *
         *     **It enqueues `resident.designated`, on the orchestrator's lane whoever is designated** — the resident does not announce itself to itself, one of exactly two carve-outs §7 makes to the lane rule. Nothing already queued moves: a lane is stamped once, at enqueue time, and never rewritten, so designating does not re-route work the orchestrator is already holding.
         *
         *     **One action, one commit** (SPEC.md §4), authored by the acting party. It presents no key (SPEC.md §7): it sets one frontmatter field and replaces nothing a reader was holding.
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
            /** @description Optional in full: omit the body entirely — or send `{}` — to designate a general resident, and give `name` to designate a profile. */
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["DesignateResidentRequest"];
                };
            };
            responses: {
                /** @description The thread, its `resident` now the resolved `{name, docId, weight, designationId}` — the first two null for a general resident, the third null when no weight was chosen, and the fourth the id of the designation now in force — and any warnings raised while writing it. */
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
                /** @description Two opposite refusals, told apart by `reason`. `has-parent`: the thread is on a document and may never have a resident. `draining`: its released resident left `outstanding` events the orchestrator is still working, and designating now would hand the same turns to two agents — which clears by itself in seconds. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DesignateConflictError"];
                    };
                };
            };
        };
        /**
         * Release a thread's resident agent (user-only)
         * @description Releases the thread's resident, returning its scope to ordinary routing (SPEC.md §7). Nothing is rewritten: events already stamped keep the lane they were stamped with, and everything enqueued afterwards routes as it did before there was a resident. Dissolving is the **absence** of a resident, never a third state.
         *
         *     **A release that releases somebody enqueues `resident.released`, on the orchestrator's lane** — under the same carve-out as `resident.designated`: a released resident does not announce its own end to itself, and the orchestrator is what launched the listener and has to learn the lane returned to it. The payload names the thread, the resident that left and `reason: "released"`; resolution's release says `resolved`, a replacement says `replaced`, and a lapse is not a release and produces none. One release, one event.
         *
         *     **Idempotent.** Releasing a thread that has no resident is a `200` that changes nothing, writes nothing and commits nothing — the caller often cannot know, and a release with nothing to release is a no-op rather than an error. It answers with the thread rather than a bare `204` because a release that *does* write can raise §11's warnings, and a rejected auto-commit has to be visible somewhere.
         *
         *     **User-only**: `403` for `x-corpus-author: agent`, exactly as designating is — release is the other half of the same user-only state, and an agent able to release could quietly stop being resident in a conversation a person put it in.
         *
         *     **Resolving a thread releases its resident too** (SPEC.md §7): a settled conversation has nobody to keep resident, so `POST /api/threads/{id}/resolve` does this as part of resolving. **Reopening does not bring it back** (SPEC.md §8) — the conversation resumes on the orchestrator's lane, and designating again is a deliberate act, as the first designation was.
         *
         *     `404` when the thread is unknown. It presents no key (SPEC.md §7): it clears one frontmatter field and replaces nothing a reader was holding.
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
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The thread, its `resident` now null, and any warnings raised while writing it. Unchanged when there was no resident to release. */
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
    "/api/agents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The roster of lanes, their residents and their liveness
         * @description Every lane of the queue: which conversation it belongs to, who is resident on it, whether a listener is parked on it right now and since when, and a short line about what it is doing (SPEC.md §7). The composer reads this to offer a recipient, and the board reads it to show who is running.
         *
         *     **The `orchestrator` row is always present** — it exists before anything has been designated and survives the last release — so an empty list is a bug rather than a workspace with no agents.
         *
         *     **A lane's `resident` is null only on that row.** Every other lane exists because a conversation was designated, and since a designation may name no profile (SPEC.md §7) the resident of such a lane is an object whose `name` is null — a *general resident*, designated and lane-owning like any other. A row with a general resident and a row with a profiled one differ in nothing else here: same `lane`, same liveness, same fallback. A client must not print a stand-in name for the null; it is null so that it cannot be confused with, or collide with, a real profile.
         *
         *     **Liveness is observed, never registered.** A lane is live exactly while its listener holds a parked scoped `GET /api/queue/idle`: there is no heartbeat to send, no registration to keep fresh and no state to reap, so an agent that stops parking stops being present whether it exited cleanly, crashed or was killed. A lane that is not live is an ordinary, recoverable state — past the grace window its pending events fall back to the orchestrator's unscoped claim, so the work is done more slowly and never silently not done.
         *
         *     **A read, never a push** (SPEC.md §7). The roster and each lane's liveness arrive over HTTP and are refetched when an `invalidate` frame names `["agents"]`; nothing about them travels over SSE, which carries key names and never data. Read-only; no acting party, and no parameters — there is one roster, and a filtered one would hide the lapsed lanes the recipient picker most needs to show.
         *
         *     **Every row here is derived, so the frame that stales it is often named after something else.** A lane's `summary` is read off the same `events` and `jobs` rows a queue transition or a job-log append writes, and its `origin.title` is the root thread's current title — so those writes name `["agents"]` too, alongside `["queue"]`, `["jobs"]` or `["docs"]`. A client that refetches this only on designation and presence changes will show a stale roster; `GET /events` lists the full set of emitters.
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
                /** @description Every lane, the orchestrator's included. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AgentRoster"];
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
    "/api/queue/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Whether an agent is there, halted state, and per-status event counts
         * @description What the console strip reads (SPEC.md §10): the counts describe the work, and `agent` describes the worker. **`agent` is true exactly while some listener is holding a parked scoped `idle`** — SPEC.md §7's definition of presence, measured here directly rather than read off another endpoint's rows — and it is here so that `idle` can be a claim with evidence behind it rather than the else-branch of the counts. It is the same observation `GET /api/agents` reports per lane, at the workspace's grain: the two normally agree, and `AgentPresence` states the one window in which they legitimately do not. An empty queue means nobody asked for anything; it has never meant somebody is waiting to be asked.
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
                /** @description Agent presence, current queue depth and halt state. */
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
         *
         *     **Parking here is what presence *is*** (SPEC.md §7). A resident is live exactly while it holds a parked scoped `idle` — there is no heartbeat to send and no registration to keep fresh — so `scope` decides both which lane's work this call waits for and which lane `GET /api/agents` reports as live. An agent that stops parking stops being present, and its lane's pending work falls back to the orchestrator's unscoped claim once the grace window has passed.
         *
         *     **Because parking is presence, a `scope` that names no lane is refused** with `422`, before the park is admitted and therefore before it can be observed (SPEC.md §7). A thread id is a thread id on the wire, so this is a refusal only the workspace can make: the value must name a standalone thread that holds a resident. Omitting `scope` is always fine — it means the orchestrator's lane — and a lane whose resident is released *while its listener is parked* keeps that park to its end; what is refused is a value that was never a lane, not one that has stopped being one. `claim-all` deliberately does not refuse it: draining a lapsed lane's already-stamped events is the listener's job, and refusing there would strand them.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Which lane to consume (SPEC.md §7): `orchestrator`, or the id of a designated root thread. **Omitted means `orchestrator`** — the same lane, so a caller written before lanes existed keeps its meaning exactly. A **scoped** call sees only its own lane's events; the orchestrator's call is the unscoped one and **never sees a live lane's events**, so two agents working at once are reading disjoint sets rather than racing for one event. A lane whose listener has been absent longer than the grace window has **lapsed**, and its pending events become visible to the orchestrator's call — the fallback is computed when the call is made and never written into the events, so a resident that comes back finds its lane exactly as it left it. One consumer per lane: a second concurrent claim on one lane is still refused. */
                    scope?: "orchestrator" | string;
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
                /** @description `scope` names no lane, so **nothing was parked and no work was claimed**: this workspace holds no such thread, or that thread holds no resident and is therefore not a lane at all (SPEC.md §7). Recover by omitting `scope` to take the orchestrator's lane, designating a resident on that thread first, or picking a lane from `GET /api/agents`. The body is `unknown_recipient` — the one code for “the value you named is not a lane”, whichever parameter named it — and carries the refused value in `recipient`. Refused rather than silently parked because parking is what presence *is*: a park the server admitted on a non-lane would report an agent listening on a lane the roster does not list, for as long as the loop kept re-parking. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UnknownRecipientError"];
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
         *
         *     **A claim takes a lane** (SPEC.md §7). `scope` names it, and omitting it means the orchestrator's — so a caller written before lanes existed keeps its meaning exactly. A scoped claim sees only its own lane's events; the orchestrator's claim never sees a live lane's events, and picks up a lapsed lane's pending work. Two agents claiming at once are therefore reading disjoint sets rather than racing, and **one consumer per lane** still holds: a second concurrent claim on one lane is refused exactly as a second claim on the whole queue always was.
         */
        post: {
            parameters: {
                query?: {
                    /** @description Which lane to consume (SPEC.md §7): `orchestrator`, or the id of a designated root thread. **Omitted means `orchestrator`** — the same lane, so a caller written before lanes existed keeps its meaning exactly. A **scoped** call sees only its own lane's events; the orchestrator's call is the unscoped one and **never sees a live lane's events**, so two agents working at once are reading disjoint sets rather than racing for one event. A lane whose listener has been absent longer than the grace window has **lapsed**, and its pending events become visible to the orchestrator's call — the fallback is computed when the call is made and never written into the events, so a resident that comes back finds its lane exactly as it left it. One consumer per lane: a second concurrent claim on one lane is still refused. */
                    scope?: "orchestrator" | string;
                };
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
        /**
         * Mark a claimed event processed
         * @description Moves the event from `in-progress/` to `processed/`: the agent reporting that the work it claimed is done (SPEC.md §7).
         *
         *     `409` when the event is not `in-progress`: only claimed work can be completed, because nobody settles work they did not claim — an event still `pending` was never worked on, and one already in a terminal state was settled once already. A repeat is refused too, and says `already`, so a duplicated call learns that the outcome it wanted is the one on record rather than going to look for a fault. `404` when there is no such event.
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
    "/api/queue/{id}/fail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark a claimed event failed
         * @description Moves the event from `in-progress/` to `failed/`: the agent reporting that the work it claimed could not be done (SPEC.md §7). `failed/` is the recoverable half of giving up — `POST /api/jobs/{id}/retry` picks it up again, where `abandoned/` is the end.
         *
         *     `409` when the event is not `in-progress`: only claimed work can be failed, because nobody settles work they did not claim — an event still `pending` was never worked on, and one already in a terminal state was settled once already. A repeat is refused too, and says `already`, so a duplicated call learns that the outcome it wanted is the one on record rather than going to look for a fault. It is also what stops a second `fail` quietly discarding the `reason` it carried, since the first one's annotation was never going to be overwritten. `404` when there is no such event.
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
         *
         *     `409` when the event is `processed` or already `abandoned`: only outstanding work can be abandoned, because there is nothing left to give up on once it is done, and `processed/` → `abandoned/` would rewrite the history the kept file exists to be. This is the one settle that is **not** restricted to claimed work — abandoning is the operator's give-up rather than the agent's report, so `pending`, `in-progress`, `deferred` and `failed` events may all be abandoned, which is what lets the console offer it beside `retry` on a failed job. A repeat says `already`. `404` when there is no such event.
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
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspace/reflect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The reflection clock, what is unreflected, and the quiet window
         * @description What the board bar's Reflect control reads (SPEC.md §7, §10): when the corpus was last reflected on, whether a reflection is pending, **how many documents are unreflected**, the digest thread of the last one, and the configured quiet window.
         *
         *     `changed` is a corpus-wide count and is here so the control is **one request rather than a list**. It counts documents whose `updated` is later than `reflected`, whose `lastActor` is not `agent`, and which are not archived — the same predicate the board applies to mark each row, shipped as this package's `isUnreflected` so the count and the marks cannot disagree.
         *
         *     Read-only; no acting party. Refetch it on the `["reflect"]` invalidate key (`GET /events`).
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
                /** @description The clock, the pending reflection, the unreflected count, the last digest, and the window. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReflectStatus"];
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
         * Ask for a reflection over the whole corpus
         * @description Enqueues a `workspace.reflect` event carrying one timestamp — the corpus's last reflection (SPEC.md §7). The event falls in no scope and takes the orchestrator's lane. This is the board bar's Reflect control and `corpus reflect`; the other way one happens is the server enqueuing it after the quiet window (see `GET /api/workspace/reflect`).
         *
         *     **An ask while one is pending is answered with the pending one, never doubled and never refused.** Ten people pressing Reflect produce one reflection, and the tenth is told so: the response names the event already pending or in progress and sets `pending: true`. That is a `202` rather than a `409` because nothing is wrong — the thing the caller wanted is already going to happen, and no different body would change the answer.
         *
         *     It writes a queue event and no document, so it makes no commit. It still carries the acting party, like every other queue verb (`halt`, `complete`, `fail`): the header records who asked, which is what the job log and the digest thread report.
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
                /** @description The reflection that will run — newly enqueued, or the one already pending. */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReflectAskResult"];
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
    "/api/workspace/reflect/quiet": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the quiet window, or switch the automatic path off
         * @description Writes `reflect.quiet` into the workspace config (SPEC.md §7, rider signed 2026-08-25: *a person may switch the automatic path off where they see it*). This is the board bar's Reflect control; the file remains what a person may edit directly, and the server re-reads it on every use, so nothing has to restart.
         *
         *     **`0` disables the automatic path** and leaves asking as the only way a reflection happens — the Reflect control becomes the only thing that starts one. That is the spelling §7 has always given to *off*, and it is deliberately the only one: there is no separate boolean, because two keys with one effect are two ways to say the same thing.
         *
         *     **It answers the whole `ReflectStatus`**, exactly as `GET` does, so a caller that switches the path off learns in the same round trip what is still pending and how many documents are unreflected. A bare acknowledgement would make every caller read again to find out what it had just done.
         *
         *     `PUT` rather than `PATCH`: one field, wholly replaced, and setting the same value twice is the same state. It writes config and no document, so it makes no commit, and it carries the acting party like every other write.
         */
        put: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path?: never;
                cookie?: never;
            };
            /** @description The quiet window in minutes. `0` disables the automatic path and leaves asking as the only way a reflection happens. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ReflectQuietRequest"];
                };
            };
            responses: {
                /** @description The clock, the pending reflection, the unreflected count, the last digest, and the window as it now stands. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReflectStatus"];
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
        post?: never;
        delete?: never;
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
         * @description Two questions on one route. **Unfiltered** it is the console's master list: one row per queue event with its status and last log line (SPEC.md §7, §10), most recently touched first, and `originId` links each row back to the document or thread it came from. **Filtered by `originId` (and usually `status`)** it is a predicate about a single document — *is the agent still working here?* — which SPEC.md §8's pending row and the board row's agent dot both need. That answer is **complete** — `recent` bounds the console list and is ignored once `originId` is given — because a predicate about one document cannot be allowed to be displaced by unrelated queue activity; that displacement is exactly how a deferred job's "working…" row used to vanish while its reply was still coming (CONTRACT-030). **Either way the response says whether it is complete**: `total` counts everything the query matched and `truncated` says whether `recent` cut it, so a windowed answer can never be mistaken for a whole one (CONTRACT-035). With `originId` given the window is not applied at all, so `truncated` is false and `total` equals the array's length.
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
         * @description Returns the event to `pending/` so the agent picks it up again — the retry action in the console's detail header (SPEC.md §10).
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
         * @description Re-derives every row of `.corpus/cache.db` from the workspace's files alone and swaps the result in atomically, which is what makes §9.1's "derived tables only" checkable rather than merely asserted (SPEC.md §11). The rename is the commit point: an interrupted rebuild leaves the previous database intact. **Takes no request body at all** — there is nothing to configure, and a bodiless `POST` is the whole call. A rebuild of a large corpus is the longest-running call in the API; clients give it a longer timeout than the default. `rebuild` followed by a clean `doctor` is the standing invariant §11 names.
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
         * @description Reports every disagreement between the workspace's files and the projection's rows (SPEC.md §11). Cheap enough for a pre-commit hook: a file whose size and mtime are unchanged is never re-read, and a file that already has a row is never re-parsed. Nothing is mutated and no rebuild is triggered — a drifted projection is reported, never quietly repaired, because the point of the check is that drift is visible. `ok` is the verdict `corpus db doctor` turns into its exit code. Findings that are worth reporting but are not disagreements arrive separately in `warnings`, which never moves `ok`.
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
         * Validate documents against the §11 rules
         * @description Runs the corpus validator and reports what it found, separated into failures and warnings (SPEC.md §11). This is the same validator every server mutation runs before writing — hooks and API share one implementation, which is the whole point of exposing it.
         *
         *     **Two request forms, exactly one per call.** `{ids}` names documents to read from the workspace. `{documents: [{path, content}]}` supplies content that is not on disk — `corpus doc check --staged`, whose bytes come from `git diff --cached`. Sending both keys, or neither, is a `400`: the two forms answer different questions and a request that mixed them would leave the caller guessing which one was honoured. There is deliberately no implicit everything form, so an empty request can never be mistaken for a whole-workspace check; an empty `ids` or `documents` array is legal and returns an empty, `ok` report.
         *
         *     **Cross-document rules see the whole corpus, not just the request.** Duplicate ids, thread parents, anchor claims and `[[refs]]` are judged against the workspace, so checking one file does not report every reference in it as unresolved merely because its target was not submitted.
         *
         *     **Severity is fixed by §11, not by the caller.** Warnings are exactly `anchor-unresolved` (a well-formed anchor whose quote no longer resolves — an orphaned thread, a normal outcome of editing) and `ref-unresolved` (a `[[ref]]` whose target does not exist yet — how a corpus grows). The other twelve codes are errors, `anchor-unused` among them: §11 requires every anchor to belong to an existing thread, so a highlight pointing at no conversation is structural drift. `unterminated-fence` is one too — a fenced code block the body never closes reads as code to the end of the document, so a thread's later turns disappear into the turn before them. `ok` is `errors.length === 0` and is what `corpus doc check` turns into exit 0 or exit 6.
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
         * @description Reports the semantic index's coverage — indexed, pending and failed chunk counts — the recorded provider/model identity, whether a full rebuild is in progress, and the single `state` those facts derive to (SPEC.md §9.1). It is the surface that makes asynchronous indexing honest rather than hidden: indexing never blocks a save, so a backlog is normal, and this is where a person sees it draining. A backlog is **staleness, not drift** — `corpus db doctor` stays clean while indexing is in flight (SPEC.md §11), and the two checks answer different questions on purpose. `state` is the same value, from the same schema, that `GET /api/search` reports as `semanticIndex`. Read-only; no acting party.
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
         *     **The creation lands as a normal auto-commit** (SPEC.md §9.2) and is projected and broadcast like any other write, so the new skill appears on the board and in `GET /api/docs?type=skill` without a restart. If the workspace's git hooks reject the commit, the file stands anyway and the rejection comes back in `warnings` (SPEC.md §11).
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
                /** @description The created skill as an ordinary document — its frontmatter, body and workspace-relative path — plus any §11 warnings. The same shape `POST /api/docs` returns, because what was created is the same kind of thing. */
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
         *     The key vocabulary is **closed** — these 10 shapes and no others. Constants and helpers that build them are published as `QUERY_KEY_VOCABULARY` and friends from `@corpus/contract` and `@corpus/contract/client`, so the emitter and the client bridge share one source rather than two copies that drift.
         *
         *     **An emitter names every key a route carrying the changed fact is cached under, not the key of the route the fact is named after** — so several of these travel in frames named after some other resource, and each entry below says which and why:
         *
         *     - `["docs"]` — emitted by every document or thread mutation (create, update, move, archive, unarchive, delete, thread create, turn append, resolve/reopen, re-attach, mark-seen) and every out-of-band file change the watcher projects — plus every queue transition, since `needs=failed-job` is computed from an event's status and a transition therefore changes what `GET /api/docs?needs=me` answers, and a projection rebuild, which replaces every row the collection is read from. Refetch: `GET /api/docs` — every board column, the search overlay, Attention, and every autocomplete.
         *     - `["docs", "<docId|threadId>"]` — emitted by a mutation of that one document, and a thread mutation for both the thread and its parent. Refetch: `GET /api/docs/{id}` — the open reader for that document.
         *     - `["tree"]` — emitted by anything that changes the folder hierarchy: create, move, delete, archive of a skill — plus a projection rebuild, which names this key whether or not the hierarchy moved, since a rebuild is a resynchronisation instruction rather than a report of a change. Refetch: `GET /api/tree` — the folder-column picker.
         *     - `["threads", "<threadId>"]` — emitted by thread creation, turn append, turn deletion, resolve/reopen, and mark-seen for that thread. Refetch: `GET /api/threads/{id}` — the open thread view and its unread badge.
         *     - `["queue"]` — emitted by every queue transition: enqueue, claim, complete, fail, defer, abandon, reap, halt/resume, and the end of an edit session that re-enters a deferred event — plus every change to agent presence, since the status carries it: a listener parking, its hold ending, and the grace window lapsing — and a projection rebuild, which replaces the rows the counts are read from. **A queue transition names `["agents"]` in the same frame**, because a lane row of the roster is derived from the `events` and `jobs` rows the transition writes: see that key for the rule behind it. Refetch: `GET /api/queue/status` — the console strip's agent pill, depth and halted state.
         *     - `["jobs"]` — emitted by every queue transition, plus any job-log append (coalesced) — over HTTP or out of band — and a projection rebuild, which replaces the rows the list is read from. **A transition and an append each name `["agents"]` in the same frame**, because a lane row of the roster is derived from the same `events` and `jobs` rows: see that key for the rule behind it. Refetch: `GET /api/jobs` — the console's job list.
         *     - `["jobs", "<eventId>"]` — emitted by an append to that job's log — over HTTP or out of band — and its retry/abandon transitions. Refetch: `GET /api/jobs/{id}/log` — the console's live log panel for the selected job.
         *     - `["index"]` — emitted by the embed worker whenever the index's derived state moves: provider adoption, a new disabled or model-download reason, throttled progress while a backlog drains, and the caught-up transition — plus an index rebuild's start and end. Refetch: `GET /api/index/status` — the console strip's index pill.
         *     - `["agents"]` — emitted by designating or releasing a thread's resident, a thread's resolution releasing one with it, and every change to a lane's liveness — a scoped `idle` parking, its hold ending, and a lane lapsing past the grace window — **plus every write that moves a row a lane is derived from**: a queue transition or a job-log append, over HTTP or out of band, since a lane's `summary` is read off the same `events` and `jobs` rows that write touches; a designated root thread being retitled or deleted, since a row carries that conversation's title and its existence; and a projection rebuild, which re-derives all of it. The rule behind that list is worth stating, because no single call site shows it: **a lane row is computed at read time and never stored**, so the roster goes stale on frames named after other resources, and an emitter names this key whenever it writes a row the roster reads — not only when it writes something called an agent. The derivation itself may change without a contract change (`AgentLane.summary` says as much of its own content); the invalidation may not. Refetch: `GET /api/agents` — the composer's recipient picker and every surface showing who is running.
         *     - `["reflect"]` — emitted by **every frame that names `["docs"]` or `["queue"]`, and no others** — the union, because the resource moves on two unrelated things and each half would miss the other: a document mutation or an out-of-band file change moves the unreflected count, while a queue transition moves whether a reflection is pending, when the clock last advanced and which thread is the latest digest. Stating it as a rule rather than as a list is deliberate: an emitter can follow it without knowing what a reflection is, and a write added later inherits it. Refetch: `GET /api/workspace/reflect` — the board bar's Reflect control, its unreflected count and the marks each column renders.
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
             * @description Document type. Core values: note, thread, view, board, template, skill, agent-def. Open rather than enumerated because a workspace may hold a document whose type this build has never heard of — from its own history, or hand-written — and such a document still opens, renders and searches (SPEC.md §5, §12's M6).
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
            /** @description **Where the document sits in a workflow** (SPEC.md §5) — free-form, named by the kanban boards that use it (§10), written comma-free, and filterable with `GET /api/docs?stage=`. `null` when the file carries no `stage` key, which is what puts a document in a kanban's **first column**. **It is not `status`, and neither substitutes for the other**: `status` says whether work remains, `stage` says where in a workflow the document is, and a document in any stage is ordinarily `open`. While a document is in a kanban its stage decides its status — a stage the board's `kanban.status` map names writes that status on entry, a stage with no mapping writes `open`, in the same commit and named in the response — while writing `status` never moves a stage. Two kanbans over the same documents share this one value, so they should share a vocabulary. */
            stage: string | null;
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
            /**
             * @description The acting party of this document's **last write** (SPEC.md §4, projected as `documents.last_actor`, §9.1). Never absent and never null: a document the server has never written reads `user`, and so does an out-of-band edit the watcher picked up, because a change nobody attributed to the agent is a person's. It is not frontmatter and it is not settable — no request carries it. **It is what §7's reflection reads**: a document changed only by the agent since the corpus's last reflection is not marked and not counted, since the changelog entries and the digest a reflection produces are its output rather than new work for it. Pair it with `updated`, `status` and the clock from `GET /api/workspace/reflect` — or call `isUnreflected`, which is the one implementation of that predicate and the same one the server counts `changed` with.
             * @example user
             * @enum {string}
             */
            lastActor: "user" | "agent";
            /** @description Leading plain-text excerpt of the body, for list rows. */
            excerpt: string;
            /** @description **A board's position among boards**, ascending under `sort=order` (SPEC.md §10, rider 7). `null` when the file carries no `order` key — such a board is still placed, by the documented tiebreak (`order` with nulls last, then `title`, then `id`). Any finite number is legal, so a reorder may write midpoints between neighbours instead of renumbering every board. **It is a board's position and nothing else**: a `type: view` document is a saved query with no position of its own, the same view may sit on two boards, and a column's place is its index in that board's `columns`. */
            order: number | null;
            /** @description **A view's query, or a kanban board's scope** (SPEC.md §10): a flat map from `GET /api/docs` parameter names to a value or an array of values — arrays OR together, like the comma-separated wire form (`{type: ["note", "view"]}` ≡ `type=note,view`). On a `type: view` document it is the stored query the column lists; on a kanban board it is the scope every derived stage column is drawn from, narrowed per column by that column's own `stage=` or `status=`. The server stores it and never interprets it: the client compiles it into the collection query and renders it as filter chips, so an unknown key degrades in the client, never on the wire. `null` when the file carries no `query` key. */
            query: {
                [key: string]: string | number | boolean | (string | number | boolean)[];
            } | null;
            /** @description **The columns of a `type: board` document**: the ids of the `type: view` documents that render them, in display order (SPEC.md §10, rider 2). `null` when the file carries no `columns` key — which is every non-board document, and also a **kanban** board, whose columns are derived one per stage from `kanban.stages` and are not view documents at all. Adding, removing or reordering a column edits the board document and never the view, so the same view may sit on two boards without either knowing about the other. */
            columns: string[] | null;
            /** @description **The kanban definition of a `type: board` document** (SPEC.md §10), or `null` when the file carries no `kanban` key — which is every non-board document and every ordinary board, whose columns are the view ids in `columns` instead. A board carries one or the other, never both: a kanban's columns are derived from its stages. */
            kanban: components["schemas"]["Kanban"] | null;
            /** @description True on the one board that **receives every open that names no board** (SPEC.md §10, rider 2 as amended 2026-08-22): the explorer's clicks, and the first load of a browser that remembers no board. `false` when the file carries no `default-open` key. **At most one board carries it** — setting it on one clears the others, in the same commit, and the response names the documents it changed (SPEC.md §9.2) — and when no board carries it the first board in `order` receives those opens instead. The frontmatter key is `default-open`; `defaultOpen` is its wire spelling, and `unset` names the frontmatter one. */
            defaultOpen: boolean;
            /** @description Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat and verbatim — any key the core does not define (SPEC.md §5, §9.1). The server stores and returns these keys and **never interprets them**; meaning belongs to whoever wrote the key, never to this contract. Keys must not name a core frontmatter key (id, type, title, created, updated, tags, status, anchors, due, reviewed, evergreen, origin, parent, anchor, agent, resident, turnModels, stage, order, query, columns, kanban, default-open, defaultOpen) — such a request is rejected with `400`, exact and case-sensitive, so a core field can never be shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) nested at most 8 containers deep, at most 65536 UTF-8 bytes serialized per document; the bounds are enforced at the write boundary. **On update the object is a shallow merge patch** (RFC 7386, applied at the top level): each named key replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte — omit the field to leave every extra key alone, and never read-modify-write the whole object, which would race concurrent writers of other keys. On create, keys are written into the new file's frontmatter and a `null` value is a no-op. **Responses always carry the object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned as `null` and is therefore removed if echoed back through an update. */
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
             * @description Agent participation state (none, requested, engaged, SPEC.md §6, §8) — the `agent=` filter's column. It only ever climbs, and nothing lowers it again, so it says what this thread's history contains and never what the queue is holding now: the pending-agent indicator is `awaitingAgent`, which asks the queue instead. Null on non-threads.
             * @enum {string|null}
             */
            agent: "none" | "requested" | "engaged" | null;
            /** @description The anchored text this thread hangs off, pinned at the top of a thread row (SPEC.md §10). Null on non-threads, on whole-document threads, and on standalone threads. */
            anchorQuote: string | null;
            /** @description Number of turns in the thread. Null on non-threads. */
            turnCount: number | null;
            /**
             * @description Author of the thread's last turn — the `author=` filter's column, and the other half of "awaiting your answer". Null on non-threads and on a thread with no turns.
             * @example user
             * @enum {string|null}
             */
            lastAuthor: "user" | "agent" | null;
            /** @description Plain-text preview of the thread's last turn, for the row's second line (SPEC.md §10). Null on non-threads and on a thread with no turns. */
            lastTurn: string | null;
            /** @description True when the thread's last turn is newer than your last-seen mark (SPEC.md §7) — the unread badge. Null on non-threads. */
            unread: boolean | null;
            /** @description True when the queue still owes this thread something — the pending-agent indicator (SPEC.md §8, §10). **It is a question about the queue, not about the thread**: true exactly when some event in a non-terminal status (`pending`, `in-progress` or `deferred`, SPEC.md §7 — `deferred` included, since a job parked while somebody edits is still owed) carries this thread's id as a top-level value of its payload. The payload is matched by value rather than by a fixed key list (`threadId`, `parentId`, …), the same way the `failed-job` attention reason matches one, so an event type this build has never heard of that names this thread under its own key lights the indicator with no server change (SPEC.md §7). **It reads no thread state, deliberately** — not `agent`, not `status`, not `lastAuthor`. In particular resolving a thread does not clear it, because resolving cancels no queued event: the missing `status` test is the rule here, not an omission. A note-only turn enqueues nothing, so it never sets this. **Not a duplicate of a `GET /api/jobs` scan**, which asks a different question of the same source: separating SPEC.md §8's *working* from *waiting* needs each job's own `status` and `lastLine`, which a boolean cannot carry, and that scan is bounded by one response's worth of unfinished jobs where this column is unwindowed. Null on non-threads. */
            awaitingAgent: boolean | null;
            /** @description How many of **this document's own threads** are currently unread for the user (SPEC.md §7) — the aggregate behind a document row's unread pill. It counts child threads whose last turn is newer than your last-seen mark, which is exactly the comparison the per-thread `unread` flag makes, so the two agree by construction: this equals the item count of `?parent=<id>&type=thread&unread=true`, and a thread marked seen at a `lastSeenTs` before its last turn (a partial read) still counts as unread in both. It rides on every row so a list never issues one such query per row. **`0` on a thread row** — a thread does not aggregate its own child threads here — **and `0` on a document with no threads.** Never null and never absent, so `0` always means "nothing unread" and never "unknown". */
            unreadThreads: number;
            /** @description How many **unanswered forms** this thread still holds (SPEC.md §6, §10) — the number behind Attention's "how many are still open". It counts the thread's agent turns carrying an answerable `form` block that no later turn has answered, which is exactly the set the `form` attention reason tests for the existence of, under the same open-thread guard. **The two agree in both directions**: this is non-zero **iff** `attention` contains `form`. Left to right, a form counted here is a form that existence test finds; right to left, the reason cannot hold with nothing to count — one derivation produces both, so neither can move without the other. The `needs=form` filter tests that same predicate, so a filtered list never disagrees with the rows in it about which threads are waiting (it filters, so the rest of the query — including the default archived exclusion — still applies to which rows are returned at all). **Resolving the thread takes it to `0`** along with the reason: a resolved conversation is not waiting for an answer (SPEC.md §6). **`POST /api/threads/{id}/seen` leaves it untouched** — an unanswered form's row is the one that survives being read (SPEC.md §10), the opposite of `unread` and `unreadThreads`, which being read is precisely what clears. It rides on every row so no list has to fetch each thread to count its forms. **`0` on a thread with no unanswered form, and `0` on every non-thread row** — never null and never absent, so `0` always means "none" and never "unknown". Rendering is the consumer's: §10 asks for the number only when it is greater than one. */
            unansweredForms: number;
            /** @description Attention reasons for this row, populated on every response rather than only under `needs=`, so any list can render reason chips. Empty when nothing applies; never contains `me`, which is the union filter and not a reason. Entries stay bare codes: the one reason with a number to report carries it in the sibling `unansweredForms`, because the server's vocabulary may grow ahead of the client reading it — a client must render a reason code it has never seen — and a bare code is what every consumer of every reason already reads. */
            attention: ("unread-reply" | "form" | "due" | "stale" | "failed-job")[];
            /** @description Search highlights for this row; empty when the query carried no `q`. */
            snippets: components["schemas"]["Snippet"][];
        };
        /** @description A board drawn as a **kanban** over one field (SPEC.md §10): the field, the stages in display order, and optionally the transition graph and the stage-to-status map of §5. Its columns are derived one per stage from the board's `query` scope and are not view documents; a document in scope with no value for the field sits in the first column. A drag follows a transition and nothing else, and anything the graph forbids is still done by setting the field in the document — **the server enforces the status map, never the transitions**. */
        Kanban: {
            /**
             * @description The document field this board's columns are drawn over (SPEC.md §10). `stage` is the free-form workflow position of §5; `status` is the three-value lifecycle. Those are the only two — a kanban over an arbitrary frontmatter key would be a board over a value the server neither filters nor arbitrates.
             * @enum {string}
             */
            field: "status" | "stage";
            /** @description The stages in **display order**, one column each, distinct. The first is where a document in scope with no value for the field sits (SPEC.md §10), which is why a client asks for that column with `stage=,<first>` — the first stage or nothing at all, in one request. **A kanban over `status` may name only the three statuses of §5**, `open`, `resolved`, `archived`, because those are the only values that field holds. */
            stages: string[];
            /** @description For each stage, the stages a **drag** may reach — the board's transition graph (SPEC.md §10). Every key and every value must be one of `stages`, and a stage may not lead to itself. **Omitted means the linear funnel**: each stage leads to its neighbours, both ways. An empty object is not the same thing — it is a graph nothing may be dragged along. A stage the graph does not reach is still reachable by setting the field in the document, from the reader or the CLI: the server enforces the status map, never the transitions. */
            transitions?: {
                [key: string]: string[];
            };
            /** @description **How a stage decides a status** (SPEC.md §5's coupling rule): entering a stage named here writes that status in the same commit, and entering a stage that is not named here writes `open`. Every key must be one of `stages`. The coupling is by this explicit map and never by a stage's name, so a stage called `archived` couples to nothing unless the board says so. Omitted means the board couples no stage at all. */
            status?: {
                [key: string]: "open" | "resolved" | "archived";
            };
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
            /** @description Total rows matching the query, ignoring pagination — and ignoring **only** pagination. Every filter the request carried narrows the count exactly as it narrows the page, so the bound line a list draws is always about the set that list is showing. */
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
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
             *     **Asymmetric on purpose**, because the two writers are: a person's editing is a session the server tracks, while the agent's writing is a sequence of one-shot commands with no session to report. So this never reports the agent, and the person instead sees the agent's writes land live (SPEC.md §9.2). Neither is a lock in the other direction.
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
             * @description Document type. Core values: note, thread, view, board, template, skill, agent-def. Open rather than enumerated because a workspace may hold a document whose type this build has never heard of — from its own history, or hand-written — and such a document still opens, renders and searches (SPEC.md §5, §12's M6).
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
            /** @description **Where the document sits in a workflow** (SPEC.md §5) — free-form, named by the kanban boards that use it (§10), written comma-free, and filterable with `GET /api/docs?stage=`. `null` when the file carries no `stage` key, which is what puts a document in a kanban's **first column**. **It is not `status`, and neither substitutes for the other**: `status` says whether work remains, `stage` says where in a workflow the document is, and a document in any stage is ordinarily `open`. While a document is in a kanban its stage decides its status — a stage the board's `kanban.status` map names writes that status on entry, a stage with no mapping writes `open`, in the same commit and named in the response — while writing `status` never moves a stage. Two kanbans over the same documents share this one value, so they should share a vocabulary. */
            stage: string | null;
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
            /** @description **A board's position among boards**, ascending under `sort=order` (SPEC.md §10, rider 7). `null` when the file carries no `order` key — such a board is still placed, by the documented tiebreak (`order` with nulls last, then `title`, then `id`). Any finite number is legal, so a reorder may write midpoints between neighbours instead of renumbering every board. **It is a board's position and nothing else**: a `type: view` document is a saved query with no position of its own, the same view may sit on two boards, and a column's place is its index in that board's `columns`. */
            order: number | null;
            /** @description **A view's query, or a kanban board's scope** (SPEC.md §10): a flat map from `GET /api/docs` parameter names to a value or an array of values — arrays OR together, like the comma-separated wire form (`{type: ["note", "view"]}` ≡ `type=note,view`). On a `type: view` document it is the stored query the column lists; on a kanban board it is the scope every derived stage column is drawn from, narrowed per column by that column's own `stage=` or `status=`. The server stores it and never interprets it: the client compiles it into the collection query and renders it as filter chips, so an unknown key degrades in the client, never on the wire. `null` when the file carries no `query` key. */
            query: {
                [key: string]: string | number | boolean | (string | number | boolean)[];
            } | null;
            /** @description **The columns of a `type: board` document**: the ids of the `type: view` documents that render them, in display order (SPEC.md §10, rider 2). `null` when the file carries no `columns` key — which is every non-board document, and also a **kanban** board, whose columns are derived one per stage from `kanban.stages` and are not view documents at all. Adding, removing or reordering a column edits the board document and never the view, so the same view may sit on two boards without either knowing about the other. */
            columns: string[] | null;
            /** @description **The kanban definition of a `type: board` document** (SPEC.md §10), or `null` when the file carries no `kanban` key — which is every non-board document and every ordinary board, whose columns are the view ids in `columns` instead. A board carries one or the other, never both: a kanban's columns are derived from its stages. */
            kanban: components["schemas"]["Kanban"] | null;
            /** @description True on the one board that **receives every open that names no board** (SPEC.md §10, rider 2 as amended 2026-08-22): the explorer's clicks, and the first load of a browser that remembers no board. `false` when the file carries no `default-open` key. **At most one board carries it** — setting it on one clears the others, in the same commit, and the response names the documents it changed (SPEC.md §9.2) — and when no board carries it the first board in `order` receives those opens instead. The frontmatter key is `default-open`; `defaultOpen` is its wire spelling, and `unset` names the frontmatter one. */
            defaultOpen: boolean;
            /** @description Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat and verbatim — any key the core does not define (SPEC.md §5, §9.1). The server stores and returns these keys and **never interprets them**; meaning belongs to whoever wrote the key, never to this contract. Keys must not name a core frontmatter key (id, type, title, created, updated, tags, status, anchors, due, reviewed, evergreen, origin, parent, anchor, agent, resident, turnModels, stage, order, query, columns, kanban, default-open, defaultOpen) — such a request is rejected with `400`, exact and case-sensitive, so a core field can never be shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) nested at most 8 containers deep, at most 65536 UTF-8 bytes serialized per document; the bounds are enforced at the write boundary. **On update the object is a shallow merge patch** (RFC 7386, applied at the top level): each named key replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte — omit the field to leave every extra key alone, and never read-modify-write the whole object, which would race concurrent writers of other keys. On create, keys are written into the new file's frontmatter and a `null` value is a no-op. **Responses always carry the object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned as `null` and is therefore removed if echoed back through an update. */
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
             * @description `commit_failed`: the workspace's git hooks rejected the auto-commit, or git itself failed — the write is on disk and uncommitted. `commit_skipped`: **no commit stands for this write**, and nothing refused it — the write is on disk and uncommitted, as it is under `commit_failed`, but no hook and no git command said no. The ordinary causes are a workspace that is not a git repository and no `git` on the server's PATH, and the rarer one is a commit that ran and left no `HEAD`; `detail` names which, and the set is the server's to grow. Silent when a save changed no committed bytes: the pipeline agreeing with itself is not a degraded state. `orphaned_anchor`: an anchor entry is well-formed but its quote no longer resolves in the body, so its thread is detached (SPEC.md §6). `unresolved_ref`: a `[[ref]]` in the body names no document. `validation_error`: this write carried a §11 validation finding of **error** severity and the server wrote the file anyway. It reports what the save **tolerated**, and it re-grades nothing: the finding keeps the code and the severity it was raised under, so `corpus doc check` still fails on the same bytes and still exits 6. A save is refused for what a save can *break*, and a fault the bytes already carry is a different case — refusing it would make the faulty document unwritable and take the repair with it, since the repair is itself a write. Two families are tolerated today: an **unterminated code fence**, which swallows everything after it, a thread's later turns included, and **invalid frontmatter under one of §7's `.claude/` roots**, where the file may be one a hand wrote years before this system read it. The set is the server's, and a client tells one finding from another by reading `detail`, never by this code multiplying. `detail` is `<check-code>: <specifics>` — the finding's own code, then its own prose — rendered verbatim like every other `detail` and parsed by nobody. **One warning per finding, not one per save**: bytes carrying two tolerated findings report two. It is deliberately **not** every error the write path lets through: one cross-document rule (`anchor-unused`) is answered a write behind on the commonest mutation in the product, so reporting it would put a false warning on nearly every anchored comment and teach a reader to skip the channel the fence finding needs them to read. `carried_skill`: this act moved a skill folder, and the move **enabled or disabled a skill document the act did not itself archive or unarchive** — SPEC.md §7 makes a skill's location its enablement, so a nested `SKILL.md` carried along by the folder changes state without being asked. One warning per carried document, naming its id, its path after the move, and which way its enablement went. `carried_reconciliation`: a carried document's **own frontmatter was rewritten** to agree with where it now sits — a stale `status: archived`, left by a previous independent archive of that nested skill, corrected to `resolved` because the folder move landed it back under the enabled root, where frontmatter is what status is read from. `resolved` and not `open`: being swept back to the enabled root **is** being unarchived, implicitly rather than by name, so the carried document is given the state SPEC.md §5's ladder gives the one a caller unarchives outright — one move must not hand two skills two different states. One warning per document reconciled, naming its id, its path and the status it was given. It arises on unarchive only: the archived root reads status from the root itself and never consults the key, so a move in that direction leaves the key exactly as its author wrote it. `stage_status`: this write moved a document's `stage`, the document is **in a kanban**, and the board's `kanban.status` map therefore decided its `status` in the same commit (SPEC.md §5's coupling rule, rider signed 2026-08-22). One warning, naming the stage, the status it wrote and the board that decided — and, when the document is in more than one kanban over `stage`, the boards that did not decide, since "the one with the lowest `order`" is a rule a caller cannot check from the response alone. It is about the document the request named, unlike the carried pair above, and it is here because the caller asked for one field and got two: a `status` a caller neither sent nor was told about is exactly the effect §11 says must not be learned from `git log`. A stage the board maps writes that status; any other stage, a stage the board does not draw included, writes `open` (SPEC.md §5). **It is silent in five cases**, and the last is the common one: when the write moved no stage at all (an autosave re-sending the stored value has moved nothing); when no kanban over `stage` claims the document; when the only board that would claim it is itself **archived**, since a board nobody can see deciding a status is a change with no visible cause; when the document's **root** decides its status rather than its frontmatter — an archived skill is archived because of the folder it sits in (§7), so there is no status here to decide; and when the status the stage decides is the one the write was already going to leave on disk, which is every ordinary move between two stages a board maps the same way. The last is why this is not a warning per drag: it fires when a `status` changed under a caller who asked about `stage`, and not otherwise. `default_open_cleared`: this write set `default-open: true` on a board, and **at most one board carries it** (SPEC.md §10, rider 2), so every other board that carried the flag lost it in the same commit. One warning per board cleared, naming its id and title. Silent when no other board carried it. The last two are silent when there is nothing to say, and so are the carried pair — an act that carried no other skill document emits neither, and a carried document whose frontmatter needed no correction emits `carried_skill` alone. Neither ever describes a document whose **own archive or unarchive landed in this act**: that document is the response's own subject on the single-document routes, or a `changed` entry carrying that verb in a bulk result, and the move is exactly what it asked for. **Being named is not enough** — a staged row that was refused, that was already in the state it asked for, or that carried some other verb (a `tag` on the skill an `archive` in the same Save disabled) is still described here, because nothing in the answer it did get says the act moved its folder.
             * @enum {string}
             */
            code: "commit_failed" | "commit_skipped" | "orphaned_anchor" | "unresolved_ref" | "validation_error" | "carried_skill" | "carried_reconciliation" | "stage_status" | "default_open_cleared";
            /** @description Human-readable specifics — the hook's own output, the offending anchor id, the unresolved ref, the carried document's id and path. Rendered verbatim in the console; never parsed, which is why every distinction a client must act on lives in `code`. */
            detail: string;
        };
        UnknownJobError: {
            /** @enum {string} */
            code: "unknown_job";
            message: string;
            /** @description The id that resolved to no event, or to work already settled. */
            job: string;
        };
        CreateDocRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to **the thread the event itself names** and records that as the created document's `origin`, which is what makes scope membership computable (§7). Not the event's *lane*: §7 keeps the two apart deliberately — the lane routes the work (a summons carries the recipient's), while the origin files it (the conversation the message was posted in). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /**
             * @description Document type. Core values: note, thread, view, board, template, skill, agent-def. Open rather than enumerated because a workspace may hold a document whose type this build has never heard of — from its own history, or hand-written — and such a document still opens, renders and searches (SPEC.md §5, §12's M6).
             * @example note
             */
            type: string;
            /** @description Human-readable title, and the source of the document's filename (`Analyst` → `analyst.md`; a thread is named by its id instead). Under `data/docs/` two documents may share a title — the id is identity and the path is presentation (SPEC.md §5), so the filename dedupes to `analyst-2.md` — and a create there never fails on the title. **In a root where the filename is the name the document answers to it can**: `.claude/agents/analyst.md` is what makes `@analyst` resolve (SPEC.md §8), so deduping would file a second persona at an address nobody asked for and the create is a `400` naming the name already taken. Edit the existing document with `PUT /api/docs/{id}`, or choose a title that names something else. */
            title: string;
            /** @description Omit to pre-fill from the type's `template` document when one exists. */
            body?: string;
            /** @description Folder under `data/docs/`, accepted either as a bare name (`finance`) or as the full prefix (`data/docs/finance`). Defaults to `inbox` — creation is inbox-first (SPEC.md §10), and the agent files inbox arrivals per its skill — **except for a type that SPEC.md §7 gives a document root of its own that takes ordinary markdown documents**, which is where an omitted `folder` files it: a `type: agent-def` document lands in `.claude/agents/`, so creating a persona never requires knowing a path. Such a root may also be named outright, by its exact declared path (`.claude/agents`) — that path itself, never a folder beneath it. It must hold the type being created: a root overrides the type of every file under it, so naming one that holds something else is a `400` rather than a document that is not the one you asked for. A root that does not take an ordinary `*.md` is out of reach for the same reason it is not a default — `.claude/skills` indexes `SKILL.md` files alone, so naming it is a `400` and a `type: skill` create with no folder still lands in `inbox`; a skill is created with `POST /api/skills`. An explicit folder always wins over that default, which is what keeps a document *about* a persona expressible: `type: agent-def` with `folder: "inbox"` still files under `data/docs/`. **What that costs is addressability, and it costs all of it**: a persona is loaded and resolved from `.claude/agents/` alone, so an `agent-def` written anywhere else answers to neither `@<name>` nor `POST /api/threads/{id}/resident`, under its filename stem or its title alike — it is a note about a persona rather than one. **One type is placed by neither rule**: a `type: thread` document is flat at `data/threads/<id>.md`, named by its id (SPEC.md §4), so a `folder` sent with one is still checked but never changes where it lands — and a thread is normally created by `POST /api/threads`. */
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
            /** @description **Where the document sits in a workflow** (SPEC.md §5) — free-form, named by the kanban boards that use it (§10), written comma-free, and filterable with `GET /api/docs?stage=`. `null` when the file carries no `stage` key, which is what puts a document in a kanban's **first column**. **It is not `status`, and neither substitutes for the other**: `status` says whether work remains, `stage` says where in a workflow the document is, and a document in any stage is ordinarily `open`. While a document is in a kanban its stage decides its status — a stage the board's `kanban.status` map names writes that status on entry, a stage with no mapping writes `open`, in the same commit and named in the response — while writing `status` never moves a stage. Two kanbans over the same documents share this one value, so they should share a vocabulary. Null is the same as omitting it: no `stage` key. */
            stage?: string | null;
            /** @description **A board's position among boards**, ascending under `sort=order` (SPEC.md §10, rider 7). `null` when the file carries no `order` key — such a board is still placed, by the documented tiebreak (`order` with nulls last, then `title`, then `id`). Any finite number is legal, so a reorder may write midpoints between neighbours instead of renumbering every board. **It is a board's position and nothing else**: a `type: view` document is a saved query with no position of its own, the same view may sit on two boards, and a column's place is its index in that board's `columns`. Null is the same as omitting it: no `order` key. */
            order?: number | null;
            /** @description **A view's query, or a kanban board's scope** (SPEC.md §10): a flat map from `GET /api/docs` parameter names to a value or an array of values — arrays OR together, like the comma-separated wire form (`{type: ["note", "view"]}` ≡ `type=note,view`). On a `type: view` document it is the stored query the column lists; on a kanban board it is the scope every derived stage column is drawn from, narrowed per column by that column's own `stage=` or `status=`. The server stores it and never interprets it: the client compiles it into the collection query and renders it as filter chips, so an unknown key degrades in the client, never on the wire. `null` when the file carries no `query` key. Null is the same as omitting it: no `query` key. */
            query?: {
                [key: string]: string | number | boolean | (string | number | boolean)[];
            } | null;
            /** @description **The columns of a `type: board` document**: the ids of the `type: view` documents that render them, in display order (SPEC.md §10, rider 2). `null` when the file carries no `columns` key — which is every non-board document, and also a **kanban** board, whose columns are derived one per stage from `kanban.stages` and are not view documents at all. Adding, removing or reordering a column edits the board document and never the view, so the same view may sit on two boards without either knowing about the other. Null is the same as omitting it: no `columns` key. */
            columns?: string[] | null;
            /** @description **The kanban definition of a `type: board` document** (SPEC.md §10), or `null` when the file carries no `kanban` key — which is every non-board document and every ordinary board, whose columns are the view ids in `columns` instead. A board carries one or the other, never both: a kanban's columns are derived from its stages. Null is the same as omitting it: no `kanban` key. */
            kanban?: components["schemas"]["Kanban"] | null;
            /** @description True on the one board that **receives every open that names no board** (SPEC.md §10, rider 2 as amended 2026-08-22): the explorer's clicks, and the first load of a browser that remembers no board. `false` when the file carries no `default-open` key. **At most one board carries it** — setting it on one clears the others, in the same commit, and the response names the documents it changed (SPEC.md §9.2) — and when no board carries it the first board in `order` receives those opens instead. The frontmatter key is `default-open`; `defaultOpen` is its wire spelling, and `unset` names the frontmatter one. Defaults to `false` — creating a board never displaces the one a browser opens onto unless the create says so. */
            defaultOpen?: boolean;
            /** @description Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat and verbatim — any key the core does not define (SPEC.md §5, §9.1). The server stores and returns these keys and **never interprets them**; meaning belongs to whoever wrote the key, never to this contract. Keys must not name a core frontmatter key (id, type, title, created, updated, tags, status, anchors, due, reviewed, evergreen, origin, parent, anchor, agent, resident, turnModels, stage, order, query, columns, kanban, default-open, defaultOpen) — such a request is rejected with `400`, exact and case-sensitive, so a core field can never be shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) nested at most 8 containers deep, at most 65536 UTF-8 bytes serialized per document; the bounds are enforced at the write boundary. **On update the object is a shallow merge patch** (RFC 7386, applied at the top level): each named key replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte — omit the field to leave every extra key alone, and never read-modify-write the whole object, which would race concurrent writers of other keys. On create, keys are written into the new file's frontmatter and a `null` value is a no-op. **Responses always carry the object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned as `null` and is therefore removed if echoed back through an update. */
            extra?: {
                [key: string]: unknown;
            };
        };
        BulkActionResult: {
            /** @description Documents the act changed, each with the verb that changed it — §10's first part. Every one of them has a file in `commit` (§4); the containment runs this way only, since a commit may also carry files for documents the act did not name (§6's anchor cascade reaching a surviving parent, a skill folder move carrying a nested skill — reported in `warnings`, never as an entry here, since these lists partition the requested ids). Empty is a legal outcome: every document was already in the target state, or every one was refused. */
            changed: components["schemas"]["BulkActionOutcome"][];
            /** @description Documents that were **already in that state** — §10's second part, explicitly a no-op and **not a failure**: "a document already archived is a no-op, not a failure". They contribute nothing to the commit, and a board must not colour them as errors. This is also where a row that reached its staged state between staging and saving lands: §10 keeps such a row staged and says it is already done, and this part is what says it. The `review` act populates it only when the instant it would write is the one already there: instants are second-precision, so repeating `review` on the same document inside one second genuinely moves no bytes. Reporting it as changed would put an id in `changed` that `git show --name-only` does not list, and that containment is the stronger, testable invariant (SERVER-077). */
            alreadyInState: components["schemas"]["BulkActionOutcome"][];
            /** @description Documents that **did not change, and why** — §10's third part, listed apart from both others because it is the part worth re-reading. After the act, §10 reduces the staged set to exactly these, so retrying what was refused is one gesture. */
            refused: components["schemas"]["BulkActionRefusal"][];
            /** @description Threads left as **orphaned records** by a `delete`, totalled across every document actually deleted (SPEC.md §9.2 — they keep their `parent` id and stay readable; their anchors no longer resolve). Drop their caches. Empty when the act deleted nothing. §10's confirm needs this count *before* the act, which is a `GET /api/docs?type=thread&parent=<ids>` the caller makes itself — this field is what the act actually did. */
            orphanedThreadIds: string[];
            /** @description The **single** auto-commit this act landed as (SPEC.md §4), authored by the acting party. One sha, never a list, **whatever mix of verbs the act carried**: §4 is explicit that "a Save carrying a mix of verbs is still one act and still one commit", so a server that grouped by verb would have no honest value to put here. Null in three cases, none of them an error — `changed` is empty, so there was nothing to commit and a commit containing nothing is not one; the workspace is not a git repository (`commit_skipped` in `warnings`); or the workspace's hooks rejected the commit, leaving the writes on disk and uncommitted (`commit_failed` in `warnings`, §11). */
            commit: string | null;
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
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
             * @description Which act was applied to **this** document. Carried per document rather than once per request because a Save may hold a mix of verbs (SPEC.md §4, §10: each row carries its own staged action), so the report reads on its own and never has to be paired back to the call that produced it — including for documents a `wholeResultSet` entry covered, which the caller never enumerated. The eight are SPEC.md §10's selection actions except "Ask the agent about these", which changes no document and goes through `POST /api/threads`.
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
             * @description Which act was applied to **this** document. Carried per document rather than once per request because a Save may hold a mix of verbs (SPEC.md §4, §10: each row carries its own staged action), so the report reads on its own and never has to be paired back to the call that produced it — including for documents a `wholeResultSet` entry covered, which the caller never enumerated. The eight are SPEC.md §10's selection actions except "Ask the agent about these", which changes no document and goes through `POST /api/threads`.
             * @example archive
             * @enum {string}
             */
            action: "archive" | "unarchive" | "resolve" | "reopen" | "move" | "tag" | "review" | "delete";
            /**
             * @description Which class of refusal this is. `not-found`: no document has that id; the other documents are not the caller's mistake, so it is an entry here rather than a `404` for the whole request. `not-applicable`: the act does not apply to this document (resolving something that is not a thread) — §10 offers an action only on the rows that can take it, so for an enumerated row this means the corpus changed between staging and saving, and for a `wholeResultSet` entry it is the ordinary case of one act covering a mixed result set. `invalid`: the write would leave the document failing §11 validation, refused with its reason. `write-failed`: the file could not be written; nothing about this document reached the commit.
             * @example not-applicable
             * @enum {string}
             */
            reason: "not-found" | "not-applicable" | "invalid" | "write-failed";
            /** @description Human-readable specifics for this document — which act found nothing to apply, the validator's own finding, the write error. Rendered verbatim beside the document's title; never parsed. Always present: §10 requires every entry in this part to carry its reason, and a class alone does not tell a person what to do next. */
            message: string;
        };
        ForbiddenError: {
            /** @enum {string} */
            code: "forbidden";
            message: string;
        };
        BulkActionRequest: {
            /** @description The individually staged rows — one entry per document, each carrying its own act. **An id may appear at most once**: a row carries exactly one staged action (SPEC.md §10 — re-choosing *replaces* a row's staged action), so a repeat is a caller bug rather than something to resolve. Two entries for one id with **different** acts are refused naming both, because picking one would be a silent choice about someone's documents; two with the same act are refused too, and the message says which id. May be empty **only** when `wholeResultSet` is present — an act on nothing is a caller bug, and a `200` carrying three empty lists would let a broken board look healthy. Deliberately uncapped: a column's query legitimately matches thousands, and a limit the spec does not state would refuse a selection §10 allows the board to offer. */
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
            /** @description The act staged against this one document, discriminated on `action`. **Each row carries its own** (SPEC.md §10): archiving three documents and resolving two is one Save, so a request may hold any mix of verbs and is still one act and one commit (§4). */
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
        /** @description §10's whole-result-set selection, staged as a **single entry** carrying one action for everything the column's query matches rather than for enumerated ids. At most one — the field is singular rather than a member of `entries`, so "at most one" is structural and `delete` is inexpressible. Omit it for an ordinary staged set, which is the common case. The ids it resolves to are not in the request, so the result's three parts are the only place the caller learns them. */
        BulkWholeResultSetEntry: {
            /** @description The column's query, in the same flat parameter map a `type: view` document stores (SPEC.md §10) — `{type: ["note", "view"], tag: "finance"}` ≡ `type=note,view&tag=finance`. The server compiles it into `GET /api/docs` and applies the act to **everything it matches when the Save runs**, re-evaluated then and not before (§10). Unlike a stored view's query an unrecognised key or an unacceptable value is a `400` here rather than a silent degrade: this query decides what gets written. Documents that `entries` names individually are **excluded** — a row someone staged by hand keeps the verb they chose, so no document is ever covered twice and the request needs no precedence rule at write time. */
            query: {
                [key: string]: string | number | boolean | (string | number | boolean)[];
            };
            /** @description The one act carried for everything the query matches. **`delete` is not among them**: §10 forbids deleting a whole-result-set selection, because "all 412 matching" is not a set anyone read before confirming. Rows the act does not apply to come back `refused` with `not-applicable`, exactly as an enumerated row would. */
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
             * @description The resolved base of the range, exclusive — the value used, whether supplied or defaulted. A default is the newest commit before `to` that touched **this document**, never `to`'s parent (a party-scoped commit window makes the parent routinely someone else's save to another file); `EMPTY_TREE_OBJECT_ID` when nothing before `to` ever touched this document. `null` only in the no-history case below, where `to` is null too.
             * @example 9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456
             */
            from: string | null;
            /**
             * @description The resolved head of the range, inclusive. **`null` exactly when the workspace has no committed history for this document** — a file written but not yet committed, or a workspace with no git at all (SPEC.md §11). In that case `from` is null too, `diff` is empty, `stats` are zero and `truncated` is false: an answer, not an error, because a document that has never been committed genuinely has no change to show.
             * @example 9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456
             */
            to: string | null;
            stats: components["schemas"]["DocChangeStats"];
            /** @description The unified diff of this document's file across the range, at most 16000 characters (`DOC_DIFF_MAX_CHARS`). Path-scoped, so commits in the range that touched other documents contribute nothing. Plain text, rendered as-is and never interpreted — a diff of a markdown document contains markdown, and a client that renders it would be rendering the user's document instead of showing the change to it. Empty when nothing changed in the range, which is a legitimate answer. */
            diff: string;
            /** @description `true` when the diff was cut to `DOC_DIFF_MAX_CHARS`. **Whole hunks are kept while they fit, and the hunk that straddles the bound is then cut at a line boundary** (SPEC.md §9.2), so the bound is spent on content rather than on alignment: a change whose body hunk lands just under the cap comes back as that change, not as the `updated:` frontmatter hunk in front of it. The cut is never mid-line and never mid hunk-header, so what is returned is always something a reader can read — **but the last hunk of a truncated diff may be a prefix of itself**, and its header's line counts then describe more lines than follow. Read it, do not apply it: `truncated` is the flag that says which you have. Stated rather than silent (the rule the context pack's own `truncated` sets): an agent acting on half a change while believing it saw all of it is the failure this flag exists to prevent, and `stats` plus `totalChars` say how much is missing. */
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
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
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to **the thread the event itself names** and records that as the created document's `origin`, which is what makes scope membership computable (§7). Not the event's *lane*: §7 keeps the two apart deliberately — the lane routes the work (a summons carries the recipient's), while the origin files it (the conversation the message was posted in). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
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
             *     **Required when this request carries `body`**, which is the write that replaces a block without naming what it changes; a `body` with no key is a `400` naming this field. **Not required by a write that names its own delta** — a tag, a status, `reviewed`, a view or board key, an `unset` — which merges with whatever else happened rather than overwriting it. Sending one anyway is welcome and is **still checked**: presenting a key always means *I am writing against this version*, so a stale one is refused whatever else the request changes. A caller that always sends what it read therefore needs no rule about which fields are which.
             * @example 3b2ec1f04d75a2c6ef2b8b9a1f0c4d3e5a6b7c8d9e0f1a2b3c4d5e6f708192a3
             */
            key?: string;
            title?: string;
            body?: string;
            /** @description Replace the document's tag set with exactly this list. **Prefer `addTags`/`removeTags` when you mean to change one tag**: this field carries the whole set, so it overwrites whatever another writer added between your read and your write. Use it when you genuinely mean *these and no others* — reordering the set, or clearing it with `[]`. */
            tags?: string[];
            /** @description Tags to add, merged **server-side against the file as it stands** (SPEC.md §7's canonical keyless write — a write that names its own delta merges with whatever else happened). Existing order is preserved and additions are appended, so no read is needed first and no concurrent tag can be lost. Adding a tag the document already carries is a no-op, not a failure. Cannot be combined with `tags`, which states the whole set instead. */
            addTags?: string[];
            /** @description Tags to remove, applied server-side against the file as it stands. Removing a tag the document does not carry is a no-op, not a failure. May be sent alongside `addTags`; a tag named in both is removed, exactly as `POST /api/docs/bulk`'s `tag` act resolves it. Cannot be combined with `tags`. */
            removeTags?: string[];
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
            /** @description **Where the document sits in a workflow** (SPEC.md §5) — free-form, named by the kanban boards that use it (§10), written comma-free, and filterable with `GET /api/docs?stage=`. `null` when the file carries no `stage` key, which is what puts a document in a kanban's **first column**. **It is not `status`, and neither substitutes for the other**: `status` says whether work remains, `stage` says where in a workflow the document is, and a document in any stage is ordinarily `open`. While a document is in a kanban its stage decides its status — a stage the board's `kanban.status` map names writes that status on entry, a stage with no mapping writes `open`, in the same commit and named in the response — while writing `status` never moves a stage. Two kanbans over the same documents share this one value, so they should share a vocabulary. On update, `null` clears the key from the file. */
            stage?: string | null;
            /** @description **A board's position among boards**, ascending under `sort=order` (SPEC.md §10, rider 7). `null` when the file carries no `order` key — such a board is still placed, by the documented tiebreak (`order` with nulls last, then `title`, then `id`). Any finite number is legal, so a reorder may write midpoints between neighbours instead of renumbering every board. **It is a board's position and nothing else**: a `type: view` document is a saved query with no position of its own, the same view may sit on two boards, and a column's place is its index in that board's `columns`. On update, `null` clears the key from the file. */
            order?: number | null;
            /** @description **A view's query, or a kanban board's scope** (SPEC.md §10): a flat map from `GET /api/docs` parameter names to a value or an array of values — arrays OR together, like the comma-separated wire form (`{type: ["note", "view"]}` ≡ `type=note,view`). On a `type: view` document it is the stored query the column lists; on a kanban board it is the scope every derived stage column is drawn from, narrowed per column by that column's own `stage=` or `status=`. The server stores it and never interprets it: the client compiles it into the collection query and renders it as filter chips, so an unknown key degrades in the client, never on the wire. `null` when the file carries no `query` key. On update, `null` clears the key from the file. */
            query?: {
                [key: string]: string | number | boolean | (string | number | boolean)[];
            } | null;
            /** @description **The columns of a `type: board` document**: the ids of the `type: view` documents that render them, in display order (SPEC.md §10, rider 2). `null` when the file carries no `columns` key — which is every non-board document, and also a **kanban** board, whose columns are derived one per stage from `kanban.stages` and are not view documents at all. Adding, removing or reordering a column edits the board document and never the view, so the same view may sit on two boards without either knowing about the other. On update, `null` clears the key from the file. */
            columns?: string[] | null;
            /** @description **The kanban definition of a `type: board` document** (SPEC.md §10), or `null` when the file carries no `kanban` key — which is every non-board document and every ordinary board, whose columns are the view ids in `columns` instead. A board carries one or the other, never both: a kanban's columns are derived from its stages. On update, `null` clears the key from the file. */
            kanban?: components["schemas"]["Kanban"] | null;
            /** @description True on the one board that **receives every open that names no board** (SPEC.md §10, rider 2 as amended 2026-08-22): the explorer's clicks, and the first load of a browser that remembers no board. `false` when the file carries no `default-open` key. **At most one board carries it** — setting it on one clears the others, in the same commit, and the response names the documents it changed (SPEC.md §9.2) — and when no board carries it the first board in `order` receives those opens instead. The frontmatter key is `default-open`; `defaultOpen` is its wire spelling, and `unset` names the frontmatter one. Setting it `true` clears the flag from every other board in the same commit, and the response names those documents. */
            defaultOpen?: boolean;
            /** @description Frontmatter keys to **remove** from the file (SPEC.md §9.2) — how a migration (§2.4) drops a key the tool has stopped reading, and what `corpus doc update --unset` sends. Keys are named **exactly as the file writes them**, not as this API spells them: the keys most worth removing are ones the core no longer defines, and those have no wire spelling at all. Where a core key differs, the file's spelling is the one that works — `default-open`, never `defaultOpen`. Removing a key the document does not carry is a no-op rather than a failure, exactly as `removeTags` is. **`id`, `type` and `created` are refused**, with the offending key named: they are the document's identity, its behaviour and its birth. It names its own delta, so it presents no `key`. */
            unset?: string[];
            /** @description Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat and verbatim — any key the core does not define (SPEC.md §5, §9.1). The server stores and returns these keys and **never interprets them**; meaning belongs to whoever wrote the key, never to this contract. Keys must not name a core frontmatter key (id, type, title, created, updated, tags, status, anchors, due, reviewed, evergreen, origin, parent, anchor, agent, resident, turnModels, stage, order, query, columns, kanban, default-open, defaultOpen) — such a request is rejected with `400`, exact and case-sensitive, so a core field can never be shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) nested at most 8 containers deep, at most 65536 UTF-8 bytes serialized per document; the bounds are enforced at the write boundary. **On update the object is a shallow merge patch** (RFC 7386, applied at the top level): each named key replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte — omit the field to leave every extra key alone, and never read-modify-write the whole object, which would race concurrent writers of other keys. On create, keys are written into the new file's frontmatter and a `null` value is a no-op. **Responses always carry the object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned as `null` and is therefore removed if echoed back through an update. */
            extra?: {
                [key: string]: unknown;
            };
        };
        PatchDocResponse: {
            doc: components["schemas"]["Doc"];
            anchors: components["schemas"]["AnchorReconciliation"];
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
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
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to **the thread the event itself names** and records that as the created document's `origin`, which is what makes scope membership computable (§7). Not the event's *lane*: §7 keeps the two apart deliberately — the lane routes the work (a summons carries the recipient's), while the origin files it (the conversation the message was posted in). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        MoveDocRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to **the thread the event itself names** and records that as the created document's `origin`, which is what makes scope membership computable (§7). Not the event's *lane*: §7 keeps the two apart deliberately — the lane routes the work (a summons carries the recipient's), while the origin files it (the conversation the message was posted in). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /** @description Destination folder under `data/docs/`, accepted either as a bare name (`finance`) or as the full prefix (`data/docs/finance`). **Required, and it has no default**: a move names where the document is going. Nothing here is inbox-first — that is creation's rule (`POST /api/docs`, SPEC.md §10), and a document being moved already has a folder. Every destination is under `data/docs/`: a move carries no type, and each document root SPEC.md §7 adds alongside `data/` holds exactly one type, so naming one (`.claude/agents`) is a `400` — filing a document into such a root is part of creating it, not of moving it. The filename does not change, so a destination that already holds a file of that name is a `400` and never an overwrite. **This is the destination alone**: whether the document may be moved at all depends on where it already sits, and `POST /api/docs/{id}/move` states that rule. */
            folder: string;
        };
        JobOnlyRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to **the thread the event itself names** and records that as the created document's `origin`, which is what makes scope membership computable (§7). Not the event's *lane*: §7 keeps the two apart deliberately — the lane routes the work (a summons carries the recipient's), while the origin files it (the conversation the message was posted in). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
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
        RenameFolderResult: {
            /** @description **Every document this act changed**, including ones the request never named individually (SPEC.md §9.2): a folder act is a bulk act, and threads inherit their parent document's folder (§6), so a folder's threads are listed beside its documents. Empty when the folder held nothing. Each row carries the id and the field that changed and nothing else — enough to update a client in place, so no refetch is needed. */
            documents: components["schemas"]["MovedFolderDoc"][];
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        MovedFolderDoc: {
            /**
             * @description Identifier of any document; threads are documents too.
             * @example doc_a1b2c3
             */
            id: string;
            /** @description The document's path after the rename, relative to the workspace root. */
            path: string;
        };
        ConflictError: {
            /** @enum {string} */
            code: "conflict";
            message: string;
        };
        RenameFolderRequest: {
            /**
             * @description The folder to rename, as it stands now. A folder under `data/docs/`, relative to it: `finance`, `finance/mortgage`. No leading or trailing slash, no empty segment, and no segment beginning with a dot — which rules out `.` and `..` and every document root outside this one. The `data/docs/` prefix is refused rather than accepted, so the path can never be ambiguous. A malformed path is `400` naming the reason; a well-formed path this workspace does not hold is `404`.
             * @example finance/mortgage
             */
            from: string;
            /**
             * @description The folder's new path. **Compared exactly**: a rename that differs only in case is a rename, and what a case-insensitive filesystem then does with it is the server's problem, not a different request. `409` when `to` already exists — a rename never merges two folders, because merging is an act nobody asked for and cannot be undone by renaming back. A folder under `data/docs/`, relative to it: `finance`, `finance/mortgage`. No leading or trailing slash, no empty segment, and no segment beginning with a dot — which rules out `.` and `..` and every document root outside this one. The `data/docs/` prefix is refused rather than accepted, so the path can never be ambiguous. A malformed path is `400` naming the reason; a well-formed path this workspace does not hold is `404`.
             * @example finance/mortgage
             */
            to: string;
        };
        FolderStatusResult: {
            /** @description **Every document this act changed**, including ones the request never named individually (SPEC.md §9.2): a folder act is a bulk act, and threads inherit their parent document's folder (§6), so a folder's threads are listed beside its documents. Empty when the folder held nothing. Each row carries the id and the field that changed and nothing else — enough to update a client in place, so no refetch is needed. A status act lists **every** document under the folder with the status it now has, so one the act was refused is listed here too, carrying the status it kept — `refused` is what says why it kept it. */
            documents: components["schemas"]["FolderStatusChange"][];
            /** @description **Every document under the folder the act could not apply to**, each with why (SPEC.md §9.2, §10's bulk rule: an act applies to what it can and reports what it could not, and never refuses the whole set because of one document). Empty in the ordinary case. A document named here **did not change** — nothing about it reached the commit — and the act stands for every other document in the folder. It is listed here whether or not it also appears in `documents`, which each result defines for itself: the two halves together say what the document is now and why it is still that. */
            refused: components["schemas"]["FolderRefusal"][];
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        FolderStatusChange: {
            /**
             * @description Identifier of any document; threads are documents too.
             * @example doc_a1b2c3
             */
            id: string;
            /**
             * @description The document's status after the act.
             * @enum {string}
             */
            status: "open" | "resolved" | "archived";
        };
        FolderRefusal: {
            /**
             * @description The document the act could not apply to.
             * @example doc_a1b2c3
             */
            id: string;
            /** @description Human-readable specifics for this document — the validator's finding, the write error, the reason the file could not be read. Rendered verbatim beside the document; never parsed. Always present: an entry with no reason tells a person nothing to do next. */
            message: string;
        };
        FolderPathRequest: {
            /**
             * @description The folder to act on. A folder under `data/docs/`, relative to it: `finance`, `finance/mortgage`. No leading or trailing slash, no empty segment, and no segment beginning with a dot — which rules out `.` and `..` and every document root outside this one. The `data/docs/` prefix is refused rather than accepted, so the path can never be ambiguous. A malformed path is `400` naming the reason; a well-formed path this workspace does not hold is `404`.
             * @example finance/mortgage
             */
            path: string;
        };
        DeleteFolderResult: {
            /** @description **Every document this act changed**, including ones the request never named individually (SPEC.md §9.2): a folder act is a bulk act, and threads inherit their parent document's folder (§6), so a folder's threads are listed beside its documents. Empty when the folder held nothing. Each row carries the id and the field that changed and nothing else — enough to update a client in place, so no refetch is needed. Deletion reports ids alone, because there is no field left to report: the client drops these rows. A document the delete was refused is **not** here — it still exists — and is in `refused` instead. */
            documents: components["schemas"]["DeletedFolderDoc"][];
            /** @description **Every document under the folder the act could not apply to**, each with why (SPEC.md §9.2, §10's bulk rule: an act applies to what it can and reports what it could not, and never refuses the whole set because of one document). Empty in the ordinary case. A document named here **did not change** — nothing about it reached the commit — and the act stands for every other document in the folder. It is listed here whether or not it also appears in `documents`, which each result defines for itself: the two halves together say what the document is now and why it is still that. */
            refused: components["schemas"]["FolderRefusal"][];
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        DeletedFolderDoc: {
            /**
             * @description Identifier of any document; threads are documents too.
             * @example doc_a1b2c3
             */
            id: string;
        };
        ReorderBoardsResult: {
            /** @description Every board the request named, in the order it asked for, each with the position it now carries and whether this act wrote it. The act is all-or-nothing, so this is the order the corpus holds — never a partial one. */
            boards: components["schemas"]["BoardPosition"][];
            /** @description The **single** auto-commit this reorder landed as (SPEC.md §4), authored by the acting party, containing exactly the board documents whose position changed. One sha, never a list: that is the whole of what rider 2's "in one commit" promises, and it is why this route exists rather than one `PUT` per board. Null in three cases, none of them an error — every board was already at its position, so there was nothing to commit; the workspace is not a git repository (`commit_skipped` in `warnings`); or the workspace's hooks rejected the commit, leaving the writes on disk and uncommitted (`commit_failed` in `warnings`, §11). */
            commit: string | null;
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        /** @description One board and where it sits after the reorder. Every board the request named is here, in the order it asked for, whether or not this act had to write it. */
        BoardPosition: {
            /**
             * @description The board this position is about.
             * @example doc_a1b2c3
             */
            id: string;
            /** @description The position this board **now** carries — its place in the list the request sent, counting from one. Read back from the document rather than predicted, so a caller renders what the corpus holds. */
            order: number;
            /** @description Whether this act wrote the board's file. False for a board already at that position: nothing was written for it and nothing about it is in `commit`. A caller reporting "how many boards moved" counts these, never the length of the list it sent. */
            changed: boolean;
        };
        ReorderBoardsRequest: {
            /** @description **The bar, in the order it should be in** — every board this caller is ordering, by id, first tab first. The positions are derived from the list: the first board is given `1`, the next `2`, and so on in steps of one. A board already sitting at the number it would be given is **not** written, because a write that changes nothing still stamps `updated` and lands a line in the log the agent reads. An id may appear at most once — a board has one position, so a repeat is a caller bug rather than something to resolve. Boards this list does not name are left exactly as they are, which is what lets a bar that hides archived boards state its own order without inventing positions for boards nobody can see. */
            boards: string[];
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        CaptureRequest: {
            /** @description The captured text. Becomes the inbox document's body and its filing thread's first turn. */
            text: string;
            /** @description Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. Omitted: the server requests the agent — filing is the whole point of a capture — unless the text carries its own mention or skill invocation, which routes it instead. `true`: request the agent. `false`: "note only" — suppress the enqueue even when the thread is engaged. */
            requestsAgent?: boolean;
            /** @description The weight this request's work should be done at (SPEC.md §7) — **a directive, not a hint**. The value is a **level's key from the workspace's own agent guidance, verbatim** — the key column of the guidance's tier table, not the label beside it, because the label is prose a person may reword and the key is what survives that (AGENT-015). This contract never enumerates the levels: §7 keeps model tiers in the orchestrate skill, and §2.4 lets a workspace edit that document on its own schedule, so a published enum would reject a workspace's own vocabulary and could only be fixed by a release. The value is therefore validated for **shape only** — non-blank, single line, at most 100 characters — and never for meaning: the server records it and interprets nothing about it. **Honoured, not weighed again**: the work is dispatched at the stated weight rather than at the one the orchestrator would have picked, and is **never silently substituted in either direction** — running stronger than asked spends against an explicit instruction exactly as running weaker falls short of one. When a stated weight **cannot be honoured** (the installed agent does not offer that model, the level no longer exists in the guidance) the work is still done, at what the orchestrator judges best, and the deviation is stated: in the job's log while it runs, and in the reply the request receives. It **rides with the request to whatever does the work** (§10) — onto the queue event this call enqueues, under the payload key `weight`, which is what the dispatch reads. **Omit it to state no weight, which means the orchestrator decides** — its own judgment, unchanged, and never a default level: absence of a choice is the ordinary case, and this field has no default and takes no `null`. An empty string is a `400` rather than a second spelling of silence. A weight is **inert** on a request that enqueues nothing (an explicit `requestsAgent: false`): it is not rejected there — §8 alone decides what reaches the agent, and stating a weight neither asks the agent nor stops it being asked — it simply governs no work. */
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
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
            /** @description The agent resident in this conversation, or null when it has none (SPEC.md §7). **Null means nobody, and never a resident with no profile**: since a designation may name no `agent-def`, a general resident is an object here whose `name` is null — so a designated conversation always carries an object, whatever it was designated with. On a roster row null therefore occurs only on the `orchestrator` lane, which belongs to no conversation; every other lane exists because something was designated. **Standalone threads only** — a thread on a document is *about* that document, and a resident owns a conversation rather than a passage — so this is always null on an anchored or whole-document thread. Single-valued: a thread has one resident or none, and nothing has to arbitrate between two. Designation is **user-only** state, set through `POST /api/threads/{id}/resident` and released through `DELETE`; resolving the thread releases it too, and reopening does not bring it back (§8). */
            resident: components["schemas"]["Resident"] | null;
            /** @description **Whether this thread holds a turn you have not seen** (SPEC.md §7) — `DocRow.unread` for the thread you are reading, the same comparison against the same server-side mark in `.corpus/seen.json`, so the two agree by construction. Required and **never null**: this resource is only ever a thread, so there is no *null on non-threads* case to spell, and `false` means nothing is unseen rather than *unknown*. A thread with no turns reads `false` — there is nothing to have read. A partial read reads `true`, the same as the row and the same as the `unread` the mark itself reported (`MarkSeenResult`). It is here because SPEC.md §10's interlock makes read state an input to a **placement** — a conversation carrying an unseen turn is never collapsed by §6's rule — and a standalone thread has no list row a reader could take the answer from. */
            unread: boolean;
            turns: components["schemas"]["Turn"][];
        };
        Resident: {
            /**
             * @description The **profile** this conversation's agent was designated with, or null when it was designated with none. Null is the ordinary case (SPEC.md §7): a resident with no profile is *a general resident* — an agent working the conversation as the workspace's ordinary agent does — and it is a resident in every other respect, so **null here never means there is nobody**; that is the whole field being null one level up. Where it is a name, it is the invocable name `@<subagent>` mentions use (SPEC.md §8), not a document id, and it is what a person reads. **Do not substitute a word for null and print it as a name** — beside real profile names it would be indistinguishable from one, and could collide with an agent-def titled the same.
             * @example researcher
             */
            name: string | null;
            /**
             * @description The `type: agent-def` document `name` resolves to **right now**, or null when there is none to resolve — either because no profile was named, or because the one that was named has since been renamed, deleted, or moved out of `.claude/agents/`, the root a persona has to live in to be addressable at all. **Archiving a profile does not empty this field**: an archived `agent-def` still under that root resolves exactly as before, and is still designatable, so what stands here is its id and `name (profile missing)` is the wrong thing to show for it. Archived-ness is not carried on a `Resident` at all — it is the document's own `status`, on the document this id names, for the caller that cares. Read the two fields together: `name` null is a general resident, `name` set with this null is a resident whose profile has gone (SPEC.md §7 — the designation stands, and the missing profile is reported rather than silently substituted), and both set is a profile a reader can open. It is re-resolved on every response rather than stored, so what stands here is the document the name answers to now, never a stale id.
             * @example doc_a1b2c3
             */
            docId: string | null;
            /** @description The **weight this resident runs at**, or null (SPEC.md §7, rider signed 2026-08-19: a resident's weight is set when it is designated, not per message). Where set, it is a level's key from the workspace's own agent guidance — the same token a message's `weight` carries, never a model name — recorded verbatim from the designation and interpreted by nothing here. **Null means none was chosen**: the launcher decides what the resident runs at, and says so. Orthogonal to `name` and `docId` — a general resident may run at a stated weight, and a profiled one at none. It governs the resident's own turns; a weight stated on a message still governs what the resident hands off (SPEC.md §7, rider signed 2026-08-19). A designation is long-lived, so a level the launcher cannot meet is not refused here (the table is skill text the server never reads): the launcher reports it, per §7's weight rider, in the listener's first reply. */
            weight: string | null;
            /**
             * @description **Which designation this is** — an opaque id the server mints for the act, not for the agent (SPEC.md §7). It changes **exactly when the designation changes**: a re-designation that names a different profile, or the same profile at a different weight, is a different designation and gets a different id, while one that asks for the state already in force writes nothing, displaces nobody and keeps the id it had.
             *
             *     **It exists to be compared, by the listener the designation launched.** A listener carries the id from the `resident.designated` it was launched with, and the lane's roster row carries the id in force now; where the two differ, the designation it serves has been replaced and a successor is or will be running. That comparison is the only machine-readable way to learn it — a replacement at the same weight leaves the lane present and the row in place, so nothing else on the row moves, and the row's rendered resident cell is written for a person and must never be parsed. What a listener then does is the converse skill's to state, not this contract's.
             *
             *     **Not the id of the `resident.designated` event.** That event announces a designation and one designation may be announced more than once — re-designating is how a person asks for a listener that stopped to be started again, and each such call enqueues an event while the designation stands unchanged. An event id would therefore differ where nothing had been replaced, which is the one wrong answer this field must not give.
             *
             *     **Opaque, and never rendered.** Nothing is encoded in it, two of them have no order, and no surface shows it to a person: equality is the only sound operation. **Null means there is no id to compare** — a designation made before the server recorded this, or a hand-written `resident:` block that omits it — and it is not a value. Two nulls are not evidence of the same designation, so a reader that meets one on either side has no answer and must do what it did before this field existed, rather than concluding that nothing changed.
             * @example des_9f2a1c
             */
            designationId: string | null;
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
            /** @description Display name of the model that wrote this turn (SPEC.md §10) — a **display string, not an enum**: §7 keeps model names in the orchestrator skill, so this contract never enumerates them and a workspace that changes its tiers changes nothing here. **One model, never a list.** Where a request ran in stages at different weights (§7), this names the model of the **deciding** stage — the one that drew the conclusion or wrote the words. It does not accumulate the stages, and a reader must not treat it as the whole account of what ran: the per-stage record is the job's log, for as long as that log lasts. **It is not a weight.** A weight is an instruction stated before the work (§7, honoured and not weighed again); this is a fact about what happened. The two are deliberately separate fields of separate things (CONTRACT-039) and merging them would make §7's guarantee unverifiable. At most 200 characters, non-blank, and on one line: it is persisted as a plain YAML scalar in the thread document's frontmatter. **`null` when no model is named** — a turn a person wrote, or a turn appended before the server recorded this. Null is the honest answer and never a default: an unknown that says so is worth more than a plausible attribution nobody can check. Clients render nothing for it, never a placeholder such as "unknown". */
            model: string | null;
        };
        /** @description The value you named is not a lane: this workspace holds no such thread, or that thread holds no resident and is therefore not a lane at all (SPEC.md §7). **`unknown_recipient` is the one code for that fact whatever named it** — the `recipient` of a post, or the `scope` of a queue park — because the two are one refusal with one remedy: name a lane that exists, or name none. It is spelled for the parameter that first produced it, not for the only one that can; a second code would hand a client two branches for one recovery. Nothing was written or parked, and `recipient` carries the offending value either way. */
        UnknownRecipientError: {
            /** @enum {string} */
            code: "unknown_recipient";
            message: string;
            /** @description The value that named no lane — a thread this workspace does not hold, or one that holds no resident and is therefore not a lane at all. **Whichever parameter carried it**: the `recipient` of a post, or the `scope` of a queue park. The field is spelled `recipient` because the code is; which parameter was at fault is the operation you called. */
            recipient: string;
        };
        CreateThreadRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to **the thread the event itself names** and records that as the created document's `origin`, which is what makes scope membership computable (§7). Not the event's *lane*: §7 keeps the two apart deliberately — the lane routes the work (a summons carries the recipient's), while the origin files it (the conversation the message was posted in). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /** @description Which lane this message is addressed to (SPEC.md §7): `orchestrator`, or the id of a designated root thread. **Omit it for the default**, which is computed from where the message is posted — inside a designated scope it addresses that scope's resident, anywhere else the orchestrator — so absence is the ordinary case and never a guess the caller has to check. Stating one **routes this message and nothing else**: it never rewires a scope, never re-designates anything, and does not persist past the message it was set on. The event this request enqueues is stamped with the named recipient's lane, which is what makes it reach them — an event stamped with the host's lane would be claimable by nobody, since a scoped claim sees only its own lane and an unscoped claim never sees a live lane's events. What the summoned agent writes still belongs to the conversation it was asked in: **routing follows the recipient, filing follows the conversation** (§7), and filing is `job`/`origin`'s job, not this field's. A value naming a thread that is not a designated root — or no thread at all — is a `422`: the composer only offers live lanes, but a pick can go stale between the roster read and the post, and silently routing it somewhere else would answer the person from an agent they did not address. */
            recipient?: "orchestrator" | string;
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
            /** @description Display name of the model that wrote this turn (SPEC.md §10) — a **display string, not an enum**: §7 keeps model names in the orchestrator skill, so this contract never enumerates them and a workspace that changes its tiers changes nothing here. **One model, never a list.** Where a request ran in stages at different weights (§7), this names the model of the **deciding** stage — the one that drew the conclusion or wrote the words. It does not accumulate the stages, and a reader must not treat it as the whole account of what ran: the per-stage record is the job's log, for as long as that log lasts. **It is not a weight.** A weight is an instruction stated before the work (§7, honoured and not weighed again); this is a fact about what happened. The two are deliberately separate fields of separate things (CONTRACT-039) and merging them would make §7's guarantee unverifiable. At most 200 characters, non-blank, and on one line: it is persisted as a plain YAML scalar in the thread document's frontmatter. Omit it when no model wrote the turn. Supplying it on a turn authored by anyone but `agent` (`x-corpus-author`) is a `400`: §10 says a person's turn names no model, and a server that accepted one would be publishing an attribution nobody made. The server records the value verbatim and interprets nothing about it. */
            model?: string;
            /** @description The weight this request's work should be done at (SPEC.md §7) — **a directive, not a hint**. The value is a **level's key from the workspace's own agent guidance, verbatim** — the key column of the guidance's tier table, not the label beside it, because the label is prose a person may reword and the key is what survives that (AGENT-015). This contract never enumerates the levels: §7 keeps model tiers in the orchestrate skill, and §2.4 lets a workspace edit that document on its own schedule, so a published enum would reject a workspace's own vocabulary and could only be fixed by a release. The value is therefore validated for **shape only** — non-blank, single line, at most 100 characters — and never for meaning: the server records it and interprets nothing about it. **Honoured, not weighed again**: the work is dispatched at the stated weight rather than at the one the orchestrator would have picked, and is **never silently substituted in either direction** — running stronger than asked spends against an explicit instruction exactly as running weaker falls short of one. When a stated weight **cannot be honoured** (the installed agent does not offer that model, the level no longer exists in the guidance) the work is still done, at what the orchestrator judges best, and the deviation is stated: in the job's log while it runs, and in the reply the request receives. It **rides with the request to whatever does the work** (§10) — onto the queue event this call enqueues, under the payload key `weight`, which is what the dispatch reads. **Omit it to state no weight, which means the orchestrator decides** — its own judgment, unchanged, and never a default level: absence of a choice is the ordinary case, and this field has no default and takes no `null`. An empty string is a `400` rather than a second spelling of silence. A weight is **inert** on a request that enqueues nothing (an explicit `requestsAgent: false`): it is not rejected there — §8 alone decides what reaches the agent, and stating a weight neither asks the agent nor stops it being asked — it simply governs no work. */
            weight?: string;
            /**
             * @description **Who will own this conversation** (SPEC.md §7, rider signed 2026-08-25). **Three states, and `null` is not the same as omitting this field** — unlike `parent` and `selector` on this same body, where omitted and null mean one thing. **Omit it** for the default: a general resident, because a new standalone thread designates one unless the person chose otherwise. **Send `{name}`** to designate that profile. **Send `null`** for a thread with no resident at all, which belongs to the orchestrator as every thread did before this rider.
             *
             *     **This is not `recipient`, and the two are never collapsed.** Naming a recipient routes **one message** and rewires nothing (SPEC.md §7's summons); designating hands over the conversation **and everything that grows out of it**. Both may be sent on one request, and they mean different things.
             *
             *     **Refused on a thread with a parent.** §7 lets only a standalone thread designate: a thread on a document is *about* that document, and a resident owns a conversation rather than a passage.
             */
            resident?: {
                /**
                 * @description The profile to designate, by the invocable name `@<subagent>` mentions use (SPEC.md §8). Omitted designates a **general resident** — an agent with no persona document, which §7 calls the ordinary case. Resolution and its `404` are exactly the designate route's.
                 * @example researcher
                 */
                name?: string;
                /** @description The model tier this resident works at (SPEC.md §7's rider signed 2026-08-19), the same level-key vocabulary the designate route takes. Omitted leaves it to the launcher. */
                weight?: string;
            } | null;
        };
        MultipartCreateThreadRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to **the thread the event itself names** and records that as the created document's `origin`, which is what makes scope membership computable (§7). Not the event's *lane*: §7 keeps the two apart deliberately — the lane routes the work (a summons carries the recipient's), while the origin files it (the conversation the message was posted in). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /** @description Which lane this message is addressed to (SPEC.md §7): `orchestrator`, or the id of a designated root thread. **Omit it for the default**, which is computed from where the message is posted — inside a designated scope it addresses that scope's resident, anywhere else the orchestrator — so absence is the ordinary case and never a guess the caller has to check. Stating one **routes this message and nothing else**: it never rewires a scope, never re-designates anything, and does not persist past the message it was set on. The event this request enqueues is stamped with the named recipient's lane, which is what makes it reach them — an event stamped with the host's lane would be claimable by nobody, since a scoped claim sees only its own lane and an unscoped claim never sees a live lane's events. What the summoned agent writes still belongs to the conversation it was asked in: **routing follows the recipient, filing follows the conversation** (§7), and filing is `job`/`origin`'s job, not this field's. A value naming a thread that is not a designated root — or no thread at all — is a `422`: the composer only offers live lanes, but a pick can go stale between the roster read and the post, and silently routing it somewhere else would answer the person from an agent they did not address. */
            recipient?: "orchestrator" | string;
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
            /** @description Display name of the model that wrote this turn (SPEC.md §10) — a **display string, not an enum**: §7 keeps model names in the orchestrator skill, so this contract never enumerates them and a workspace that changes its tiers changes nothing here. **One model, never a list.** Where a request ran in stages at different weights (§7), this names the model of the **deciding** stage — the one that drew the conclusion or wrote the words. It does not accumulate the stages, and a reader must not treat it as the whole account of what ran: the per-stage record is the job's log, for as long as that log lasts. **It is not a weight.** A weight is an instruction stated before the work (§7, honoured and not weighed again); this is a fact about what happened. The two are deliberately separate fields of separate things (CONTRACT-039) and merging them would make §7's guarantee unverifiable. At most 200 characters, non-blank, and on one line: it is persisted as a plain YAML scalar in the thread document's frontmatter. Omit it when no model wrote the turn. Supplying it on a turn authored by anyone but `agent` (`x-corpus-author`) is a `400`: §10 says a person's turn names no model, and a server that accepted one would be publishing an attribution nobody made. The server records the value verbatim and interprets nothing about it. */
            model?: string;
            /** @description The weight this request's work should be done at (SPEC.md §7) — **a directive, not a hint**. The value is a **level's key from the workspace's own agent guidance, verbatim** — the key column of the guidance's tier table, not the label beside it, because the label is prose a person may reword and the key is what survives that (AGENT-015). This contract never enumerates the levels: §7 keeps model tiers in the orchestrate skill, and §2.4 lets a workspace edit that document on its own schedule, so a published enum would reject a workspace's own vocabulary and could only be fixed by a release. The value is therefore validated for **shape only** — non-blank, single line, at most 100 characters — and never for meaning: the server records it and interprets nothing about it. **Honoured, not weighed again**: the work is dispatched at the stated weight rather than at the one the orchestrator would have picked, and is **never silently substituted in either direction** — running stronger than asked spends against an explicit instruction exactly as running weaker falls short of one. When a stated weight **cannot be honoured** (the installed agent does not offer that model, the level no longer exists in the guidance) the work is still done, at what the orchestrator judges best, and the deviation is stated: in the job's log while it runs, and in the reply the request receives. It **rides with the request to whatever does the work** (§10) — onto the queue event this call enqueues, under the payload key `weight`, which is what the dispatch reads. **Omit it to state no weight, which means the orchestrator decides** — its own judgment, unchanged, and never a default level: absence of a choice is the ordinary case, and this field has no default and takes no `null`. An empty string is a `400` rather than a second spelling of silence. A weight is **inert** on a request that enqueues nothing (an explicit `requestsAgent: false`): it is not rejected there — §8 alone decides what reaches the agent, and stating a weight neither asks the agent nor stops it being asked — it simply governs no work. */
            weight?: string;
            /** @description Who will own this conversation, as a JSON value encoded into one part (SPEC.md §7's rider signed 2026-08-25). Same three states as the JSON body's `resident`: **omit the part** for the default — a general resident — send `null` for a thread with no resident at all, or send an object such as `{"name":"researcher"}` to designate a profile. **An omitted part and a `null` one mean different things here**, which is why this is one encoded value rather than flat parts: flat parts cannot say *present, and explicitly nobody*. */
            resident?: string;
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
        ThreadScope: {
            /**
             * @description The designated thread this is the scope of — the root, and the name of the lane every member's events are stamped with (SPEC.md §7). It is also `members[0].id`.
             * @example th_x9y8
             */
            thread: string;
            /** @description Every artifact in the scope, capped at 200: the root thread first (`via: "self"`), then every other member most recently updated first, so when the cap bites the page holds the live end of the scope and what falls off is what nothing has touched for longest. **Computed per request by the same walk the queue routes with** (SPEC.md §7: scope is computed, never stored) — what is listed here is exactly what an event posted there would be routed to this lane by, and nothing else. One line per member and never a body. */
            members: components["schemas"]["ScopeMember"][];
            /** @description True when the scope holds more than 200 members and the list was cut. Stated rather than left to be derived, for the reason `DocDiff.truncated` gives: a capped list that looks complete is the failure this flag exists to prevent. **There is no cursor and no total**, deliberately: the bound exists so that a scope cannot be enumerated, and a count would cost the very enumeration it forbids. A caller that needs one particular member reads it by id. */
            truncated: boolean;
        };
        ScopeMember: {
            /**
             * @description The member's id — a `th_` id for a thread, a `doc_` id for a document. Open it with the verb `kind` names.
             * @example doc_a1b2c3
             */
            id: string;
            /**
             * @description `thread` for a conversation (open it with `GET /api/threads/{id}`), `doc` for any other document (`GET /api/docs/{id}`). A thread is a document (SPEC.md §6), so this tells a reader which surface to open and nothing about how the member reached the scope.
             * @enum {string}
             */
            kind: "thread" | "doc";
            /** @description The member's **current** title, read at response time. */
            title: string;
            /**
             * @description The member's own lifecycle status, as its listing row carries it: `open` or `resolved` for a thread, `open`, `resolved` or `archived` for a document. **An archived document is still in scope**: membership is the walk over `origin` and `parent`, which archiving does not touch (SPEC.md §7) — detaching is the escape hatch, not archiving — so it is listed, and this field is what tells a reader it is archived.
             * @enum {string}
             */
            status: "open" | "resolved" | "archived";
            /**
             * @description How this member reaches the scope (SPEC.md §7), as the same walk that routes the queue reports it: `self` — this is the designated thread itself, the scope's root and the lane's name, always the first member; `parent` — a thread whose parent chain reaches the root, directly or through a document in scope (§7's “every thread on such a document”); `origin` — a document whose `origin` reaches the root, i.e. written by a job run from this conversation, including one written before the thread was designated. A member with both edges reports `parent`, because the walk tries a thread's parent chain before its own origin (the ranking `walkScope` documents). It is the edge the walk took, reported rather than re-derived by the reader.
             * @enum {string}
             */
            via: "self" | "parent" | "origin";
        };
        AppendTurnResponse: {
            thread: components["schemas"]["ThreadSummary"];
            turn: components["schemas"]["Turn"];
            /**
             * @description Enqueued `comment.created` event; null when nothing was enqueued. Non-null when `requestsAgent` was true, or when it was omitted and the thread is already engaged; always null when `requestsAgent` was explicitly false ("note only", SPEC.md §8).
             * @example evt_7c1d
             */
            eventId: string | null;
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
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
            /** @description The agent resident in this conversation, or null when it has none (SPEC.md §7). **Null means nobody, and never a resident with no profile**: since a designation may name no `agent-def`, a general resident is an object here whose `name` is null — so a designated conversation always carries an object, whatever it was designated with. On a roster row null therefore occurs only on the `orchestrator` lane, which belongs to no conversation; every other lane exists because something was designated. **Standalone threads only** — a thread on a document is *about* that document, and a resident owns a conversation rather than a passage — so this is always null on an anchored or whole-document thread. Single-valued: a thread has one resident or none, and nothing has to arbitrate between two. Designation is **user-only** state, set through `POST /api/threads/{id}/resident` and released through `DELETE`; resolving the thread releases it too, and reopening does not bring it back (§8). */
            resident: components["schemas"]["Resident"] | null;
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
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to **the thread the event itself names** and records that as the created document's `origin`, which is what makes scope membership computable (§7). Not the event's *lane*: §7 keeps the two apart deliberately — the lane routes the work (a summons carries the recipient's), while the origin files it (the conversation the message was posted in). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /** @description Which lane this message is addressed to (SPEC.md §7): `orchestrator`, or the id of a designated root thread. **Omit it for the default**, which is computed from where the message is posted — inside a designated scope it addresses that scope's resident, anywhere else the orchestrator — so absence is the ordinary case and never a guess the caller has to check. Stating one **routes this message and nothing else**: it never rewires a scope, never re-designates anything, and does not persist past the message it was set on. The event this request enqueues is stamped with the named recipient's lane, which is what makes it reach them — an event stamped with the host's lane would be claimable by nobody, since a scoped claim sees only its own lane and an unscoped claim never sees a live lane's events. What the summoned agent writes still belongs to the conversation it was asked in: **routing follows the recipient, filing follows the conversation** (§7), and filing is `job`/`origin`'s job, not this field's. A value naming a thread that is not a designated root — or no thread at all — is a `422`: the composer only offers live lanes, but a pick can go stale between the roster read and the post, and silently routing it somewhere else would answer the person from an agent they did not address. */
            recipient?: "orchestrator" | string;
            body: string;
            /** @description Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. Omitted: the server enqueues when the thread is already `engaged`, and otherwise only on an explicit mention or skill invocation. `true`: request the agent. `false`: "note only" — suppress the enqueue even when the thread is engaged. */
            requestsAgent?: boolean;
            /** @description Display name of the model that wrote this turn (SPEC.md §10) — a **display string, not an enum**: §7 keeps model names in the orchestrator skill, so this contract never enumerates them and a workspace that changes its tiers changes nothing here. **One model, never a list.** Where a request ran in stages at different weights (§7), this names the model of the **deciding** stage — the one that drew the conclusion or wrote the words. It does not accumulate the stages, and a reader must not treat it as the whole account of what ran: the per-stage record is the job's log, for as long as that log lasts. **It is not a weight.** A weight is an instruction stated before the work (§7, honoured and not weighed again); this is a fact about what happened. The two are deliberately separate fields of separate things (CONTRACT-039) and merging them would make §7's guarantee unverifiable. At most 200 characters, non-blank, and on one line: it is persisted as a plain YAML scalar in the thread document's frontmatter. Omit it when no model wrote the turn. Supplying it on a turn authored by anyone but `agent` (`x-corpus-author`) is a `400`: §10 says a person's turn names no model, and a server that accepted one would be publishing an attribution nobody made. The server records the value verbatim and interprets nothing about it. */
            model?: string;
            /** @description The weight this request's work should be done at (SPEC.md §7) — **a directive, not a hint**. The value is a **level's key from the workspace's own agent guidance, verbatim** — the key column of the guidance's tier table, not the label beside it, because the label is prose a person may reword and the key is what survives that (AGENT-015). This contract never enumerates the levels: §7 keeps model tiers in the orchestrate skill, and §2.4 lets a workspace edit that document on its own schedule, so a published enum would reject a workspace's own vocabulary and could only be fixed by a release. The value is therefore validated for **shape only** — non-blank, single line, at most 100 characters — and never for meaning: the server records it and interprets nothing about it. **Honoured, not weighed again**: the work is dispatched at the stated weight rather than at the one the orchestrator would have picked, and is **never silently substituted in either direction** — running stronger than asked spends against an explicit instruction exactly as running weaker falls short of one. When a stated weight **cannot be honoured** (the installed agent does not offer that model, the level no longer exists in the guidance) the work is still done, at what the orchestrator judges best, and the deviation is stated: in the job's log while it runs, and in the reply the request receives. It **rides with the request to whatever does the work** (§10) — onto the queue event this call enqueues, under the payload key `weight`, which is what the dispatch reads. **Omit it to state no weight, which means the orchestrator decides** — its own judgment, unchanged, and never a default level: absence of a choice is the ordinary case, and this field has no default and takes no `null`. An empty string is a `400` rather than a second spelling of silence. A weight is **inert** on a request that enqueues nothing (an explicit `requestsAgent: false`): it is not rejected there — §8 alone decides what reaches the agent, and stating a weight neither asks the agent nor stops it being asked — it simply governs no work. */
            weight?: string;
        };
        MultipartAppendTurnRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to **the thread the event itself names** and records that as the created document's `origin`, which is what makes scope membership computable (§7). Not the event's *lane*: §7 keeps the two apart deliberately — the lane routes the work (a summons carries the recipient's), while the origin files it (the conversation the message was posted in). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /** @description Which lane this message is addressed to (SPEC.md §7): `orchestrator`, or the id of a designated root thread. **Omit it for the default**, which is computed from where the message is posted — inside a designated scope it addresses that scope's resident, anywhere else the orchestrator — so absence is the ordinary case and never a guess the caller has to check. Stating one **routes this message and nothing else**: it never rewires a scope, never re-designates anything, and does not persist past the message it was set on. The event this request enqueues is stamped with the named recipient's lane, which is what makes it reach them — an event stamped with the host's lane would be claimable by nobody, since a scoped claim sees only its own lane and an unscoped claim never sees a live lane's events. What the summoned agent writes still belongs to the conversation it was asked in: **routing follows the recipient, filing follows the conversation** (§7), and filing is `job`/`origin`'s job, not this field's. A value naming a thread that is not a designated root — or no thread at all — is a `422`: the composer only offers live lanes, but a pick can go stale between the roster read and the post, and silently routing it somewhere else would answer the person from an agent they did not address. */
            recipient?: "orchestrator" | string;
            /** @description Markdown body of the turn. Optional: a turn may be attachment-only. */
            text?: string;
            /** @description Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. Omitted: the server enqueues when the thread is already `engaged`, and otherwise only on an explicit mention or skill invocation. `true`: request the agent. `false`: "note only" — suppress the enqueue even when the thread is engaged. */
            requestsAgent?: boolean;
            /** @description Display name of the model that wrote this turn (SPEC.md §10) — a **display string, not an enum**: §7 keeps model names in the orchestrator skill, so this contract never enumerates them and a workspace that changes its tiers changes nothing here. **One model, never a list.** Where a request ran in stages at different weights (§7), this names the model of the **deciding** stage — the one that drew the conclusion or wrote the words. It does not accumulate the stages, and a reader must not treat it as the whole account of what ran: the per-stage record is the job's log, for as long as that log lasts. **It is not a weight.** A weight is an instruction stated before the work (§7, honoured and not weighed again); this is a fact about what happened. The two are deliberately separate fields of separate things (CONTRACT-039) and merging them would make §7's guarantee unverifiable. At most 200 characters, non-blank, and on one line: it is persisted as a plain YAML scalar in the thread document's frontmatter. Omit it when no model wrote the turn. Supplying it on a turn authored by anyone but `agent` (`x-corpus-author`) is a `400`: §10 says a person's turn names no model, and a server that accepted one would be publishing an attribution nobody made. The server records the value verbatim and interprets nothing about it. */
            model?: string;
            /** @description The weight this request's work should be done at (SPEC.md §7) — **a directive, not a hint**. The value is a **level's key from the workspace's own agent guidance, verbatim** — the key column of the guidance's tier table, not the label beside it, because the label is prose a person may reword and the key is what survives that (AGENT-015). This contract never enumerates the levels: §7 keeps model tiers in the orchestrate skill, and §2.4 lets a workspace edit that document on its own schedule, so a published enum would reject a workspace's own vocabulary and could only be fixed by a release. The value is therefore validated for **shape only** — non-blank, single line, at most 100 characters — and never for meaning: the server records it and interprets nothing about it. **Honoured, not weighed again**: the work is dispatched at the stated weight rather than at the one the orchestrator would have picked, and is **never silently substituted in either direction** — running stronger than asked spends against an explicit instruction exactly as running weaker falls short of one. When a stated weight **cannot be honoured** (the installed agent does not offer that model, the level no longer exists in the guidance) the work is still done, at what the orchestrator judges best, and the deviation is stated: in the job's log while it runs, and in the reply the request receives. It **rides with the request to whatever does the work** (§10) — onto the queue event this call enqueues, under the payload key `weight`, which is what the dispatch reads. **Omit it to state no weight, which means the orchestrator decides** — its own judgment, unchanged, and never a default level: absence of a choice is the ordinary case, and this field has no default and takes no `null`. An empty string is a `400` rather than a second spelling of silence. A weight is **inert** on a request that enqueues nothing (an explicit `requestsAgent: false`): it is not rejected there — §8 alone decides what reaches the agent, and stating a weight neither asks the agent nor stops it being asked — it simply governs no work. */
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
            warnings: components["schemas"]["Warning"][];
        };
        FormAnswerRequest: {
            /**
             * @description The queue event this write is doing the work of (SPEC.md §9.2). The server resolves it to **the thread the event itself names** and records that as the created document's `origin`, which is what makes scope membership computable (§7). Not the event's *lane*: §7 keeps the two apart deliberately — the lane routes the work (a summons carries the recipient's), while the origin files it (the conversation the message was posted in). **Optional everywhere**: a write that names no job records no origin and the document belongs to no conversation — forgetting it costs provenance, never correctness, so nothing is refused and nothing is lost. An id that names no event is a `422` rather than a silent omission: a caller that got the id wrong wanted the attribution, and dropping it quietly would leave it believing it had one.
             * @example evt_a1b2c3d4
             */
            job?: string;
            /** @description Which lane this message is addressed to (SPEC.md §7): `orchestrator`, or the id of a designated root thread. **Omit it for the default**, which is computed from where the message is posted — inside a designated scope it addresses that scope's resident, anywhere else the orchestrator — so absence is the ordinary case and never a guess the caller has to check. Stating one **routes this message and nothing else**: it never rewires a scope, never re-designates anything, and does not persist past the message it was set on. The event this request enqueues is stamped with the named recipient's lane, which is what makes it reach them — an event stamped with the host's lane would be claimable by nobody, since a scoped claim sees only its own lane and an unscoped claim never sees a live lane's events. What the summoned agent writes still belongs to the conversation it was asked in: **routing follows the recipient, filing follows the conversation** (§7), and filing is `job`/`origin`'s job, not this field's. A value naming a thread that is not a designated root — or no thread at all — is a `422`: the composer only offers live lanes, but a pick can go stale between the roster read and the post, and silently routing it somewhere else would answer the person from an agent they did not address. */
            recipient?: "orchestrator" | string;
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed, and a carried effect is not a failure at all but a consequence the caller is owed. **This is a reporting channel and not a severity class**: its members run from `carried_skill`, where nothing went wrong at all, to `commit_failed`, and `validation_error` carries a §11 finding of error severity that the save reported rather than refused (CONTRACT-084). Read `code` to tell them apart, never the position in the array and never `detail`. Empty when nothing went wrong and the act touched nothing beyond what it was asked to do. */
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
        DesignateConflictError: {
            /** @enum {string} */
            code: "conflict";
            message: string;
            /**
             * @description Which refusal this is, and they are opposites. **`has-parent`** — the thread is on a document, so it may never have a resident (SPEC.md §7: a resident owns a conversation rather than a passage). **`draining`** — the thread's released resident left work the orchestrator is still doing, so designating now would hand the same turns to two agents; it clears by itself in seconds. Branch on this rather than on the status: one can never succeed and the other is about to.
             * @enum {string}
             */
            reason: "has-parent" | "draining";
            /** @description **How many of the released resident's events the orchestrator is still working.** At least one under `draining`, and `0` under `has-parent`, where nothing is outstanding and nothing ever will be. A field rather than a number inside `message` for the reason this package keeps everywhere — a client must never parse prose to decide anything — and it is what tells a person whether waiting means a moment or a while. */
            outstanding: number;
        };
        DesignateResidentRequest: {
            /**
             * @description The **profile** to designate, by the invocable name `@<subagent>` mentions already use (SPEC.md §8): for a `type: agent-def` document **under `.claude/agents/`**, its filename stem or its title, matched case-insensitively — and the two routinely differ, since a persona created with the title `Legacy Analyst` is written to `legacy-analyst.md`. **Not a document id, and not an `agent-def` filed outside that root**: one under `data/docs/` is a document *about* a persona, nothing loads it as a subagent, and it answers to neither spelling. A name that resolves to no agent-def in this workspace is a `404` — a typo is refused rather than degraded to a general resident, because a typo that looked like it worked is the worse outcome — and where an off-root `agent-def` is titled the name given, that `404` names its path, because moving the file into `.claude/agents/` is what makes it designatable.
             *
             *     **Omit it — or send no body at all — to designate a general resident**: an agent with no persona document, working the conversation as the workspace's ordinary agent does. That is the ordinary designation and needs nothing to exist in the workspace first (SPEC.md §7). Everything else is identical either way — the lane, the scope, presence, the lapse fallback, release, and resolution releasing it. A **blank** name is not absence: `""` and `"   "` are `400`, because dropping a name by accident is a mistake and asking for no profile is a decision.
             * @example researcher
             */
            name?: string;
            /** @description The **weight the resident runs at** (SPEC.md §7, rider signed 2026-08-19: a resident's weight is set when it is designated, not per message — a running agent cannot change what it is without discarding the conversation it holds, so the designation is the only place the choice exists). The value is a **level's key from the workspace's own agent guidance, verbatim** — the same token a message's `weight` carries, and never a model name: this contract enumerates no levels, because §7 keeps the tiers in the orchestrate skill and a published enum would reject a workspace's own vocabulary. Validated for **shape only** — non-blank, single line, at most 100 characters — and interpreted by nothing here. It governs the resident's own turns; a weight stated on a message still governs what the resident hands off (SPEC.md §7, rider signed 2026-08-19). **Omit it to choose nothing**, which keeps today's behaviour exactly: the resident runs at whatever the launcher starts it as, `Resident.weight` reads null, and the launcher says what it chose. No default, no `null` spelling, and an empty string is a `400` rather than a second way of saying nothing. A level the launcher cannot meet is not refused here — the tier table is skill text the server never reads — and since a designation is long-lived the report lands where §7's weight rider puts it: in the listener's first reply, naming what was asked for and what was done instead. Sent alone, it designates a general resident at that weight; the two fields are independent. */
            weight?: string;
        };
        AgentRoster: {
            /** @description Every lane of the queue. The `orchestrator` row is always present — it exists before anything has been designated and survives the last release — so a caller that finds an empty list has found a bug rather than a workspace with no agents. */
            agents: components["schemas"]["AgentLane"][];
        };
        AgentLane: {
            /** @description This lane's name: `orchestrator`, or the id of a designated root thread. It is the value to send as `scope` on a queue verb, and as `recipient` on a message addressed here. */
            lane: "orchestrator" | string;
            /** @description The agent resident in this conversation, or null when it has none (SPEC.md §7). **Null means nobody, and never a resident with no profile**: since a designation may name no `agent-def`, a general resident is an object here whose `name` is null — so a designated conversation always carries an object, whatever it was designated with. On a roster row null therefore occurs only on the `orchestrator` lane, which belongs to no conversation; every other lane exists because something was designated. **Standalone threads only** — a thread on a document is *about* that document, and a resident owns a conversation rather than a passage — so this is always null on an anchored or whole-document thread. Single-valued: a thread has one resident or none, and nothing has to arbitrate between two. Designation is **user-only** state, set through `POST /api/threads/{id}/resident` and released through `DELETE`; resolving the thread releases it too, and reopening does not bring it back (§8). */
            resident: components["schemas"]["Resident"] | null;
            /** @description **Whether a listener is parked** (SPEC.md §7) — on this lane where this sits on a roster row, on any lane at all where it sits on the queue status. One observation at two grains, and `AgentPresence` names the one window in which the two grains legitimately differ. Presence is the parked scoped `idle` and nothing else: there is no heartbeat, no registration and nothing to reap, so an agent that stops parking stops being present whether it exited cleanly, crashed or was killed. **The grace window is already applied**: a listener between parks is still live, since a healthy one un-parks for a moment every time it re-arms. False is therefore an ordinary, recoverable state and not an error — past that window a lane's pending events fall back to the orchestrator at claim time, so the work is done more slowly and never silently not done. */
            live: boolean;
            /**
             * Format: date-time
             * @description **When a listener was last observed parked**, as an instant — null when none ever has been. It advances every time the listener re-arms, so on a live lane it is never older than the idle timeout, and it stops the moment the listener does: `now − since` is therefore the age of the evidence behind `live`, not the length of a session. An instant rather than an elapsed duration, for the reason `InProgressEvent.heldSince` gives: a duration is stale the moment the response is read and hides which clock produced it, while an instant lets the caller subtract against whichever clock it trusts. Rendering it as `last seen 12m ago` is the caller's job.
             * @example 2026-07-19T10:05:00Z
             */
            since: string | null;
            /** @description **How many events are pending on this lane** (SPEC.md §7, rider signed 2026-08-25). `pending` only — never `in-progress`, which is work already being done rather than work waiting, and never `deferred`, which is waiting on a person's edit session and returns to pending by itself. **A lane with `pending > 0` and `live: false` is a conversation nobody is answering**, and that pair is the whole signal: since the rider there is no fallback, so no other agent will take this work and the only thing that changes it is a listener starting. Neither field means it alone — a lane with no work and no listener is idle and healthy. **Decide from this rather than from `summary`**, which is display-only and says so. `0` where nothing is waiting, never null and never absent. */
            pending: number;
            /**
             * @description **Whether this lane is holding work it claimed** (SPEC.md §7). True while an event stamped for this lane sits in `in-progress/`.
             *
             *     **It is not presence and must never be read as it.** `live` is the parked request; this is held work, and the two come apart in both directions. A resident works its conversation inline and holds no park while it does, so a turn longer than the grace window reads `{live: false, working: true}` — which is the state this field exists for, and the one that tells a busy agent from a dead one. And a listener that died mid-event leaves its event held until `corpus queue reap-stale` requeues it, so `working: true` outlives the agent that earned it: **the field bounds a launch decision and is never evidence anybody is there**.
             *
             *     **The third of three, and the launch decision needs all three.** `live` answers *is anybody there*, `pending` answers *is anybody waiting*, and this answers *is anything being done*. **Decide from this rather than from `summary`**, which renders the same fact as prose and forbids deciding from it.
             */
            working: boolean;
            /** @description A short line about what this lane is doing, or null when there is nothing to say. **The contract promises its bound and nothing about its content**: it is derived server-side, capped at 200 characters and trimmed there, and how it is derived may change without a contract change. So it is for display only — a client must never parse it, key on it, or decide anything from it, and everything a client needs to decide from is a field of its own on this row. */
            summary: string | null;
            /** @description The conversation this lane belongs to — its id and current title — or null for the `orchestrator` lane, which belongs to none. **Not a document's `origin` (SPEC.md §9.2)**: that is the conversation a document was written *from*, while this is the conversation a lane *is*. Where `lane` is a thread id, `origin.id` repeats it — the field is here for the title beside it, so a recipient picker can name the conversation without a second read. */
            origin: components["schemas"]["LaneOrigin"] | null;
        };
        LaneOrigin: {
            /**
             * @description The designated root thread this lane belongs to.
             * @example th_x9y8
             */
            id: string;
            /** @description That thread's title as it now stands, read at response time. */
            title: string;
        };
        QueueStatus: {
            agent: components["schemas"]["AgentPresence"];
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
        /**
         * @description **Whether an agent is there, and the observation behind the answer** (SPEC.md §7, §10). Presence is the parked scoped `idle` and nothing else — nothing is registered, nothing is reaped, and nothing new is asked of the agent, which is why it can be reported without a heartbeat protocol.
         *
         *     Where this sits on `QueueStatus` it measures the workspace **directly**: `live` is true exactly when some listener is holding a parked scoped `idle`, and `since` is the most recent instant among the lanes that are live — or, when none is, the most recent instant any lane has ever supplied, so *last parked 10m ago* stays distinguishable from *none has parked since the server started*. It is defined by the parked request, not by another endpoint's rows.
         *
         *     **It can therefore read `live` while `GET /api/agents` lists no live lane** — briefly, and both answers correct. A roster row exists while a thread has a resident, and releasing that resident (or resolving the thread, which releases it too) removes the row at once. The listener parked on that lane does not go with it: it is still holding an `idle`, and it keeps holding it until it returns or lapses, up to one grace window. Presence is the parked request (SPEC.md §7), so this reports live for that window while the roster, which reports designated lanes, reports none. It resolves itself when that listener stops. A caller that must not watch two numbers disagree should read one of them.
         *
         *     **It says whether an agent is present, never how many are**: one parked agent and two are both `live`, and a count belongs to the roster, which has a row per lane to put it on. Read it rather than deriving idleness from the queue counts beside it — an empty queue means nobody asked for anything, not that somebody is waiting to be asked.
         */
        AgentPresence: {
            /** @description **Whether a listener is parked** (SPEC.md §7) — on this lane where this sits on a roster row, on any lane at all where it sits on the queue status. One observation at two grains, and `AgentPresence` names the one window in which the two grains legitimately differ. Presence is the parked scoped `idle` and nothing else: there is no heartbeat, no registration and nothing to reap, so an agent that stops parking stops being present whether it exited cleanly, crashed or was killed. **The grace window is already applied**: a listener between parks is still live, since a healthy one un-parks for a moment every time it re-arms. False is therefore an ordinary, recoverable state and not an error — past that window a lane's pending events fall back to the orchestrator at claim time, so the work is done more slowly and never silently not done. */
            live: boolean;
            /**
             * Format: date-time
             * @description **When a listener was last observed parked**, as an instant — null when none ever has been. It advances every time the listener re-arms, so on a live lane it is never older than the idle timeout, and it stops the moment the listener does: `now − since` is therefore the age of the evidence behind `live`, not the length of a session. An instant rather than an elapsed duration, for the reason `InProgressEvent.heldSince` gives: a duration is stale the moment the response is read and hides which clock produced it, while an instant lets the caller subtract against whichever clock it trusts. Rendering it as `last seen 12m ago` is the caller's job.
             * @example 2026-07-19T10:05:00Z
             */
            since: string | null;
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
            /** @description Event type. Core values: comment.created, form.respond, doc.edited, resident.designated, resident.released, workspace.reflect, agent.done. Open rather than enumerated because the set on the wire is not the set any one build knows: a queue carried over from an older workspace, an event written into `pending/` by hand, or a server newer than this client can each name a type this client has never heard of (SPEC.md §7). A consumer that does not recognise a type fails the event with the type quoted, and never guesses a handler from the name. */
            type: string;
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            created: string;
            /** @description What produced the event, e.g. `ui` or `cli`. */
            source: string;
            /**
             * @description Type-specific payload; the shape belongs to whatever defines the type, which is why this stays open rather than becoming a union keyed on `type` (SPEC.md §7) — a union would close the same set `type` deliberately leaves open, and make every event this build has not heard of unrepresentable on the wire. The core payloads are declared beside their features: `form.respond` carries `{threadId, formTs, answers, note}`, where `answers` holds one entry per field of the answered form (SPEC.md §6, §7); `doc.edited` carries `{docId, sessionId, actor, endedBy, from, to, stats}` (SPEC.md §4); `resident.designated` carries `{threadId, resident}` and `resident.released` carries `{threadId, resident, reason}` (SPEC.md §7) — one release produces exactly one such event, and a lapse produces none; `workspace.reflect` carries `{since}`, the corpus's last reflection, `null` for one never reflected on (SPEC.md §7).
             *
             *     **One key crosses every type: `weight`.** When the request that enqueued the event stated the weight its work should be done at (SPEC.md §7, §10), that level name rides here verbatim, and the dispatch honours it rather than weighing the work again. It is **absent** when the request stated nothing, which means the orchestrator decides — never a default level, and never `null`. It is deliberately not part of any one payload shape: a weight is a property of *a request that asked for work*, so any event type carries it the same way with no contract change.
             */
            payload: {
                [key: string]: unknown;
            };
        };
        /** @description What the server still thinks the agent is doing (SPEC.md §7) — reported beside a claim as **its own field, never mixed into the claimed events**. The two answer different questions, and an agent that confused them would either redo settled work or settle work it never did. Nothing here was claimed by the call that returned it: these events were already in `in-progress/` when it arrived. The loop reconciles: settle what you have already done with the ordinary verbs, leave what you are still working, and never settle an event you cannot account for. The server reports and settles nothing by itself. */
        InProgressSet: {
            /** @description The held events, most recently claimed first, capped at 20. **Disjoint from the events just claimed** — an event cannot be in both, since a claim moves it out of `pending/` and this list is read from `in-progress/` as it stood beforehand. When the cap bites, the newest are kept: those are the ones this session can still account for, and the ancient ones are `reap-stale`'s job. */
            events: components["schemas"]["InProgressEvent"][];
            /** @description How many events the server holds `in-progress` **in total**, equal to `events.length` whenever `truncated` is false. It is the "and N more" the cap owes the caller: subtract the list's length to get it. For more than 20 of them, ask `GET /api/jobs?status=in-progress`, which pages up to 200 and reports its own `total` and `truncated` — so this cap bounds this report, and the route it points at windows without hiding it. */
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
            /** @description The held event's type — the same open string `QueueEvent.type` and `Job.type` carry, for the same reason: the set on the wire is not the set any one build knows. Core values: comment.created, form.respond, doc.edited, resident.designated, resident.released, workspace.reflect, agent.done. It is half of what makes the row checkable: an agent recognises *what kind of work* it is being told it still owes. */
            type: string;
            /**
             * Format: date-time
             * @description **When the event was claimed**, as an instant — not how long ago that was. An instant is still true after the agent has sat on this response for a turn, and it lets the caller compute the age against whichever clock it trusts instead of inheriting the server's. Rendering it as `held 3h` is the CLI's job (SPEC.md §7).
             * @example 2026-07-19T10:05:00Z
             */
            heldSince: string;
            /**
             * @description Document or thread the held event originated from, or null — **the same field `Job.originId` is, derived by the same rule**: the first of `threadId`, `parentId`, `docId` in the event payload that names a document the corpus still holds. `form.respond` names a thread; an event whose payload names none of the three is what null is for.
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
        ReflectAskResult: {
            /**
             * @description The `workspace.reflect` event that will run — newly enqueued when nothing was pending or in progress, and otherwise the one already there.
             * @example evt_7c1d
             */
            eventId: string;
            /**
             * Format: date-time
             * @description **The window's start**: the `created` time of the corpus's last processed reflection (SPEC.md §7). `null` means a corpus that has never been reflected on, and it means **everything** — the agent's gather runs with no `--since` rather than with an empty window. A failed job leaves the clock where it was, so a retry sees the same window.
             * @example 2026-07-19T10:05:00Z
             */
            since: string | null;
            /** @description **True when this ask enqueued nothing** and `eventId` names a reflection that was already pending or in progress. Ten people pressing Reflect produce one reflection (SPEC.md §7), and the tenth is told so rather than refused: retrying cannot help, and the thing they wanted is already happening. False when this ask is what created the event. */
            pending: boolean;
        };
        ReflectStatus: {
            /**
             * Format: date-time
             * @description **The clock** (SPEC.md §7): the `created` time of the last reflection whose job was processed, held as server state in `.corpus/`. `null` for a corpus never reflected on. A failed job leaves it, so a retry sees the same window.
             * @example 2026-07-19T10:05:00Z
             */
            reflected: string | null;
            /**
             * @description The `workspace.reflect` event currently pending or in progress, or `null` when none is. It is what makes the Reflect control say *reflecting…* rather than offering to ask again, and it is the id `POST /api/workspace/reflect` answers with while it is set.
             * @example evt_7c1d
             */
            pending: string | null;
            /** @description **How many documents are unreflected**: those whose `updated` is later than `reflected`, **whose last write was not the agent's** (`lastActor` is not `agent`, SPEC.md §7 — the changelog entries and digest a reflection produces are its output, not new work for it), and which are **not archived** (an archived document shows on no board, so a mark for it is impossible, and the agent's own gather sees archives at the next reflection with `--include-archived`). With no clock yet, every document meeting the other two conditions counts. It is **the same predicate the UI applies row by row** — the `isUnreflected` this package exports — so the corpus count and the marks on the rows cannot disagree. It rides here rather than being derived by a client because deriving it means listing the whole corpus to produce one number. */
            changed: number;
            /**
             * @description The standalone **digest thread** of the most recent reflection (SPEC.md §7), so "reflected 2h ago" links to what was said. `null` until one exists. A reflection with nothing to say still posts its thread, in one line, so this is null only before the first reflection lands.
             * @example th_x9y8
             */
            lastDigest: string | null;
            /** @description The configured quiet window in **minutes** (`reflect.quiet`, SPEC.md §7; default 30, maximum 10080 — seven days, past which nobody is choosing a cadence). The server enqueues a reflection by itself when something changed after the clock, nothing has changed for this long, and no reflection is pending or running — so ten changes in five minutes are one reflection, this long after the last. **`0` disables the automatic path** and leaves asking as the only way one happens: the Reflect control becomes the only thing that starts one. */
            quiet: number;
        };
        ReflectQuietRequest: {
            /** @description The configured quiet window in **minutes** (`reflect.quiet`, SPEC.md §7; default 30, maximum 10080 — seven days, past which nobody is choosing a cadence). The server enqueues a reflection by itself when something changed after the clock, nothing has changed for this long, and no reflection is pending or running — so ten changes in five minutes are one reflection, this long after the last. **`0` disables the automatic path** and leaves asking as the only way one happens: the Reflect control becomes the only thing that starts one. */
            quiet: number;
        };
        JobList: {
            /** @description Console rows, most recent first. */
            jobs: components["schemas"]["Job"][];
            /** @description **How many jobs matched this query in total**, before `recent` bounded the page — equal to `jobs.length` whenever `truncated` is false. Counted over the same filters the array was selected with, so it answers *how much did I not see* and never *how many jobs exist*. It is the `showing N of M` a windowed list owes its reader, spelled as `InProgressSet.total` spells it. */
            total: number;
            /** @description True when `recent` cut the list — `total` is then greater than `jobs.length`. Stated rather than left to be derived (the rule `DocDiff.truncated` sets and `InProgressSet.truncated` follows): a windowed answer reads exactly like a complete one, and the direction it fails in is silent — a job past the cut is indistinguishable from no job, which reads as *nothing outstanding*. **Always false when `originId` is given**, because that query drops the window and is answered completely (CONTRACT-030; see `recent`). */
            truncated: boolean;
        };
        Job: {
            /**
             * @description Identifier of a queue event.
             * @example evt_7c1d
             */
            eventId: string;
            /** @description The type of the queue event this job is running — the same value as `QueueEvent.type`, read from the projection rather than re-derived. Core values: comment.created, form.respond, doc.edited, resident.designated, resident.released, workspace.reflect, agent.done. Open rather than enumerated for the same reason `QueueEvent.type` is: the set on the wire is not the set any one build knows (SPEC.md §7). The console's collapsed job row reads `<type> · <originTitle>`, so this is what tells the user *what* is running, not just what it is running on (SPEC.md §10). */
            type: string;
            /**
             * @description Mirrors the `.corpus/queue/<status>/` directory the event file currently lives in. `pending` and `in-progress` are the live states; `processed`, `failed` and `abandoned` are terminal. **`deferred` is neither** (SPEC.md §7): the event was claimed and the agent parked it because a person had an edit session open on the document it needs, so it waits — not claimable, not failed — and returns to `pending` automatically when that session ends. Nothing refused it: the agent deferred because it saw, not because it was blocked.
             * @enum {string}
             */
            status: "pending" | "in-progress" | "deferred" | "processed" | "failed" | "abandoned";
            /**
             * @description **Which lane this job's event was stamped with** (SPEC.md §7), read from the projection rather than re-derived. It is the stamp made once at enqueue time and never rewritten, so it is a fact about the event and not a computation over the corpus as it now stands.
             *
             *     **A client cannot work this out, which is why it is here** (CONTRACT-056). Walking the scope from the payload's thread gets the right answer for the ordinary event and the wrong one for exactly the two cases §7 carves out: a `resident.designated`, which takes the **orchestrator's** lane whoever is designated — a resident does not announce itself to itself — and a message that **named a recipient**, which takes that recipient's lane and is not recoverable from the scope at all. The second is the decisive one: the walk cannot be made right, it can only be replaced.
             *
             *     **It is display material, never routing.** The server stamps the lane and claims on it; nothing a client decides changes where an event goes. What this fixes is a surface saying *waiting for researcher* about work the orchestrator is holding, which is a wrong sentence rather than a misdelivered event. An event written before lanes existed reads as the orchestrator's, the same way the claim path reads it — one interpretation of a missing stamp, not two.
             */
            lane: "orchestrator" | string;
            /**
             * Format: date-time
             * @description **When this event entered the queue** (SPEC.md §7) — the `created` instant of the queue event that is this job. Written once and never moved, whatever the job goes on to do. This is what an elapsed-time display counts from: a job that sat `pending` for ten minutes and then began talking has been waited on for ten minutes, and nothing here resets when it starts.
             * @example 2026-07-19T10:05:00Z
             */
            enqueued: string;
            /**
             * Format: date-time
             * @description **When the job first wrote a log line**, and null until it writes one — a job that is `pending`, and one that has been claimed but is still silent, both read null. Written once and never moved: later lines advance `updated`, not this. It is deliberately not the enqueue instant with another name (`enqueued` is that, and it is always known), because a field that means *enqueued* while queued and *first spoke* afterwards silently changes meaning partway through a job's life — which is what CONTRACT-029 was filed about. Null is the honest answer for work that has not been observed yet.
             * @example 2026-07-19T10:05:00Z
             */
            started: string | null;
            /**
             * Format: date-time
             * @description **The most recent log line's instant**, falling back to `enqueued` for a job that has written none. This is what `GET /api/jobs` orders by, most recent first. A `deferred` job stops advancing it while it waits (SPEC.md §7), which is how one falls out of a windowed list — see that route's `recent`.
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
            /** @description Report-only findings that are not drift: things worth a person's attention that the projection is nonetheless correct about. **Never moves `ok` and never changes the exit code** — SPEC.md §11's standing `rebuild && doctor` clean invariant is about drift, and a warning that flipped the verdict would fail a routine check on workspaces where nothing is wrong with the projection. Absent and empty mean the same thing: a server that runs no warning pass omits the key entirely, which is what keeps this field additive for clients generated before it existed. */
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
            /** @description Findings that do not fail the check: orphaned anchors and unresolved `[[refs]]` (§11). Unrelated to the `Warning` shape mutation responses carry for a rejected auto-commit — this route writes nothing and can produce none. */
            warnings: components["schemas"]["CheckFinding"][];
        };
        CheckFinding: {
            /**
             * @description Which §11 rule the finding reports. Warnings are exactly `anchor-unresolved` (an orphaned thread) and `ref-unresolved` (a `[[ref]]` whose target does not exist yet); the other twelve are errors, `anchor-unused` and `unterminated-fence` among them.
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
