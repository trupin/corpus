import { MAX_PAGE_LIMIT, type Doc } from "@corpus/contract";
import { ServerResponseError, UsageError } from "../../errors.js";
import { plural } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { documentLines } from "./render.js";
import { documentSections, selectSection, type DocumentSection } from "./sections.js";

/**
 * `corpus doc show` — the CLI's first document *read* (SPEC.md §5, §7), and
 * **the read that hands out the key**. The agent interacts with the system only
 * through the CLI (CLAUDE.md Architecture Decision 2), and a document's state is
 * not fully recoverable from its file: anchors resolve against the *current*
 * body at read time, so whether a thread is still attached is something only
 * `GET /api/docs/{id}` can answer. Parsing the markdown would answer it wrongly
 * — and, since SHARED-041, could not answer at all, because the key names the
 * version the server just handed you.
 *
 * The verb is one request and a rendering. It prints the frontmatter a person
 * reads first, the key a writer presents back, the anchored threads with their
 * resolution state — the context §7's comment skill needs before replying — and
 * then the body. Everything the endpoint returns, including the board keys and
 * the `extra` block of non-core frontmatter, is in `--json`; the human rendering is a summary and
 * says so.
 *
 * Timestamps that the file genuinely lacks (a hand-written `SKILL.md` has none)
 * render as “—”, never as a substituted date: the contract prescribes it, and
 * "we do not know" is not "1970".
 *
 * ## The two narrow reads (CLI-055)
 *
 * `--headings` and `--section` make the same request and print a slice of what
 * it returned. **They save the reader's context, not the wire** — the body still
 * crosses the socket whole, and nothing here should be described as if it did
 * not. That is the cost worth saving: the agent pays for what enters its
 * context, and a targeted read then `corpus doc patch` costs ~20 words in and
 * ~20 out against a whole-document read then `corpus doc edit`'s ~3,500 and
 * ~3,400 (measured, CLI-055).
 *
 * A server-side route would shrink the wire too, and would let the server reuse
 * its own heading scan instead of this file re-stating it. It was rejected for
 * now on two grounds: it needs a contract change and a server change to deliver
 * a saving nobody reported missing, and a section computed server-side would be
 * a *second* definition of "the bytes to quote" sitting beside the body that
 * `POST /api/docs/{id}/patch` actually matches against. Slicing the body this
 * read already holds makes the excerpt a substring of that exact string by
 * construction, which is the property the whole feature turns on.
 *
 * ## Several ids in one call (CLI-057)
 *
 * The saving here is **processes, not bytes**. Each id is still its own request,
 * and reading five documents still moves five bodies over the socket. What it
 * stops costing is five `corpus` invocations, and a `corpus` invocation costs
 * ~159 ms of fixed startup before it does anything (CLI-058) against ~10 ms for
 * a warm local round trip. Five ids in one call is one startup and five round
 * trips instead of five of each — measured at **189 ms against 797 ms**, a
 * saving of 608 ms on one read of five documents.
 *
 * The requests are made **in order, one at a time**. Concurrency would take the
 * five round trips down to roughly one, but that is a second-order gain — some
 * 40 ms against the 608 ms the shared startup already recovered — bought with a
 * failure mode that has to be got right: which of several in-flight failures
 * ends the run, and what has already been printed when one does. Sequential
 * keeps "printed in the order asked for" true by construction and keeps each
 * id's failure exactly the failure a single-id call would have raised.
 *
 * **One id behaves exactly as it did before this existed** — same payload, same
 * lines, same exit codes — because that is the call the agent makes most, and a
 * plural feature that reshaped the singular case would have cost more than it
 * saved.
 */

/**
 * The most ids one call may name, borrowed from the server's own page ceiling
 * rather than invented here: the most documents one read names is the most rows
 * one listing returns. Exceeding it is refused **before any request** with the
 * cap stated (SPEC.md §10's stated-cap rule) — a bounded read that quietly
 * dropped ids past the bound would be the silent half-answer the rule exists to
 * forbid, and 200 sequential round trips is already several seconds.
 */
export const MAX_SHOW_IDS = MAX_PAGE_LIMIT;

/** What the caller asked this read to narrow to, if anything. */
type Narrowing =
  | { readonly kind: "headings" }
  | { readonly kind: "section"; readonly headingPath: string; readonly nth: number | undefined };

/**
 * The flag combination, checked **before the request**: a usage error that cost
 * a round trip would be teaching the caller the wrong thing about its mistake.
 */
