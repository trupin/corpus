// `POST /api/skills` — §7's skill genesis, through the server's write path.
//
// §7 makes a skill an ordinary document, so almost all of this verb is the
// ordinary create: mint an id, stamp the §5 frontmatter block, validate, write
// atomically, auto-commit with the acting party as author, re-project
// synchronously and invalidate. What a skill needs and a document does not is
// exactly two things, and they are the only two this module owns:
//
// - **Where it goes.** A skill is `.claude/skills/<name>/SKILL.md` — a different
//   root, a directory per skill and one fixed filename — and that shape is why
//   this verb exists at all. `POST /api/docs` can now file into the other
//   document roots §7 declares (`resolveFolder`, SERVER-122), but it files a
//   *document*: one `*.md` whose name comes from the title. A skill needs a
//   directory minted for it and a filename that is not derived from anything the
//   caller sent, which is not a folder question and cannot be answered by naming
//   one — the projection refuses `.claude/skills` as a create target for exactly
//   that reason (its `skill-tree` shape indexes `SKILL.md` alone), so the two
//   surfaces agree rather than compete. The rule that survives unchanged is the
//   one that matters: **no wire form writes a document outside the roots the
//   server names in its own source**, `projection/roots.ts` being that source.
// - **What its frontmatter carries.** Both vocabularies at once: Claude Code
//   discovers a skill by `name` + `description`, Corpus indexes a document by
//   the §5 core keys, and the shipped `orchestrate`/`comment` skills already
//   carry both in one block. This writes the same shape a `corpus init`
//   workspace arrives with.
//
// The name is validated three times over, deliberately: the contract's schema
// refuses `../evil`, `a/b` and every encoded traversal as a `400` naming
// `body.name` before a handler runs; this module re-parses it with the same
// schema, so a programmatic caller cannot skip the boundary; and `runMutation`'s
// `assertContained` still resolves the final path against the workspace root
// with symlinks followed. No new grammar is introduced at any of the three —
// `SkillNameSchema` is imported, never restated.

import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { SkillNameSchema, type Actor, type Doc, type SkillCreateRequest } from "@corpus/contract";
import {
  emptyDocument,
  formatInstant,
  idPrefixForDocType,
  newId,
  serializeDocument,
  setFrontmatterFields,
} from "../core/index.js";
import {
  CREATE_LANE,
  findTemplate,
  isIdTaken,
  loadDocument,
  runMutation,
  toWireDoc,
  validateBeforeWrite,
  validationError,
  type DocsWorkspace,
  type DocumentMutex,
  type MutationResult,
} from "../docs/index.js";
import { conflict } from "../errors.js";
import { DOCS_KEY, docKey } from "../events/index.js";
import { archivedSkillFolderPath, skillDocumentPath, skillFolderPath } from "./paths.js";

/** The `type` every document under `.claude/skills/` is indexed as (SPEC.md §7). */
const SKILL_TYPE = "skill";

export type CreateSkillOutcome = { readonly doc: Doc; readonly result: MutationResult };

/**
 * True when anything at all occupies `path` — a directory, a file, a symlink,
 * even a broken one.
 *
 * `lstatSync` rather than `existsSync` because the two disagree about exactly
 * the cases that matter here. §10 symlinks a plugin's skill into
 * `.claude/skills/<name>`, so the name is taken by a link whose target may be
 * anywhere; and a *broken* link is invisible to `existsSync` while still being
 * an entry `mkdir` cannot create through. Both are "that name is already
 * spoken for", which is what the caller is asking.
 */
function entryExists(workspaceRoot: string, path: string): boolean {
  try {
    lstatSync(resolve(workspaceRoot, path));
    return true;
  } catch {
    return false;
  }
}

/**
 * The `409` refusals, in the order a name can be taken.
 *
 * **An archived skill holds its name** (SERVER-036's open question, decided
 * here). Archiving is §7's "reversible organizational act, never a deletion":
 * `corpus doc archive` moves `.claude/skills/<name>/` to
 * `.claude/skills-archived/<name>/` precisely to disable the skill, and
 * unarchiving moves it back. Letting a new skill take the name would quietly
 * spend that reversibility — the archived document keeps its row, keeps its
 * threads and keeps every promise §7 makes about it, right up until somebody
 * unarchives it and `docs/archive.ts`'s destination guard refuses with a `400`
 * about a directory they never mentioned. The failure would surface on an
 * unrelated verb, long after the create that caused it, and no automatic
 * recovery exists: two folders would be competing for one installed path.
 *
 * Refusing costs one step and names it in the message — unarchive it, or pick
 * another name — and that step is reversible in turn. The contract left both
 * answers describable (refusing is this `409`, allowing would have been a plain
 * `201`), so this is a server ruling and not a shape change.
 */
