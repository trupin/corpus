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
                    /** @description Restrict to a lifecycle status. Omitted, the default result set **excludes** `status: archived` (SPEC.md §11); passing `status` explicitly overrides that default, so `status=archived` is how the archived chip brings them back. */
                    status?: "open" | "resolved" | "archived";
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
                    /** @description Sort key; defaults to `-updated`. `relevance` requires `q` and is rejected with `400` without it, rather than silently falling back. */
                    sort?: "updated" | "-updated" | "created" | "-created" | "due" | "title" | "relevance";
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
                /** @description The created document. */
                201: {
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
                /** @description The deleted id and the threads it orphaned. */
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
                /** @description The document at its new path. */
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
                /** @description The document, now archived. */
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
                /** @description The document, restored. */
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
         * @description The composer's Capture action (SPEC.md §11): creates the document in `data/docs/inbox/` **plus** its whole-document filing thread asking the agent to retitle, move, expand and tag it, in one call. `multipart/form-data`, so a screenshot plus one line is a first-class capture; build the body with `uploadCapture` from `@corpus/contract/client`. The returned `eventId` lets the board show the pending-agent indicator immediately and the console link the job back to the capture.
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
            /** @description The thread and its first turn. `body` is mandatory, so the request body is too. */
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateThreadRequest"];
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
         * @description The server owns the turn format and guarantees timestamps are unique and monotonic within the thread (SPEC.md §6). Send `application/json` for a plain turn, or `multipart/form-data` to attach files — a turn may be attachment-only, but one carrying neither text nor files is a `400`. Multipart bodies are built by `uploadTurn` in `@corpus/contract/client`, since `openapi-fetch` serialises JSON only.
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
            /** @description The turn, as JSON or as multipart. Omitting it entirely is never a meaningful call — the JSON form demands `body` and a multipart part carrying neither `text` nor `files` is a `400` — but it is declared optional so the two media types stay independently validated. */
            requestBody?: {
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
         * @description Sets `status: resolved`. The thread collapses in the document view and **later turns stop re-triggering the agent** even while it is `engaged` (SPEC.md §8) — resolving is how a conversation is closed without deleting anything.
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
                /** @description The updated thread summary. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ThreadSummary"];
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
         * @description Sets `status: open` again. An `engaged` thread resumes re-triggering the agent on later turns (SPEC.md §8).
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
                /** @description The updated thread summary. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ThreadSummary"];
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
                    /** @description Seconds to hold the request open, 1–480 (the server clamps anything longer). Parking costs the agent zero tokens: it is blocked on a response, not looping. */
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
         * @description **Localhost-only and unauthenticated**, for Claude Code hooks such as `PostToolUse` which hold no token. Appends to the same `.corpus/jobs/<eventId>.jsonl` that `corpus job log` writes through. Hardening (SPEC.md §7): non-loopback peers and requests carrying a browser `Origin` header are rejected with `403`, line length is capped, and appends to unknown job ids are refused with `404`.
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
                /** @description The line was appended. */
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
         * Retry a failed job
         * @description Returns the event to `pending/` so the agent picks it up again — the retry action in the console's detail header (SPEC.md §11).
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
         */
        get: {
            parameters: {
                query: {
                    /** @description Workspace bearer token; a query parameter because EventSource cannot set headers. */
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
             * @example 2026-07-19T10:05:00Z
             */
            created: string;
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            updated: string;
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
             * @example 2026-07-19T10:05:00Z
             */
            created: string;
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            updated: string;
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
        };
        NotFoundError: {
            /** @enum {string} */
            code: "not_found";
            message: string;
        };
        UpdateDocResponse: {
            doc: components["schemas"]["Doc"];
            anchors: components["schemas"]["AnchorReconciliation"];
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
        };
        DeleteDocResult: {
            /**
             * @description Identifier of any document; threads are documents too.
             * @example doc_a1b2c3
             */
            deletedId: string;
            /** @description Threads that named the deleted document as `parent`. They keep that id and remain readable; their anchors no longer resolve. Drop their caches. */
            orphanedThreadIds: string[];
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
        AppendTurnResponse: {
            thread: components["schemas"]["ThreadSummary"];
            turn: components["schemas"]["Turn"];
            /**
             * @description Enqueued `comment.created` event; null when nothing was enqueued. Non-null when `requestsAgent` was true, or when it was omitted and the thread is already engaged; always null when `requestsAgent` was explicitly false ("note only", SPEC.md §8).
             * @example evt_7c1d
             */
            eventId: string | null;
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
            /**
             * @description Always false: the mark is at or beyond the last turn the caller has seen.
             * @enum {boolean}
             */
            unread: false;
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
            /** @description Event type. Core values: comment.created, form.respond, agent.done. Plugins define their own. */
            type: string;
            /**
             * Format: date-time
             * @example 2026-07-19T10:05:00Z
             */
            created: string;
            /** @description What produced the event, e.g. `ui` or `cli`. */
            source: string;
            /** @description Type-specific payload; plugins own the shape of their own event types. */
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
        };
        HaltQueueRequest: {
            /** @description Human-readable halt reason, recorded in the `.corpus/HALT` sentinel. */
            reason?: string;
        };
        FailEventRequest: {
            /** @description Human-readable failure reason, shown in the console. */
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
            /**
             * @description Mirrors the `.corpus/queue/<status>/` directory the event file currently lives in.
             * @enum {string}
             */
            status: "pending" | "in-progress" | "processed" | "failed" | "abandoned";
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
            /** @enum {boolean} */
            appended: true;
        };
        AppendLogRequest: {
            /** @description One progress line. Rendered as plain text and never interpreted; the server caps its length (SPEC.md §7). */
            line: string;
        };
        ConflictError: {
            /** @enum {string} */
            code: "conflict";
            message: string;
            lock?: components["schemas"]["Lock"] & unknown;
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