export function narrowing(
  context: WorkspaceCommandContext,
  idCount: number,
): Narrowing | undefined {
  const headings = context.flags.boolean("headings");
  const headingPath = context.flags.string("section");
  const nth = context.flags.number("nth");

  // Both narrow to a place *inside* one document, and neither has a plural
  // form worth having: `--section`'s whole value is that its output is the
  // document's own bytes, and two sections joined by anything at all are no
  // longer anyone's bytes. `--headings`' value is a list a caller pastes back
  // in, and a list that has to be attributed to a document first is a list the
  // caller has to take apart.
  if (idCount > 1 && (headings || headingPath !== undefined)) {
    const flag = headings ? "--headings" : "--section";
    throw new UsageError(
      `${flag} reads inside one document, so it takes one id — ${String(idCount)} were given.`,
      {
        hint:
          "Name the one document you want to read into. Several ids without these flags reads " +
          "each document whole, which is what they are for. Nothing was requested.",
      },
    );
  }

  if (headings && headingPath !== undefined) {
    throw new UsageError("--headings and --section ask for different things.", {
      hint:
        "--headings lists the addresses; --section prints the text at one of them. Run " +
        "--headings first, then --section with a path it printed. Nothing was requested.",
    });
  }
  if (nth !== undefined && headingPath === undefined) {
    throw new UsageError("--nth chooses between sections, so it needs a --section to choose in.", {
      hint:
        "Pass --section '<heading path>' as well. --nth only ever matters when a heading path " +
        "names more than one section, and the refusal that happens then says so. Nothing was " +
        "requested.",
    });
  }
  if (nth !== undefined && (!Number.isInteger(nth) || nth < 1)) {
    throw new UsageError(`--nth counts sections from 1, so ${String(nth)} is not a choice.`, {
      hint: "Pass a whole number: --nth 1 is the first section with that heading path in document order.",
    });
  }

  if (headings) return { kind: "headings" };
  if (headingPath === undefined) return undefined;
  return { kind: "section", headingPath, nth };
}

/**
 * The ids to read, in the order given, with a repeat dropped.
 *
 * A repeated id would read the same document twice and print it twice under two
 * separators, which is never what anyone meant by naming it twice. It is read
 * once, at the position it was first named.
 */
export function requestedIds(context: WorkspaceCommandContext): readonly string[] {
  const ids = [...new Set(context.args.list("id"))];
  if (ids.length > MAX_SHOW_IDS) {
    throw new UsageError(
      `at most ${String(MAX_SHOW_IDS)} documents can be read in one call, and ` +
        `${String(ids.length)} ids were given.`,
      {
        hint:
          "Nothing was requested. Read them in batches of that size, or narrow the set first " +
          "with `corpus doc list` or `corpus search`.",
      },
    );
  }
  return ids;
}

export async function runDocShow(context: WorkspaceCommandContext): Promise<void> {
  const ids = requestedIds(context);
  const narrowed = narrowing(context, ids.length);

  if (ids.length > 1) {
    await showSeveral(context, ids);
    return;
  }

  // `requestedIds` refuses an empty list through the registry's required
  // argument, so there is exactly one here.
  const id = ids[0] ?? "";
  const doc = await context.client.request((api) =>
    api.GET("/api/docs/{id}", { params: { path: { id } } }),
  );

  if (narrowed === undefined) {
    context.out.emit(doc);
    for (const line of documentLines(doc)) context.out.line(line);
    return;
  }

  const sections = documentSections(doc.body, doc.frontmatter.title);
  if (narrowed.kind === "headings") {
    showHeadings(context, id, sections);
    return;
  }
  showSection(context, id, selectSection(sections, id, narrowed.headingPath, narrowed.nth));
}

/**
 * The separator between two documents in the human rendering.
 *
 * It carries the id because that is what makes it useful to something other
 * than an eye: `sed -n '/^──── doc_a1b2c3 /,/^────/p'` cuts one document out of
 * the stream. It is drawn with `U+2500`, not with `-` or `=`, because a
 * markdown body may open a line with either of those — `---` is a frontmatter
 * fence and a setext underline both — and a separator a body can forge is not a
 * separator. Nothing can rule that out absolutely, and the honest answer to a
 * caller that needs certainty is `--json`, where the documents are array
 * elements and no parsing is involved at all.
 */
