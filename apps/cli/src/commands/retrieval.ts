/**
 * What `corpus search` and `corpus doc related` share beyond their filters: the
 * one thing either of them says that is not a result.
 *
 * Retrieval ships in phases (SPEC.md §9.1). Phase A ranks lexically; Phase B
 * adds semantic relevance to the *same* ranked lists. The seam is already on
 * both response envelopes — `semanticIndex`, absent or `current` throughout
 * Phase A with nothing computing it — so the day ranking is running on half an
 * index, the agent reading these lines is told instead of quietly getting worse
 * answers.
 */

/**
 * The degraded-ranking note, or `undefined` when there is nothing to say.
 *
 * **Any value other than `current` is degraded**, which is the contract's
 * published rule rather than this module's shortcut: a Phase B state a released
 * CLI has never heard of must still read as "degraded", so the field can gain
 * values without a client upgrade. That is why the parameter is a plain string
 * and there is no exhaustive match — an unknown state is reported by name.
 *
 * Absent means the server makes no claim, which is Phase A's normal answer and
 * is silent. The note is `#`-prefixed and goes through the human channel only:
 * the result lines are a parse target an agent reads positionally, and `--json`
 * carries the same field in the envelope, so a machine caller never needs the
 * prose.
 */
export function semanticIndexNote(state: string | undefined): string | undefined {
  if (state === undefined || state === "current") return undefined;
  return (
    `# ranking is degraded — the semantic index is "${state}" (SPEC.md §9.1); ` +
    "these results are ranked on the lexical half alone."
  );
}

/**
 * **The document types retrieval does not rank, as this CLI states them**
 * (SERVER-144, on the SPEC.md §7 rider signed 2026-08-24; CLI-069).
 *
 * These two arrays are the CLI's own statement of a rule the **server** owns.
 * They are not, and cannot be, an import of it: `apps/server` is not upstream of
 * `apps/cli` — the dependency direction runs `packages/contract` →
 * `apps/cli` (CLAUDE.md → Repository Structure) — and the rule is not on the
 * contract either, because it is a ranking default rather than a wire shape.
 *
 * So the two statements are held together by measurement instead of by an
 * import. `scripts/retrieval-exclusion-parity.test.ts` seeds a real workspace
 * with one document of every core type, calls the **real** `searchCorpus`,
 * `relatedDocs` and `threadContextPack`, and asserts that the types those three
 * actually drop are exactly the ones named here. Editing the server's list, or
 * changing which surface applies which list, turns that test red — which is the
 * thing that did not exist the two times this help text went false.
 *
 * Every sentence of help below is **composed** from these arrays, counts
 * included, so no number here can be typed by hand and go stale.
 */
export const UNRANKED_SEARCH_TYPES = ["skill", "agent-def"] as const;

/**
 * The same list plus the two types that configure the board.
 *
 * The difference between the two lists is the difference between the two
 * questions. `corpus search` asks _where is this said?_, and a view or a board
 * the user named and can open is a real answer to that. `corpus doc related`
 * and `corpus thread context` ask _what else bears on this?_, and a stored query
 * has no prose, so a hit on one is a title collision dressed as a neighbour.
 */
export const UNRANKED_NEIGHBOUR_TYPES = [...UNRANKED_SEARCH_TYPES, "view", "board"] as const;

/**
 * `template` is deliberately in **neither** list, and this constant exists so a
 * test can say so about the code rather than about a comment.
 *
 * A `template` document is the user's own, written by them for their own use,
 * and excluding what a person wrote from their own search is a different act
 * from excluding what `corpus init` installed. An earlier implementation
 * excluded it and was withdrawn from v0.21.0 partly for that reason.
 */
export const ALWAYS_RANKED_TYPE = "template";

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven"] as const;

/**
 * The size of a type list as an English word, so the sentences below carry no
 * hand-typed figure. The withdrawn implementation's help said `3 of 5 hits` and
 * `Five document types`, and both survived a rewrite of the rule they described.
 */
export function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

