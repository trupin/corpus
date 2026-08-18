import { z } from "@hono/zod-openapi";
import { BodyRangeSchema, TextQuoteSelectorSchema } from "./anchor.js";
import { ExtraFrontmatterSchema } from "./extra.js";
import { AnchorIdSchema, DocumentIdSchema, ThreadIdSchema } from "./id.js";
import { jobField, originDetachField, originField } from "./provenance.js";
import {
  documentKeyRequestField,
  documentKeyResponseField,
  MISSING_DOCUMENT_KEY_MESSAGE,
  KEYED_UPDATE_FIELDS,
  updateNeedsDocumentKey,
  userEditingField,
} from "./key.js";
import { ThreadStatusSchema } from "./thread.js";
import { IsoDateSchema, IsoDateTimeSchema } from "./time.js";
import { warningsField } from "./warning.js";

/**
 * Document types the product itself defines (SPEC.md §5). The wire type stays an
 * open string because plugins declare their own types (e.g. `todo`, §10) — a
 * closed enum here would make every plugin a contract change.
 */
export const CORE_DOC_TYPES = ["note", "thread", "view", "template", "skill", "agent-def"] as const;

export const CoreDocTypeSchema = z.enum(CORE_DOC_TYPES);

export const DocTypeSchema = z
  .string()
  .min(1)
  .openapi({
    description: `Document type. Core values: ${CORE_DOC_TYPES.join(", ")}. Plugins define their own.`,
    example: "note",
  });

export const DOC_STATUSES = ["open", "resolved", "archived"] as const;

export const DocStatusSchema = z.enum(DOC_STATUSES).openapi({
  description:
    "Lifecycle status; meaning is per type. Archiving is a reversible flip, never a deletion.",
});

/**
 * Folder placement under `data/docs/`. Creation is inbox-first (SPEC.md §11
 * "zero-form, inbox-first"), so an omitted folder lands the document in
 * `data/docs/inbox/` rather than at the root — unless the type being created has
 * a root of its own that it can actually land in, which
 * {@link CREATE_FOLDER_DESCRIPTION} spells out.
 *
 * "Has a root of its own" is not the same as "lands there", and the difference
 * is the whole reason this qualifier keeps having to be re-added (PR #49 review,
 * three times in one phase). Two types do not land here, and they are decided
 * by two different functions — naming only one of them is how this comment came
 * to be wrong about the other.
 *
 * `rootForType` (`apps/server/src/docs/write.ts`) yields exactly **one**:
 * `agent-def` → `.claude/agents/` (SPEC.md §7). `thread` is not in it at all —
 * `NAMEABLE_ROOTS` drops every root whose path starts with `data/`, so
 * `rootForType("thread")` is `null` and `resolveFolder` answers
 * `data/docs/inbox` for a thread exactly as for a note. The thread exception is
 * `allocatePath` (`apps/server/src/docs/create.ts`), which returns
 * `data/threads/<id>.md` (SPEC.md §4) *after* the folder has been resolved and
 * without consulting it. So a `folder` sent with a thread is checked exactly as
 * any other create's is — one that fails is still a `400` — and one that passes
 * is then ignored.
 *
 * `skill` is **not** an exception, though §7 gives it `.claude/skills`: that
 * root indexes `SKILL.md` files alone, so `projectionIndexesFolder` is false for
 * it, `rootForType("skill")` is `null`, and a skill created with no folder lands
 * here in the inbox like anything else.
 *
 * This constant is the `data/docs` default and nothing more; the roots outside
 * it are not folders under it.
 */
export const DEFAULT_DOC_FOLDER = "inbox";

