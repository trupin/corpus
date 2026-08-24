import { z } from "zod";
import { ACTORS } from "../actor.js";
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
import { openapi } from "./openapi-metadata.js";

/**
 * Document types the core defines, and they are all of them (SPEC.md §5).
 *
 * **The wire type stays an open string, deliberately** (SPEC.md §12's M6): a
 * workspace may hold a document whose `type:` this build has never heard of —
 * from the workspace's own history, or hand-written — and such a document must
 * still open, render, search and pass `doc check`. A closed enum here would
 * turn every one of them into a `400` at the boundary, which is the one
 * failure this openness exists to prevent. Consumers that only handle the core
 * set narrow with {@link CoreDocTypeSchema}.
 *
 * **`board` joined the set on 2026-08-22** (rider 2, SHARED-064): a board is a
 * `type: board` document listing its columns, its position among boards and its
 * kanban, so the core gives it behaviour and it belongs here. It sits beside
 * `view` because that is what it is made of — a board lists the ids of view
 * documents — and not at the end, which would read as an afterthought rather
 * than as a member of the same family. SPEC.md §5's `type:` comment listed the
 * older six when this was written; it names `board` as of 2026-08-23, applied
 * as a consequence of rider 2 rather than as a new rule.
 */
export const CORE_DOC_TYPES = [
  "note",
  "thread",
  "view",
  "board",
  "template",
  "skill",
  "agent-def",
] as const;

export const CoreDocTypeSchema = z.enum(CORE_DOC_TYPES);

export const DocTypeSchema = openapi(z.string().min(1), {
  description:
    `Document type. Core values: ${CORE_DOC_TYPES.join(", ")}. Open rather than enumerated ` +
    "because a workspace may hold a document whose type this build has never heard of — from " +
    "its own history, or hand-written — and such a document still opens, renders and searches " +
    "(SPEC.md §5, §12's M6).",
  example: "note",
});

export const DOC_STATUSES = ["open", "resolved", "archived"] as const;

export const DocStatusSchema = openapi(z.enum(DOC_STATUSES), {
  description:
    "Lifecycle status; meaning is per type. Archiving is a reversible flip, never a deletion.",
});

/**
 * Folder placement under `data/docs/`. Creation is inbox-first (SPEC.md §10
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
 *
 * **And the second check, added by PR #50's second review**: where the sentence
 * says an explicit folder wins, it is describing a caller filing an `agent-def`
 * outside `.claude/agents/` — so it must also say what that costs. Since
 * SERVER-125 the cost is *all* of the document's addressability: an off-root
 * `agent-def` resolves under neither its filename stem nor its title, so
 * `@<name>` and `POST /api/threads/{id}/resident` both miss it (see
 * `DesignateResidentRequestSchema` and `apps/server/src/threads/resident.ts`).
 * "A document *about* a persona" alone told an API consumer what the document
 * *is* and not what it *answers to*, which is the asymmetry CONTRACT-064 removed
 * from the designation surface and left standing here. The wording is the CLI's
 * (`apps/cli/src/commands/doc/create.ts`), route names substituted for flags —
 * this is the same act described at two surfaces, so it is one sentence, not
 * two.
 */
const CREATE_FOLDER_DESCRIPTION =
  "Folder under `data/docs/`, accepted either as a bare name (`finance`) or as the full prefix " +
  `(\`data/docs/finance\`). Defaults to \`${DEFAULT_DOC_FOLDER}\` — creation is inbox-first ` +
  "(SPEC.md §10), and the agent files inbox arrivals per its skill — **except for a type that " +
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
  "`POST /api/skills`. An explicit folder always wins over that default, which is what keeps a " +
  'document *about* a persona expressible: `type: agent-def` with `folder: "inbox"` still ' +
  "files under `data/docs/`. **What that costs is addressability, and it costs all of it**: a " +
  "persona is loaded and resolved from `.claude/agents/` alone, so an `agent-def` written " +
  "anywhere else answers to neither `@<name>` nor `POST /api/threads/{id}/resident`, under its " +
  "filename stem or its title alike — it is a note about a persona rather than one. " +
  "**One type is placed by neither rule**: a `type: thread` document is flat at " +
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
 *
 * **The source half is deliberately not here** (CONTRACT-065). A move is
 * refused by where the document already sits — `assertMovable` in
 * `apps/server/src/docs/move.ts` — and that is a fact about the document, not
 * about this field. It lives on the route, with a pointer from the last
 * sentence, because CONTRACT-064's lesson is that one rule stated in two places
 * drifts.
 */