/** `` `skill`, `agent-def`, `view` and `board` `` — code-quoted, Oxford-comma-free. */
export function typeList(types: readonly string[]): string {
  const quoted = types.map((type) => `\`${type}\``);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1] ?? ""}`;
}

/**
 * What `corpus search`'s help says about the exclusion, composed from
 * {@link UNRANKED_SEARCH_TYPES}.
 *
 * The `--type` gate is stated because it is the behaviour: `search.ts` applies
 * the exclusion only `if (query.type === undefined)`, so naming **any** type
 * lifts it entirely rather than subtracting from what was named.
 */
export const SEARCH_EXCLUSION_NOTE =
  `**The ranking skips ${countWord(UNRANKED_SEARCH_TYPES.length)} document types by default** ` +
  `(SERVER-144): ${typeList(UNRANKED_SEARCH_TYPES)} — the skills and personas \`corpus init\` ` +
  "installed. Their worked examples are written in realistic domain prose about rates, mortgages " +
  "and filing, so they match the questions a real corpus asks and displace the row you wanted: " +
  "the SHARED-070 audit measured rows pointing at them at **52% of seven retrieval calls' output " +
  "tokens**.\n\n" +
  "**Naming any `--type` turns that default off entirely** — the gate is whether you named a " +
  "type at all, not whether you named an excluded one — so `--type skill` returns every skill " +
  `and \`--type note,skill\` returns both. Nothing is de-indexed either way: this is a default ` +
  "about ranking, never a change to what is searchable, and `doc show` and `doc list` are " +
  `untouched. \`${ALWAYS_RANKED_TYPE}\` is **not** on the list — a template is the user's own ` +
  "writing, and hiding that from their own search would be a different act.";

/** The types the neighbour surfaces drop that `corpus search` deliberately keeps. */
export const NEIGHBOUR_ONLY_TYPES = UNRANKED_NEIGHBOUR_TYPES.filter(
  (type) => !UNRANKED_SEARCH_TYPES.includes(type as (typeof UNRANKED_SEARCH_TYPES)[number]),
);

/**
 * The other half of `corpus search`'s statement: what the neighbour surfaces
 * drop that this verb keeps, and why the two differ.
 */
export const SEARCH_KEEPS_NEIGHBOUR_TYPES_NOTE =
  `**${typeList(NEIGHBOUR_ONLY_TYPES)} are kept here, deliberately.** This verb asks _where is ` +
  "this said?_, and a board or a view you named and can open is a real answer to that. The " +
  "neighbour surfaces — `corpus doc related` and `corpus thread context` — ask _what else bears " +
  "on this?_, where a stored query bears on nothing because it has no prose, so they drop " +
  `${typeList(NEIGHBOUR_ONLY_TYPES)} on top of the ` +
  `${countWord(UNRANKED_SEARCH_TYPES.length)} above. Their exclusion has **no override**: ` +
  "neither verb takes a type.";

/**
 * What the two neighbour surfaces say, composed from
 * {@link UNRANKED_NEIGHBOUR_TYPES}. `verb` names the one being described so each
 * help block reads as a sentence about itself.
 */
export function neighbourExclusionNote(verb: string): string {
  const extra = NEIGHBOUR_ONLY_TYPES;
  const opening = countWord(UNRANKED_NEIGHBOUR_TYPES.length);
  return (
    `**${opening.charAt(0).toUpperCase()}${opening.slice(1)} document types are never ` +
    "neighbours** " +
    `(SERVER-144): ${typeList(UNRANKED_NEIGHBOUR_TYPES)}. The first ` +
    `${countWord(UNRANKED_SEARCH_TYPES.length)} are the tool's own machinery, whose worked ` +
    "examples are realistic domain prose and therefore honeypots — the SHARED-070 audit found " +
    "the top neighbour of a user's mortgage note was the orchestrate skill. The other " +
    `${countWord(extra.length)} are stored queries and column lists: \`${verb}\` asks _what ` +
    "else bears on this?_, and a query with no prose bears on nothing, so a hit on one is a " +
    "title collision dressed as a neighbour.\n\n" +
    "**There is no flag to widen it** — this route takes no type — so the exclusion is " +
    "unconditional here in a way it is not on `corpus search`, which keeps " +
    `${typeList(extra)} and lifts the rest for any \`--type\`. Nothing is de-indexed: ` +
    "`corpus search --type skill` still finds every skill, `corpus doc show` on one still reads " +
    `it, and \`corpus doc related\` **on** a skill as the subject still works. \`${ALWAYS_RANKED_TYPE}\` ` +
    "is **not** excluded — a neighbour surface that hid the user's own templates would hide " +
    "their own writing. It is the neighbour list these types are kept out of, never the corpus."
  );
}