/**
 * **Create and move do not share a folder grammar, so they do not share a
 * description** (CONTRACT-062). They did until SERVER-122 gave *create* the
 * `type`-aware half below — an omitted `folder` filing into the root the `type`
 * declares, and a declared root nameable outright — which `move` did not get,
 * because a move carries no new type to file under. One sentence serving both
 * was worse than a wrong one: right for move, wrong for create, and with nothing
 * in it telling a reader which route it was about.
 *
 * Both are written against `resolveFolder(folder, forType)`
 * (`apps/server/src/docs/write.ts`), which is what a caller actually meets —
 * and both state what a caller may conclude rather than restating how the
 * server derives it (SERVER-114). In particular the roots are *not* enumerated
 * here: the server reads them off its own root table, so a root declared later
 * is reachable without a contract change, and the one example named
 * (`.claude/agents`) is named because it is the one the product's own agent
 * depends on.
 *
 * **The check every version of this sentence has failed** (PR #49 second
 * review): take the finished sentence back to `DOCUMENT_ROOTS`
 * (`apps/server/src/projection/roots.ts`) and ask of each of the five roots
 * whether it is true of a document filed there. `.claude/skills` and
 * `.claude/skills-archived` are why the "takes ordinary markdown documents"
 * qualifier cannot be dropped — a `type: skill` create with no folder lands in
 * the inbox — and `data/threads` is why the closing clause exists: `thread` is
 * the one type `allocatePath` places before `folder` is consulted at all, so
 * neither the inbox default nor "an explicit folder wins" holds for it.
 */
const CREATE_FOLDER_DESCRIPTION =
  "Folder under `data/docs/`, accepted either as a bare name (`finance`) or as the full prefix " +
  `(\`data/docs/finance\`). Defaults to \`${DEFAULT_DOC_FOLDER}\` — creation is inbox-first ` +
  "(SPEC.md §11), and the agent files inbox arrivals per its skill — **except for a type that " +
  "SPEC.md §7 gives a document root of its own that takes ordinary markdown documents**, which " +
  "is where an omitted `folder` files it: a " +
  "`type: agent-def` document lands in `.claude/agents/`, so creating a persona never requires " +
  "knowing a path. Such a root may also be named outright, by its exact declared path " +
  "(`.claude/agents`) — that path itself, never a folder beneath it. It must hold the type being " +
  "created: a root overrides the type of every file under it, so naming one that holds something " +
  "else is a `400` rather than a document that is not the one you asked for. A root that does " +
  "not take an ordinary `*.md` is out of reach for the same reason it is not a default — " +
  "`.claude/skills` indexes `SKILL.md` files alone, so naming it is a `400` and a `type: skill` " +
  `create with no folder still lands in \`${DEFAULT_DOC_FOLDER}\`; a skill is created with ` +
  "`POST /api/skills`. An explicit folder always wins over that default, so " +
  '`folder: "inbox"` still files an `agent-def` under `data/docs/` as a document *about* a ' +
  "persona. **One type is placed by neither rule**: a `type: thread` document is flat at " +
  "`data/threads/<id>.md`, named by its id (SPEC.md §4), so a `folder` sent with one is still " +
  "checked but never changes where it lands — and a thread is normally created by " +
  "`POST /api/threads`.";

/**
 * **A title is refused only where the filename is an address** (PR #49 review;
 * `allocatePath` in `apps/server/src/docs/create.ts`).
 *
 * Under `data/docs/` a title collision is not a refusal at all: the id is
 * identity and the path is presentation (SPEC.md §5), so the server dedupes the
 * filename — `analyst.md`, then `analyst-2.md` — and two documents may share a
 * title forever. Under a root where the filename *is* the name the document
 * answers to, that same dedupe would file a second persona at `@analyst-2`, an
 * address nobody asked for, while `@analyst` went on meaning the older document
 * (SPEC.md §8). So the create is refused there instead, and the refusal is
 * published on `title` because `title` is the field the `400` names and the
 * field the caller has to change.
 *
 * Written against the server rather than against a proposal, and stating what a
 * caller may conclude rather than how the server derives it (SERVER-114): the
 * roots are not enumerated, because the condition is a property of the root's
 * declared shape, and a root declared later inherits the rule without a contract
 * change.
 */
const CREATE_TITLE_DESCRIPTION =
  "Human-readable title, and the source of the document's filename (`Analyst` → `analyst.md`; a " +
  "thread is named by its id instead). Under `data/docs/` two documents may share a title — the " +
  "id is identity and the path is presentation (SPEC.md §5), so the filename dedupes to " +
  "`analyst-2.md` — and a create there never fails on the title. **In a root where the filename " +
  "is the name the document answers to it can**: `.claude/agents/analyst.md` is what makes " +
  "`@analyst` resolve (SPEC.md §8), so deduping would file a second persona at an address nobody " +
  "asked for and the create is a `400` naming the name already taken. Edit the existing document " +
  "with `PUT /api/docs/{id}`, or choose a title that names something else.";

