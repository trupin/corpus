import { z } from "zod";
import { openapi } from "./openapi-metadata.js";

/**
 * The **open extra-frontmatter surface** (CONTRACT-011, adjudicated 2026-07-27).
 *
 * SPEC.md §5 says that any key the core does not define is "preserved verbatim
 * as extra frontmatter", and §9.1 says the projection carries it "as opaque
 * passthrough the server never interprets". This module is that promise
 * reaching the wire: one object, `extra`, carried on every document row, on the
 * single document read, and on create/update requests, holding **every
 * frontmatter key that is not a core key** — flat, exactly as the keys sit in
 * the file. The object itself is the namespace, and there is no sub-nesting,
 * because the file has none: on disk such a key is simply a YAML key beside the
 * core ones, and the wire mirrors the file (the file is the source of truth,
 * and this surface must round-trip it).
 *
 * The server **stores and returns these keys and never interprets them**.
 * Meaning belongs to whoever wrote the key — a person, an agent following a
 * convention the workspace holds in its own documents — never this contract.
 * That is the whole design: a workspace can carry a shape the core has never
 * heard of at *zero* contract changes, which is the same openness `type` keeps
 * (SPEC.md §12's M6).
 *
 * Core keys, by contrast, stay closed and validated where they always were.
 * The view and board keys (`order`, `query`, `columns`, `kanban`,
 * `default-open`) and `stage` are deliberately **not** in here — they are
 * first-class core fields (see `doc.ts`), because several are server semantics
 * (`order` is a sort, `stage` is a filter, `default-open` is a value the server
 * keeps unique across boards, and a key the server sorts, filters or arbitrates
 * on is by definition not opaque) and because keeping them out preserves this
 * object's one absolute rule: nothing in it ever means anything to the server.
 */

/**
 * The closed set of core frontmatter keys (SPEC.md §5 base fields, §6 thread
 * fields, §10 view fields). A key in `extra` naming one of these is rejected
 * with `400`, on requests and by construction on responses — so a core field
 * can never be shadowed, duplicated, or smuggled past its own validation.
 *
 * The match is exact and case-sensitive, because YAML keys are: `Title` is a
 * genuinely different key on disk and therefore a legal extra key. `extra`
 * itself is deliberately absent — it is a wire envelope, not a disk key, so a
 * file's literal `extra:` key simply rides inside it (`extra: { extra: … }`)
 * and collides with nothing.
 *
 * `extra.test.ts` pins this list against the actual doc and thread schemas, so
 * a core key added elsewhere without a matching entry here fails a test.
 */
