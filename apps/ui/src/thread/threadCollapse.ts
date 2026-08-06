/**
 * Whether a conversation is folded, and who decided (SPEC.md §11, rider signed
 * 2026-08-05; §6's `status` line).
 *
 * The whole model is three sentences of the spec, and they are kept here as
 * pure functions so the components below never restate them:
 *
 * - **One rule, and the set is closed.** A `resolved` thread is collapsed by
 *   default. Adding a second takes a change to SPEC.md — a rules engine is the
 *   wrong answer to a focus problem, because every extra rule is another
 *   conversation that vanished for a reason the reader has to reconstruct.
 * - **Unread outranks the rule.** A conversation holding a turn nobody has seen
 *   is never collapsed *by the rule*, whoever wrote it and whatever its status:
 *   a collapsed conversation displays nothing and therefore reads nothing
 *   (SPEC.md §7), so a rule that folded away unread turns would be a way to lose
 *   them. The asymmetry is deliberate — the override binds the **rule**, not the
 *   reader, who may still fold an unread conversation by hand, and not the depth
 *   clamp, which is not a rule at all (see {@link placedCollapsed}).
 * - **Precedence: the last thing that happened wins.** The rule decides the
 *   state a conversation is *placed* in; the reader's own act overrides it and
 *   sticks; a change to the thread's **status** re-asserts the rule and clears
 *   the override. Reading never collapses anything.
 *
 * **Nothing here is ever written to the corpus.** Every write in this product
 * goes through the server and auto-commits (SPEC.md §4, §7), so a collapse
 * stored in the thread or the document would mean *reading a document produces
 * git commits*. §11 already draws the line — "only browser-local state stays
 * local: scroll positions, open readers, and per-reader navigation stacks" — and
 * a reading posture belongs in exactly that set, beside the console's height and
 * the reader's chosen width.
 */

/** The status that trips the one rule. */
export const RESOLVED_STATUS = "resolved";

export const COLLAPSE_STORAGE_KEY = "corpus.collapse";

/** Bumped when the shape below changes; an older blob degrades to defaults. */
export const COLLAPSE_STATE_VERSION = 1;

/**
 * How many overrides one surface keeps.
 *
 * Overrides are per thread and never expire on their own, so a browser left
 * open for months would otherwise accumulate one entry per conversation it has
 * ever folded. The oldest go first; losing one means a conversation returns to
 * what the rule says about it, which is the same thing a fresh browser sees.
 */
export const MAX_OVERRIDES_PER_SURFACE = 200;

/** What a surface knows about a conversation when it decides how to place it. */
export interface ThreadCollapseSubject {
  readonly threadId: string;
  /** The thread's own status; `resolved` is what the rule keys on. */
  readonly status: string;
  /** True while it holds a turn nobody has displayed yet (SPEC.md §7). */
  readonly unread: boolean;
  /**
   * True when this surface cannot usefully draw the conversation where it
   * stands — nesting past {@link MAX_DRAWN_DEPTH}. Not a second rule: it is what
   * the surface can draw, and SPEC.md §11 spells the consequence out ("a
   * conversation nested deeper than a surface can usefully draw is collapsed
   * rather than dropped").
   */
  readonly tooDeep?: boolean | undefined;
}

/**
 * SPEC.md §11's **single** rule, alone and nameable.
 *
 * Kept separate from {@link placedCollapsed} so the closed set stays visible in
 * the code: this function is the whole of it, and a second rule would have to be
 * written into this one body rather than added beside it.
 */
export function resolvedRuleCollapses(subject: ThreadCollapseSubject): boolean {
  return subject.status === RESOLVED_STATUS && !subject.unread;
}

/**
 * The state a conversation is **placed** in, before anyone touches it.
 *
 * Two things decide it, and they are not the same kind of thing.
 *
 * **What the surface can draw comes first, and the interlock does not bind it**
 * (PR #25 review, MINOR). §11 binds the interlock to *the rule* — "a
 * conversation carrying a turn you have not seen is never collapsed **by the
 * rule**" — and depth is not a rule: `threadDepth.ts` says so in as many words,
 * "not a second rule: it is what the surface can draw". An unread conversation
 * nested past {@link MAX_DRAWN_DEPTH} used to be drawn in full at a depth the
 * surface had already declared it could not usefully draw; now it is placed
 * collapsed like every other conversation down there — with the "new" badge on
 * its line, so the unseen turn is announced rather than buried, and one click
 * expands it where it stands.
 *
 * **Then the rule**, with the interlock inside it ({@link
 * resolvedRuleCollapses}): a conversation nobody has seen is never folded away
 * by the rule, only by a person.
 */
export function placedCollapsed(subject: ThreadCollapseSubject): boolean {
  if (subject.tooDeep === true) return true;
  return resolvedRuleCollapses(subject);
}

/**
 * One reader's decision about one conversation.
 *
 * The **status it was made against** is half the record, and it is what makes
 * "a status change re-asserts the rule" true across a reload as well as live:
 * an override taken while the thread read `open` says nothing about the same
 * thread once it reads `resolved`, because the status changing is newer
 * information than a gesture made before it.
 */
export interface CollapseOverride {
  readonly collapsed: boolean;
  readonly status: string;
}

/** Every override one surface holds, by thread id. */
export type SurfaceOverrides = Readonly<Record<string, CollapseOverride>>;

/** Every surface's overrides, by surface key. */
export interface CollapseState {
  readonly version: number;
  readonly surfaces: Readonly<Record<string, SurfaceOverrides>>;
}

export const EMPTY_COLLAPSE_STATE: CollapseState = {
  version: COLLAPSE_STATE_VERSION,
  surfaces: {},
};

const NO_OVERRIDES: SurfaceOverrides = {};

