// Who last wrote each document, for a projection built from files alone
// (SPEC.md §9.1's `documents.last_actor`, SERVER-138).
//
// §4 already records this fact, in the one place a rebuild can still read it:
// every auto-commit is **authored** by the acting party, and the author's name
// is the actor string itself (`git/commit.ts`'s `ACTOR_IDENTITIES`). So a
// rebuild does not have to invent an attribution or default the whole corpus to
// one party — it reads back what the server wrote.
//
// **One `git log`, not one per document.** The naive form of this question is
// `git log -1 --format=%an -- <path>` per file, which is one process per
// document and turns a rebuild's cost into a function of the corpus size times
// the cost of spawning git. One walk over the history with `--name-only`
// answers it for every path at once, newest commit first, so the first author
// seen for a path is that path's last writer.

import { execFileSync } from "node:child_process";
import type { Actor } from "@corpus/contract";
import { ACTOR_IDENTITIES } from "../git/commit.js";
import { sanitizeGitEnv } from "../git/env.js";

/**
 * What a document whose history says nothing reads as, and the answer §9.1
 * gives for every uncertain case: `user`.
 *
 * A change nobody attributed to the agent is a person's — an untracked file, a
 * workspace with no git, a commit by `corpus init` or by a person's own
 * `git commit`, and the `recovery` author §4 reserves for a commit whose party
 * was destroyed by an unclean stop. Guessing `agent` for any of them would tell
 * §7's reflection that a document it must look at is its own output.
 */
export const DEFAULT_LAST_ACTOR: Actor = "user";

/**
 * How much `git log --name-only` output one pass may produce. Every line is one
 * path or one author, so 64 MiB is on the order of a million file-touches —
 * past any workspace a person edits by hand, and small enough that a repository
 * pathological enough to exceed it fails fast instead of exhausting the heap.
 *
 * Exceeding it is not an error: {@link readLastActors} answers
 * {@link DEFAULT_LAST_ACTOR} for everything, which is the same answer a
 * workspace with no git gets, and the projection is complete either way.
 */
export const LAST_ACTOR_MAX_BUFFER = 64 * 1024 * 1024;

/** The byte `--format=%x00` emits, and the one byte no path can contain. */
const NUL = "\u0000";

/** The actor an author name denotes, or {@link DEFAULT_LAST_ACTOR}. */
function actorOfAuthor(name: string): Actor {
  return name === ACTOR_IDENTITIES.agent.name ? "agent" : DEFAULT_LAST_ACTOR;
}

/**
 * Every path's last writer, keyed by workspace-relative path.
 *
 * Absent from the map means "no commit in this history touched that path", which
 * {@link LastActorIndex.actorFor} answers as {@link DEFAULT_LAST_ACTOR}.
 */
export interface LastActorIndex {
  actorFor(relativePath: string): Actor;
}

/** An index that knows nothing and says so — a workspace with no git, or a failed walk. */
const EMPTY_INDEX: LastActorIndex = { actorFor: () => DEFAULT_LAST_ACTOR };

/**
 * Parses one `git log --format=%x00%an --name-only` stream.
 *
 * The NUL prefix is what makes an author line unmistakable: a path can hold any
 * byte a filesystem allows *except* NUL, so no filename can be mistaken for the
 * start of a commit. Blank lines separate the format line from the name list and
 * carry nothing.
 *
 * git quotes a path containing a control character or a backslash (`core.quotePath`),
 * and such a line simply fails to match any enumerated document — the file then
 * reads {@link DEFAULT_LAST_ACTOR}, which is what an unknown path always reads.
 * Nothing is mis-attributed by it.
 *
 * Exported for its own test: the parsing is the part with edge cases, and pinning
 * it against a literal git stream is cheaper and sharper than building repositories
 * that happen to produce each shape.
 */
export function parseLastActorLog(stdout: string): Map<string, Actor> {
  const byPath = new Map<string, Actor>();
  let actor: Actor = DEFAULT_LAST_ACTOR;
  for (const line of stdout.split("\n")) {
    if (line.startsWith(NUL)) {
      actor = actorOfAuthor(line.slice(NUL.length));
      continue;
    }
    if (line === "") continue;
    // Newest first, so the first commit that names a path is its last write.
    if (!byPath.has(line)) byPath.set(line, actor);
  }
  return byPath;
}

/**
 * Reads the whole history once and answers "who last wrote this path" for every
 * path in it.
 *
 * **Never throws.** A workspace with no repository, no `git` on `PATH`, no
 * commits, or a history too large for {@link LAST_ACTOR_MAX_BUFFER} all produce
 * an index that answers {@link DEFAULT_LAST_ACTOR} — the same answer a path with
 * no history gets. A rebuild must complete over whatever the workspace is, and
 * an attribution is not worth failing one over.
 *
 * `--no-renames` is deliberate: a rename is a write to the new path, by the party
 * that made it, and following the rename would attribute the new path to whoever
 * last touched the old one — which is exactly the wrong answer for `POST /move`.
 */
export function readLastActors(workspaceRoot: string): LastActorIndex {
  let stdout: string;
  try {
    stdout = execFileSync(
      "git",
      ["log", "--format=%x00%an", "--name-only", "--no-renames", "--no-color"],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        env: sanitizeGitEnv(),
        maxBuffer: LAST_ACTOR_MAX_BUFFER,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    return EMPTY_INDEX;
  }
  const byPath = parseLastActorLog(stdout);
  return { actorFor: (relativePath) => byPath.get(relativePath) ?? DEFAULT_LAST_ACTOR };
}