export const RESERVED_FRONTMATTER_KEYS = [
  // SPEC.md §5 — every document
  "id",
  "type",
  "title",
  "created",
  "updated",
  "tags",
  "status",
  "anchors",
  "due",
  "reviewed",
  "evergreen",
  // SPEC.md §7/§9.2 — the conversation this document came from (SHARED-043).
  // Reserved for the same reason `turnModels` is: `extra` is a client-supplied
  // merge patch, and an origin stored there could be rewritten by an ordinary
  // `PUT /api/docs/{id}` — which is precisely the caller-asserted scope
  // membership the job/origin split exists to make unexpressible. Detach is the
  // only way a caller touches it, and it can only clear.
  "origin",
  // SPEC.md §6 — thread documents
  "parent",
  "anchor",
  "agent",
  // SPEC.md §7 — the resident a standalone thread designates (SHARED-043).
  // Reserved for exactly the reason `origin` and `turnModels` are, and the
  // hazard was **reproduced against a running server** before this line existed
  // (SERVER-109): `extra` is a client-supplied merge patch, so an unreserved
  // `resident` let an agent designate — or release — itself with an ordinary
  // `PUT /api/docs/{threadId}`, straight past §7's user-only rule. Once the
  // queue routes on designation (SERVER-111) that is also a way for an agent to
  // redirect its own work.
  "resident",
  // SPEC.md §10 — which model wrote each agent turn, keyed by turn timestamp.
  // Reserved is what makes it unforgeable: `extra` is a client-supplied merge
  // patch, so an attribution stored there could be rewritten by an ordinary
  // `PUT /api/docs/{id}` (see `./turn-model.ts`).
  "turnModels",
  // SPEC.md §5 — where a document sits in a workflow (rider 5, 2026-08-22).
  // Reserved because the server filters on it and because a kanban's status
  // coupling is driven by it: a stage smuggled through `extra` would move a
  // document's status without going through the write that decides it.
  "stage",
  // SPEC.md §10 — view and board documents (first-class core keys, see doc.ts)
  //
  // `column` is deliberately absent (SHARED-066). It named a plugin renderer,
  // `<plugin>/<type>`, and with the plugin surface gone it names nothing — so
  // it stopped being a core key rather than becoming a core key that means
  // nothing. Absent from this list is what makes an old view's `column:` land
  // here, in `extra`, preserved verbatim and never interpreted: a board written
  // before the removal keeps working, and echoing the document back through an
  // update writes the key out again unchanged.
  //
  // `pinned` left the same way on 2026-08-22 (rider 2): a board lists its own
  // columns, so nothing reads `pinned` and it stopped being a core key. A view
  // written before the removal keeps its key, here, until `corpus upgrade`'s
  // migration drops it (SPEC.md §2.4).
  "order",
  "query",
  "columns",
  "kanban",
  // **Both spellings, deliberately.** `default-open` is the frontmatter key and
  // is what a file actually holds; `defaultOpen` is its wire name. Reserving the
  // file key is the one that matters — `extra` is a client-supplied merge patch,
  // so an unreserved `default-open` would let an ordinary `PUT /api/docs/{id}`
  // set the flag while bypassing the arbitration that clears it from every other
  // board (the hazard `resident` and `origin` are reserved against). The wire
  // spelling is reserved beside it so the two can never be told apart by a
  // caller guessing which one this surface polices.
  "default-open",
  "defaultOpen",
] as const;

const RESERVED_KEY_SET: ReadonlySet<string> = new Set(RESERVED_FRONTMATTER_KEYS);

/**
 * Maximum container nesting of a single extra value, counting the value's own
 * arrays and objects but not the `extra` object itself. An array of objects of
 * scalars — the shape a hand-written list of items takes — is depth 2, so the
 * bound leaves ample structural headroom while keeping a document's
 * frontmatter a record, not a database.
 */
export const EXTRA_MAX_DEPTH = 8;

/** Maximum JSON-serialized size of a document's whole `extra` object, in UTF-8 bytes. */
export const EXTRA_MAX_BYTES = 64 * 1024;

/**
 * A legal extra value: plain JSON as YAML can carry it — `null`, strings,
 * finite numbers, booleans, arrays, and plain objects, recursively. Not a
 * wire type (the schema types values as `unknown`, since their meaning is the
 * key owner's); exported for consumers that build extra values in TypeScript.
 */
export type ExtraValue =
  null | string | number | boolean | readonly ExtraValue[] | { readonly [key: string]: ExtraValue };

const EXTRA_DESCRIPTION =
  "Extra frontmatter: every YAML key of the document's frontmatter that is not a core key, flat " +
  "and verbatim — any key the core does not define (SPEC.md §5, §9.1). The server stores and " +
  "returns these keys and **never interprets them**; meaning belongs to whoever wrote the key, " +
  "never to this contract. " +
  `Keys must not name a core frontmatter key (${RESERVED_FRONTMATTER_KEYS.join(", ")}) — such a ` +
  "request is rejected with `400`, exact and case-sensitive, so a core field can never be " +
  "shadowed. Values are plain JSON (`null`, strings, finite numbers, booleans, arrays, objects) " +
  `nested at most ${EXTRA_MAX_DEPTH} containers deep, at most ${EXTRA_MAX_BYTES} UTF-8 bytes ` +
  "serialized per document; the bounds are enforced at the write boundary. **On update the " +
  "object is a shallow merge patch** (RFC 7386, applied at the top level): each named key " +
  "replaces the file's key wholesale, `null` removes it, unnamed keys are untouched byte-for-byte " +
  "— omit the field to leave every extra key alone, and never read-modify-write the whole " +
  "object, which would race concurrent writers of other keys. On create, keys are written into " +
  "the new file's frontmatter and a `null` value is a no-op. **Responses always carry the " +
  "object**, `{}` when the file has no extra keys; a hand-edited `key: null` on disk is returned " +
  "as `null` and is therefore removed if echoed back through an update.";

