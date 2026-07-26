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
        /** Query the document collection */
        get: {
            parameters: {
                query?: {
                    /** @description Maximum rows to return (1–200). */
                    limit?: number;
                    /** @description Rows to skip before collecting the page. */
                    offset?: number;
                    /** @description Full-text query across document titles, bodies and turn bodies. */
                    q?: string;
                    /** @description Restrict to a single document type. Core values: note, thread, view, template, skill, agent-def. */
                    type?: string;
                    /** @description Restrict to a status. Omitted, the result set excludes `archived` documents; passing `status` explicitly overrides that default. */
                    status?: "open" | "resolved" | "archived";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Matching documents, newest-updated first. */
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
         * @description The body is pre-filled from the type's `template` document when one exists and no body is given (SPEC.md §9.2). The server assigns the id; it is immutable thereafter.
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
            requestBody?: {
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
         * @description Runs anchor reconciliation (SPEC.md §6) in the same save and reports which anchors were remapped and which were orphaned. Refused with `423` when the other party holds the document's edit lock.
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
            requestBody?: {
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
         * @description The server owns the turn format and guarantees timestamps are unique and monotonic within the thread (SPEC.md §6). Multipart attachment uploads arrive with CONTRACT-002.
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
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["AppendTurnRequest"];
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
            items: components["schemas"]["DocSummary"][];
            page: components["schemas"]["PageMeta"];
        };
        DocSummary: {
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
        NotFoundError: {
            /** @enum {string} */
            code: "not_found";
            message: string;
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
            /** @description Folder under `data/docs/`; defaults to the root. */
            folder?: string;
            /** @default [] */
            tags: string[];
            /**
             * @default open
             * @enum {string}
             */
            status: "open" | "resolved" | "archived";
            /**
             * Format: date
             * @default null
             * @example 2026-08-01
             */
            due: string | null;
            /** @default false */
            evergreen: boolean;
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
        CreateThreadResponse: {
            thread: components["schemas"]["Thread"];
            /**
             * @description Anchor written into the parent, when a selector was given.
             * @example anc_k4f7
             */
            anchorId: string | null;
            /**
             * @description Enqueued `comment.created` event, when the agent was requested.
             * @example evt_7c1d
             */
            eventId: string | null;
        };
        CreateThreadRequest: {
            /**
             * @description Document being commented on; null creates a standalone thread.
             * @default null
             * @example doc_a1b2c3
             */
            parent: string | null;
            /**
             * @description Text-quote selector captured from the user's selection. The server writes the anchor entry into the parent's frontmatter and creates the thread file atomically. Null anchors the thread to the whole document, or to nothing when `parent` is null.
             * @default null
             */
            selector: {
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
            } | null;
            /** @description Defaults to the anchor quote or the first turn. */
            title?: string;
            /** @description Body of the thread's first turn. */
            body: string;
            /**
             * @description True enqueues a `comment.created` event so the parked agent wakes. Independent of who authored the turn.
             * @default false
             */
            requestsAgent: boolean;
        };
        AppendTurnResponse: {
            thread: components["schemas"]["ThreadSummary"];
            turn: components["schemas"]["Turn"];
            /**
             * @description Enqueued `comment.created` event, when the agent was requested or is already engaged.
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
            /**
             * @description True enqueues a `comment.created` event so the parked agent wakes. Independent of who authored the turn.
             * @default false
             */
            requestsAgent: boolean;
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
        ClaimBatch: {
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
        FailEventRequest: {
            /** @description Human-readable failure reason, shown in the console. */
            reason?: string;
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
