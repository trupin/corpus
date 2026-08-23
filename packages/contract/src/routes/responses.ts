import { z } from "zod";

import {
  ConflictErrorSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  StaleKeyErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
  UnknownJobErrorSchema,
  UnknownRecipientErrorSchema,
} from "../schemas/error.js";

/** Wraps a schema as a single-content-type JSON response entry for `createRoute`. */
export const jsonContent = <T extends z.ZodType>(schema: T, description: string) =>
  ({ description, content: { "application/json": { schema } } }) as const;

export const UNAUTHORIZED_RESPONSE = jsonContent(
  UnauthorizedErrorSchema,
  "Missing or invalid workspace bearer token.",
);

export const VALIDATION_RESPONSE = jsonContent(
  ValidationErrorSchema,
  "The request failed schema validation; `issues` names the offending fields.",
);

/**
 * `413` for an upload past the workspace's size caps, declared on every route
 * that accepts files.
 *
 * **It reuses `bad_request` rather than adding an eighth error code.** An
 * over-cap upload is a request-shape problem, and `ValidationError`'s
 * `{code, message, issues[]}` already carries exactly the field-level detail an
 * operator needs — which part was too large, and what the cap is. The `ApiError`
 * union is discriminated on `code`, so a new member would touch every narrowing
 * site: the CLI's error renderer, the upload helpers' `UploadError`, and every
 * consumer that switches on the code. That is a wide blast radius for one
 * status. The status code carries the distinction instead, which is what status
 * codes are for.
 */
export const PAYLOAD_TOO_LARGE_RESPONSE = jsonContent(
  ValidationErrorSchema,
  "An attached file, or the request as a whole, is past the workspace's upload caps. `issues` " +
    "names the offending part and the limit it exceeded. The body is the same `bad_request` shape " +
    "every other validation failure uses — the status is what distinguishes it.",
);

/**
 * Every route that carries it says in prose *which* actor it refuses, because
 * `403` is about who is asking rather than about the request being malformed.
 */
export const FORBIDDEN_RESPONSE = jsonContent(
  ForbiddenErrorSchema,
  "The acting party in `x-corpus-author` may not make this call.",
);

export const NOT_FOUND_RESPONSE = jsonContent(NotFoundErrorSchema, "No such resource.");

/**
 * A `job` naming no event (SPEC.md §9.2, CONTRACT-050).
 *
 * `422` rather than `400`, and rather than silence. Not `400`, because the body
 * is well-formed — `evt_…` is a valid id, it simply names nothing — and not
 * silence, because a caller that got the id wrong **wanted the attribution**:
 * dropping it quietly leaves the caller believing its document was filed into a
 * conversation when it was not, which is the failure mode provenance exists to
 * prevent. It is the one place a missing job is refused; an **omitted** job is
 * always fine, and that asymmetry is the whole rule (§9.2: "forgetting it costs
 * provenance, never correctness" — but naming the wrong thing is not
 * forgetting).
 */
export const UNKNOWN_JOB_RESPONSE = jsonContent(
  UnknownJobErrorSchema,
  "The `job` names no event. Nothing was written; retry without it, or with the right id.",
);

/**
 * The `422` of a **posting** request, which can name two things that may not
 * exist: the job it serves, and the lane it is addressed to (SPEC.md §7, §9.2 —
 * CONTRACT-050 and CONTRACT-051).
 *
 * One status, two bodies, told apart by `code` — the arrangement `409` already
 * uses for `conflict` versus `stale_key`, and for the same reason: a client
 * narrows on the code, so two refusals sharing a status must differ there or one
 * of them is unreachable. The union is declared inline rather than registered as
 * a component, because a `oneOf` has no `type: "object"` and a registered name
 * would propagate onto anything derived from it (CONTRACT-037).
 *
 * The document writes take a job and no recipient, so they keep
 * {@link UNKNOWN_JOB_RESPONSE}; `POST /api/capture` takes neither and declares
 * no `422` at all. No route publishes a refusal it cannot produce.
 */
export const UNRESOLVED_REFERENCE_RESPONSE = jsonContent(
  z.union([UnknownJobErrorSchema, UnknownRecipientErrorSchema]),
  "The request names something that does not exist: `unknown_job` — a `job` resolving to no " +
    "event, or to work already settled — or `unknown_recipient` — a `recipient` naming a thread " +
    "this workspace does not hold, or one that holds no resident and is therefore not a lane. " +
    "Nothing was written in either case. Retry without the offending field, or with a value that " +
    "resolves.",
);

/**
 * The `422` of a request whose **`scope`** names no lane — `GET /api/queue/idle`
 * (SPEC.md §7, SERVER-118, CONTRACT-058).
 *
 * The body is `UnknownRecipientError`, the same code
 * {@link UNRESOLVED_REFERENCE_RESPONSE} publishes for a bad `recipient`, because
 * it is the same fact with the same remedy — see the component's own
 * description for why one code covers both parameters. A separate constant, not
 * a shared one, because the *recovery prose* differs and prose is what a
 * response description is for: a post retries without a recipient, a park
 * retries without a `scope`, and "designate a resident on that thread first" is
 * advice only a park can act on.
 *
 * **It says why parking is refused where claiming is not.** Parking is what
 * presence *is* (SPEC.md §7), so an admitted park on a non-lane makes
 * `QueueStatus.agent.live` true about a lane `GET /api/agents` does not list —
 * whereas a `claim-all` on a lane that just lost its resident is how the
 * listener still holding it drains work already stamped with that lane. That
 * asymmetry is the reason one queue verb declares this and the other does not,
 * and a caller reading only the `422` would otherwise read it as an oversight.
 */
export const UNKNOWN_SCOPE_RESPONSE = jsonContent(
  UnknownRecipientErrorSchema,
  "`scope` names no lane, so **nothing was parked and no work was claimed**: this workspace holds " +
    "no such thread, or that thread holds no resident and is therefore not a lane at all " +
    "(SPEC.md §7). Recover by omitting `scope` to take the orchestrator's lane, designating a " +
    "resident on that thread first, or picking a lane from `GET /api/agents`. The body is " +
    "`unknown_recipient` — the one code for “the value you named is not a lane”, whichever " +
    "parameter named it — and carries the refused value in `recipient`. Refused rather than " +
    "silently parked because parking is what presence *is*: a park the server admitted on a " +
    "non-lane would report an agent listening on a lane the roster does not list, for as long as " +
    "the loop kept re-parking.",
);

export const CONFLICT_RESPONSE = jsonContent(
  ConflictErrorSchema,
  "The request conflicts with state that already exists.",
);

/**
 * SPEC.md §7's refusal, declared on every write that presents a key.
 *
 * The `409` a stale key answers with is **never bare**: it carries the document
 * as it now stands, whose own `key` is the fresh one, so the writer sees what
 * changed and can write again inside one exchange. It replaced the `423` of the
 * removed edit lock, and the difference is the point — nothing is held, so there
 * is nothing to wait for, break or reap; there is only a version you have not
 * read yet.
 */
export const STALE_KEY_RESPONSE = jsonContent(
  StaleKeyErrorSchema,
  "The `key` presented names a version this document no longer is: it changed since you read it, " +
    "so the write was refused rather than overwriting something you never saw (SPEC.md §7). " +
    "Nothing was written and nothing is lost — `doc` is the document as it now stands, `doc.key` " +
    "is the fresh key, and the content you tried to save is yours to reconcile and resend.",
);