type IssueContext = {
  addIssue: (issue: { code: "custom"; message: string; path?: PropertyKey[] }) => void;
};

const isPlainObject = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Walks one extra value, reporting everything that is not plain, bounded JSON.
 * Returns false when any issue was raised, so the caller can skip the size
 * check (`JSON.stringify` throws on bigints and silently drops the rest).
 */
const checkValue = (
  value: unknown,
  path: PropertyKey[],
  depth: number,
  ctx: IssueContext,
): boolean => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return true;
    ctx.addIssue({ code: "custom", path, message: "Extra values must be finite numbers." });
    return false;
  }
  if (value === undefined) {
    ctx.addIssue({
      code: "custom",
      path,
      message: "`undefined` is not a YAML value; use `null` to remove a key.",
    });
    return false;
  }
  if (Array.isArray(value)) {
    if (depth >= EXTRA_MAX_DEPTH) {
      ctx.addIssue({
        code: "custom",
        path,
        message: `Extra values nest at most ${EXTRA_MAX_DEPTH} containers deep.`,
      });
      return false;
    }
    let ok = true;
    for (const [index, item] of value.entries()) {
      ok = checkValue(item, [...path, index], depth + 1, ctx) && ok;
    }
    return ok;
  }
  if (typeof value === "object" && isPlainObject(value)) {
    if (depth >= EXTRA_MAX_DEPTH) {
      ctx.addIssue({
        code: "custom",
        path,
        message: `Extra values nest at most ${EXTRA_MAX_DEPTH} containers deep.`,
      });
      return false;
    }
    let ok = true;
    for (const [key, item] of Object.entries(value)) {
      ok = checkValue(item, [...path, key], depth + 1, ctx) && ok;
    }
    return ok;
  }
  ctx.addIssue({
    code: "custom",
    path,
    message:
      "Extra values are plain JSON: null, strings, finite numbers, booleans, arrays and plain objects.",
  });
  return false;
};

/**
 * The `extra` object itself. Deliberately **not** a registered OpenAPI
 * component: it is inlined at every use so each carries the full contract in
 * place, and so no derived form can ever rewrite a shared component definition
 * (see the non-nullable-component invariant in `openapi.test.ts`).
 *
 * Values are typed `unknown` on purpose — the contract polices *shape bounds*
 * (plain JSON, depth, size) and *key collisions*, never meaning. Whoever wrote
 * a key is the only party that knows what it says, which is what keeps a
 * frontmatter convention the core has never heard of at zero contract changes.
 */
export const ExtraFrontmatterSchema = openapi(
  z.record(z.string().min(1), z.unknown()).superRefine((extra, ctx) => {
    let ok = true;
    for (const [key, value] of Object.entries(extra)) {
      if (RESERVED_KEY_SET.has(key)) {
        ok = false;
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `\`${key}\` is a core frontmatter key; core keys cannot be set or shadowed through \`extra\`.`,
        });
        continue;
      }
      ok = checkValue(value, [key], 0, ctx) && ok;
    }
    if (!ok) return;
    const bytes = new TextEncoder().encode(JSON.stringify(extra)).length;
    if (bytes > EXTRA_MAX_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `\`extra\` serializes to ${String(bytes)} bytes; the bound is ${String(EXTRA_MAX_BYTES)}.`,
      });
    }
  }),
  { description: EXTRA_DESCRIPTION },
);

export type ExtraFrontmatter = z.infer<typeof ExtraFrontmatterSchema>;