function assertNameFree(workspace: DocsWorkspace, name: string): void {
  const installed = skillFolderPath(name);
  if (entryExists(workspace.workspaceRoot, installed)) {
    throw conflict(
      `a skill named \`${name}\` is already installed (${installed} exists) — ` +
        "edit it with `PUT /api/docs/{id}` or choose another name",
    );
  }
  const archived = archivedSkillFolderPath(name);
  if (entryExists(workspace.workspaceRoot, archived)) {
    throw conflict(
      `the name \`${name}\` belongs to an archived skill (${archived} exists) — ` +
        "unarchive it to bring it back, or choose another name; creating over the name would " +
        "leave it unable to return",
    );
  }
}

/**
 * The file a create writes.
 *
 * Key order is the order the keys are emitted, and it is chosen rather than
 * inherited: Claude Code's two discovery keys lead, then §5's canonical block,
 * which is what the shipped `orchestrate` and `comment` skills look like. The
 * three §5 keys that carry only defaults — `due`, `reviewed`, `evergreen` — are
 * omitted rather than written as nulls, because the file-level frontmatter
 * schema defaults every one of them and a skill's block stays readable to the
 * human who edits it in an editor.
 *
 * **The `id` is minted, not synthesized.** The projection can derive
 * `doc_skill<hex>` from the path for a hand-written `SKILL.md` that has no `id:`
 * (§7), but a derived id is a function of where the file sits — so archiving the
 * skill, which moves its folder, would turn it into a different document, which
 * is why `docs/archive.ts` stamps one in before it moves anything. A skill
 * created by the server has no reason to start out fragile: it gets a real
 * `doc_*` id like every other created document, exactly as the shipped skills
 * carry one.
 */
function skillFileText(input: SkillCreateRequest, id: string, stamp: string, body: string): string {
  return serializeDocument(
    setFrontmatterFields(emptyDocument(body), {
      name: input.name,
      description: input.description,
      id,
      type: SKILL_TYPE,
      title: input.title ?? input.name,
      created: stamp,
      updated: stamp,
      tags: input.tags ?? [],
      status: "open",
      anchors: {},
    }),
  );
}

export async function createSkill(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  input: SkillCreateRequest,
): Promise<CreateSkillOutcome> {
  // Defence in depth, and the reason this is a re-parse rather than a hand-rolled
  // check: the route already validated the body against this very schema, so the
  // only way to arrive here with a hostile name is to call the function directly
  // — and a second, differently-worded guard is how the two would eventually
  // disagree about what a name is.
  const parsed = SkillNameSchema.safeParse(input.name);
  if (!parsed.success) {
    validationError("skill name must be lowercase letters, digits and single hyphens", [
      { path: "name", message: `\`${input.name}\` is not a valid skill name` },
    ]);
  }
  const name = parsed.data;
  const path = skillDocumentPath(name);

  // The lane every create takes. It is not about the id — those are minted free
  // — but about the name: two concurrent creates of one name would otherwise
  // both find it unclaimed and race to write the same file, and the second
  // would silently become an edit of the first (SERVER-036). One lane for all
  // creates is what `docs/create.ts` already does, for the same reason about
  // slugs.
  return mutex.run(CREATE_LANE, async () => {
    assertNameFree(workspace, name);

    const id = newId(idPrefixForDocType(SKILL_TYPE), (candidate) =>
      isIdTaken(workspace.projection, candidate),
    );
    const stamp = formatInstant(workspace.now());
    // Same rule `POST /api/docs` follows: an omitted body pre-fills from the
    // type's template document when the workspace defines one, and a workspace
    // with none gets an empty body (SPEC.md §10 — "none → empty").
    const body =
      input.body ??
      findTemplate(workspace.workspaceRoot, workspace.projection, SKILL_TYPE)?.body ??
      "";
    const text = skillFileText({ ...input, name }, id, stamp, body);
    const warnings = validateBeforeWrite(workspace, path, text);

    const result = await runMutation(workspace, {
      docId: id,
      actor,
      warnings,
      plan: {
        operations: [{ kind: "write", path, content: text }],
        stage: [path],
        project: [path],
        unproject: [],
        commit: { subject: `skill create: ${name} (${id}) by ${actor}` },
        keys: [DOCS_KEY, docKey(id)],
        // Skills live outside `data/docs/`, which is the only tree
        // `GET /api/tree` describes — no folder badge can move (SERVER-018).
      },
    });

    return {
      doc: toWireDoc(workspace, loadDocument(workspace.workspaceRoot, workspace.projection, id)),
      result,
    };
  });
}
