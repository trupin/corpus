import {
  ACTORS,
  DOC_STATUSES,
  NEEDS_FILTERS,
  STALE_TIERS,
  THREAD_AGENT_STATES,
} from "@corpus/contract";
import type { paths } from "@corpus/contract/client";
import { InternalError, UsageError } from "../errors.js";
import type { CommandContext, FlagSpec } from "../registry/types.js";

/**
 * The structured document filters, declared **once** for every verb that sends
 * them (SPEC.md §9.2).
 *
 * The contract made this a promise rather than a coincidence: `/api/search`'s
 * "structured filters are the same set, with the same semantics (including the
 * archived default), as `GET /api/docs`", and it keeps that promise by building
 * both query schemas from one `docFilterShape`
 * (`packages/contract/src/schemas/query.ts`). The CLI is the other half — the
 * flags an agent actually types. Two hand-maintained flag lists that have to
 * agree is the same drift, one layer up: a filter documented on `doc list` and
 * missing from `search` is a filter the agent re-implements by reading rows.
 *
 * So both verbs spread {@link DOC_FILTER_FLAGS} and both collect the wire query
 * through {@link collectDocFilters}. What stays local to a verb is what the two
 * endpoints genuinely disagree about: `q` (optional on the collection query,
 * required on ranked retrieval), `--limit` (a page size against a top-k cap),
 * and the list-only `--is-parent`, `--sort` and `--offset`, which
 * `/api/search` does not accept and which therefore must not appear on `search`.
 *
 * **`--pinned` used to be the fourth of those, and is gone** (CLI-060, rider 2
 * signed 2026-08-22). A view document has no `pinned` any more — a board lists
 * its own columns — so the filter left `GET /api/docs` in the same act.
 * `--stage` joined this shared list on the same day, on `docFilterShape`, which
 * is why it lands on both verbs with no edit in either.
 *
 * `--is-parent` is the one of those three that is a genuine structural filter and
 * would belong in this shared list on the merits — ranked retrieval over roots
 * only is a sensible ask. It is local to `doc list` because SPEC.md §9.2's
 * signed `/api/search` parameter string does not carry it while the signed
 * `GET /api/docs` one does (CONTRACT-042), so the contract declares it on
 * `DocsQuerySchema` alone. When that rider is signed it moves here and lands on
 * both verbs; until then a flag for it on `search` would go nowhere on the wire.
 */

/** `GET /api/search`'s query, from which the shared filters are exactly the middle. */
type SearchQuery = NonNullable<paths["/api/search"]["get"]["parameters"]["query"]>;

/** `GET /api/docs`'s query — the superset, carrying paging and the board's keys. */
type DocsListQuery = NonNullable<paths["/api/docs"]["get"]["parameters"]["query"]>;

/**
 * The filters both endpoints share, named from the wire so a contract rename
 * stops this module compiling rather than sending a filter nowhere.
 */
export type DocFilters = Omit<SearchQuery, "q" | "limit">;

/**
 * All these helpers read of a command context: the parsed flags. Narrower than
 * the context on purpose — a filter collector has no business with the client,
 * the workspace or the output stream, and the narrow type is what lets the
 * tests call it without standing a server up.
 */
type FlagSource = Pick<CommandContext, "flags">;

type AssertAssignable<Expected, Actual extends Expected> = Actual;

/**
 * The sharing, asserted at compile time: every filter this module collects is a
 * parameter `GET /api/docs` accepts too, with the same type. If the two
 * endpoints ever drift apart in the contract, `doc list` stops compiling here
 * instead of quietly dropping a filter on one of them.
 */
type _SharedFiltersAreCollectionFilters = AssertAssignable<DocsListQuery, DocFilters>;

/**
 * The fifteen shared flags, in the order `doc list` has always published them.
 * `--is-parent` sits between `--unread` and `--due` on that verb, which is why
 * it is spliced in with {@link insertFlagAfter} rather than the array being cut
 * in two: a filter added here still lands on both verbs with no second edit.
 */