/**
 * **Move's half of the split sentence was wrong for move too** (CONTRACT-063; PR
 * #49 second review). CONTRACT-062 separated the two constants and deliberately
 * left this one byte-identical, so that the split could not be accused of
 * quietly giving move a grammar it never had. What it left behind published a
 * falsehood: the field is `z.string()` — required, no `.default()` — and the
 * text said it "Defaults to `inbox`", then explained that default with
 * *creation* being inbox-first, a rule about a route this field is not on.
 *
 * Written from `moveDocument`/`planMove` (`apps/server/src/docs/move.ts`) and
 * from `resolveFolder(folder)` called with **no type**, which is what makes
 * move's grammar the plain one: `admitRoot` refuses a named root whose declared
 * type is not the type being filed, and a move supplies none, so every root in
 * `DOCUMENT_ROOTS` outside `data/` is a `400` here rather than a destination.
 * That refusal is stated rather than left out, because it is the question a
 * caller arrives with after reading create's field.
 */
const MOVE_FOLDER_DESCRIPTION =
  "Destination folder under `data/docs/`, accepted either as a bare name (`finance`) or as the " +
  "full prefix (`data/docs/finance`). **Required, and it has no default**: a move names where " +
  "the document is going. Nothing here is inbox-first — that is creation's rule " +
  "(`POST /api/docs`, SPEC.md §11), and a document being moved already has a folder. Every " +
  "destination is under `data/docs/`: a move carries no type, and each document root SPEC.md §7 " +
  "adds alongside `data/` holds exactly one type, so naming one (`.claude/agents`) is a `400` — " +
  "filing a document into such a root is part of creating it, not of moving it. The filename " +
  "does not change, so a destination that already holds a file of that name is a `400` and never " +
  "an overwrite.";

/**
 * **Nullable timestamps (CONTRACT-005 decision, 2026-07-27; extended to
 * `DocFrontmatter` by the SERVER-005 escalation, 2026-07-27).** A document's
 * `created`/`updated` are legitimately absent: a hand-written `SKILL.md` carries
 * no frontmatter timestamps, and the projection stores NULL for it. The wire
 * says `null` rather than an epoch sentinel — the sentinel is a lie every
 * consumer then has to special-case, and "we do not know" is not "1970".
 * Staleness treats an unknown age as **fresh** (`stale: null`), never as
 * ancient, which is the same reading `docs/staleness.ts` already implements.
 *
 * Both response-side shapes say the same thing. The list row (`docRowBaseShape`,
 * `GET /api/docs`) and the single document (`DocFrontmatter`,
 * `GET /api/docs/{id}` and every mutation response) must not disagree about the
 * same file: reading one skill through the two routes previously yielded `null`
 * from one and `1970-01-01T00:00:00Z` from the other.
 *
 * This is a *response*-side statement only. The server's own file-parsing
 * schemas are separate and unaffected.
 */
const UNDATED_DESCRIPTION = (which: string): string =>
  `When the document was ${which}, or \`null\` when the file carries no such timestamp — a ` +
  "hand-written skill file legitimately has none. Render it as “—” rather than " +
  "substituting a date; staleness treats an unknown age as fresh.";

/**
 * **The §11 view keys are first-class core fields, not extra frontmatter**
 * (CONTRACT-011 design decision, 2026-07-27). Three reasons, in force order:
 *
 * 1. Two of the four are server semantics — `pinned` is a `GET /api/docs`
 *    filter and `order` is a sort key, and a key the server filters and sorts
 *    on is by definition not opaque passthrough. Routing them through `extra`
 *    would mean the server reaching into a blob it promises never to read.
 * 2. §11 makes columns core product ("a column IS a `type: view` document");
 *    core keys are closed and validated here, and `query`'s well-formedness
 *    and `column`'s `<plugin>/<type>` format deserve `400`s at the write
 *    boundary, which `extra` deliberately never provides.
 * 3. It keeps `extra`'s contract absolute — *nothing* in it is ever
 *    interpreted by the server, with no view-key asterisk.
 *
 * Plugin keys (`todo.items`, SPEC.md §12) stay in `extra` (`./extra.js`);
 * that split — closed core, open extra — is the whole shape of the surface.
 *
 * Carried on **every** document, not only views: frontmatter is per-file and
 * `type` is an open string, so any file may hold the keys; they simply mean
 * nothing off a view. Shared verbatim between the list row and the single
 * read — `doc.test.ts` pins the descriptions identical, the same rule the
 * nullable timestamps follow.
 */