const MOVE_FOLDER_DESCRIPTION =
  "Destination folder under `data/docs/`, accepted either as a bare name (`finance`) or as the " +
  "full prefix (`data/docs/finance`). **Required, and it has no default**: a move names where " +
  "the document is going. Nothing here is inbox-first — that is creation's rule " +
  "(`POST /api/docs`, SPEC.md §10), and a document being moved already has a folder. Every " +
  "destination is under `data/docs/`: a move carries no type, and each document root SPEC.md §7 " +
  "adds alongside `data/` holds exactly one type, so naming one (`.claude/agents`) is a `400` — " +
  "filing a document into such a root is part of creating it, not of moving it. The filename " +
  "does not change, so a destination that already holds a file of that name is a `400` and never " +
  "an overwrite. **This is the destination alone**: whether the document may be moved at all " +
  "depends on where it already sits, and `POST /api/docs/{id}/move` states that rule.";

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
 * **The §10 view and board keys are first-class core fields, not extra
 * frontmatter** (CONTRACT-011 design decision, 2026-07-27; widened to the board
 * keys by CONTRACT-074, 2026-08-22). Three reasons, in force order:
 *
 * 1. Several are server semantics — `order` is a sort key, `stage` is a filter,
 *    and `default-open` is a value the server keeps unique across boards. A key
 *    the server filters, sorts or arbitrates on is by definition not opaque
 *    passthrough, and routing one through `extra` would mean the server reaching
 *    into a blob it promises never to read.
 * 2. §10 makes boards core product ("a board is a `type: board` document"); core
 *    keys are closed and validated here, and a `kanban` block's well-formedness
 *    deserves a `400` at the write boundary, which `extra` deliberately never
 *    provides.
 * 3. It keeps `extra`'s contract absolute — *nothing* in it is ever
 *    interpreted by the server, with no view-key asterisk.
 *
 * Every other frontmatter key — anything the core does not define — stays in
 * `extra` (`./extra.js`); that split — closed core, open extra — is the whole
 * shape of the surface.
 *
 * Carried on **every** document, not only views and boards: frontmatter is
 * per-file and `type` is an open string, so any file may hold the keys; they
 * simply mean nothing off the type that uses them. Shared verbatim between the
 * list row and the single read — `doc.test.ts` pins the descriptions identical,
 * the same rule the nullable timestamps follow.
 *
 * **`pinned` is gone, removed rather than deprecated** (rider 2, signed
 * 2026-08-22; the user's decision the same day). A view document is a saved
 * query and nothing more: what puts a column on a board is the board's own
 * `columns` list, so nothing reads `pinned` any more and a key nothing reads is
 * not a core key. A file that still carries one is not an error — it arrives in
 * `extra` like every other key the core does not define — and `corpus upgrade`
 * names the migration that drops it (SPEC.md §2.4, CLI-061). The `pinned=`
 * filter left `GET /api/docs` in the same act.
 */
const ORDER_DESCRIPTION =
  "**A board's position among boards**, ascending under `sort=order` (SPEC.md §10, rider 7). " +
  "`null` when the file carries no `order` key — such a board is still placed, by the documented " +
  "tiebreak (`order` with nulls last, then `title`, then `id`). Any finite number is legal, so a " +
  "reorder may write midpoints between neighbours instead of renumbering every board. **It is a " +
  "board's position and nothing else**: a `type: view` document is a saved query with no position " +
  "of its own, the same view may sit on two boards, and a column's place is its index in that " +
  "board's `columns`.";

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
  "**A view's query, or a kanban board's scope** (SPEC.md §10): a flat map from " +
  "`GET /api/docs` parameter names to a value or an array of values — arrays OR together, like " +
  'the comma-separated wire form (`{type: ["note", "view"]}` ≡ `type=note,view`). On a ' +
  "`type: view` document it is the stored query the column lists; on a kanban board it is the " +
  "scope every derived stage column is drawn from, narrowed per column by that column's own " +
  "`stage=` or `status=`. The server stores it and never interprets it: the client compiles it " +
  "into the collection query and renders it as filter chips, so an unknown key degrades in the " +
  "client, never on the wire. `null` when the file carries no `query` key.";

const viewQueryValue = z.union([z.string(), z.number(), z.boolean()]);

export const ViewQuerySchema = openapi(
  z.record(z.string().min(1), z.union([viewQueryValue, z.array(viewQueryValue)])),
  { description: VIEW_QUERY_DESCRIPTION },
);

/**
 * A stage value as a document may carry it, and as a board may name it.
 *
 * **Comma-free, exactly as a tag is.** `stage=` is a comma-separated OR list
 * (`../schemas/query.ts`), so a stage carrying a comma would be a value the
 * filter could never select — and a kanban column that cannot be queried is a
 * column that silently shows the wrong documents. Tags solved this the same way
 * and for the same reason, so the separator needs no escaping scheme on either
 * field. SPEC.md §5 calls `stage` free-form, and it stays free-form: one
 * reserved character is the price of being filterable, which §5 asks for in the
 * same sentence.
 *
 * Write-side only. The response-side `stage` is a plain nullable string
 * ({@link stageField}), because a response reports what a file holds rather than
 * validating it — the split `TextQuoteSelectorSchema` established.
 */
export const StageValueSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes(","), {
    message:
      "a stage may not contain a comma: `GET /api/docs?stage=` is a comma-separated OR list " +
      "(SPEC.md §5, §10), so a stage with one could never be filtered for.",
  });

