import {
  AttachButton,
  AutocompleteMenu,
  COMPOSER_NEWLINE_HINT,
  COMPOSER_PRIMARY_KEY,
  COMPOSER_SECONDARY_KEY,
  composerAddress,
  ComposerAddress,
  composerReachesAgent,
  GLOBAL_COMPOSE_WEIGHT_SCOPE,
  handleComposerKeyDown,
  PendingAttachments,
  useAttachmentIntake,
  MENTION_DOC_TYPE,
  rowToken,
  useAutocomplete,
  useDocs,
  useComposerRecipient,
  useComposerWeight,
  useWeightLevels,
  type PendingAttachment,
  type RowNotice,
} from "@corpus/kit";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import {
  LAUNCHER_DECIDES_LABEL,
  LAUNCHER_WEIGHT_META,
  LEVEL_WEIGHT_META,
} from "../thread/residentActions";
import { useCompose, type ComposeInput, type ComposeMode } from "./useCompose";
import "./compose.css";

/**
 * The global composer (SPEC.md §10, `design/index.html`'s `#compose-overlay`):
 * one textarea, two submits, and the blank page the agent is reachable from.
 *
 * **It is the thread composer's units in a different chrome.** The `@` / `/`
 * `[[` completions are `@corpus/kit`'s, the three ways a file gets in are
 * `useAttachmentIntake`'s, and the chips are `PendingAttachments`. Nothing about
 * "typing at Corpus" is re-implemented here; what is new is only the routing
 * between Ask and Capture, which lives in `useCompose`.
 *
 * The panel carries `.overlay.open` — the class pair `isOverlayOpen()` queries.
 * A modal that manages its own visibility and skips them tells the shortcut
 * dispatcher the board still owns the keyboard, and `c` would then reopen the
 * composer from inside the composer.
 */

/**
 * The prototype's placeholder, character for character — **one attribute with an
 * embedded newline** (`design/index.html` writes it as `&#10;`), not two
 * elements. A separate hint line would need its own font, colour and spacing to
 * look like this, and would then be a second thing to keep matching the first.
 */
export const COMPOSE_PLACEHOLDER =
  "Ask the agent anything, or capture a thought…\n" +
  "@ routes to a subagent · / invokes a skill · [[ links a document · paste/drop files";

export const COMPOSE_HINT = `@ agents · / skills · [[ refs · ${COMPOSER_NEWLINE_HINT}`;
export const ASK_LABEL = `Ask ${COMPOSER_PRIMARY_KEY}`;
/**
 * Capture is the *secondary* submit, so it takes `⇧⌘↵` — SPEC.md §10's contract
 * gives `⌘↵` to the primary action in every composer, and here that is Ask. The
 * chord it used to own moved with the rule, not against it.
 */
export const CAPTURE_LABEL = `Capture ${COMPOSER_SECONDARY_KEY}`;

/** Why Capture can be unavailable while Ask is not: a document needs a body. */
export const CAPTURE_NEEDS_TEXT = "A capture becomes a document — it needs a line of text.";

/**
 * Said while a recipient is picked and Capture is still available.
 *
 * `POST /api/capture` carries no `recipient` (CONTRACT-051): a capture files a
 * thought and the filing is the orchestrator's. Saying so is the alternative to
 * a composer that shows a pick and quietly drops it — the picker sits above both
 * buttons, and only one of them can honour it.
 */
export const CAPTURE_IGNORES_RECIPIENT =
  "Save to inbox/ — the agent files it. A capture is always the orchestrator's; " +
  "the recipient applies to Ask.";