/** The surface key for a column's reader — one per column, as §11 requires. */
export function columnSurface(columnId: string): string {
  return `col:${columnId}`;
}

/** Focus mode is one surface: there is only ever one full-screen reader. */
export const FOCUS_SURFACE = "focus";

/**
 * Whether an override still speaks for this conversation.
 *
 * A mismatch is not repaired and not honoured — it is simply not an answer any
 * more, and the rule takes back over.
 */
export function overrideApplies(
  override: CollapseOverride | undefined,
  subject: ThreadCollapseSubject,
): override is CollapseOverride {
  return override !== undefined && override.status === subject.status;
}

/** The answer for one conversation: the reader's, if they gave one; else the rule's. */
export function isThreadCollapsed(
  overrides: SurfaceOverrides,
  subject: ThreadCollapseSubject,
): boolean {
  const override = overrides[subject.threadId];
  return overrideApplies(override, subject) ? override.collapsed : placedCollapsed(subject);
}

/**
 * Records a reader's own act, stamped with the status it was made against.
 *
 * Re-inserted rather than updated in place so the key moves to the end of the
 * insertion order — which is what makes {@link MAX_OVERRIDES_PER_SURFACE} drop
 * the least recently *decided* rather than the least recently seen.
 */
export function withOverride(
  overrides: SurfaceOverrides,
  subject: ThreadCollapseSubject,
  collapsed: boolean,
): SurfaceOverrides {
  const next: Record<string, CollapseOverride> = {};
  for (const [id, entry] of Object.entries(overrides)) {
    if (id !== subject.threadId) next[id] = entry;
  }
  next[subject.threadId] = { collapsed, status: subject.status };
  const keys = Object.keys(next);
  if (keys.length <= MAX_OVERRIDES_PER_SURFACE) return next;
  for (const id of keys.slice(0, keys.length - MAX_OVERRIDES_PER_SURFACE)) {
    delete next[id];
  }
  return next;
}

/**
 * Drops the override a status change has just made obsolete.
 *
 * {@link isThreadCollapsed} already ignores a stale override, so this is not
 * what makes the display correct — it is what stops a **resurrection**: resolve,
 * expand by hand, reopen, resolve again, and an override kept on disk would
 * speak for a gesture two status changes old.
 */
export function dropStaleOverride(
  overrides: SurfaceOverrides,
  subject: ThreadCollapseSubject,
): SurfaceOverrides {
  const override = overrides[subject.threadId];
  if (override === undefined || override.status === subject.status) return overrides;
  const next = { ...overrides };
  delete next[subject.threadId];
  return next;
}

function storageOrNull(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    // Safari private mode and sandboxed frames throw on the property itself.
    return null;
  }
}

function readOverride(value: unknown): CollapseOverride | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const collapsed = record["collapsed"];
  const status = record["status"];
  if (typeof collapsed !== "boolean" || typeof status !== "string") return null;
  return { collapsed, status };
}

function readSurface(value: unknown): SurfaceOverrides | null {
  if (typeof value !== "object" || value === null) return null;
  const out: Record<string, CollapseOverride> = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    const override = readOverride(entry);
    if (override !== null) out[id] = override;
  }
  return out;
}

/**
 * Anything unrecognised — garbage, a hand-edited value, a blob from an older
 * version — reads as "nobody has decided anything". Losing a fold is a shrug;
 * throwing here is a reader that will not open.
 */
export function readCollapseState(storage: Storage | null = storageOrNull()): CollapseState {
  if (storage === null) return EMPTY_COLLAPSE_STATE;
  let raw: string | null;
  try {
    raw = storage.getItem(COLLAPSE_STORAGE_KEY);
  } catch {
    return EMPTY_COLLAPSE_STATE;
  }
  if (raw === null) return EMPTY_COLLAPSE_STATE;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_COLLAPSE_STATE;
    const record = parsed as Record<string, unknown>;
    if (record["version"] !== COLLAPSE_STATE_VERSION) return EMPTY_COLLAPSE_STATE;
    const surfaces: Record<string, SurfaceOverrides> = {};
    const stored = record["surfaces"];
    if (typeof stored === "object" && stored !== null) {
      for (const [key, value] of Object.entries(stored)) {
        const surface = readSurface(value);
        if (surface !== null) surfaces[key] = surface;
      }
    }
    return { version: COLLAPSE_STATE_VERSION, surfaces };
  } catch {
    return EMPTY_COLLAPSE_STATE;
  }
}

export function writeCollapseState(
  state: CollapseState,
  storage: Storage | null = storageOrNull(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded, or storage revoked mid-session. The surface keeps its
    // folds in memory for this session; they just will not survive a reload.
  }
}

/**
 * Forgets every fold, everywhere.
 *
 * For the jsdom suites' `afterEach`: folds outlive a component and a document by
 * design, so without this one test's gesture is the next one's starting state.
 * Nothing in the app calls it — there is no "forget my folds" action, and §11
 * does not describe one.
 */
export function clearCollapseState(storage: Storage | null = storageOrNull()): void {
  try {
    storage?.removeItem(COLLAPSE_STORAGE_KEY);
  } catch {
    // Same shrug as the writer's: there was nothing to clear.
  }
}

/** One surface's overrides out of the stored blob. */
export function surfaceOverrides(state: CollapseState, surfaceKey: string): SurfaceOverrides {
  return state.surfaces[surfaceKey] ?? NO_OVERRIDES;
}

/** The blob with one surface replaced — the only shape the writer ever takes. */
export function withSurface(
  state: CollapseState,
  surfaceKey: string,
  overrides: SurfaceOverrides,
): CollapseState {
  return {
    version: COLLAPSE_STATE_VERSION,
    surfaces: { ...state.surfaces, [surfaceKey]: overrides },
  };
}
