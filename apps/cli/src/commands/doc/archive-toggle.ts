import type { Doc, DocMutationResponse } from "@corpus/contract";
import { warningSuffix } from "../../input.js";
import type { WorkspaceCommandContext } from "../../registry/types.js";

/**
 * The shared body of `corpus doc archive` and `corpus doc unarchive` (wave-3
 * audit, CLEAN 49). The two verbs were the same twenty lines with two words
 * changed, and the drift that duplication invites is exactly what the audit
 * found: the "already there?" check was decorative in one of them and
 * destructive in the other.
 *
 * The shape both verbs share:
 *
 * 1. Read the document. The response of either route cannot say whether it
 *    moved anything, so the *before* state is the only way to report honestly.
 * 2. **If the document is already entirely where this verb would put it, send
 *    nothing at all** — see {@link isSettled}.
 * 3. Otherwise `POST`, and report what the route did with the warnings folded
 *    onto the same line.
 *
 * `--json` emits one value of the same shape in both branches, so a caller
 * parsing `{doc, warnings}` never has to know which branch ran.
 */

/**
 * Where an archived skill's folder lives, workspace-relative.
 *
 * Duplicated from `apps/server/src/projection/roots.ts` because the dependency
 * direction forbids importing it (CLAUDE.md → Repository Structure), the same
 * way `staged.ts` already carries the pair. It is a **read-only comparison
 * against a path the server itself put on the wire** — this module writes no
 * file and knows nothing else about the layout.
 */
const SKILLS_ARCHIVED_PREFIX = ".claude/skills-archived/";

/**
 * Whether the route would be a no-op, judged from **both** halves of the state
 * it owns: the frontmatter status *and*, for a `type: skill` document, which
 * side of `.claude/skills-archived/` the folder is on.
 *
 * Status alone is not enough in either direction, and getting that wrong costs
 * something different each way:
 *
 * - **Sending anyway** is how `unarchive` used to silently reopen a `resolved`
 *   document: the route used to set `status: open` unconditionally, so "unarchive a
 *   document that was never archived" quietly *changed* it; the server now makes no write at all in that case (it answers 200 with the document untouched), and this guard is the second line rather than the only one (wave-3 audit,
 *   FIX 11). Nobody asked for that and the old output line called it a no-op.
 * - **Skipping on status alone** would give up the only repair this CLI has for
 *   the half-state a raw `PUT` or the UI can still reach until SERVER-039 lands
 *   (audit FIX 5): frontmatter `open`, folder still sitting in
 *   `.claude/skills-archived/`, name still `409`-blocked. The server's
 *   unarchive route heals exactly that — it plans the folder move off the
 *   *path*, not off the status — and a status-only skip would make it
 *   unreachable from the command line.
 *
 * So the predicate asks for both, which is the honest reading of "already
 * archived" for a document whose archiving is two facts.
 */
export function isSettled(doc: Doc, wantArchived: boolean): boolean {
  if ((doc.frontmatter.status === "archived") !== wantArchived) return false;
  if (doc.frontmatter.type !== "skill") return true;
  return doc.path.startsWith(SKILLS_ARCHIVED_PREFIX) === wantArchived;
}

export interface ArchiveToggle {
  /** True for `archive`, false for `unarchive` — which end state the verb wants. */
  readonly wantArchived: boolean;
  /**
   * The route call, kept as a callback so each verb keeps its own **literal**
   * path: the generated client is typed per path, and threading the segment
   * through as a variable would trade that away for one saved line.
   */
  readonly post: (context: WorkspaceCommandContext, id: string) => Promise<DocMutationResponse>;
  /** The line for a document the route actually moved. */
  readonly moved: (id: string) => string;
  /** The line for a document that was already there; nothing was sent. */
  readonly settled: (id: string) => string;
}

export async function runArchiveToggle(
  context: WorkspaceCommandContext,
  toggle: ArchiveToggle,
): Promise<void> {
  const id = context.args.get("id");

  const before = await context.client.request((api) =>
    api.GET("/api/docs/{id}", { params: { path: { id } } }),
  );

  if (isSettled(before, toggle.wantArchived)) {
    // The same wire shape the route would have returned, so `--json` is one
    // value either way — and `warnings` is genuinely empty, because nothing was
    // written and therefore nothing could have failed to commit.
    context.out.emit({ doc: before, warnings: [] });
    context.out.line(toggle.settled(id));
    return;
  }

  const response = await toggle.post(context, id);
  context.out.emit(response);
  context.out.line(`${toggle.moved(id)}${warningSuffix(response.warnings)}`);
}
