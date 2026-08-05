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
         * @description Structured filters compose with optional full-text search: values OR within a comma-separated parameter and AND across parameters. The default result set excludes `status: archived` (SPEC.md §11) unless `status` is passed explicitly. The thread-only filters — `parent`, `agent`, `author` and `unread` — no-op for non-thread types rather than erroring (SPEC.md §9.2). Every row carries its Attention reasons; rows carry search snippets when `q` is set.
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
        /** Read a document with its resolved anchors */
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
                /** @description Frontmatter, body, and this document's anchors. */
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
         * @description Runs anchor reconciliation (SPEC.md §6) in the same save and reports which anchors were remapped and which were orphaned. Refused with `423` when the other party holds the document's edit lock. Every field is optional — a request names only what it changes — so an omitted body is exactly a `{}` body: a save that names no change and rewrites nothing.
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
            /** @description The fields to change; omit the body entirely to change nothing. */
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateDocRequest"];
                };
            };
            responses: {
                /** @description The saved document and the anchor reconciliation report. */
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
                /** @description The document is held by the other party's edit lock; `lock` identifies the holder (SPEC.md §7). */
                423: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LockedError"];
                    };
                };
            };
        };
        post?: never;
        /**
         * Delete a document (user-only)
         * @description **User-only**: a request carrying `x-corpus-author: agent` is rejected with `403` — the agent archives, never deletes (SPEC.md §7). Cascade: the document's threads become **orphaned records** — they keep their `parent` id and stay readable, but their anchors no longer resolve. Nothing is hard-deleted from history; git preserves the file and every version of it. Refused with `423` when the other party holds the document's edit lock.
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
                /** @description The document is held by the other party's edit lock; `lock` identifies the holder (SPEC.md §7). */
                423: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LockedError"];
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
         * @description Rewrites the file path only (SPEC.md §9.2). **The document id never changes**, so every `[[ref]]`, anchor entry and thread `parent` keeps resolving; the projection re-maps id → path. Refused with `423` when the other party holds the document's edit lock.
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
                /** @description The document is held by the other party's edit lock; `lock` identifies the holder (SPEC.md §7). */
                423: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LockedError"];
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
         * @description Flips `status` to `archived` — a reversible organizational act, never a deletion (SPEC.md §7). **The document id never changes** and nothing leaves git. Archived documents drop out of the default result set of `GET /api/docs` and come back with `status=archived`. Archiving a `type: skill` document additionally moves its folder to `.claude/skills-archived/`, which disables it without unindexing it. Refused with `423` when the other party holds the lock.
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
            requestBody?: never;
            responses: {
                /** @description The document, now archived, and any §14 warnings. */
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
                /** @description The document is held by the other party's edit lock; `lock` identifies the holder (SPEC.md §7). */
                423: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LockedError"];
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
         * @description The inverse flip, back to `status: open`. **The document id never changes.** Refused with `423` when the other party holds the document's edit lock.
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
            requestBody?: never;
            responses: {
                /** @description The document, restored, and any §14 warnings. */
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
                /** @description The document is held by the other party's edit lock; `lock` identifies the holder (SPEC.md §7). */
                423: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LockedError"];
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
         * @description Ranked retrieval over documents, threads and turns. `q` is required — a ranked list with nothing to rank is `GET /api/docs`, not a degraded search. The structured filters are the same set with the same semantics as `GET /api/docs`, archived default included, and are declared from the same schema so the two cannot drift; `pinned`, `sort` and `offset` are not among them and are ignored if sent (a ranked set has one order and no pages). Each hit is an **address plus a line of context** — the document id, its title, the heading path of the best-matching passage (for a hit inside a thread turn, that turn's heading), and a one-line snippet — and **never a body**: reading one is a separate, deliberate `GET /api/docs/{id}` on a retrieved id. Phase A ranks lexically (FTS5); from Retrieval Phase B, lexical and semantic relevance combine into one list with this exact response shape, and `semanticIndex` reports when that half is not caught up (SPEC.md §9.1) — the response's one Phase B seam, inert today. Read-only; no acting party.
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
         * @description With a selector, the server writes the anchor entry into the parent's frontmatter and creates the thread file atomically (SPEC.md §6). `423` when the parent is held by the other party's edit lock, since anchoring mutates the parent.
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
                /** @description The document is held by the other party's edit lock; `lock` identifies the holder (SPEC.md §7). */
                423: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LockedError"];
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
         * @description **User-only**: a request carrying `x-corpus-author: agent` is rejected with `403` — the agent never deletes turns (SPEC.md §6). Cascade: deleting a thread's **last** turn deletes the thread itself, and deleting a thread removes its anchor entry from the parent's frontmatter, so no highlight is left pointing at an empty conversation. Git retains the deleted turn. Refused with `423` when the other party holds the parent document's edit lock, since the cascade may rewrite the parent's frontmatter.
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
                /** @description The document is held by the other party's edit lock; `lock` identifies the holder (SPEC.md §7). */
                423: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LockedError"];
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
         * @description Submits an answer to the ```` ```form ```` block in the turn at `{ts}`: the server appends a structured answer turn carrying the chosen option and any note, and enqueues a `form.respond` event that re-triggers the agent like any engaged-thread reply (SPEC.md §6). The thread then leaves `needs=form`.
         *
         *     **The fence grammar**, which this route validates the answer against — settled by CONTRACT-014 as a CommonMark subset: an opening backtick fence at column 0 whose info string is exactly `form` (so ```` ```formula ```` is not one, a tilde fence is not one, and a fence quoted inside an outer fenced block is not one), then YAML with `prompt` (non-empty) and `options` (at least one, each non-empty, all distinct), then a required closing fence — a whole line of at least as many backticks; an unterminated fence is not a form. Selection is single: the answer names exactly one option, verbatim. A `note` is free text and always optional. Nothing else is part of the grammar — no form id, no per-option types, no required markers, no multi-select.
         *
         *     `400` when `option` is not one of the offered options, naming `body.option` in `issues`; `404` when the thread has no such turn, or that turn carries no form.
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
            /** @description The answer. `option` is mandatory — an answer that chooses nothing is not an answer — so the body is too. */
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
         * Atomically claim every pending event
         * @description Moves all `pending/*` events to `in-progress/` in one call and returns them as a batch; concurrent claims never hand the same event to two callers. Returns an empty batch while halted (SPEC.md §7).
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
                /** @description The claimed events; empty while halted or when nothing is pending. */
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
         * Defer a claimed event onto a document's lock
         * @description Moves a claimed event to `deferred/` — waiting, not failed (SPEC.md §7). The agent calls it when the work it claimed needs a document the **user** holds the edit lock on: it replies to the waiting thread, defers the event, and moves on.
         *
         *     **The event comes back on its own.** Releasing, force-breaking or reaping the lock on `blockedOn` returns it to `pending`, and `corpus queue idle` unparks — no retry call, no operator. Until then it is not claimable: `claim-all` skips deferred events, because handing back work whose lock is still held would spin the agent against it.
         *
         *     **Nothing is ever silently dropped** (SPEC.md §7). A deferral whose lock is never released stays on disk, stays visible in the queue counts and the console, survives a restart, and stays retryable by hand through `POST /api/jobs/{id}/retry` — which is what §7's force-break bullet promises, now as the manual override rather than the only path.
         *
         *     `409` when the event is not `in-progress`: only claimed work can be deferred, since nothing else has tried the edit yet, exactly as only a finished job can be retried. `404` when there is no such event.
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
    "/api/locks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List active locks
         * @description Read on load so lock banners are correct before the first SSE frame arrives; lock state is projected and broadcast like any other state (SPEC.md §7).
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
                /** @description Every lock currently held. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LockList"];
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
    "/api/locks/reap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Clear expired locks
         * @description Clears every lock past its TTL, so a crashed editor cannot wedge a document — the same pattern as `POST /api/queue/reap-stale` (SPEC.md §7).
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
                /** @description The documents whose expired locks were cleared. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LockReapResult"];
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
    "/api/locks/{docId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Acquire a document's edit lock
         * @description One holder at a time. The agent takes the lock before editing (the CLI's edit verbs do this implicitly) and the user's editor session holds it while actively editing (SPEC.md §7). Re-acquiring a lock you already hold renews its lease; a lock held by the other party is a `409` carrying that lock. The body is optional in full: a bare `POST` takes the lock for the default lease, and `ttl`, when given, sets a different one.
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
                    docId: string;
                };
                cookie?: never;
            };
            /** @description Optional lease override; omit the body entirely to take the default lease. */
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["AcquireLockRequest"];
                };
            };
            responses: {
                /** @description The lock, now held by the acting party. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Lock"];
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
                /** @description Another party already holds this document's lock; `lock` identifies the holder (SPEC.md §7). */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LockConflictError"];
                    };
                };
            };
        };
        /**
         * Release a document's edit lock
         * @description Only the holder may release: a request whose `x-corpus-author` is not the holder is rejected with `403`. To clear somebody else's lock, break it.
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
                    docId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The lock is gone. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReleaseLockResult"];
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
    "/api/locks/{docId}/break": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Force-unlock a document (user-only)
         * @description The human escape hatch for a stuck agent lock — the banner's Force unlock button and `corpus lock break <docId>` (SPEC.md §7). **User-only**: a request carrying `x-corpus-author: agent` is rejected with `403`, because an agent breaking its own contention would defeat the mechanism. Breaks are recorded in the audit trail commit message, and the agent's deferred edit re-enters the queue rather than being lost.
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
                    docId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The lock is broken; `holder` names who held it. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReleaseLockResult"];
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
    "/api/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Recent jobs for the console
         * @description The console's master list: one row per queue event with its status and last log line (SPEC.md §7, §11). `originId` links each row back to the document or thread it came from.
         */
        get: {
            parameters: {
                query?: {
                    /** @description How many of the most recent jobs to return (1–200). */
                    recent?: number;
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
         *     It works on a **deferred** job too, and stays the manual override once deferrals re-enter on their own (SPEC.md §7, CONTRACT-021): automatic re-entry handles the lock being released, broken or reaped, and this handles everything it did not reach — a lock released out of band, or a deferral an operator simply wants back now.
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
         *     **Severity is fixed by §14, not by the caller.** Warnings are exactly `anchor-unresolved` (a well-formed anchor whose quote no longer resolves — an orphaned thread, a normal outcome of editing) and `ref-unresolved` (a `[[ref]]` whose target does not exist yet — how a corpus grows). The other eleven codes are errors, `anchor-unused` among them: §14 requires every anchor to belong to an existing thread, so a highlight pointing at no conversation is structural drift. `ok` is `errors.length === 0` and is what `corpus doc check` turns into exit 0 or exit 6.
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
         *     **The skill is named in the body rather than in the path** because the path names a resource that does not exist yet; this is `POST /api/docs`'s convention, not a departure from the rollback route's. The name doubles as the traversal guard: it is validated against the same pattern the rollback path parameter uses, which admits no `/`, `.` or whitespace, so a traversal attempt is a `400` naming `body.name` and never reaches the filesystem.
         *
         *     **The creation lands as a normal auto-commit** (SPEC.md §9.2) and is projected and broadcast like any other write, so the new skill appears on the board and in `GET /api/docs?type=skill` without a restart. If the workspace's git hooks reject the commit, the file stands anyway and the rejection comes back in `warnings` (SPEC.md §14).
         *
         *     `409` means the name is taken — a skill of that name is already installed. Whether a name held only by an *archived* skill (`.claude/skills-archived/{name}/`, where `corpus doc archive` moves one) is likewise taken is answered by the server, and both answers are already describable here: refusing it is this same `409`, allowing it is a plain `201`.
         *
         *     There is no `423`: an edit lock is held on a document, and this call's document does not exist until the call succeeds, so nothing can be holding it. A name that is already taken is a conflict, not a lock — and editing the skill afterwards goes through `PUT /api/docs/{id}`, which does refuse under the other party's lock.
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
    "/api/skills/{name}/rollback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Restore a skill's last-known-good version
         * @description Restores `.claude/skills/{name}/SKILL.md` from git and commits the restoration — the targeted revert SPEC.md §7 names as the loop-safety escape hatch. Skills are ordinary documents and are edited like ordinary documents, so a bad edit to a core-loop skill (`orchestrate`, `comment`) can break the very loop that would otherwise fix it; this is the operator's way back, and the orchestrate skill documents it.
         *
         *     **The body is optional in full.** A bare `POST` restores the last-known-good version — the newest committed revision of the file that validates. `to` overrides that with any revision git resolves, for stepping further back.
         *
         *     **The restoration lands as a normal auto-commit**, authored by `x-corpus-author` like every other mutation (§9.2), so `git log` remains the complete audit trail and the projection and SSE stream follow as they do for any write. `commit` in the response is that new commit, not the revision the content came from; `path` is the file it rewrote; `docId` is the skill document's id, which a rollback never changes (ids are immutable, §5). If the workspace's git hooks reject the commit, the file is restored anyway, `commit` is `null` and the rejection comes back in `warnings` (§14).
         *
         *     `404` means no skill of that name is installed — there is no `.claude/skills/{name}/` directory. A skill that was archived (`corpus doc archive` moves it to `.claude/skills-archived/`) is likewise not installed, so rolling it back is a `404`: unarchive it first.
         *
         *     A skill is an ordinary document, and this is an ordinary document write path: refused with `423` when the other party holds the document's edit lock.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description Acting party, and therefore the git author of the auto-commit. Defaults to "user" when absent. */
                    "x-corpus-author"?: "user" | "agent";
                };
                path: {
                    /** @description The skill's name, which is its directory name under `.claude/skills/` and the `name` in its frontmatter. Lowercase letters, digits and single hyphens, at most 64 characters — it becomes a directory name, and no real skill name comes close to the bound. */
                    name: string;
                };
                cookie?: never;
            };
            /** @description Optional revision override; omit the body entirely to restore the last-known-good version. */
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["SkillRollbackRequest"];
                };
            };
            responses: {
                /** @description The skill is restored; `commit` is the auto-commit that restored it, or `null` when that commit failed or was skipped and the restoration stands uncommitted. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SkillRollbackResult"];
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
                /** @description The document is held by the other party's edit lock; `lock` identifies the holder (SPEC.md §7). */
                423: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LockedError"];
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
         *     - `["docs"]` — emitted by every document or thread mutation (create, update, move, archive, unarchive, delete, thread create, turn append, resolve/reopen, mark-seen) and every out-of-band file change the watcher projects. Refetch: `GET /api/docs` — every board column, the search overlay, Attention, and every autocomplete.
         *     - `["docs", "<docId|threadId>"]` — emitted by a mutation of that one document, and a thread mutation for both the thread and its parent. Refetch: `GET /api/docs/{id}` — the open reader for that document.
         *     - `["tree"]` — emitted by anything that changes the folder hierarchy: create, move, delete, archive of a skill. Refetch: `GET /api/tree` — the folder-column picker.
         *     - `["threads", "<threadId>"]` — emitted by thread creation, turn append, turn deletion, resolve/reopen, and mark-seen for that thread. Refetch: `GET /api/threads/{id}` — the open thread view and its unread badge.
         *     - `["queue"]` — emitted by every queue transition: enqueue, claim, complete, fail, defer, abandon, reap, halt/resume, and any lock release, break or reap that re-enters a deferred event. Refetch: `GET /api/queue/status` — the console strip's depth and halted state.
         *     - `["jobs"]` — emitted by every queue transition, plus any job-log append (coalesced). Refetch: `GET /api/jobs` — the console's job list.
         *     - `["jobs", "<eventId>"]` — emitted by an append to that job's log — over HTTP or out of band — and its retry/abandon transitions. Refetch: `GET /api/jobs/{id}/log` — the console's live log panel for the selected job.
         *     - `["locks"]` — emitted by lock acquire, release, force-break and reap. Refetch: `GET /api/locks` — the console's held-locks list.
         *     - `["locks", "<docId>"]` — emitted by acquire, release, force-break and reap of that one document's lock. Refetch: the open reader for that document, which renders read-only with a holder banner while held.
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
            /** @description Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat and verbatim (SPEC.md §5 — plugins add fields under their own keys; §12 — e.g. a `todo` document's `items`). The server stores and returns these keys and **never interprets them**; meaning belongs to the key's owner (a plugin's own schema), never to this contract. Keys must not name a core frontmatter key (id, type, title, created, updated, tags, status, anchors, due, reviewed, evergreen, parent, anchor, agent, pinned, order, query, column) — such a request is rejected with `400`, exact and case-sensitive, so a core field can never be shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) nested at most 8 containers deep, at most 65536 UTF-8 bytes serialized per document; the bounds are enforced at the write boundary. **On update the object is a shallow merge patch** (RFC 7386, applied at the top level): each named key replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte — omit the field to leave every extra key alone, and never read-modify-write the whole object, which would race concurrent writers of other keys. On create, keys are written into the new file's frontmatter and a `null` value is a no-op. **Responses always carry the object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned as `null` and is therefore removed if echoed back through an update. */
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
            /** @description Attention reasons for this row, populated on every response rather than only under `needs=`, so any list can render reason chips. Empty when nothing applies; never contains `me`, which is the union filter and not a reason. */
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed. Empty when nothing went wrong. */
            warnings: components["schemas"]["Warning"][];
        };
        Doc: {
            frontmatter: components["schemas"]["DocFrontmatter"];
            /** @description Markdown body, without the frontmatter block. */
            body: string;
            /** @description Path relative to the workspace root. Presentation only — `id` is identity. */
            path: string;
            anchors: components["schemas"]["ResolvedAnchor"][];
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
            /** @description Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat and verbatim (SPEC.md §5 — plugins add fields under their own keys; §12 — e.g. a `todo` document's `items`). The server stores and returns these keys and **never interprets them**; meaning belongs to the key's owner (a plugin's own schema), never to this contract. Keys must not name a core frontmatter key (id, type, title, created, updated, tags, status, anchors, due, reviewed, evergreen, parent, anchor, agent, pinned, order, query, column) — such a request is rejected with `400`, exact and case-sensitive, so a core field can never be shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) nested at most 8 containers deep, at most 65536 UTF-8 bytes serialized per document; the bounds are enforced at the write boundary. **On update the object is a shallow merge patch** (RFC 7386, applied at the top level): each named key replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte — omit the field to leave every extra key alone, and never read-modify-write the whole object, which would race concurrent writers of other keys. On create, keys are written into the new file's frontmatter and a `null` value is a no-op. **Responses always carry the object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned as `null` and is therefore removed if echoed back through an update. */
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
            /** @description Character range in the current body, or null when the selector no longer resolves. */
            range: {
                start: number;
                end: number;
            } | null;
            /** @description True when the selector did not resolve; the thread is still fully functional but detached. */
            orphaned: boolean;
        };
        Warning: {
            /**
             * @description `commit_failed`: the workspace's git hooks rejected the auto-commit, or git itself failed — the write is on disk and uncommitted. `commit_skipped`: no commit was attempted, because the workspace is not a git repository or no `git` is on the server's PATH. `orphaned_anchor`: an anchor entry is well-formed but its quote no longer resolves in the body, so its thread is detached (SPEC.md §6). `unresolved_ref`: a `[[ref]]` in the body names no document.
             * @enum {string}
             */
            code: "commit_failed" | "commit_skipped" | "orphaned_anchor" | "unresolved_ref";
            /** @description Human-readable specifics — the hook's own output, the offending anchor id, the unresolved ref. Rendered verbatim in the console; never parsed. */
            detail: string;
        };
        CreateDocRequest: {
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
            /** @description Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat and verbatim (SPEC.md §5 — plugins add fields under their own keys; §12 — e.g. a `todo` document's `items`). The server stores and returns these keys and **never interprets them**; meaning belongs to the key's owner (a plugin's own schema), never to this contract. Keys must not name a core frontmatter key (id, type, title, created, updated, tags, status, anchors, due, reviewed, evergreen, parent, anchor, agent, pinned, order, query, column) — such a request is rejected with `400`, exact and case-sensitive, so a core field can never be shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) nested at most 8 containers deep, at most 65536 UTF-8 bytes serialized per document; the bounds are enforced at the write boundary. **On update the object is a shallow merge patch** (RFC 7386, applied at the top level): each named key replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte — omit the field to leave every extra key alone, and never read-modify-write the whole object, which would race concurrent writers of other keys. On create, keys are written into the new file's frontmatter and a `null` value is a no-op. **Responses always carry the object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned as `null` and is therefore removed if echoed back through an update. */
            extra?: {
                [key: string]: unknown;
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed. Empty when nothing went wrong. */
            warnings: components["schemas"]["Warning"][];
        };
        AnchorReconciliation: {
            /** @description Anchors whose selector was recomputed against the new body. */
            remapped: string[];
            /** @description Anchors whose text was removed; their threads are now detached. */
            orphaned: string[];
        };
        LockedError: {
            /** @enum {string} */
            code: "locked";
            message: string;
            lock: components["schemas"]["Lock"];
        };
        Lock: {
            /**
             * @description Identifier of any document; threads are documents too.
             * @example doc_a1b2c3
             */
            docId: string;
            /**
             * @description The acting party for a request. Becomes the git author of the auto-commit the server makes for the mutation (SPEC.md §4, §7).
             * @example user
             * @enum {string}
             */
            holder: "user" | "agent";
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            acquired: string;
            /** @description Seconds from `acquired` after which `lock reap` may clear it. */
            ttl: number;
        };
        UpdateDocRequest: {
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
            /** @description Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat and verbatim (SPEC.md §5 — plugins add fields under their own keys; §12 — e.g. a `todo` document's `items`). The server stores and returns these keys and **never interprets them**; meaning belongs to the key's owner (a plugin's own schema), never to this contract. Keys must not name a core frontmatter key (id, type, title, created, updated, tags, status, anchors, due, reviewed, evergreen, parent, anchor, agent, pinned, order, query, column) — such a request is rejected with `400`, exact and case-sensitive, so a core field can never be shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) nested at most 8 containers deep, at most 65536 UTF-8 bytes serialized per document; the bounds are enforced at the write boundary. **On update the object is a shallow merge patch** (RFC 7386, applied at the top level): each named key replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte — omit the field to leave every extra key alone, and never read-modify-write the whole object, which would race concurrent writers of other keys. On create, keys are written into the new file's frontmatter and a `null` value is a no-op. **Responses always carry the object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned as `null` and is therefore removed if echoed back through an update. */
            extra?: {
                [key: string]: unknown;
            };
        };
        DeleteDocResult: {
            /**
             * @description Identifier of any document; threads are documents too.
             * @example doc_a1b2c3
             */
            deletedId: string;
            /** @description Threads that named the deleted document as `parent`. They keep that id and remain readable; their anchors no longer resolve. Drop their caches. */
            orphanedThreadIds: string[];
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed. Empty when nothing went wrong. */
            warnings: components["schemas"]["Warning"][];
        };
        ForbiddenError: {
            /** @enum {string} */
            code: "forbidden";
            message: string;
        };
        MoveDocRequest: {
            /** @description Folder under `data/docs/`, accepted either as a bare name (`finance`) or as the full prefix (`data/docs/finance`). Defaults to `inbox` — creation is inbox-first (SPEC.md §11), and the agent files inbox arrivals per its skill. */
            folder: string;
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed. Empty when nothing went wrong. */
            warnings: components["schemas"]["Warning"][];
        };
        CaptureRequest: {
            /** @description The captured text. Becomes the inbox document's body and its filing thread's first turn. */
            text: string;
            /** @description Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. Omitted: the server requests the agent — filing is the whole point of a capture — unless the text carries its own mention or skill invocation, which routes it instead. `true`: request the agent. `false`: "note only" — suppress the enqueue even when the thread is engaged. */
            requestsAgent?: boolean;
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed. Empty when nothing went wrong. */
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
        };
        CreateThreadRequest: {
            /**
             * @description Document being commented on. Omitted or null creates a standalone thread.
             * @example doc_a1b2c3
             */
            parent?: string | null;
            /** @description Text-quote selector captured from the user's selection. The server writes the anchor entry into the parent's frontmatter and creates the thread file atomically. Omitted or null anchors the thread to the whole document, or to nothing when `parent` is null. */
            selector?: {
                /** @description The quoted text the thread is attached to. */
                exact: string;
                /** @description Text immediately preceding `exact`, for disambiguation. Omit it when there is none, which is what a quote at a document boundary produces; the server stores the empty string. */
                prefix?: string;
                /** @description Text immediately following `exact`, for disambiguation. Omit it when there is none, which is what a quote at a document boundary produces; the server stores the empty string. */
                suffix?: string;
            } | null;
            /** @description Defaults to the anchor quote or the first turn. */
            title?: string;
            /** @description Body of the thread's first turn. */
            body: string;
            /** @description Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. Omitted: the server enqueues only when the body carries an explicit `@agent` mention, a targeted `@<subagent>` mention or a `/<skill>` invocation. `true`: request the agent. `false`: "note only" — suppress the enqueue even when the thread is engaged. */
            requestsAgent?: boolean;
        };
        MultipartCreateThreadRequest: {
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed. Empty when nothing went wrong. */
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
            body: string;
            /** @description Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. Omitted: the server enqueues when the thread is already `engaged`, and otherwise only on an explicit mention or skill invocation. `true`: request the agent. `false`: "note only" — suppress the enqueue even when the thread is engaged. */
            requestsAgent?: boolean;
        };
        MultipartAppendTurnRequest: {
            /** @description Markdown body of the turn. Optional: a turn may be attachment-only. */
            text?: string;
            /** @description Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. Omitted: the server enqueues when the thread is already `engaged`, and otherwise only on an explicit mention or skill invocation. `true`: request the agent. `false`: "note only" — suppress the enqueue even when the thread is engaged. */
            requestsAgent?: boolean;
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
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed. Empty when nothing went wrong. */
            warnings: components["schemas"]["Warning"][];
        };
        FormAnswerResponse: {
            thread: components["schemas"]["ThreadSummary"];
            turn: components["schemas"]["Turn"] & unknown;
            /**
             * @description The enqueued `form.respond` event, which re-triggers the agent like any engaged-thread reply (SPEC.md §6). Null when the answer does not re-trigger it — a resolved thread stops re-triggering the agent even while it is engaged (SPEC.md §8).
             * @example evt_7c1d
             */
            eventId: string | null;
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed. Empty when nothing went wrong. */
            warnings: components["schemas"]["Warning"][];
        };
        FormAnswerRequest: {
            /** @description The chosen option, matched verbatim against the answered form's `options`. An option the form does not offer is a `400` naming `body.option` — validating the answer against the fence it answers is the point of the route. */
            option: string;
            /** @description Free-text note recorded beside the chosen option (SPEC.md §6). Optional. */
            note?: string;
        };
        ThreadMutationResponse: {
            thread: components["schemas"]["ThreadSummary"];
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed. Empty when nothing went wrong. */
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
        QueueStatus: {
            /** @description True while the `.corpus/HALT` sentinel exists; claims return empty. */
            halted: boolean;
            pending: number;
            inProgress: number;
            /** @description Events waiting on a user-held edit lock (SPEC.md §7). Counted separately from `failed` because a deferral is not a failure — a non-zero count here is work that will resume by itself, and the console strip must not read it as breakage. */
            deferred: number;
            processed: number;
            failed: number;
            abandoned: number;
        };
        IdleResult: {
            /** @description Pending events, still in `pending/`. Claim them with `POST /api/queue/claim-all`. */
            events: components["schemas"]["QueueEvent"][];
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
            /** @description Type-specific payload; plugins own the shape of their own event types, which is why this stays open rather than becoming a union keyed on `type` (SPEC.md §7). The core payloads are declared beside their features: `form.respond` carries `{threadId, formTs, option, note}` (SPEC.md §6). */
            payload: {
                [key: string]: unknown;
            };
        };
        ClaimBatch: {
            events: components["schemas"]["QueueEvent"][];
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
        ConflictError: {
            /** @enum {string} */
            code: "conflict";
            message: string;
            lock?: components["schemas"]["Lock"] & unknown;
        };
        DeferEventRequest: {
            /**
             * @description The document whose edit lock the work is waiting for. Releasing, breaking or reaping that lock returns this event to `pending` automatically (SPEC.md §7), so a deferral that named the wrong document would wait forever.
             * @example doc_a1b2c3
             */
            blockedOn: string;
            /** @description Human-readable deferral note, shown in the console beside the blocking document. No `deferred:` prefix is needed or wanted — the status says that now. */
            reason?: string;
        };
        /** @description Every active lock, for hydrating lock banners on load (SPEC.md §7). */
        LockList: {
            locks: components["schemas"]["Lock"][];
        };
        LockReapResult: {
            /** @description Documents whose expired locks were cleared. */
            reaped: string[];
        };
        LockConflictError: {
            /** @enum {string} */
            code: "conflict";
            message: string;
            lock: components["schemas"]["Lock"] & unknown;
        };
        AcquireLockRequest: {
            /** @description Lease in seconds; defaults to 300. A TTL is what keeps a crashed editor from wedging a document — `POST /api/locks/reap` clears expired leases. */
            ttl?: number;
        };
        ReleaseLockResult: {
            /**
             * @description Identifier of any document; threads are documents too.
             * @example doc_a1b2c3
             */
            docId: string;
            /** @enum {boolean} */
            released: true;
            /**
             * @description The party whose lock this call cleared.
             * @example user
             * @enum {string}
             */
            holder: "user" | "agent";
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
             * @description Mirrors the `.corpus/queue/<status>/` directory the event file currently lives in. `pending` and `in-progress` are the live states; `processed`, `failed` and `abandoned` are terminal. **`deferred` is neither** (SPEC.md §7): the event was claimed and could not proceed because the user holds the edit lock on the document it needs, so it waits — not claimable, not failed — and returns to `pending` automatically when that lock is released, broken or reaped.
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
             * @description **The document whose edit lock this job is waiting for**, or null — non-null exactly when `status` is `deferred` (SPEC.md §7, CONTRACT-021). It is the document supplied at defer time, and the one whose release, break or reap returns the job to `pending` automatically. The console needs it to say what a waiting row is waiting *for*: a deferred job that names no document is indistinguishable from a stuck one.
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
            /** @description Rows written to `locks` by this rebuild. */
            locks: number;
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
             * @description `missing_row`: a document file exists but the projection has no row for it. `orphan_row`: the projection has a row for a path that no longer exists. `content_mismatch`: the file's bytes no longer hash to what was projected. `count_mismatch`: a table the projection keeps no per-item detail for disagrees with the files by count. `unparseable`: the file is a document by location but its frontmatter cannot be read. `duplicate_id`: two files claim one id; only the first by path order is projected.
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
             * @description Which §14 rule the finding reports. Warnings are exactly `anchor-unresolved` (an orphaned thread) and `ref-unresolved` (a `[[ref]]` whose target does not exist yet); the other eleven are errors, `anchor-unused` among them.
             * @example ref-unresolved
             * @enum {string}
             */
            code: "frontmatter-unparseable" | "frontmatter-invalid" | "id-prefix-mismatch" | "duplicate-id" | "anchor-malformed" | "duplicate-anchor-id" | "thread-parent-missing" | "thread-anchor-missing" | "anchor-claimed-twice" | "anchor-unused" | "duplicate-turn-timestamp" | "anchor-unresolved" | "ref-unresolved";
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
        SkillRollbackResult: {
            /**
             * @description The skill's name, which is its directory name under `.claude/skills/` and the `name` in its frontmatter. Lowercase letters, digits and single hyphens, at most 64 characters — it becomes a directory name, and no real skill name comes close to the bound.
             * @example orchestrate
             */
            name: string;
            /**
             * @description Id of the restored skill document. Unchanged by the rollback — ids are immutable (§5), so this is the id the board, the projection and every thread anchored to the skill already use.
             * @example doc_a1b2c3
             */
            docId: string;
            /** @description Sha of the commit the server made to restore the file — the new HEAD, not the ref the content came from. `git show <commit>` is the audit trail entry for this rollback. `null` means the file was restored but not committed: the auto-commit failed or was skipped, the file write stands regardless (SPEC.md §14), and the reason — the workspace's own hook output for `commit_failed`, or `commit_skipped` for a workspace with no git — is in `warnings`. A rollback that reports `null` has still changed the file on disk. */
            commit: string | null;
            /** @description Workspace-relative path of the restored file, e.g. `.claude/skills/orchestrate/SKILL.md`. */
            path: string;
            /** @description Non-fatal problems noticed while performing this mutation (SPEC.md §14). The mutation succeeded regardless — files are the source of truth and the server never rolls a write back because a commit or a check failed. Empty when nothing went wrong. */
            warnings: components["schemas"]["Warning"][];
        };
        SkillRollbackRequest: {
            /** @description Git ref to restore the skill from — a commit sha, tag or any revision git resolves. Omit it (or send null) to restore the last-known-good version, which is the newest committed revision of the file that validates (SPEC.md §7). */
            to?: string | null;
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