const STAGE_DESCRIPTION =
  "**Where the document sits in a workflow** (SPEC.md §5) — free-form, named by the kanban " +
  "boards that use it (§10), written comma-free, and filterable with `GET /api/docs?stage=`. " +
  "`null` when the file carries no `stage` key, which is what puts a document in a kanban's " +
  "**first column**. **It is not `status`, and neither substitutes for the other**: `status` says " +
  "whether work remains, `stage` says where in a workflow the document is, and a document in any " +
  "stage is ordinarily `open`. While a document is in a kanban its stage decides its status — a " +
  "stage the board's `kanban.status` map names writes that status on entry, a stage with no " +
  "mapping writes `open`, in the same commit and named in the response — while writing `status` " +
  "never moves a stage. Two kanbans over the same documents share this one value, so they should " +
  "share a vocabulary.";

const COLUMNS_DESCRIPTION =
  "**The columns of a `type: board` document**: the ids of the `type: view` documents that render " +
  "them, in display order (SPEC.md §10, rider 2). `null` when the file carries no `columns` key " +
  "— which is every non-board document, and also a **kanban** board, whose columns are derived " +
  "one per stage from `kanban.stages` and are not view documents at all. Adding, removing or " +
  "reordering a column edits the board document and never the view, so the same view may sit on " +
  "two boards without either knowing about the other.";

const DEFAULT_OPEN_DESCRIPTION =
  "True on the one board that **receives every open that names no board** (SPEC.md §10, rider 2 " +
  "as amended 2026-08-22): the explorer's clicks, and the first load of a browser that remembers " +
  "no board. `false` when the file carries no `default-open` key. **At most one board carries " +
  "it** — setting it on one clears the others, in the same commit, and the response names the " +
  "documents it changed (SPEC.md §9.2) — and when no board carries it the first board in `order` " +
  "receives those opens instead. The frontmatter key is `default-open`; `defaultOpen` is its wire " +
  "spelling, and `unset` names the frontmatter one.";

/**
 * The one place `stage` is spelled, referenced by both the single read and the
 * list row so the two cannot describe the same file key differently — the rule
 * the nullable timestamps already follow.
 */
const stageField = z.string().nullable().describe(STAGE_DESCRIPTION);

/** The two fields a kanban may be drawn over (SPEC.md §10, rider 6). */
export const KANBAN_FIELDS = ["status", "stage"] as const;