export const DOC_FILTER_FLAGS: readonly FlagSpec[] = [
  {
    name: "type",
    type: "string",
    valueName: "a,b",
    description:
      "Comma-separated document types; values OR together. The types the core knows: `note`, " +
      "`thread`, `view`, `template`, `skill`, `agent-def`. Any other value is sent as given — a " +
      "document may carry a `type:` this build has never heard of, and it is still listed and " +
      "still searchable (SPEC.md §5).",
  },
  {
    name: "title",
    type: "string",
    valueName: "text",
    description:
      "Match a document's title. Takes glob patterns — `*` for any run of characters, `?` for " +
      'one — and matches **exactly** without one, so a substring is spelled `"*mortgage*"`. ' +
      "Case-insensitive. Distinct from `--q`, which ranks whole words across the corpus " +
      "(SPEC.md §9.2). **Quote the pattern**: an unquoted `*` is expanded by your shell before " +
      "this command ever sees it.",
  },
  {
    name: "body",
    type: "string",
    valueName: "text",
    description:
      "Match a document's body text, on the same terms as `--title` — glob with a wildcard, " +
      "exact without one. A thread carries its turns in its body, so a pattern reaches turn " +
      'text. Almost every useful body filter wants wildcards: `--body "*rate assumption*"`.',
  },
  {
    name: "tag",
    type: "string",
    valueName: "a,b",
    description:
      "Comma-separated tags; values OR together. Each value takes glob patterns on the same " +
      'terms as `--title`, so `--tag "proj-*"` matches a family of tags.',
  },
  {
    name: "folder",
    type: "string",
    valueName: "path",
    description:
      "Path prefix under `data/docs/`, matching the folder and its descendants. Threads inherit " +
      "their parent's folder. Takes glob patterns, which match the stored path rather than the " +
      'bare name — `--folder "work/*"` — and cannot be combined with `--folder-scope`.',
  },
  {
    name: "status",
    type: "string",
    valueName: "status",
    description: `Lifecycle status: ${DOC_STATUSES.join(", ")}. Passing it replaces the default archived exclusion.`,
  },
  {
    name: "stage",
    type: "string",
    valueName: "a,b",
    description:
      "Comma-separated stage values (SPEC.md §5); values OR together like `--type` and `--tag`, " +
      "and each is an **exact** match. **An empty element selects documents with no stage at " +
      "all** — the null sentinel — so `--stage ,triage` is one request for a kanban's first " +
      'column, which holds its first stage _and_ everything unstaged, and `--stage ""` on its ' +
      "own selects the unstaged. It can never collide with a real stage, because a written stage " +
      "is a non-empty comma-free string. Not thread-only: any document may carry a stage.",
  },
  {
    name: "include-archived",
    type: "boolean",
    description:
      "Include archived documents **alongside** the rest, rather than excluding them — the " +
      "board's archived chip. A no-op next to an explicit `--status`.",
  },
  {
    name: "needs",
    type: "string",
    valueName: "reason",
    description: `The Attention filter (SPEC.md §10): ${NEEDS_FILTERS.join(", ")}. \`me\` is the union of every reason.`,
  },
  {
    name: "parent",
    type: "string",
    valueName: "doc-id",
    description: "Threads whose parent is this document. Thread-only.",
  },
  {
    name: "references",
    type: "string",
    valueName: "doc-id",
    description: "Documents whose body contains `[[<doc-id>]]` — the backlinks of that document.",
  },
  {
    name: "agent",
    type: "string",
    valueName: "state",
    description: `Agent participation state: ${THREAD_AGENT_STATES.join(", ")}. Thread-only.`,
  },
  {
    name: "author",
    type: "string",
    valueName: "user|agent",
    description: "Author of the thread's last turn. Thread-only.",
  },
  {
    name: "unread",
    type: "boolean",
    description:
      "Only threads whose last turn is newer than your last-seen mark. Thread-only, and it " +
      "selects the unread side only — there is no flag for the read side.",
  },
  {
    name: "due",
    type: "string",
    valueName: "date|keyword",
    description:
      "An ISO date (due on or before it) or one of `overdue`, `today`, `week`, resolved against " +
      "the workspace's clock.",
  },
  {
    name: "since",
    type: "string",
    valueName: "iso",
    description: "Documents updated strictly after this ISO 8601 instant.",
  },
  {
    name: "stale",
    type: "string",
    valueName: "tier",
    description: `Staleness tier (SPEC.md §5) and beyond: ${STALE_TIERS.join(", ")}. Evergreen documents never match.`,
  },
];