export function documentSeparator(id: string): string {
  const rule = "─".repeat(8);
  return `${rule} ${id} ${rule}`;
}

/**
 * Several documents: one request each, in order, and one payload for the lot.
 *
 * An id that names no document is **not** the end of the read. The other four
 * were asked for in good faith and cost nothing to print, so they are printed,
 * and the misses are named together at the end with exit 5 — the same code and
 * the same `not_found` a single missing id has always produced, so a caller's
 * branch on the exit status does not have to know how many ids it sent.
 *
 * Any *other* failure ends the run where it happens. A `401`, a `500` or an
 * unreachable server is a fact about the run rather than about one id, and
 * pressing on would spend up to 199 more doomed round trips before saying so.
 */
async function showSeveral(
  context: WorkspaceCommandContext,
  ids: readonly string[],
): Promise<void> {
  const found: Doc[] = [];
  const missing: string[] = [];

  for (const id of ids) {
    try {
      found.push(
        await context.client.request((api) =>
          api.GET("/api/docs/{id}", { params: { path: { id } } }),
        ),
      );
    } catch (error) {
      if (!isNotFound(error)) throw error;
      missing.push(id);
    }
  }

  context.out.emit(found);
  for (const [index, doc] of found.entries()) {
    if (index > 0) context.out.line("");
    context.out.line(documentSeparator(doc.frontmatter.id));
    for (const line of documentLines(doc)) context.out.line(line);
  }

  if (missing.length === 0) return;
  throw new ServerResponseError(
    `404 not_found: ${plural(missing.length, "id names", "ids name")} no document — ` +
      `${missing.join(", ")}.`,
    {
      code: "not_found",
      status: 404,
      hint:
        found.length === 0
          ? "None of the ids named a document, so nothing was printed. `corpus doc list` and `corpus search` are where an id comes from."
          : `${
              found.length === 1
                ? "The other document was"
                : `The other ${String(found.length)} documents were`
            } read and printed; only the ids above are missing.`,
      details: { missing, found: found.map((doc) => doc.frontmatter.id) },
    },
  );
}

/** A `404` from `GET /api/docs/{id}` — the one failure that is about one id. */
function isNotFound(error: unknown): boolean {
  return error instanceof ServerResponseError && error.status === 404;
}

/**
 * One address per line and nothing else — no indentation, no tree drawing, no
 * counts. A path is meant to be copied straight into `--section`, and anything
 * printed around it is a decoration the copier has to undo.
 *
 * `--json` carries the structure a decorated rendering would have carried:
 * level and size, which is how a caller picks the section worth reading.
 */
function showHeadings(
  context: WorkspaceCommandContext,
  id: string,
  sections: readonly DocumentSection[],
): void {
  context.out.emit({
    id,
    headings: sections.map((section) => ({
      headingPath: section.headingPath,
      level: section.level,
      chars: section.text.length,
    })),
  });
  if (sections.length === 0) {
    context.out.line(`no sections — the body of ${id} is empty.`);
    return;
  }
  for (const section of sections) context.out.line(section.headingPath);
}

/**
 * The section's bytes, **unaltered**.
 *
 * Written raw rather than through `out.line`, which would append a newline the
 * body may not contain. That one newline is the whole difference between an
 * excerpt `corpus doc patch --old` matches and one it refuses, and this flag
 * exists because `corpus search`'s prettified snippet lost that argument
 * already: ellipsized and newline-collapsed, it matched 0 times.
 */
function showSection(context: WorkspaceCommandContext, id: string, section: DocumentSection): void {
  context.out.emit({ id, headingPath: section.headingPath, section: section.text });
  if (!context.out.json) context.out.write(section.text);
}