const PINNED_DESCRIPTION =
  "True pins this `type: view` document to the board as a column (SPEC.md §11). `false` when " +
  "the file carries no `pinned` key. Filter the column set with `GET /api/docs?pinned=true`.";

const ORDER_DESCRIPTION =
  "Board position of a pinned view, ascending under `sort=order` (SPEC.md §11). `null` when the " +
  "file carries no `order` key — such a column is still placed, by the documented tiebreak " +
  "(`order` with nulls last, then `title`, then `id`). Any finite number is legal, so a reorder " +
  "may write midpoints between neighbours instead of renumbering every column.";

/**
 * The three tag fields on an update, and the one sentence that separates them:
 * `tags` **states the set**, `addTags`/`removeTags` **state the change**.
 *
 * Only the second kind can keep §7's promise. A whole set is not a delta a
 * server can merge — it is a value that overwrites — so two callers that each
 * read a list, appended to it and sent it back would each land a `200` and one
 * of the two tags would be gone. Naming the delta lets the server compute the
 * result against the file it is holding, inside the write lane, which is the
 * same thing `POST /api/docs/bulk`'s `tag` act has always done.
 */
const TAGS_DESCRIPTION =
  "Replace the document's tag set with exactly this list. **Prefer `addTags`/`removeTags` when " +
  "you mean to change one tag**: this field carries the whole set, so it overwrites whatever " +
  "another writer added between your read and your write. Use it when you genuinely mean *these " +
  "and no others* — reordering the set, or clearing it with `[]`.";

const ADD_TAGS_DESCRIPTION =
  "Tags to add, merged **server-side against the file as it stands** (SPEC.md §7's canonical " +
  "keyless write — a write that names its own delta merges with whatever else happened). " +
  "Existing order is preserved and additions are appended, so no read is needed first and no " +
  "concurrent tag can be lost. Adding a tag the document already carries is a no-op, not a " +
  "failure. Cannot be combined with `tags`, which states the whole set instead.";

const REMOVE_TAGS_DESCRIPTION =
  "Tags to remove, applied server-side against the file as it stands. Removing a tag the " +
  "document does not carry is a no-op, not a failure. May be sent alongside `addTags`; a tag " +
  "named in both is removed, exactly as `POST /api/docs/bulk`'s `tag` act resolves it. Cannot " +
  "be combined with `tags`.";

const VIEW_QUERY_DESCRIPTION =
  "The stored board query of a `type: view` document (SPEC.md §11): a flat map from " +
  "`GET /api/docs` parameter names to a value or an array of values — arrays OR together, like " +
  'the comma-separated wire form (`{type: ["note", "view"]}` ≡ `type=note,view`). The server ' +
  "stores it and never interprets it: the client compiles it into the collection query and " +
  "renders it as filter chips, so an unknown key degrades in the client, never on the wire. " +
  "`null` when the file carries no `query` key.";

const COLUMN_DESCRIPTION =
  'Plugin column type rendered for this pinned view, as `"<plugin>/<type>"` (SPEC.md §10) — ' +
  "e.g. `todos/board`. `null` when the view is a plain filtered list. A view referencing an " +
  "uninstalled plugin keeps its board position and renders a plugin-missing card (SPEC.md §15).";

const viewQueryValue = z.union([z.string(), z.number(), z.boolean()]);

export const ViewQuerySchema = z
  .record(z.string().min(1), z.union([viewQueryValue, z.array(viewQueryValue)]))
  .openapi({ description: VIEW_QUERY_DESCRIPTION });