/**
 * The shared flags with one verb-specific flag placed after a named shared one,
 * so a verb can publish its own order without owning a second copy of the list.
 * An unknown anchor is an internal error at registry-load time — the same moment
 * a malformed registry fails — rather than a flag silently landing last.
 */
export function insertFlagAfter(
  flags: readonly FlagSpec[],
  after: string,
  extra: FlagSpec,
): readonly FlagSpec[] {
  const index = flags.findIndex((flag) => flag.name === after);
  if (index === -1) {
    throw new InternalError(
      `no shared filter flag named "--${after}" to place "--${extra.name}" after`,
    );
  }
  return [...flags.slice(0, index + 1), extra, ...flags.slice(index + 1)];
}

/**
 * The shared half of the wire query, built only from the flags actually passed.
 *
 * The enumerated values are checked against the contract's own lists rather than
 * sent for the server to reject: `--from`'s precedent (`input.ts`) is that a
 * misspelled enum is a usage error naming the alternatives, not a `400` the
 * server had to be asked for. Open-valued parameters — `type`, `tag`, `folder`,
 * `due`, ids — are passed through verbatim, because the CLI does not know the
 * workspace's tags, its folders, or every `type:` its documents carry, and
 * pretending otherwise would refuse valid queries.
 */
export function collectDocFilters(context: FlagSource): DocFilters {
  const { flags } = context;

  const type = flags.string("type");
  const title = flags.string("title");
  const body = flags.string("body");
  const tag = flags.string("tag");
  const folder = flags.string("folder");
  const status = oneOf(context, "status", DOC_STATUSES);
  // Open-valued and, uniquely, meaningful when empty: `--stage ""` is the null
  // sentinel and selects documents carrying no stage at all, so absence and the
  // empty string are two different filters and only `undefined` means "none".
  const stage = flags.string("stage");
  const parent = flags.string("parent");
  const references = flags.string("references");
  const agent = oneOf(context, "agent", THREAD_AGENT_STATES);
  const author = oneOf(context, "author", ACTORS);
  const since = flags.string("since");
  const due = flags.string("due");
  const stale = oneOf(context, "stale", STALE_TIERS);
  const needs = oneOf(context, "needs", NEEDS_FILTERS);

  // Conditional spreads rather than assignment: under
  // `exactOptionalPropertyTypes` an explicit `undefined` is not an absent key,
  // and an absent key is exactly what "no such filter" means on the wire.
  return {
    ...(type === undefined ? {} : { type }),
    ...(title === undefined ? {} : { title }),
    ...(body === undefined ? {} : { body }),
    ...(tag === undefined ? {} : { tag }),
    ...(folder === undefined ? {} : { folder }),
    ...(status === undefined ? {} : { status }),
    ...(stage === undefined ? {} : { stage }),
    ...(parent === undefined ? {} : { parent }),
    ...(references === undefined ? {} : { references }),
    ...(agent === undefined ? {} : { agent }),
    ...(author === undefined ? {} : { author }),
    ...(since === undefined ? {} : { since }),
    ...(due === undefined ? {} : { due }),
    ...(stale === undefined ? {} : { stale }),
    ...(needs === undefined ? {} : { needs }),
    // These select only their true side: absent means "no such filter", and the
    // false side is a query the board's chips do not offer either.
    ...(flags.boolean("include-archived") ? { includeArchived: true } : {}),
    ...(flags.boolean("unread") ? { unread: true } : {}),
  };
}

/** One enumerated flag, checked against the contract's list before anything is sent. */
export function oneOf<T extends string>(
  context: FlagSource,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = context.flags.string(name);
  if (value === undefined) return undefined;

  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new UsageError(`--${name} must be one of: ${allowed.join(", ")} — got "${value}".`);
  }
  return match;
}