export interface ComposeOverlayProps {
  readonly onClose: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

/**
 * The sentinel for *no resident at all* in the `<select>`'s value space
 * (UI-173).
 *
 * A `<select>` value is a string and cannot be `null`, so the three states need
 * three strings: `""` is the default, this is nobody, and anything else is a
 * profile name. The value is chosen to be one no profile can have —
 * `AgentNameSchema` refuses a blank or whitespace-only name, and a leading
 * `@` is not part of the invocable name it validates.
 */
const NO_RESIDENT_VALUE = "@none";

/** The same bound the `@` menu uses, for the same directory. */
const RESIDENT_CHOICE_LIMIT = 50;

/** What the default option says. It names the outcome, not the absence of a choice. */
const DEFAULT_RESIDENT_LABEL = "its own agent";

/** …and what choosing nobody says, in terms of who answers instead. */
const NO_RESIDENT_LABEL = "no owner — the main agent";

const RESIDENT_TITLE =
  "Who owns this conversation and everything that grows out of it (SPEC.md §7). " +
  "A new conversation gets its own agent unless you choose otherwise. This is not the " +
  "recipient beside it: a recipient routes this one message and changes nothing else.";

/**
 * What the designation's weight control is, and what it is not (UI-185).
 *
 * The two metas are `residentActions.ts`'s own, joined — one declaration of
 * what a level row means and what leaving the set alone means, shared with the
 * thread menu's rows rather than reworded here. The last sentence is this
 * surface's alone, because only this surface has a second weight beside it to
 * be mistaken for.
 */
const RESIDENT_WEIGHT_TITLE =
  `${LEVEL_WEIGHT_META} (SPEC.md §7: a resident's weight is set when it is designated, ` +
  `not per message). Left alone, ${LAUNCHER_WEIGHT_META}. ` +
  "This is not the weight in the address beside it: that one rides this message.";

/** Names the control for the DOM and the suites. */
export const RESIDENT_WEIGHT_ARIA = "The weight this conversation's resident works at";

/**
 * The `resident` the submit carries (UI-185) — the three contract states, with
 * the designation's weight riding **inside** the object and never beside it.
 *
 * - Owner untouched, no level: `{}` — the key stays off the body, which is the
 *   default the contract's three states are built on.
 * - Owner untouched, a level: `{resident: {weight}}` — a general resident at
 *   that level; the contract makes `name` and `weight` independent.
 * - A profile: `{resident: {name}}`, with the level beside it when one stands.
 * - Nobody: `{resident: null}`, and no weight rides — there is no resident to
 *   run at one, the control is not shown in that state, and a value the
 *   surface no longer shows must not be sent (§10).
 */
export function designationRequest(
  resident: string | null | undefined,
  weight: string | undefined,
): ComposeInput["resident"] {
  if (resident === null) return { resident: null };
  if (resident === undefined && weight === undefined) return {};
  return {
    resident: {
      ...(resident === undefined ? {} : { name: resident }),
      ...(weight === undefined ? {} : { weight }),
    },
  };
}

export function ComposeOverlay({ onClose, onNotify }: ComposeOverlayProps): ReactElement {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>(undefined);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const intake = useAttachmentIntake();
  const compose = useCompose(onNotify);
  /*
   * One weight for the whole overlay, shared by both submits (SPEC.md §10's
   * rider). The global composer's Ask is not a conversation, so "the same
   * conversation" has no referent here; `GLOBAL_COMPOSE_WEIGHT_SCOPE` documents
   * the reading taken and the one rejected. Both submits send `requestsAgent:
   * true`, so the control is always live on this surface.
   */
  const weight = useComposerWeight(GLOBAL_COMPOSE_WEIGHT_SCOPE);
  /**
   * `null`: Ask creates a **standalone** thread, which is in no scope by
   * construction, so the computed default here is the orchestrator without a
   * walk. Picking a resident is §7's summons — the one deliberate crossing of a
   * scope boundary — and it routes this message and nothing else.
   */
  const recipient = useComposerRecipient({ start: null });
  /**
   * **Who will own the conversation** (UI-173; SPEC.md §7's rider A, §10's
   * rider B).
   *
   * `undefined` is the default — a general resident — and it is deliberately
   * the state the control starts in, because rider A makes owning the
   * conversation what happens when nobody chose. `null` is *nobody*, and a
   * string is a profile name.
   *
   * **A separate piece of state from `recipient`, and it must stay one.** They
   * are different acts: a recipient routes one message and rewires nothing,
   * while a designation hands over the conversation and everything that grows
   * out of it. Both may be set at once, and a control that made picking one
   * imply the other would be the collapse §10's rider rules out.
   */
  const [resident, setResident] = useState<string | null | undefined>(undefined);
  /**
   * **The level the resident is designated at** (UI-185; SPEC.md §7's rider of
   * 2026-08-19: the designation is the only place the choice exists).
   *
   * Plain `useState` that dies with the overlay, like the thread menu's
   * (`ThreadMenuItems.tsx`) and deliberately **not** `weightChoice.ts`'s map:
   * that map remembers a *message's* weight per conversation, and one map
   * serving both would have a message's standing level silently pre-arming a
   * designation. `undefined` is "the launcher decides" — a real choice here,
   * offered as an explicit option, never merely an unpressed state.
   */
  const [residentWeight, setResidentWeight] = useState<string | undefined>(undefined);
  /*
   * The workspace's own tier table — the same declaration every weight surface
   * reads (`useWeightLevels`, SHARED-022 Decision 1), through the same cached
   * query the message control's `useComposerWeight` reads it by. One
   * vocabulary, two independent choices. Empty means **no control at all**,
   * exactly as the thread menu behaves — never a fallback list.
   */
  const levels = useWeightLevels();
  /*
   * The profiles the picker offers — the same `type: agent-def` directory the
   * `@` autocomplete draws from, at the same bound, rather than a second query
   * with its own idea of what an invocable persona is.
   *
   * §7 says an **archived** profile is still designatable but is withdrawn from
   * the choices a workspace offers, and `useDocs` excludes archived documents by
   * default — so the offer is right without a filter of its own.
   */
  const profileDocs = useDocs({ type: MENTION_DOC_TYPE, limit: RESIDENT_CHOICE_LIMIT });
  /*
   * `rowToken` is **the** predicate both offer surfaces apply, and using it here
   * rather than reading a field is the point of its existing: the `@`
   * autocomplete and the designate menu each derived their own idea of what an
   * agent-def answers to once, and when the server changed its mind both were
   * wrong in the same way and neither noticed. A third reading here would be
   * that bug, restored.
   *
   * It also gates the offer: a row it cannot name is one the server would not
   * resolve, so offering it would promise a resolution that fails.
   */
  const profiles = useMemo(
    () =>
      (profileDocs.data?.items ?? []).flatMap((row) => {
        const name = rowToken(row);
        return name === null ? [] : [{ id: row.id, name }];
      }),
    [profileDocs.data],
  );
  /*
   * The address (UI-126). Both submits send `requestsAgent: true`, so it is
   * always live here. The weight rides `address.weightRequest` — stated only
   * where a level was offered and chosen, so picking a **resident** for Ask
   * (§7's summons) names that resident's designation-time weight instead of
   * offering a choice it would discard (rider signed 2026-08-19); Capture,
   * which is always the orchestrator's, shares the overlay's one control and
   * therefore its one statement.
   *
   * `designating` is what tells the address a resident is being **created**
   * (UI-185): its weight section then says its levels ride the message and
   * govern only what that resident hands off — the resident's own level is the
   * owner control's, one label to the right. The choice still travels, as the
   * *message* weight, because §7 gives it that job and Capture reads the same
   * control; what changes is that the overlay now says which weight went
   * where, instead of letting the one visible control read as the resident's.
   */
  const address = composerAddress({
    weight,
    recipient,
    live: composerReachesAgent({ requestsAgent: true }),
    designating:
      resident === null ? undefined : resident === undefined ? DEFAULT_RESIDENT_LABEL : resident,
  });

  useEffect(() => {
    textarea.current?.focus();
  }, []);

  /**
   * Escape closes from anywhere *outside* the textarea through the one chain
   * (UI-005's layers, at overlay priority, over focus mode and the readers). The
   * chain deliberately ignores keys aimed at a writing surface, which is why the
   * panel below also handles Escape: with the caret in the textarea — where it
   * starts — the layer never sees the press.
   */
  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Overlay, onEscape: onClose });

  const applyCompletion = useCallback((result: { text: string; caret: number }) => {
    setText(result.text);
    setCaret(result.caret);
    const element = textarea.current;
    if (element !== null) {
      element.value = result.text;
      element.setSelectionRange(result.caret, result.caret);
      element.focus();
    }
  }, []);

  const autocomplete = useAutocomplete({ value: text, caret, onComplete: applyCompletion });

  useLayoutEffect(() => {
    if (!autocomplete.isOpen || textarea.current === null) return;
    const rect = textarea.current.getBoundingClientRect();
    setMenuStyle({ top: rect.bottom + 4, left: rect.left });
  }, [autocomplete.isOpen, autocomplete.items.length]);

  const trimmed = text.trim();
  const canAsk = (trimmed !== "" || intake.pending.length > 0) && !compose.isPending;
  const canCapture = trimmed !== "" && !compose.isPending;

  const submit = useCallback(
    (mode: ComposeMode) => {
      if (mode === "ask" ? !canAsk : !canCapture) return;
      const body = text;
      const attachments: readonly PendingAttachment[] = intake.take();
      setText("");
      setCaret(0);
      void (async () => {
        const outcome = await compose.submit(mode, {
          text: body,
          files: attachments.map((attachment) => attachment.file),
          weight: address.weightRequest,
          recipient: recipient.request,
          // Absence is the default, so it is spelled by leaving the key out —
          // and `null` is a value here rather than another absence. The
          // designation's level rides *inside* the object (UI-185): it is the
          // resident's, and the body's top-level `weight` above is the
          // message's, which never governs the resident's own turn (§7).
          resident: designationRequest(resident, residentWeight),
        });
        if (outcome.ok) {
          // An override routes the message it was set on and never the next one
          // (SPEC.md §7), and this message landed.
          recipient.clear();
          intake.release(attachments);
          onClose();
          return;
        }
        // Nothing is lost on a failure: the text, the chips **and the lane** come
        // back and the panel stays open, because the person still means to send
        // this. The lane is the one that matters most here: a `422` refusing the
        // pick is the server saying this build's roster is behind, and a retry
        // that fell back to the computed default would silently address someone
        // else (UI-118).
        recipient.refuse(outcome.error);
        setText(body);
        setCaret(body.length);
        intake.restore(attachments);
        textarea.current?.focus();
      })();
    },
    // `resident` was absent here once, and only typing after the pick hid it:
    // a `useCallback` whose deps miss a state it closes over hands the click a
    // stale designation (found by UI-185, alongside the weight it adds).
    [
      address.weightRequest,
      canAsk,
      canCapture,
      compose,
      intake,
      onClose,
      recipient,
      resident,
      residentWeight,
      text,
    ],
  );

  /**
   * The contract, and only the contract (SPEC.md §10): `↵` is a newline, `⌘↵`
   * asks, `⇧⌘↵` captures, `esc` closes, an IME commit does none of it, and an
   * open completion menu is asked first. Every one of those sentences used to be
   * written out here, and in four other composers, each slightly differently.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    handleComposerKeyDown(event, {
      claim: autocomplete.handleKeyDown,
      onPrimary: () => {
        submit("ask");
      },
      onSecondary: () => {
        submit("capture");
      },
      onEscape: onClose,
    });
  };

  return (
    <div
      className="overlay open"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className={
          intake.dropping ? "search-panel compose-panel dropping" : "search-panel compose-panel"
        }
        role="dialog"
        aria-modal="true"
        aria-label="Ask or capture"
        data-dropzone="compose"
        onDragEnter={intake.onDragEnter}
        onDragOver={intake.onDragOver}
        onDragLeave={intake.onDragLeave}
        onDrop={intake.onDrop}
      >
        <textarea
          ref={textarea}
          value={text}
          placeholder={COMPOSE_PLACEHOLDER}
          aria-label="Ask the agent, or capture a thought"
          data-composer="compose"
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart);
          }}
          onSelect={(event) => {
            setCaret(event.currentTarget.selectionStart);
          }}
          onPaste={intake.onPaste}
          onKeyDown={onKeyDown}
        />

        <PendingAttachments pending={intake.pending} onRemove={intake.remove} />

        {/*
         * **Two rows, because the prototype's one row holds five things and
         * this one holds seven** (UI-180, reported 2026-08-27).
         *
         * `design/index.html`'s `.compose-actions` is `clip · hint · spacer ·
         * Capture · Ask`, and it fits. The product then added the address line
         * (UI-126, 140px) and the owner picker (UI-173, 145px) to the same row
         * without re-measuring it, and 286px went into a bar with about 70px of
         * slack. Every item shrank below its content: the hint wrapped to three
         * lines, and `Capture ⇧⌘↵` and `Ask ⌘↵` broke across three lines each.
         * Measured in a real browser at the panel's own 640px: the bar needed
         * 841px and had 606px.
         *
         * The split is along what the controls *are*, not along what fits. These
         * two say **who answers and who will own it** — settings for the send,
         * read before pressing. The row below is the send itself. So the
         * prototype's action row is restored exactly, and the two controls it
         * never budgeted for get a line of their own.
         */}
        <div className="compose-settings">
          <ComposerAddress address={address} surface="compose" />
          {/*
           * **Who will own the conversation** (UI-173).
           *
           * Beside the address rather than inside it, because they are two
           * different acts and §10's rider says so: naming a recipient routes
           * one message and rewires nothing, while designating hands over the
           * conversation and everything that grows out of it. Both may be set,
           * and a single control would have made choosing one imply the other.
           *
           * **It shows the default rather than an unchosen state.** Rider A
           * makes a general resident what happens if a person does nothing, so
           * a control reading "choose an owner…" would misdescribe what
           * pressing Ask is about to do.
           *
           * Ask only. A capture's thread has a parent, and §7 lets only a
           * standalone thread designate (SHARED-073).
           */}
          <label className="compose-resident">
            <span className="compose-resident-label">owner</span>
            <select
              aria-label="Who will own this conversation"
              value={resident === undefined ? "" : (resident ?? NO_RESIDENT_VALUE)}
              title={RESIDENT_TITLE}
              onChange={(event) => {
                const picked = event.currentTarget.value;
                setResident(
                  picked === "" ? undefined : picked === NO_RESIDENT_VALUE ? null : picked,
                );
              }}
            >
              <option value="">{DEFAULT_RESIDENT_LABEL}</option>
              <option value={NO_RESIDENT_VALUE}>{NO_RESIDENT_LABEL}</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.name}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          {/*
           * **The level that resident works at** (UI-185; §7's rider of
           * 2026-08-19: a resident's weight is set when it is designated, not
           * per message — and Ask is where most designations are made, so this
           * is where the choice must exist).
           *
           * Beside the owner and *not* inside the address, because the two
           * weights are different things: the address's rides this message and
           * governs only hand-offs, this one is what the resident **is** for
           * as long as the conversation lives. `at` is the lead
           * `residentActions.ts` gives an act's level ("— at heavy"), so the
           * pair reads as one designation: *owner researcher, at heavy*.
           *
           * Offered only where there is a resident to weigh — with "no owner"
           * picked it disappears rather than dims, and any standing choice is
           * then not sent, because a value the surface no longer shows must
           * not act (§10). A workspace declaring no levels gets no control at
           * all, exactly as the thread menu's rows behave.
           */}
          {levels.length > 0 && resident !== null ? (
            <label className="compose-resident compose-resident-weight">
              <span className="compose-resident-label">at</span>
              <select
                aria-label={RESIDENT_WEIGHT_ARIA}
                value={residentWeight ?? ""}
                title={RESIDENT_WEIGHT_TITLE}
                onChange={(event) => {
                  const picked = event.currentTarget.value;
                  setResidentWeight(picked === "" ? undefined : picked);
                }}
              >
                {/*
                 * An explicit member, worded as the thread menu words it: "the
                 * launcher decides" is a real outcome the contract reports
                 * back (`Resident.weight` null), never merely an unpressed
                 * state — and it is the way back once a level was picked.
                 */}
                <option value="">{LAUNCHER_DECIDES_LABEL}</option>
                {levels.map((level) => (
                  <option key={level.key} value={level.key}>
                    {level.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div className="compose-actions">
          <AttachButton surface="compose" onFiles={intake.add} />
          <span className="hint">{COMPOSE_HINT}</span>
          <span className="spacer" />
          <button
            type="button"
            className="btn-capture"
            disabled={!canCapture}
            title={
              canCapture
                ? recipient.overridden
                  ? CAPTURE_IGNORES_RECIPIENT
                  : "Save to inbox/ — the agent files it"
                : CAPTURE_NEEDS_TEXT
            }
            onClick={() => {
              submit("capture");
            }}
          >
            {CAPTURE_LABEL}
          </button>
          <button
            type="button"
            className="btn-ask"
            disabled={!canAsk}
            title="Start a standalone agent thread"
            onClick={() => {
              submit("ask");
            }}
          >
            {ASK_LABEL}
          </button>
        </div>

        <AutocompleteMenu
          open={autocomplete.isOpen}
          items={autocomplete.items}
          activeIndex={autocomplete.activeIndex}
          onHover={autocomplete.setActiveIndex}
          onChoose={autocomplete.choose}
          style={menuStyle}
          label="Composer completions"
        />
      </div>
    </div>
  );
}
