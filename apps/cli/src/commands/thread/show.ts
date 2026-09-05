import { plural } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import {
  ARCHIVING_IS_NOT_A_CAUSE,
  GENERAL_RESIDENT,
  MISSING_PROFILE_CAUSES_PHRASE,
  PROFILE_MISSING,
  residentLabel,
} from "../resident.js";
import {
  renderTurnIndex,
  selectTurns,
  totalTurnBytes,
  turnAddress,
  turnBytes,
  turnIndexRows,
  type TurnAddress,
  type TurnLike,
} from "./turns.js";

/**
 * `corpus thread show` — the read half of the conversation surface (SPEC.md §6,
 * §8). §7's comment skill reads a thread before it replies, and a thread's state
 * lives in the projection as much as in its file: which document it hangs off,
 * whether the anchor still resolves, and whether the agent is engaged are
 * answers the server owns.
 *
 * **It renders exactly what `GET /api/threads/{id}` returns** — turns, status,
 * agent state, parent and anchor (sprint-013 Adjudication 14). The endpoint
 * carries no `events` array, so this verb reports none — a fabricated list would
 * be worse than none.
 *
 * **Read-state it does report, since CONTRACT-036.** The endpoint now carries
 * `unread`, computed server-side against the `.corpus/seen.json` mark, so the
 * flag is the server's answer rather than this session's guess. Reading it
 * clears nothing: the only read-state *mutation* is `POST /api/threads/{id}/seen`,
 * which a read verb must never call — showing a thread would silently clear its
 * unread badge in the board.
 *
 * The three thread shapes §7's skill branches on are named in the output rather
 * than left to be inferred from two nulls: anchored to a selection, on a whole
 * document, or standalone.
 *
 * ## Reading part of a conversation (CLI-076)
 *
 * `--index` prints the map — one row per turn with its size — and `--turn`,
 * `--turns`, `--last` and `--since` print the territory. `turns.ts` owns the
 * derivation and records the six decisions behind it; what matters here is the
 * one difference between the two printing paths.
 *
 * **The whole read keeps its `trimEnd`, and an addressed read does not**
 * (decision 4). Trimming is right for a human reading a conversation top to
 * bottom and wrong for a slice meant to be quoted: `corpus search`'s prettified
 * snippet lost that argument already, matching zero times when it was pasted
 * back (CLI-055). So an addressed turn's body is written raw — nothing trimmed,
 * nothing appended after the last one — while the no-flag path prints exactly
 * what it printed before this existed. The `author · ts` line above each body,
 * and the blank line between two of them, are this verb's framing rather than
 * stored bytes, and the help says so.
 */

/** What an absent value renders as, matching `corpus doc show`. */
const NONE = "—";

export async function runThreadShow(context: WorkspaceCommandContext): Promise<void> {
  const wantsIndex = context.flags.boolean("index");
  const address = turnAddress(context.flags);
  const id = context.args.get("id");
  const thread = await context.client.request((api) =>
    api.GET("/api/threads/{id}", { params: { path: { id } } }),
  );

  if (wantsIndex) {
    showTurnIndex(context, thread);
    return;
  }
  if (address !== undefined) {
    showAddressedTurns(context, thread, address);
    return;
  }

  context.out.emit(thread);

  context.out.line(thread.title);
  // `unread` arrived on this endpoint with CONTRACT-036 (v0.22.0). Before it,
  // this verb reported no read-state because the endpoint carried none and a
  // fabricated flag is worse than none. Both reasons are gone: the server
  // answers it from the `.corpus/seen.json` mark, and reading it clears
  // nothing — only `POST /api/threads/{id}/seen` does that, and a read verb
  // must never call a mutation.
  context.out.line(
    `${thread.id} · ${thread.status} · agent ${thread.agent} · ${thread.unread ? "unread" : "read"}`,
  );
  context.out.line(
    `parent ${thread.parent ?? NONE} · anchor ${thread.anchor ?? NONE} · ${shapeOf(thread.parent, thread.anchor)}`,
  );
  // Printed only when there is one, because absence is the ordinary state of
  // almost every thread and a `resident —` line on all of them would be noise
  // (SPEC.md §7: dissolving is the absence of a resident, never a third state).
  //
  // It reports the **designation** and says nothing about whether that agent is
  // running: liveness belongs to one lane's roster row, is read from a different
  // endpoint, and the two may legitimately disagree for a grace window. Printing
  // both here would present them as one fact. `corpus agents` is where presence
  // is answered.
  //
  // Rendered through the shared label, because since SHARED-048 a resident's
  // `name` and `docId` are each nullable and the three combinations mean three
  // different things — interpolating them raw printed `resident null · null` for
  // the ordinary case.
  const resident = thread.resident;
  if (resident !== null && resident !== undefined) {
    context.out.line(`resident ${residentLabel(resident)}`);
  }
  context.out.line(`created ${thread.created} · updated ${thread.updated}`);
  context.out.line(`tags ${thread.tags.length === 0 ? NONE : thread.tags.join(", ")}`);

  if (thread.turns.length === 0) {
    context.out.line("");
    context.out.line("(no turns)");
    return;
  }

  // Oldest first, as the wire orders them: a conversation read backwards is a
  // different conversation.
  for (const turn of thread.turns) {
    context.out.line("");
    context.out.line(`${turn.author} · ${turn.ts}`);
    context.out.line(turn.body.trimEnd());
  }
}