export const KanbanFieldSchema = z.enum(KANBAN_FIELDS);

/**
 * A board drawn as a kanban over one field (SPEC.md §10, rider 6; §5's coupling
 * rule).
 *
 * **Strict, like the form grammar and for the same reason** (CONTRACT-038): the
 * agent writes this block into YAML with §10 as its only reference, so
 * `transitionz` must fail loudly rather than silently mean nothing. Every
 * refusal below names the field it is about, because the caller's next act is to
 * fix that field in a document.
 *
 * **The contract validates shape; the server enforces the status map.** §10 is
 * explicit that the server does not enforce transitions — a person may set the
 * field directly from the reader or the CLI and skip the graph entirely — so
 * nothing here refuses a write for landing a document in an unreachable stage.
 * What is refused is a graph that cannot be drawn: a transition leaving or
 * reaching a stage the board does not declare, a stage leading to itself, a
 * status mapped for a stage that is not on the board.
 *
 * **Absent is not empty.** `transitions` omitted means the linear funnel (each
 * stage leads to its neighbours, both ways — a UI rule); `transitions: {}` means
 * a graph in which nothing may be dragged anywhere. `status` omitted means the
 * board couples no stage to a status; `status: {}` means the same thing and is
 * simply the long way to write it.
 */
export const KanbanSchema = openapi(
  z
    .strictObject({
      field: KanbanFieldSchema.describe(
        "The document field this board's columns are drawn over (SPEC.md §10). `stage` is the " +
          "free-form workflow position of §5; `status` is the three-value lifecycle. Those are the " +
          "only two — a kanban over an arbitrary frontmatter key would be a board over a value the " +
          "server neither filters nor arbitrates.",
      ),
      stages: z
        .array(StageValueSchema)
        .min(1)
        .describe(
          "The stages in **display order**, one column each, distinct. The first is where a " +
            "document in scope with no value for the field sits (SPEC.md §10), which is why a " +
            "client asks for that column with `stage=,<first>` — the first stage or nothing at all, " +
            "in one request. **A kanban over `status` may name only the three statuses of §5**, " +
            `\`${DOC_STATUSES.join("`, `")}\`, because those are the only values that field holds.`,
        ),
      transitions: z
        .record(z.string(), z.array(z.string()))
        .optional()
        .describe(
          "For each stage, the stages a **drag** may reach — the board's transition graph " +
            "(SPEC.md §10). Every key and every value must be one of `stages`, and a stage may not " +
            "lead to itself. **Omitted means the linear funnel**: each stage leads to its " +
            "neighbours, both ways. An empty object is not the same thing — it is a graph nothing " +
            "may be dragged along. A stage the graph does not reach is still reachable by setting " +
            "the field in the document, from the reader or the CLI: the server enforces the status " +
            "map, never the transitions.",
        ),
      status: z
        .record(z.string(), DocStatusSchema)
        .optional()
        .describe(
          "**How a stage decides a status** (SPEC.md §5's coupling rule): entering a stage named " +
            "here writes that status in the same commit, and entering a stage that is not named " +
            "here writes `open`. Every key must be one of `stages`. The coupling is by this " +
            "explicit map and never by a stage's name, so a stage called `archived` couples to " +
            "nothing unless the board says so. Omitted means the board couples no stage at all.",
        ),
    })
    .superRefine((kanban, ctx) => {
      const declared = new Set<string>();
      for (const [index, stage] of kanban.stages.entries()) {
        if (declared.has(stage)) {
          ctx.addIssue({
            code: "custom",
            path: ["stages", index],
            message:
              `duplicate stage \`${stage}\`: a kanban's stages are its columns, and a column ` +
              "appears once.",
          });
        }
        declared.add(stage);
        if (kanban.field === "status" && !DocStatusSchema.safeParse(stage).success) {
          ctx.addIssue({
            code: "custom",
            path: ["stages", index],
            message:
              `\`${stage}\` is not a status: a kanban over \`status\` has the three statuses of ` +
              `SPEC.md §5 as its only possible stages (\`${DOC_STATUSES.join("`, `")}\`).`,
          });
        }
      }
      for (const [from, targets] of Object.entries(kanban.transitions ?? {})) {
        if (!declared.has(from)) {
          ctx.addIssue({
            code: "custom",
            path: ["transitions", from],
            message: `\`${from}\` is not one of \`stages\`: a transition may only leave a stage this board declares.`,
          });
        }
        for (const [index, to] of targets.entries()) {
          if (!declared.has(to)) {
            ctx.addIssue({
              code: "custom",
              path: ["transitions", from, index],
              message: `\`${to}\` is not one of \`stages\`: a transition may only reach a stage this board declares.`,
            });
            continue;
          }
          if (to === from) {
            ctx.addIssue({
              code: "custom",
              path: ["transitions", from, index],
              message: `\`${from}\` may not lead to itself: a drop on the column a document is already in changes nothing.`,
            });
          }
        }
      }
      for (const stage of Object.keys(kanban.status ?? {})) {
        if (!declared.has(stage)) {
          ctx.addIssue({
            code: "custom",
            path: ["status", stage],
            message: `\`${stage}\` is not one of \`stages\`: only a stage this board draws can decide a status.`,
          });
        }
      }
    }),
  "Kanban",
  {
    description:
      "A board drawn as a **kanban** over one field (SPEC.md §10): the field, the stages in " +
      "display order, and optionally the transition graph and the stage-to-status map of §5. Its " +
      "columns are derived one per stage from the board's `query` scope and are not view " +
      "documents; a document in scope with no value for the field sits in the first column. A " +
      "drag follows a transition and nothing else, and anything the graph forbids is still done " +
      "by setting the field in the document — **the server enforces the status map, never the " +
      "transitions**.",
  },
);