export const showCommand: WorkspaceCommandSpec = {
  name: "show",
  summary:
    "Read one document or several — all of it, its heading paths, or one section byte for byte.",
  description:
    "Reads `GET /api/docs/{id}` and prints what the server returned — the CLI never opens the " +
    // `_current_` rather than `*current*`: Prettier normalises markdown emphasis
    // when it formats the generated `docs/cli.md`, and the drift check compares
    // the formatted file against this string.
    "file. That matters for anchors: they are resolved against the _current_ body at read time, " +
    "so each one is listed with the thread it belongs to, that thread's status, and either the " +
    "character range it landed on or the fact that it is orphaned (SPEC.md §6). A timestamp the " +
    "file does not carry renders as “—” rather than as an invented date.\n\n" +
    "**The third line is the document's `key`** (SPEC.md §7). It names the version this read " +
    "returned, and `corpus doc edit <id> --key <key>` is how you write a new body back: a write " +
    "that replaces the body without one is refused, and one presenting a key the document has " +
    "since moved past is refused with the document as it now stands and a fresh key (exit 9). " +
    "It is printed whole and is opaque — echo it back exactly, never compute, shorten or compare " +
    "parts of one. There is nothing to release: reading gives you a key, not a claim.\n\n" +
    "**Read a section instead of a document.** `--headings` prints one heading path per line and " +
    "nothing else. `--section '<heading path>'` prints that section's text **byte for byte**: no " +
    "trimming, no ellipsis, no collapsed newlines, no added newline — which is what makes it " +
    "paste straight into `corpus doc patch --old`, and a whole-document read unnecessary for a " +
    "bounded edit. Redirect it to a file and pass `--old-file` when the passage spans lines. The " +
    "paths are exactly the ones `corpus search --json` reports as `headingPath`, so the three " +
    "verbs compose: search to find the section, `--section` to read it, `patch` to change it.\n\n" +
    "A section runs from its own heading line to the line before the next heading that closes " +
    "it, so the heading is part of what is printed, and the text above the first heading is a " +
    "section addressed by the document's title. **A `--section` that names nothing is refused** " +
    "(exit 2), listing the paths that do exist — it never falls back to printing the whole body, " +
    "because a silent fallback is the cost this flag exists to avoid. A path naming more than " +
    "one section — a heading repeated under the same parent — is refused the same way, and " +
    "`--nth` chooses between them in document order.\n\n" +
    "These two flags narrow **what you read**, not what crosses the wire: the request is the " +
    "same one, and the saving is in the reader's context.\n\n" +
    "**When a person has an edit session open**, the read says so on its own line. That is " +
    "information, not a refusal — nothing is blocked, and a write would land — but the polite " +
    "move is to leave the document alone and come back, or to park the claimed work with " +
    "`corpus queue defer <event-id> --blocked-on <id>`, which returns to pending on its own when " +
    "the session ends.\n\n" +
    "The §10 **board and workflow keys** print when the document carries them, and only then: " +
    "`stage`, `order`, `default-open`, `columns`, and a `kanban` block flattened to its field, " +
    "its stages, its graph and its status map. A board therefore shows its whole configuration " +
    "here, and an ordinary note is not made five lines longer by the existence of boards.\n\n" +
    "**Several ids read several documents in one call.** The saving is _processes, not bytes_: " +
    "each id is still its own request, but one `corpus` invocation costs ~159 ms of startup " +
    "before it does anything, against ~10 ms for a round trip, so five ids in one call is " +
    "**189 ms rather than 797 ms** (measured). The documents come back in the order asked " +
    "for, one at a time, each under a `──── <id> ────` rule; a repeated id is read once. " +
    "`--json` is then a JSON **array** of the same payloads, in the same order, so a caller " +
    "reads element `.frontmatter.id` rather than parsing a rule. **An id that names nothing " +
    "does not lose the others**: every document that was found is printed, the missing ids are " +
    "named together afterwards, and the exit code is the same `404`/exit 5 a single missing id " +
    "has always given — so exit 0 means all found and exit 5 means at least one was not. " +
    "`--json` carries them at `.error.details.missing`, with what was read at `.details.found`. " +
    "At most 200 ids at once, the same ceiling one listing has; more than that is refused " +
    "before any request. Any _other_ failure — an unreachable server, a rejected token — ends " +
    "the read where it happens rather than spending the remaining round trips.\n\n" +
    "`--headings` and `--section` read inside **one** document, so they take one id and refuse " +
    "several (exit 2). Two sections joined by a separator are no longer either document's " +
    "bytes, which is the one property `--section` exists to have.\n\n" +
    "The human rendering is a summary: the whole payload — including those keys and any " +
    "non-core `extra` frontmatter — is what `--json` emits, unchanged. An id that names no " +
    "document is the " +
    "server's `404`, which is exit 5.",
  args: [
    {
      name: "id",
      required: true,
      variadic: true,
      description:
        "The document's id. Several read several documents in one call, in the order given.",
    },
  ],
  flags: [
    {
      name: "headings",
      type: "boolean",
      description:
        "Print the document's heading paths, one per line, and nothing else — the addresses " +
        "`--section` accepts. They are the same strings `corpus search --json` reports as " +
        "`headingPath`. `--json` adds each section's heading level and character count, which is " +
        "how you pick the one worth reading.",
    },
    {
      name: "section",
      type: "string",
      valueName: "heading-path",
      description:
        "Print one section's text **byte for byte** instead of the document: exactly the " +
        "characters the body holds, heading line included, with nothing trimmed, collapsed or " +
        "appended. That is what `corpus doc patch --old` needs. Matching is exact against the " +
        "whole path, separator “ › ” included; naming no section, or more than one, is refused " +
        "(exit 2) rather than answered with the whole body.",
    },
    {
      name: "nth",
      type: "number",
      valueName: "n",
      description:
        "Which section to print when `--section`'s path names more than one, counted from 1 in " +
        "document order. Only meaningful beside `--section`, and only needed when a heading " +
        "repeats under the same parent — the refusal that happens then names the count.",
    },
  ],
  examples: [
    {
      command: "corpus doc show doc_a1b2c3",
      description:
        "Read a document before editing or commenting on it: header, its `key`, anchored threads, then the body.",
    },
    {
      command: "corpus doc show doc_a1b2c3 doc_d4e5f6 doc_g7h8i9",
      description:
        "Three documents, one process. Each arrives under a `──── <id> ────` rule, in the order asked for — one startup instead of three, measured at 189 ms against 797 ms for five.",
    },
    {
      command: "corpus doc show doc_a1b2c3 doc_nosuchid --json | jq -r '.[].frontmatter.title'",
      description:
        "A missing id does not lose the ones that were found: the array on stdout holds every document that was read, the missing ids arrive on stderr at `.error.details.missing`, and the exit code is 5.",
    },
    {
      command: "corpus doc show doc_a1b2c3 --headings",
      description:
        "The document's addresses, one per line — `Mortgage options`, `Mortgage options › Rates`, `Mortgage options › Escrow` — without reading a word of it.",
    },
    {
      command:
        "corpus doc show doc_a1b2c3 --section 'Mortgage options › Escrow' > /tmp/old.md\n" +
        "corpus doc patch doc_a1b2c3 --from agent --old-file /tmp/old.md --new-file /tmp/new.md",
      description:
        "The loop this flag exists for: read one section, edit it, patch it back. `--section` is byte-exact and `--old-file` is read byte for byte, so a multi-line passage matches exactly once — which `corpus search`'s ellipsized snippet cannot do.",
    },
    {
      command:
        "corpus search 'escrow reserve' --json > /tmp/hit.json\n" +
        'corpus doc show "$(jq -r .hits[0].id /tmp/hit.json)" --section "$(jq -r .hits[0].headingPath /tmp/hit.json)"',
      description:
        "Search addresses a passage, `--section` reads it. The two use the same `headingPath` strings, so a hit's address pastes in unchanged — which is the whole reason the syntax is search's rather than a new one.",
    },
    {
      command: "corpus doc show doc_a1b2c3 --section 'No such heading' ; echo $?",
      description:
        "A path naming nothing is exit **2** and lists the paths that do exist. It never prints the whole body instead — a silent fallback is the cost this flag removes.",
    },
    {
      command: "corpus doc show doc_a1b2c3 --json | jq -r .key",
      description:
        "The key on its own — the value `corpus doc edit <id> --key …` presents back when it replaces the body.",
    },
    {
      command: "corpus doc show doc_a1b2c3 --section 'Mortgage options › Escrow' --json",
      description:
        'One JSON value: `{"id":"doc_a1b2c3","headingPath":"Mortgage options › Escrow","section":"## Escrow\\n\\nThe escrow reserve is recalculated annually.\\n"}` — the same characters, unprettified.',
    },
    {
      command: "corpus doc show doc_a1b2c3 --json",
      description:
        'One JSON value: `{"frontmatter":{"id":"doc_a1b2c3","type":"note","title":"Mortgage ' +
        'options","created":"2026-07-28T10:00:00.000Z","updated":null,…},"body":"30-year fixed at ' +
        '6.1%.\\n","path":"data/docs/finance/mortgage-options.md","key":"3b2ec1f0…","userEditing":' +
        'false,"anchors":[{"anchorId":"anc_1",' +
        '"threadId":"th_x9y8","threadStatus":"open","range":{"start":12,"end":45},' +
        '"orphaned":false,…}]}`.',
    },
  ],
  handler: (context) => runDocShow(context),
};