/**
 * The map: a header, then one row per turn, and **nothing else**.
 *
 * No state lines, no tags, no bodies. The 19-turn conversation that prompted
 * this issue reads whole at 32,375 bytes and indexes at about a twentieth of
 * that, and every line the index prints that a caller did not ask for is paid
 * on the same loop the whole read was costing.
 */
function showTurnIndex(
  context: WorkspaceCommandContext,
  thread: {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly turns: readonly TurnLike[];
  },
): void {
  const rows = turnIndexRows(thread.turns);
  const bytes = totalTurnBytes(thread.turns);

  context.out.emit({
    id: thread.id,
    title: thread.title,
    status: thread.status,
    turnCount: rows.length,
    bytes,
    index: rows,
  });

  context.out.line(
    `${thread.title} · ${thread.id} · ${thread.status} · ${plural(rows.length, "turn")} · ` +
      `${String(bytes)} bytes`,
  );
  if (rows.length === 0) {
    context.out.line("(no turns)");
    return;
  }
  for (const line of renderTurnIndex(rows)) context.out.line(line);
}

/**
 * The territory: the addressed turns, each body written **raw**.
 *
 * `out.write` rather than `out.line`, for the reason `corpus doc show
 * --section` uses it — `line` appends a newline the body may not carry, and
 * that one newline is the difference between an excerpt that matches what is
 * stored and one that does not. The blank line between two turns is inserted
 * before the next heading rather than after the previous body, so the last
 * thing this path writes is always the last turn's bytes and nothing after
 * them.
 *
 * An empty selection is only ever `--since` asking what is new and being told
 * nothing is, or an addressed read of a thread with no turns at all. Both print
 * one line saying exactly that. Neither prints the conversation.
 */
function showAddressedTurns<T extends TurnLike>(
  context: WorkspaceCommandContext,
  thread: { readonly id: string; readonly turns: readonly T[] },
  address: TurnAddress,
): void {
  const selected = selectTurns(thread.turns, address);

  context.out.emit({
    id: thread.id,
    turnCount: thread.turns.length,
    turns: selected.map((entry) => ({
      turn: entry.turn,
      ...entry.value,
      bytes: turnBytes(entry.value.body),
    })),
  });
  if (context.out.json) return;

  if (selected.length === 0) {
    context.out.line(address.kind === "since" ? `(no turns after ${address.value})` : "(no turns)");
    return;
  }

  selected.forEach((entry, position) => {
    if (position > 0) context.out.write("\n");
    context.out.line(`${entry.value.author} · ${entry.value.ts}`);
    context.out.write(entry.value.body);
    if (position < selected.length - 1 && !entry.value.body.endsWith("\n")) {
      context.out.write("\n");
    }
  });
}

/** The three shapes a thread can have (SPEC.md §6), named rather than implied. */
function shapeOf(parent: string | null, anchor: string | null): string {
  if (parent === null) return "standalone";
  return anchor === null ? "whole document" : "anchored to a selection";
}