/**
 * A nullable reference to the registered {@link KanbanSchema}, spelled as a
 * union rather than as `KanbanSchema.nullable()`.
 *
 * `zod-to-openapi` propagates a registered name onto anything derived from it,
 * so `.nullable()` here would rewrite the shared `Kanban` component to
 * `type: ["object", "null"]` for every route that references it (CONTRACT-037).
 * The union publishes `anyOf: [{$ref: Kanban}, {type: "null"}]` and leaves the
 * component plain, which the "every named component is a plain, non-nullable,
 * undefaulted object" invariant in `openapi.test.ts` exists to keep true.
 */
const nullableKanban = z.union([KanbanSchema, z.null()]);

const KANBAN_ROW_DESCRIPTION =
  "**The kanban definition of a `type: board` document** (SPEC.md §10), or `null` when the file " +
  "carries no `kanban` key — which is every non-board document and every ordinary board, whose " +
  "columns are the view ids in `columns` instead. A board carries one or the other, never both: " +
  "a kanban's columns are derived from its stages.";

/**
 * Response-side view and board keys plus the open extra object, spread into both
 * `DocFrontmatterSchema` and `docRowBaseShape` — the same instances, so the
 * two routes cannot describe the same file key differently. All present on
 * every response (`false`/`null`/`{}` when the file omits the key): the
 * nullable-not-optional convention `threadRowShape` documents, and what lets
 * the board read its whole column set from the list response with no N+1.
 *
 * **Five keys** (CONTRACT-074). Two are a view's or a board's ordering and
 * query; three are a board's own — `columns`, `kanban` and `defaultOpen`. A
 * `column` key once named a renderer `<plugin>/<type>` and a `pinned` key once
 * put a view on the board; with no plugin surface left and boards listing their
 * own columns, neither names anything (SHARED-066, rider 2). A file that still
 * carries one is not an error: it arrives in `extra` like every other key the
 * core does not define (§9.1), round-trips verbatim, and its view renders as the
 * filtered list its `query` describes.
 */
const viewAndBoardFrontmatterShape = {
  order: z.number().nullable().describe(ORDER_DESCRIPTION),
  query: ViewQuerySchema.nullable().describe(VIEW_QUERY_DESCRIPTION),
  columns: z.array(DocumentIdSchema).nullable().describe(COLUMNS_DESCRIPTION),
  kanban: nullableKanban.describe(KANBAN_ROW_DESCRIPTION),
  defaultOpen: z.boolean().describe(DEFAULT_OPEN_DESCRIPTION),
  extra: ExtraFrontmatterSchema,
} as const;

