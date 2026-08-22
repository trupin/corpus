import { createRoute, z } from "@hono/zod-openapi";
import { DocumentIdSchema } from "../schemas/id.js";
import { NOT_FOUND_RESPONSE, UNAUTHORIZED_RESPONSE, VALIDATION_RESPONSE } from "./responses.js";

/**
 * `POST /api/docs/{id}/edit-session/flush` — SPEC.md §4's **close** path, made
 * into a call (CONTRACT-031).
 *
 * **Why this route exists, when CONTRACT-028 declared that it should not.** That
 * issue reasoned that the release of §7's then-current edit lock was already the
 * reader-close signal, so no new endpoint was needed. SERVER-052 measured the
 * premise against the shipped editor and it was false: the editor dropped its
 * lease on blur *and* after ten seconds of not typing, against the session's
 * three minutes, so it always fired first — which would have made §4's
 * explicitly "distinct and longer window" dead code in every session and
 * fragmented one sitting at a document into an event per typing burst. The two
 * signals answered different questions ("may somebody else write here" and "has
 * the person put this document down"), and a lease dropped mid-pause could not
 * answer the second. Hence a signal of its own, which per §9.3 is a contract
 * change rather than a server-local route. The lock has since been removed
 * entirely (SHARED-041), which settles the question in the same direction: the
 * first question is asked of nothing now, and **this session is what the
 * `userEditing` signal on a document read reports** (SPEC.md §7), so ending it
 * here is what makes that signal stop being true.
 *
 * The server mechanism it opens onto already exists and is under test
 * (`EditSessionTracker.flush(docId)`, SERVER-052); this declares the door. It is
 * the same tracker `Doc.userEditing` reads.
 */

const DocIdParamSchema = z.object({
  id: DocumentIdSchema.openapi({ param: { name: "id", in: "path", required: true } }),
});

export const flushEditSession = createRoute({
  method: "post",
  path: "/api/docs/{id}/edit-session/flush",
  tags: ["docs"],
  summary: "End this document's edit session now",
  description:
    "Ends any **user** edit session open on this document immediately, which is SPEC.md §4's " +
    "`close` path: *the reader closes (the UI flushes the session)*. The session's acknowledgment " +
    "— one `doc.edited` queue event carrying its commit range and change stats — follows, exactly " +
    'as it would have when §4\'s three-minute inactivity window elapsed, with `endedBy: "close"`.\n\n' +
    "**Idempotent, and that is load-bearing.** The answer is `204` whether or not a session was " +
    "open: this route asserts a *postcondition* — this document has no open edit session — rather " +
    "than performing an action, and asserting it twice is asserting it once. The caller cannot " +
    "know whether a session is open (sessions are opened by the server, on the first editor save " +
    "that lands a commit, and ended by a timer the client cannot observe), so a `404` for *nothing " +
    "to flush* would make correct client code impossible to write. Calling it on a document that " +
    "was only read, or flushing twice because an unload path fired twice, is a no-op.\n\n" +
    "**The `204` carries no body, and deliberately says nothing about whether an event was " +
    "emitted.** Two reasons, both of which would make such a field a lie. It is a race — the idle " +
    "window may have elapsed a millisecond earlier, and the session would then already be gone " +
    "through the other door. And emission is decided *after* this response: a session whose " +
    "path-scoped range turns out to be empty — an edit and its undo inside one sitting — or whose " +
    "auto-commits were all rejected or skipped (SPEC.md §11) correctly produces no event at all. " +
    "What the caller needs is the postcondition, and that is the whole of what `204` states.\n\n" +
    "**One event per session, whichever door it leaves by.** The flush path and the inactivity " +
    "path converge on the same session object, and whichever fires first removes it, so the other " +
    "finds nothing — which is also why a repeated flush is free. At most one `doc.edited` may ever " +
    "exist per `sessionId`, and a consumer may drop a repeat on that basis alone.\n\n" +
    "**Callable from a page-unload path — with `fetch(…, { keepalive: true })`, not with " +
    "`navigator.sendBeacon`.** Stated here rather than left to be discovered: `keepalive` is the " +
    "supported spelling, because it is the one that can send the workspace bearer token. " +
    "`sendBeacon` sets no request headers at all, so it cannot carry `Authorization` (SPEC.md " +
    "§2.1), and this route is not on §2.1's exception list — the method and the empty body would " +
    "both have suited it, the auth header is what rules it out. Nothing else stands in " +
    "`keepalive`'s way here: the request is body-less, so the 64 KiB keepalive budget is never in " +
    "question, and the UI is served same-origin by this server, so no preflight has to survive the " +
    "unload. Reach it from `pagehide` or `visibilitychange → hidden`; the generated client accepts " +
    "`keepalive` and forwards it to `fetch`.\n\n" +
    "**The `404` means the document is unknown, and it is the only one** — never *no session " +
    "here*. It catches the client bug worth catching (a stale or wrong id, a thread id, an " +
    "`undefined` in a template string), which a permissive `204` would hide forever. It is not " +
    "actionable on an unload path: a caller that gets one has nothing to flush either way and " +
    "should ignore it.\n\n" +
    "No acting party. The flush authors nothing — the session's commits landed minutes earlier, " +
    "authored by the user — so there is no git author to attribute and the route declares no " +
    "`x-corpus-author`, exactly as `POST /api/check` and `POST /api/index/rebuild` do not. The " +
    'event\'s own actor is fixed by its payload schema (`actor: "user"`, always), so who makes ' +
    "this call cannot change what the event says, and a caller that is not the reader cannot " +
    "manufacture an acknowledgment: with no session open there is nothing to end.",
  request: { params: DocIdParamSchema },
  responses: {
    204: {
      description:
        "The document has no open edit session. The same answer whether this call ended one or " +
        "there was none to end — the postcondition, not a report of what happened.",
    },
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