export const showCommand: WorkspaceCommandSpec = {
  name: "show",
  summary: "Read a conversation: its status, its anchoring, and every turn.",
  description:
    "Reads `GET /api/threads/{id}` and renders it as the wire returns it — title, status, agent " +
    "state, parent, anchor and every turn oldest first, each with its author and timestamp. The " +
    "anchoring line names which of the three shapes the thread has: anchored to a selection, on " +
    "a whole document (`parent` set, no anchor), or standalone (neither). This is the context " +
    "SPEC.md §7's comment skill reads before it replies. A designated thread also prints a " +
    "`resident` line naming the agent that owns the conversation, with the `agent-def` document " +
    "that defines it where it has one — a resident designated with no profile prints as " +
    `\`${GENERAL_RESIDENT}\`, and one whose profile has since been ` +
    `${MISSING_PROFILE_CAUSES_PHRASE} prints \`name (${PROFILE_MISSING})\`. ` +
    `${ARCHIVING_IS_NOT_A_CAUSE}, so the line keeps printing its id. ` +
    "Where the designation chose a weight " +
    "(SPEC.md §7, rider signed 2026-08-19) the line names it after the resident — `resident a " +
    "general resident at heavy` — with the word taken from this workspace's own agent guidance " +
    "rather than being a model name, and a designation that chose none prints nothing extra. " +
    "An undesignated thread prints no such line, because having nobody " +
    "resident is the ordinary state rather than a value. That line reports the **designation** " +
    "and says nothing " +
    "about whether the agent is currently running — presence is one lane's row in " +
    "`corpus agents`, and the two are separate reads that may honestly disagree for a moment. " +
    "The id line ends in `unread` or `read`, which the server answers from its own " +
    "seen mark — so it survives a browser change and does not depend on this session having " +
    "read anything. Asking does **not** clear it: only `POST /api/threads/{id}/seen` does, and " +
    "this verb never calls a mutation. A thread id that names nothing is the server's `404`, " +
    "which is exit 5.\n\n" +
    "**A conversation can be read in part rather than whole** (CLI-076), which is what stops " +
    "every reply paying for every turn ever written: a 19-turn thread measured 32,375 bytes, and " +
    "the cost grows each time somebody speaks. `--index` prints the map — a header, then one row " +
    "per turn with its author, its timestamp, its size in bytes and a marked first-line excerpt " +
    "— and nothing else. `--turn`, `--turns`, `--last` and `--since` print the turns themselves. " +
    "Read the index, decide, fetch what you need: it is `corpus doc show --headings` and " +
    "`--section` for threads, and the same rule holds — **an address that names nothing is " +
    "refused (exit 2) and never answered with the whole conversation**.\n\n" +
    "**An addressed turn is byte-exact and a whole read is not.** With no flags every turn's " +
    "body has its trailing whitespace trimmed, which is right for reading and wrong for " +
    "quoting, and that behaviour is unchanged. An addressed turn's body is written exactly as " +
    "stored: nothing trimmed, nothing collapsed, no newline appended after the last one. The " +
    "`author · ts` line above each body and the blank line between two turns are this verb's " +
    "framing, not stored bytes — `--json` is where the bodies arrive with no framing at all.\n\n" +
    "These flags narrow **what you read, not what crosses the wire**: it is the same single " +
    "request either way, and the saving is in the reader's context. The index's byte counts are " +
    "the turn's body in UTF-8, heading line excluded, so the header's total is exactly the sum " +
    "of the rows and a row predicts what `--turn <n>` will print.",
  args: [{ name: "id", required: true, description: "The thread's id." }],
  flags: [
    {
      name: "index",
      type: "boolean",
      description:
        "Print the conversation's map instead of the conversation: a header, then one row per " +
        "turn. The header names the title, the id, the status, the turn count and the total " +
        "bytes; each row carries an ordinal, an author, a timestamp, the body's size and a " +
        "first-line excerpt. **An excerpt that leaves " +
        "anything out ends in `…`**, so it can never be mistaken for the stored text. The rows " +
        "carry no bodies, which is the point: it is a few hundred bytes against tens of " +
        "thousands. Under `--json` the same rows arrive with a `truncated` flag per row and no " +
        "`body` key anywhere. Refused beside an address flag (exit 2) — run it first, then " +
        "address what is worth reading.",
    },
    {
      name: "turn",
      type: "string",
      valueName: "n|ts",
      description:
        "Print one turn, byte for byte. Takes **either address**: the ordinal `--index` printed " +
        "(`--turn 7`), or the ISO instant beside it (`--turn 2026-07-28T10:05:00Z`). They differ " +
        "in what survives an edit — SPEC.md §6 makes the timestamp the turn's _identity_, and a " +
        "person may delete a single turn, after which every later ordinal points at a different " +
        "turn while every timestamp still points at its own. Use the ordinal for a decision made " +
        "from an index you just read, and the timestamp for one you are carrying. Naming no turn " +
        "is exit 2.",
    },
    {
      name: "turns",
      type: "string",
      valueName: "a,b-c",
      description:
        "Print several turns: a comma-separated list of ordinals and ranges, `--turns 1,4-6`. " +
        "Ordinals only — a timestamp addresses one turn through `--turn`, since a range written " +
        "over instants cannot be told from the dashes inside them. The turns come back oldest " +
        "first however the list was written, and a repeat is printed once. A backwards range, or " +
        "an ordinal the thread does not have, is exit 2 with nothing printed.",
    },
    {
      name: "last",
      type: "number",
      valueName: "n",
      description:
        "Print the newest `n` turns — the usual way back into a conversation you have been " +
        "away from. Asking for more turns than the thread holds prints every turn and exits 0: " +
        "_the newest 50 of 19_ has an obvious honest answer. `--last 0` does not, and is exit 2.",
    },
    {
      name: "since",
      type: "string",
      valueName: "iso",
      description:
        "Print the turns after an instant, **exclusive**: `--since` the `ts` of the last turn " +
        "you read returns what has been said since, and not that turn again. Nothing new is not " +
        "a failure — it prints one line saying so and exits 0, the same carve-out `--last` gets " +
        "for running past the end. A value that is not a timestamp is exit 2.",
    },
  ],
  examples: [
    {
      command: "corpus thread show th_a1b2c3",
      description: "Read a conversation before replying to it.",
    },
    {
      command: "corpus thread show th_a1b2c3 --index",
      description:
        "The map: one row per turn with its size and a marked excerpt, at a fraction of the " +
        "whole read. This is what a long conversation should be opened with.",
    },
    {
      command: "corpus thread show th_a1b2c3 --last 3",
      description:
        "The three newest turns, byte for byte as stored — enough to answer with, without " +
        "paying for the sixteen before them.",
    },
    {
      command: "corpus thread show th_a1b2c3 --turns 1,7-9",
      description:
        "The opening turn and the exchange the index showed was the interesting one, oldest " +
        "first.",
    },
    {
      command: "corpus thread show th_a1b2c3 --since 2026-07-28T10:05:00Z",
      description:
        "What has been said since the turn you last read — exclusive of it. An empty answer " +
        "prints one line and exits 0.",
    },
    {
      command: "corpus thread show th_a1b2c3 --index --json",
      description:
        'One JSON value: `{"id":"th_a1b2c3","title":"Is 6.1% right?","status":"open",' +
        '"turnCount":19,"bytes":32375,"index":[{"turn":1,"author":"user",' +
        '"ts":"2026-07-28T10:00:00.000Z","bytes":14,"excerpt":"Is 6.1% right?",' +
        '"truncated":false}]}` — derived rows, and no turn body anywhere.',
    },
    {
      command: "corpus thread show th_a1b2c3 --json",
      description:
        'One JSON value: `{"id":"th_a1b2c3","title":"Is 6.1% right?","created":' +
        '"2026-07-28T10:00:00.000Z","updated":"2026-07-28T10:05:00.000Z","status":"open",' +
        '"tags":[],"parent":"doc_a1b2c3","anchor":"anc_1","agent":"engaged","resident":null,"turns":' +
        '[{"author":"user","ts":"2026-07-28T10:00:00.000Z","body":"Is 6.1% right?"}]}`.',
    },
  ],
  handler: (context) => runThreadShow(context),
};