export const DocFrontmatterSchema = openapi(
  z.object({
    id: DocumentIdSchema,
    type: DocTypeSchema,
    title: z.string(),
    created: IsoDateTimeSchema.nullable().describe(UNDATED_DESCRIPTION("created")),
    updated: IsoDateTimeSchema.nullable().describe(UNDATED_DESCRIPTION("last modified")),
    tags: z.array(z.string()),
    status: DocStatusSchema,
    stage: stageField,
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
    ...viewAndBoardFrontmatterShape,
  }),
  "DocFrontmatter",
);

/** Where a thread's anchor currently lands in the parent body, resolved at read time (SPEC.md §6). */
export const ResolvedAnchorSchema = openapi(
  z.object({
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
  }),
  "ResolvedAnchor",
);

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
export const DocSchema = openapi(
  z.object({
    frontmatter: DocFrontmatterSchema,
    body: z.string().describe("Markdown body, without the frontmatter block."),
    path: z
      .string()
      .describe("Path relative to the workspace root. Presentation only — `id` is identity."),
    anchors: z.array(ResolvedAnchorSchema),
    key: documentKeyResponseField,
    userEditing: userEditingField,
  }),
  "Doc",
);

/**
 * **Who made this document's last write** — projected as `documents.last_actor`
 * (SPEC.md §9.1) from §4's attribution, and the row column §7's reflection
 * reads.
 *
 * **On the row and not in the frontmatter, because it is not a frontmatter
 * key.** Nobody writes it and nobody can: it is read off the write that landed,
 * exactly as `excerpt` and `stale` are read off the body and the clock. Putting
 * it on `DocFrontmatter` would claim a file key that does not exist.
 *
 * **Declared here once because two features read it** (CONTRACT-074's brief,
 * and the reason it is not behind a request): UI-153 marks a row with it, and
 * `GET /api/workspace/reflect`'s `changed` counts the same set server-side. The
 * predicate itself is shipped rather than described twice — see `isUnreflected`
 * in `./reflect.js`, which is the one implementation both apply.
 */
const lastActorField = openapi(z.enum(ACTORS), {
  description:
    "The acting party of this document's **last write** (SPEC.md §4, projected as " +
    "`documents.last_actor`, §9.1). Never absent and never null: a document the server has never " +
    "written reads `user`, and so does an out-of-band edit the watcher picked up, because a " +
    "change nobody attributed to the agent is a person's. It is not frontmatter and it is not " +
    "settable — no request carries it. **It is what §7's reflection reads**: a document changed " +
    "only by the agent since the corpus's last reflection is not marked and not counted, since " +
    "the changelog entries and the digest a reflection produces are its output rather than new " +
    "work for it. Pair it with `updated`, `status` and the clock from " +
    "`GET /api/workspace/reflect` — or call `isUnreflected`, which is the one implementation of " +
    "that predicate and the same one the server counts `changed` with.",
  example: "user",
});

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
  stage: stageField,
  tags: z.array(z.string()),
  created: IsoDateTimeSchema.nullable().describe(UNDATED_DESCRIPTION("created")),
  updated: IsoDateTimeSchema.nullable().describe(UNDATED_DESCRIPTION("last modified")),
  due: IsoDateSchema.nullable(),
  reviewed: IsoDateTimeSchema.nullable(),
  evergreen: z.boolean(),
  origin: originField,
  lastActor: lastActorField,
  excerpt: z.string().describe("Leading plain-text excerpt of the body, for list rows."),
  ...viewAndBoardFrontmatterShape,
} as const;

/**
 * Creation is zero-form (SPEC.md §10): a type and a title are the whole
 * requirement, and everything else the server fills in. Those fields are
 * therefore `.optional()` with their server-applied default documented, never
 * `.default()` — see the optional-in/defaulted-out note in `./index.ts`.
 */