/** Exactly one `/` between non-empty, whitespace-free plugin and type names. */
export const COLUMN_REF_PATTERN = /^[^/\s]+\/[^/\s]+$/;

/**
 * Response-side view keys plus the open extra object, spread into both
 * `DocFrontmatterSchema` and `docRowBaseShape` — the same instances, so the
 * two routes cannot describe the same file key differently. All present on
 * every response (`false`/`null`/`{}` when the file omits the key): the
 * nullable-not-optional convention `threadRowShape` documents, and what lets
 * the board read its whole column set from the list response with no N+1.
 */
const viewFrontmatterShape = {
  pinned: z.boolean().describe(PINNED_DESCRIPTION),
  order: z.number().nullable().describe(ORDER_DESCRIPTION),
  query: ViewQuerySchema.nullable().describe(VIEW_QUERY_DESCRIPTION),
  column: z.string().nullable().describe(COLUMN_DESCRIPTION),
  extra: ExtraFrontmatterSchema,
} as const;

export const DocFrontmatterSchema = z
  .object({
    id: DocumentIdSchema,
    type: DocTypeSchema,
    title: z.string(),
    created: IsoDateTimeSchema.nullable().describe(UNDATED_DESCRIPTION("created")),
    updated: IsoDateTimeSchema.nullable().describe(UNDATED_DESCRIPTION("last modified")),
    tags: z.array(z.string()),
    status: DocStatusSchema,
    anchors: z
      .record(AnchorIdSchema, TextQuoteSelectorSchema)
      .describe("Text-quote selectors for threads on this document, keyed by anchor id."),
    due: IsoDateSchema.nullable().describe(
      "Optional deadline on any type; surfaces in Attention and filters.",
    ),
    reviewed: IsoDateTimeSchema.nullable().describe(
      'Last explicit "still current" confirmation; staleness runs from max(updated, reviewed).',
    ),
    evergreen: z.boolean().describe("True opts the document out of staleness entirely."),
    origin: originField,
    ...viewFrontmatterShape,
  })
  .openapi("DocFrontmatter");

/** Where a thread's anchor currently lands in the parent body, resolved at read time (SPEC.md §6). */
export const ResolvedAnchorSchema = z
  .object({
    anchorId: AnchorIdSchema,
    selector: TextQuoteSelectorSchema,
    threadId: ThreadIdSchema,
    threadStatus: ThreadStatusSchema,
    range: BodyRangeSchema.nullable().describe(
      "Character range in the current body, or null when the selector no longer resolves. The " +
        "same coordinate space `POST /api/threads/{id}/reattach` accepts, so a range read here " +
        "can be sent straight back.",
    ),
    orphaned: z
      .boolean()
      .describe(
        "True when the selector did not resolve; the thread is still fully functional but detached.",
      ),
  })
  .openapi("ResolvedAnchor");

/**
 * One whole document, and the **one place a key is published** (SPEC.md §7,
 * `./key.ts`).
 *
 * `Doc` is what `GET /api/docs/{id}` answers with and what every document
 * mutation wraps, so putting `key` here is what makes *"every document read
 * carries its key"* and *"every write that lands gives you a fresh key"* the
 * same sentence: a writer reads a key off the document it read, and reads the
 * next one off the document its write answered with. There is no second place a
 * key appears — not on the refusal beside the document, not on a list row — so
 * two copies can never disagree about which version a key names.
 *
 * **A list row deliberately carries no key** (`docRowBaseShape`): a row carries
 * no body, so there is no version of the body to have read, and a key on one
 * would let a caller write a document it never opened — the exact overwrite the
 * mechanism exists to refuse.
 */
export const DocSchema = z
  .object({
    frontmatter: DocFrontmatterSchema,
    body: z.string().describe("Markdown body, without the frontmatter block."),
    path: z
      .string()
      .describe("Path relative to the workspace root. Presentation only — `id` is identity."),
    anchors: z.array(ResolvedAnchorSchema),
    key: documentKeyResponseField,
    userEditing: userEditingField,
  })
  .openapi("Doc");

/**
 * The projection's `documents` columns, without the body (SPEC.md §9.1). Spread
 * rather than `.extend()`-ed into the list row in `query.ts`: zod-to-openapi
 * carries a registered component name onto derived schemas, so building the row
 * from the raw shape is the only way to get two distinctly named components.
 */
export const docRowBaseShape = {
  id: DocumentIdSchema,
  type: DocTypeSchema,
  title: z.string(),
  path: z.string(),
  status: DocStatusSchema,
  tags: z.array(z.string()),
  created: IsoDateTimeSchema.nullable().describe(UNDATED_DESCRIPTION("created")),
  updated: IsoDateTimeSchema.nullable().describe(UNDATED_DESCRIPTION("last modified")),
  due: IsoDateSchema.nullable(),
  reviewed: IsoDateTimeSchema.nullable(),
  evergreen: z.boolean(),
  origin: originField,
  excerpt: z.string().describe("Leading plain-text excerpt of the body, for list rows."),
  ...viewFrontmatterShape,
} as const;

/**
 * Creation is zero-form (SPEC.md §11): a type and a title are the whole
 * requirement, and everything else the server fills in. Those fields are
 * therefore `.optional()` with their server-applied default documented, never
 * `.default()` — see the optional-in/defaulted-out note in `./index.ts`.
 */
export const CreateDocRequestSchema = z
  .strictObject({
    job: jobField,
    type: DocTypeSchema,
    title: z.string().min(1).describe(CREATE_TITLE_DESCRIPTION),
    body: z
      .string()
      .optional()
      .describe("Omit to pre-fill from the type's `template` document when one exists."),
    folder: z.string().optional().describe(CREATE_FOLDER_DESCRIPTION),
    tags: z.array(z.string()).optional().describe("Defaults to no tags."),
    status: z.enum(DOC_STATUSES).optional().describe("Defaults to `open`."),
    due: IsoDateSchema.nullable()
      .optional()
      .describe("Optional deadline. Defaults to `null` — no deadline."),
    evergreen: z
      .boolean()
      .optional()
      .describe("True opts the document out of staleness entirely. Defaults to `false`."),
    pinned: z
      .boolean()
      .optional()
      .describe(
        `${PINNED_DESCRIPTION} Defaults to \`false\` — a view renders as a board column only ` +
          "once pinned.",
      ),
    order: z
      .number()
      .nullable()
      .optional()
      .describe(`${ORDER_DESCRIPTION} Null is the same as omitting it: no \`order\` key.`),
    query: ViewQuerySchema.nullable()
      .optional()
      .describe(`${VIEW_QUERY_DESCRIPTION} Null is the same as omitting it: no \`query\` key.`),
    column: z
      .string()
      .regex(COLUMN_REF_PATTERN, 'A column reference is `"<plugin>/<type>"` — exactly one slash.')
      .nullable()
      .optional()
      .describe(`${COLUMN_DESCRIPTION} Null is the same as omitting it: no \`column\` key.`),
    extra: ExtraFrontmatterSchema.optional(),
  })
  .openapi("CreateDocRequest");

/**
 * Strict (CONTRACT-017): with every field optional, a typoed key — `pinnned`,
 * or a plugin key sent at top level instead of inside `extra` — would otherwise
 * validate as the empty update and silently change nothing.
 *
 * **The one request in this contract that presents a key** (SPEC.md §7,
 * `./key.ts`), and the distinction it draws is the mechanism's whole shape: a
 * write that **replaces a block** — `body` — must name the version it replaces,
 * while a write that **names its own delta** — a tag, a folder, an archive, a
 * status, `reviewed`, a view key — merges with whatever else happened and needs
 * nothing. `KEYED_UPDATE_FIELDS` holds that classification as a list rather than
 * as a rule someone has to re-derive, and the refinement below is what makes the
 * key **required, not optional, where it applies**: an optional field a server
 * may ignore is a lock with extra steps.
 *
 * **`addTags` / `removeTags` are what make §7's sentence true of this route**
 * (SERVER-102). §7 holds adding a tag up as the canonical write that "merges
 * with whatever else happened rather than overwriting it", and `tags` alone
 * cannot do that: it carries the **whole set**, so a client that wanted to add
 * one tag had to read the list, merge it itself and send the result — and two
 * such writers each lose the other's tag, reproducibly. The delta is not a
 * guard bolted onto that; it is the wire shape the sentence always described,
 * and the one `POST /api/docs/bulk`'s `tag` act has had all along.
 */