export const CreateDocRequestSchema = openapi(
  z.strictObject({
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
    stage: StageValueSchema.nullable()
      .optional()
      .describe(`${STAGE_DESCRIPTION} Null is the same as omitting it: no \`stage\` key.`),
    order: z
      .number()
      .nullable()
      .optional()
      .describe(`${ORDER_DESCRIPTION} Null is the same as omitting it: no \`order\` key.`),
    query: ViewQuerySchema.nullable()
      .optional()
      .describe(`${VIEW_QUERY_DESCRIPTION} Null is the same as omitting it: no \`query\` key.`),
    columns: z
      .array(DocumentIdSchema)
      .nullable()
      .optional()
      .describe(`${COLUMNS_DESCRIPTION} Null is the same as omitting it: no \`columns\` key.`),
    kanban: nullableKanban
      .optional()
      .describe(`${KANBAN_ROW_DESCRIPTION} Null is the same as omitting it: no \`kanban\` key.`),
    defaultOpen: z
      .boolean()
      .optional()
      .describe(
        `${DEFAULT_OPEN_DESCRIPTION} Defaults to \`false\` — creating a board never displaces ` +
          "the one a browser opens onto unless the create says so.",
      ),
    extra: ExtraFrontmatterSchema.optional(),
  }),
  "CreateDocRequest",
);

/**
 * The three frontmatter keys `unset` refuses (SPEC.md §9.2: "for any frontmatter
 * key but `id`, `type` and `created`").
 *
 * They are not a taste: `id` is identity, and every `[[ref]]`, anchor entry and
 * thread `parent` resolves through it; `type` decides what behaviour the core
 * gives the document at all; `created` is the document's birth, which cannot be
 * un-happened. A file missing any of the three is not the same document with a
 * key removed — it is a different document, or none.
 */
export const UNSETTABLE_EXCLUSIONS = ["id", "type", "created"] as const;

/**
 * **`unset` names file keys, not wire keys**, and that is the one decision in it
 * worth writing down (CONTRACT-074).
 *
 * The keys most worth removing are the ones the core has *stopped* defining —
 * `pinned`, a view's `order` — and such a key has no wire spelling at all: it
 * arrives in `extra` under whatever the file calls it. A field that spoke wire
 * names would therefore be unable to name the very keys SPEC.md §2.4 introduced
 * it for. So the spelling is the file's, and the one core key whose two
 * spellings differ is named the file's way: `default-open`, never `defaultOpen`.
 *
 * It names its own delta, so it presents no document key — removing a named key
 * merges with whatever else happened, exactly as `removeTags` does, and it is
 * deliberately not in `KEYED_UPDATE_FIELDS`.
 */
const UNSET_DESCRIPTION =
  "Frontmatter keys to **remove** from the file (SPEC.md §9.2) — how a migration (§2.4) drops a " +
  "key the tool has stopped reading, and what `corpus doc update --unset` sends. Keys are named " +
  "**exactly as the file writes them**, not as this API spells them: the keys most worth removing " +
  "are ones the core no longer defines, and those have no wire spelling at all. Where a core key " +
  "differs, the file's spelling is the one that works — `default-open`, never `defaultOpen`. " +
  "Removing a key the document does not carry is a no-op rather than a failure, exactly as " +
  "`removeTags` is. **`id`, `type` and `created` are refused**, with the offending key named: " +
  "they are the document's identity, its behaviour and its birth. It names its own delta, so it " +
  "presents no `key`.";