export const UpdateDocRequestSchema = z
  .strictObject({
    job: jobField,
    origin: originDetachField,
    key: documentKeyRequestField,
    title: z.string().min(1).optional(),
    body: z.string().optional(),
    tags: z.array(z.string()).optional().describe(TAGS_DESCRIPTION),
    addTags: z.array(z.string().min(1)).optional().describe(ADD_TAGS_DESCRIPTION),
    removeTags: z.array(z.string().min(1)).optional().describe(REMOVE_TAGS_DESCRIPTION),
    status: z.enum(DOC_STATUSES).optional(),
    due: IsoDateSchema.nullable().optional(),
    reviewed: IsoDateTimeSchema.nullable()
      .optional()
      .describe('Set to the current instant to record "still current" (SPEC.md §5).'),
    evergreen: z.boolean().optional(),
    // The view keys follow the request's own convention — name only what you
    // change. `null` clears the key from the file; subsequent reads report
    // `null` (`false` for `pinned`, whose absent and false states are one).
    pinned: z.boolean().optional().describe(PINNED_DESCRIPTION),
    order: z
      .number()
      .nullable()
      .optional()
      .describe(`${ORDER_DESCRIPTION} On update, \`null\` clears the key from the file.`),
    query: ViewQuerySchema.nullable()
      .optional()
      .describe(`${VIEW_QUERY_DESCRIPTION} On update, \`null\` clears the key from the file.`),
    column: z
      .string()
      .regex(COLUMN_REF_PATTERN, 'A column reference is `"<plugin>/<type>"` — exactly one slash.')
      .nullable()
      .optional()
      .describe(`${COLUMN_DESCRIPTION} On update, \`null\` clears the key from the file.`),
    extra: ExtraFrontmatterSchema.optional(),
  })
  .refine((patch) => !updateNeedsDocumentKey(patch) || patch.key !== undefined, {
    message: MISSING_DOCUMENT_KEY_MESSAGE,
    path: ["key"],
  })
  /**
   * **Stating the set and stating a change to it are contradictory**, so a
   * request that does both is refused rather than silently resolved in some
   * order (SERVER-102). There is no reading of `{tags: ["a"], addTags: ["b"]}`
   * that is not a guess about which the caller meant, and the client most likely
   * to send it is one half-migrated from the whole-set field — exactly the
   * caller that must be told, not accommodated.
   *
   * Reported at `addTags`, the field that is new: a caller sending only `tags`
   * never sees this, and the one that added a delta is the one being asked to
   * choose.
   */
  .refine(
    (patch) => patch.tags === undefined || (patch.addTags ?? patch.removeTags) === undefined,
    {
      message:
        "send either `tags` (the whole set) or `addTags`/`removeTags` (a change to it), not both — " +
        "they are contradictory instructions and the server will not guess which you meant.",
      path: ["addTags"],
    },
  )
  .openapi("UpdateDocRequest")
  /**
   * The keyed-write rule, **published as JSON Schema rather than only as prose**
   * (OpenAPI 3.1 is JSON Schema 2020-12, so `dependentRequired` is legal here):
   * a reader of `openapi.json` alone learns that a `body` write must carry a
   * `key`, instead of having to take a description's word for it. Derived from
   * {@link KEYED_UPDATE_FIELDS} so the two can never drift.
   *
   * It documents; the refinement above enforces. `openapi-typescript` ignores
   * the keyword, so the generated client still types `key` as optional — which
   * is why the enforcement is the schema's and not the type's.
   */
  .meta({
    dependentRequired: Object.fromEntries(KEYED_UPDATE_FIELDS.map((field) => [field, ["key"]])),
  });

/**
 * Moving a document rewrites its path only (SPEC.md §9.2) — the id is assigned
 * at creation and is immutable, so every `[[ref]]`, anchor and thread `parent`
 * survives a move untouched.
 */