/**
 * Strict (CONTRACT-017): with every field optional, a typoed key — `stagee`,
 * or an extra-frontmatter key sent at top level instead of inside `extra` — would otherwise
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
export const UpdateDocRequestSchema = openapi(
  z
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
      // The view and board keys follow the request's own convention — name only
      // what you change. `null` clears the key from the file; subsequent reads
      // report `null` (`false` for `defaultOpen`, whose absent and false states
      // are one). `unset` below is the general form, and the only way to remove a
      // key this schema does not declare.
      stage: StageValueSchema.nullable()
        .optional()
        .describe(`${STAGE_DESCRIPTION} On update, \`null\` clears the key from the file.`),
      order: z
        .number()
        .nullable()
        .optional()
        .describe(`${ORDER_DESCRIPTION} On update, \`null\` clears the key from the file.`),
      query: ViewQuerySchema.nullable()
        .optional()
        .describe(`${VIEW_QUERY_DESCRIPTION} On update, \`null\` clears the key from the file.`),
      columns: z
        .array(DocumentIdSchema)
        .nullable()
        .optional()
        .describe(`${COLUMNS_DESCRIPTION} On update, \`null\` clears the key from the file.`),
      kanban: nullableKanban
        .optional()
        .describe(`${KANBAN_ROW_DESCRIPTION} On update, \`null\` clears the key from the file.`),
      defaultOpen: z
        .boolean()
        .optional()
        .describe(
          `${DEFAULT_OPEN_DESCRIPTION} Setting it \`true\` clears the flag from every other board ` +
            "in the same commit, and the response names those documents.",
        ),
      unset: z.array(z.string().min(1)).optional().describe(UNSET_DESCRIPTION),
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
    /**
     * The three keys a document cannot survive losing, refused **by name** rather
     * than as a class: the caller's next act is to edit that entry out of the
     * array, and a message that only said "some key is reserved" would leave them
     * reading the list themselves.
     */
    .superRefine((patch, ctx) => {
      for (const [index, key] of (patch.unset ?? []).entries()) {
        if ((UNSETTABLE_EXCLUSIONS as readonly string[]).includes(key)) {
          ctx.addIssue({
            code: "custom",
            path: ["unset", index],
            message:
              `\`${key}\` cannot be unset: \`${UNSETTABLE_EXCLUSIONS.join("`, `")}\` are a ` +
              "document's identity, its behaviour and its birth (SPEC.md §5, §9.2). Every other " +
              "frontmatter key may be removed.",
          });
        }
      }
    }),
  "UpdateDocRequest",
)
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
export const JobOnlyRequestSchema = openapi(z.strictObject({ job: jobField }), "JobOnlyRequest");

export const MoveDocRequestSchema = openapi(
  z.strictObject({ job: jobField, folder: z.string().describe(MOVE_FOLDER_DESCRIPTION) }),
  "MoveDocRequest",
);

/**
 * Every save runs anchor reconciliation (SPEC.md §6), so the response reports
 * what moved: clients use it to refresh highlight positions and to surface
 * threads that just became detached.
 */
export const AnchorReconciliationSchema = openapi(
  z.object({
    remapped: z
      .array(AnchorIdSchema)
      .describe("Anchors whose selector was recomputed against the new body."),
    orphaned: z
      .array(AnchorIdSchema)
      .describe("Anchors whose text was removed; their threads are now detached."),
  }),
  "AnchorReconciliation",
);

/**
 * What every non-editing document mutation returns — create, move, archive,
 * unarchive. The document is wrapped rather than returned bare so §11's
 * warnings have somewhere to live: a hook that rejected the auto-commit, or a
 * workspace with no git, must surface on the response and not only in a log.
 */
export const DocMutationResponseSchema = openapi(
  z.object({ doc: DocSchema, warnings: warningsField }),
  "DocMutationResponse",
);

/**
 * What a write that changes a document's **content** answers with — the saved
 * document (carrying its fresh key), what reconciliation did to the anchors, and
 * §11's warnings.
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

export const UpdateDocResponseSchema = openapi(
  z.object({ ...docWriteResponseShape }),
  "UpdateDocResponse",
);

/**
 * Deletion is user-only (SPEC.md §7, §9.2). Nothing is hard-deleted from
 * history: git keeps the file, and the document's threads survive as orphaned
 * records that still name it as `parent`.
 */
export const DeleteDocResultSchema = openapi(
  z.object({
    deletedId: DocumentIdSchema,
    orphanedThreadIds: z
      .array(ThreadIdSchema)
      .describe(
        "Threads that named the deleted document as `parent`. They keep that id and remain " +
          "readable; their anchors no longer resolve. Drop their caches.",
      ),
    warnings: warningsField,
  }),
  "DeleteDocResult",
);

export type ViewQuery = z.infer<typeof ViewQuerySchema>;
export type KanbanField = z.infer<typeof KanbanFieldSchema>;
export type Kanban = z.infer<typeof KanbanSchema>;
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