/**
 * Archive and unarchive take **no body at all today**, and this makes one that
 * is entirely optional: §9.2 says *any* write may name the job it serves, and
 * these are writes. Nothing in it is required, so an existing caller that sends
 * no body is unchanged — which is every caller, since the field's only consumer
 * is provenance and provenance is new.
 *
 * It stamps no origin: §9.2 records an origin for a document a job **creates**,
 * and archiving creates nothing. What the job buys here is attribution — the
 * job log and the trace line can say which piece of work archived something.
 */
export const JobOnlyRequestSchema = z.strictObject({ job: jobField }).openapi("JobOnlyRequest");

export const MoveDocRequestSchema = z
  .strictObject({ job: jobField, folder: z.string().describe(MOVE_FOLDER_DESCRIPTION) })
  .openapi("MoveDocRequest");

/**
 * Every save runs anchor reconciliation (SPEC.md §6), so the response reports
 * what moved: clients use it to refresh highlight positions and to surface
 * threads that just became detached.
 */
export const AnchorReconciliationSchema = z
  .object({
    remapped: z
      .array(AnchorIdSchema)
      .describe("Anchors whose selector was recomputed against the new body."),
    orphaned: z
      .array(AnchorIdSchema)
      .describe("Anchors whose text was removed; their threads are now detached."),
  })
  .openapi("AnchorReconciliation");

/**
 * What every non-editing document mutation returns — create, move, archive,
 * unarchive. The document is wrapped rather than returned bare so §14's
 * warnings have somewhere to live: a hook that rejected the auto-commit, or a
 * workspace with no git, must surface on the response and not only in a log.
 */
export const DocMutationResponseSchema = z
  .object({ doc: DocSchema, warnings: warningsField })
  .openapi("DocMutationResponse");

/**
 * What a write that changes a document's **content** answers with — the saved
 * document (carrying its fresh key), what reconciliation did to the anchors, and
 * §14's warnings.
 *
 * Shared verbatim between `PUT /api/docs/{id}` and `POST /api/docs/{id}/patch`
 * (`./doc-patch.js`) rather than restated, so the two cannot describe the same
 * outcome differently: a patch is an ordinary write once applied, and "ordinary"
 * has to be true of the response as well as of the commit. Spread rather than
 * `.extend()`-ed, for the reason `docRowBaseShape` documents — zod-to-openapi
 * carries a registered component name onto anything derived from it.
 */
export const docWriteResponseShape = {
  doc: DocSchema,
  anchors: AnchorReconciliationSchema,
  warnings: warningsField,
} as const;

export const UpdateDocResponseSchema = z
  .object({ ...docWriteResponseShape })
  .openapi("UpdateDocResponse");

/**
 * Deletion is user-only (SPEC.md §7, §9.2). Nothing is hard-deleted from
 * history: git keeps the file, and the document's threads survive as orphaned
 * records that still name it as `parent`.
 */
export const DeleteDocResultSchema = z
  .object({
    deletedId: DocumentIdSchema,
    orphanedThreadIds: z
      .array(ThreadIdSchema)
      .describe(
        "Threads that named the deleted document as `parent`. They keep that id and remain " +
          "readable; their anchors no longer resolve. Drop their caches.",
      ),
    warnings: warningsField,
  })
  .openapi("DeleteDocResult");

export type ViewQuery = z.infer<typeof ViewQuerySchema>;
export type DocType = z.infer<typeof DocTypeSchema>;
export type CoreDocType = z.infer<typeof CoreDocTypeSchema>;
export type DocStatus = z.infer<typeof DocStatusSchema>;
export type DocFrontmatter = z.infer<typeof DocFrontmatterSchema>;
export type ResolvedAnchor = z.infer<typeof ResolvedAnchorSchema>;
export type Doc = z.infer<typeof DocSchema>;
export type CreateDocRequest = z.infer<typeof CreateDocRequestSchema>;
export type UpdateDocRequest = z.infer<typeof UpdateDocRequestSchema>;
export type MoveDocRequest = z.infer<typeof MoveDocRequestSchema>;
export type AnchorReconciliation = z.infer<typeof AnchorReconciliationSchema>;
export type DocMutationResponse = z.infer<typeof DocMutationResponseSchema>;
export type UpdateDocResponse = z.infer<typeof UpdateDocResponseSchema>;
export type DeleteDocResult = z.infer<typeof DeleteDocResultSchema>;
