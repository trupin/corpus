import { CorpusRequestError, useRespondToForm, type RowNotice } from "@corpus/kit";
import {
  formAnswerRecords,
  type Form,
  type FormField,
  type FormFieldRecord,
} from "@corpus/contract";
import { useMemo, useState, type ReactElement } from "react";
import { GrowingTextarea } from "./GrowingTextarea";
import {
  draftRequest,
  emptyDraft,
  fieldDraft,
  missingRequired,
  toggleOption,
  withField,
  type FieldDraft,
  type FormDraft,
} from "./formDraft";
import { answerFaults, type AnswerFault } from "./formPreflight";
import { optionParts, type AnsweredForm } from "./parseFormBlock";

/**
 * A ```` ```form ```` fence rendered as live controls, and — once answered — as
 * the record it becomes (SPEC.md §6, §11; `design/index.html`'s
 * `.form-comment`).
 *
 * **One control per field, matched to what the field asks.** §6 has exactly
 * three kinds and the contract's `FormSchema` is what decides which one a field
 * is, so nothing here sniffs the YAML: `choose one` is a radio group,
 * `choose any` a checkbox group, `write` a growing textarea. The legacy
 * `prompt` + `options` spelling never reaches this component as a second shape
 * — it normalises into one required `choose one` field at the contract's parse
 * boundary — so there is no "is this an old form?" branch to get wrong.
 *
 * **Native inputs, visible and focusable.** The mockup hides its radios
 * (`<input type="radio" hidden>`) and paints the whole row; `hidden` removes an
 * element from the tab order, and §11 says every answer is reachable from the
 * keyboard — "a form the person cannot answer without a mouse is a question they
 * cannot answer". So the inputs are real and on screen, the row is still the
 * card the mockup draws, and arrow keys move within a radio group exactly as
 * they do everywhere else on the web.
 *
 * **Submitting goes through `POST /api/threads/{id}/turns/{ts}/form`**, never a
 * hand-composed turn posted to `/turns`. That route is what validates the
 * answers against the fence, writes the structured answer turn *and* enqueues
 * the `form.respond` event that re-triggers the agent (SPEC.md §8). A UI that
 * built the answer itself would produce a conversation that looks right and an
 * agent that never wakes up — and the difference is invisible until someone
 * reads `.corpus/queue/pending/`.
 *
 * **All-or-nothing.** There is no partial save and no per-field submit: the form
 * is unanswered until it is submitted, so "unanswered" means one thing in the
 * controls, in the Attention row and in the projection.
 */

export interface FormBlockProps {
  readonly form: Form;
  readonly threadId: string;
  /** The carrying turn's timestamp — the form's identity (SPEC.md §6). */
  readonly formTs: string;
  /** What a later turn recorded for this form, or `null` while unanswered. */
  readonly answered: AnsweredForm | null;
  /**
   * This form was answered from here, with this record.
   *
   * The route addresses the form by `ts`; the turn it writes back is prose and
   * names only the questions and what was given. Reporting the pairing lets the
   * thread attribute the answer to the form the user clicked rather than
   * inferring it from the conversation's order — which two open forms asking
   * identical questions make ambiguous (PR #10 finding 12).
   */
  readonly onAnswered?: ((formTs: string, answer: AnsweredForm) => void) | undefined;
  readonly onNotify: (notice: RowNotice) => void;
}

/** The submit's key, named on the control like every other composer's (§11). */
const SUBMIT_KEY_HINT = "⌘↵";

/**
 * The way back out of an **optional** `choose one` (PR #28 finding 7).
 *
 * A radio group is one-way by construction: clicking an option can never
 * un-click it, so an optional single-select had no blank state a person could
 * return to once they had touched it. §6 says an optional field is one the
 * person may leave blank and that a form is answered once, as a whole — so a
 * mis-click was unrecoverable *and* silent: what the agent is told changes, and
 * nothing on screen says so. AGENT-017 tells the agent to mark fields optional
 * generously, which makes optional single-selects the common case rather than
 * the exotic one.
 *
 * It is a **member of the group**, not a clear button beside it, because that is
 * the idiom the control already speaks: it is reachable with the same arrow keys
 * as every other option, it is what the group shows as chosen while the field is
 * untouched — so "blank" is visibly a legitimate state rather than an absence —
 * and choosing it is one action rather than "click a button that undoes the
 * thing you can see".
 *
 * The other two kinds already have one: a checkbox unticks itself, and a `write`
 * field empties when the text is deleted. Only a radio group cannot.
 *
 * Picking it sets the draft's `option` back to `null`, which is `formDraft`'s
 * single spelling of blank, so the field contributes **no entry at all** to the
 * request — never `option: ""`, which the server reads as a value and refuses.
 */
const LEAVE_BLANK_LABEL = "Leave blank";

/**
 * The refusal a second answer earns, said as what it is.
 *
 * `409` is not a validation failure and must not read like one: the request was
 * well formed and the *state* refused it, which happens when the same form was
 * answered in another column or another browser between render and submit. §6
 * says changing your mind is an ordinary reply, so that is what the message
 * offers — retrying the same submit never helps.
 */
export const ALREADY_ANSWERED_NOTICE =
  "Already answered — this form was answered elsewhere. Changing your mind is an ordinary reply, not a second answer.";

/**
 * The id of the message under one field, so the control it belongs to can point
 * at it and the submit can name every reason it is unavailable.
 *
 * Keyed by the field's **index**, never by its question: `aria-describedby` is a
 * space-separated list of ids, and a question is a sentence.
 */
const faultId = (formTs: string, index: number): string => `form-fault-${formTs}-${String(index)}`;

/** The message about the form as a whole, when no single field can carry it. */
const formFaultId = (formTs: string): string => `form-fault-${formTs}`;

export function FormBlock({
  form,
  threadId,
  formTs,
  answered,
  onAnswered,
  onNotify,
}: FormBlockProps): ReactElement {
  const [draft, setDraft] = useState<FormDraft>(() => emptyDraft(form));
  const [note, setNote] = useState("");
  const respond = useRespondToForm(threadId);
  /*
   * The request as it stands, and what the contract makes of it — asked on every
   * keystroke rather than on submit, because the whole point is that the person
   * is told *before* the round trip (`formPreflight.ts`). It costs one
   * format-and-parse of the answer's own text while the answer is readable,
   * which is every render but the ones that are already refusing.
   *
   * Both sit **above** the answered-record early return: a `useMemo` below it
   * would run on some renders and not others, and React refuses a component
   * whose hook count changes.
   */
  const request = useMemo(() => draftRequest(form, draft, note), [form, draft, note]);
  const faults = useMemo(() => answerFaults(form, request), [form, request]);

  if (answered !== null) {
    return <AnsweredRecord formTs={formTs} answer={answered} />;
  }

  const missing = missingRequired(form, draft);
  const formFault = faults.find((fault) => fault.question === null);
  const canSubmit = missing.length === 0 && faults.length === 0 && !respond.isPending;
  const missingId = `form-missing-${formTs}`;

  // Every reason the submit is unavailable, in the order they appear on screen,
  // so the button announces the whole of it rather than the first one.
  const describedBy = [
    ...(missing.length > 0 ? [missingId] : []),
    ...form.fields.flatMap((field, index) =>
      faults.some((fault) => fault.question === field.question) ? [faultId(formTs, index)] : [],
    ),
    ...(formFault === undefined ? [] : [formFaultId(formTs)]),
  ].join(" ");

  const submit = (): void => {
    if (!canSubmit) return;
    respond.mutate(
      {
        ts: formTs,
        answers: request.answers,
        ...(request.note === undefined ? {} : { note: request.note }),
      },
      {
        onSuccess: (result) => {
          const record: AnsweredForm = {
            answers: formAnswerRecords(form, request),
            note: request.note ?? null,
          };
          setNote("");
          onAnswered?.(formTs, record);
          onNotify({
            tone: "info",
            message:
              result.eventId === null
                ? "Answered — recorded; the agent was not re-triggered."
                : "Answered — the agent was asked to continue.",
          });
        },
        onError: (error) => {
          const conflict = error instanceof CorpusRequestError && error.status === 409;
          onNotify(
            conflict
              ? { tone: "error", message: ALREADY_ANSWERED_NOTICE }
              : { tone: "error", message: `Answer failed — ${error.message}` },
          );
        },
      },
    );
  };

  return (
    <div
      className="form-comment"
      data-form={formTs}
      /*
       * The key the submit names, actually bound (§11 — "a single submit for the
       * whole form that names its key like every other composer control"). It
       * fires from anywhere inside the form, including the `write` textarea,
       * where `↵` stays a newline exactly as the composer contract says it does.
       */
      onKeyDown={(event) => {
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        submit();
      }}
    >
      {form.fields.map((field, index) => (
        <FieldControl
          key={field.question}
          field={field}
          formTs={formTs}
          draft={draft}
          fault={faults.find((entry) => entry.question === field.question)}
          faultId={faultId(formTs, index)}
          onChange={(next) => {
            setDraft((current) => withField(current, field.question, next));
          }}
        />
      ))}

      {/* One place for the note, beside the answers and never a field's own (§6). */}
      <input
        className="form-note"
        placeholder="Note about the ask as a whole (optional)"
        aria-label="Note"
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />

      {missing.length > 0 ? (
        <p className="form-missing" id={missingId} role="status">
          Still needed: {missing.map((field) => `“${field.question}”`).join(", ")}
        </p>
      ) : null}

      {/* A refusal with no field to hang it on — see `AnswerFault.question`. */}
      {formFault === undefined ? null : (
        <p className="form-unreadable" id={formFaultId(formTs)} role="status">
          This answer cannot be recorded — {formFault.reason}
        </p>
      )}

      <button
        type="button"
        className="form-submit"
        disabled={!canSubmit}
        {...(describedBy === "" ? {} : { "aria-describedby": describedBy })}
        onClick={submit}
      >
        Answer <span className="form-submit-key">{SUBMIT_KEY_HINT}</span>
      </button>
    </div>
  );
}

interface FieldControlProps {
  readonly field: FormField;
  readonly formTs: string;
  readonly draft: FormDraft;
  /** Why this field's own text could not be recorded, if it could not. */
  readonly fault: AnswerFault | undefined;
  readonly faultId: string;
  readonly onChange: (next: FieldDraft) => void;
}

/**
 * One field, as a `fieldset`/`legend` whichever kind it is.
 *
 * The grouping is not decoration: a radio group without one announces each
 * option with no question attached, which for a form of three fields is three
 * unlabelled sets of choices. `write` gets one too so the three kinds stay one
 * visual and structural rhythm.
 */
function FieldControl({
  field,
  formTs,
  draft,
  fault,
  faultId: faultDomId,
  onChange,
}: FieldControlProps): ReactElement {
  const value = fieldDraft(draft, field.question);
  const group = `form-${formTs}-${field.question}`;

  return (
    <fieldset className={`form-field kind-${field.kind.replace(" ", "-")}`}>
      <legend className="form-prompt">
        {field.question}
        {field.optional ? null : <span className="form-required"> (required)</span>}
      </legend>

      {field.kind === "write" ? (
        /*
         * The **box** is the wrapper, not the textarea — the composer's own
         * pattern (`thread.css`). `GrowingTextarea` measures by stacking a
         * hidden copy of the value in the same grid cell, so anything that
         * decides a line break has to be identical on the field and the mirror;
         * padding or a border on the field alone would make the mirror measure a
         * different string and the row grow to the wrong height. `.composer-grow
         * > textarea` also out-specifies a bare class on the field, so styling
         * it there does not even take effect.
         */
        <div className="form-write">
          <GrowingTextarea
            aria-label={field.question}
            aria-invalid={fault === undefined ? undefined : true}
            {...(fault === undefined ? {} : { "aria-describedby": faultDomId })}
            value={value.text}
            onChange={(event) => {
              onChange({ ...value, text: event.target.value });
            }}
          />
        </div>
      ) : (
        <>
          {field.options.map((option) => {
            const { label, detail } = optionParts(option);
            const picked =
              field.kind === "choose one"
                ? value.option === option
                : value.options.includes(option);
            return (
              <label key={option} className={picked ? "form-opt picked" : "form-opt"}>
                <input
                  className="form-opt-input"
                  type={field.kind === "choose one" ? "radio" : "checkbox"}
                  name={group}
                  checked={picked}
                  onChange={() => {
                    onChange(
                      field.kind === "choose one"
                        ? { ...value, option }
                        : { ...value, options: toggleOption(field, value.options, option) },
                    );
                  }}
                />
                <span className="form-opt-label">{label}</span>
                {detail === null ? null : <span className="price">{detail}</span>}
              </label>
            );
          })}

          {/* The only kind that cannot un-choose itself — see LEAVE_BLANK_LABEL. */}
          {field.kind === "choose one" && field.optional ? (
            <label
              className={
                value.option === null ? "form-opt form-opt-blank picked" : "form-opt form-opt-blank"
              }
            >
              <input
                className="form-opt-input"
                type="radio"
                name={group}
                /*
                 * Named for the question it belongs to, because "Leave blank" is
                 * a legal option (PR #28 re-review, MINOR): a `choose one`
                 * offering it would otherwise put two radios with the same
                 * accessible name in one group, and nothing but the DOM order
                 * would tell them apart. The label the *form* wrote stays the
                 * label; only this row — the one control the UI adds itself —
                 * says which field it empties, which also stops three optional
                 * selects announcing "Leave blank" three indistinguishable
                 * times. The visible text is a prefix of the name, so
                 * voice control still reaches it by what it reads (WCAG 2.5.3).
                 */
                aria-label={`${LEAVE_BLANK_LABEL} — no answer for “${field.question}”`}
                checked={value.option === null}
                onChange={() => {
                  onChange({ ...value, option: null });
                }}
              />
              <span className="form-opt-label">{LEAVE_BLANK_LABEL}</span>
            </label>
          ) : null}
        </>
      )}

      {/*
       * The refusal, at the field that earned it and before the round trip —
       * §11's posture for a missing required field, applied to an answer that
       * would not read back (`formPreflight.ts`). The contract's sentence is
       * printed as it comes: it names the line to rewrite, which is the only
       * thing the person can act on.
       */}
      {fault === undefined ? null : (
        <p className="form-unreadable" id={faultDomId} role="status">
          {fault.reason}
        </p>
      )}
    </fieldset>
  );
}

/**
 * The record an answered form becomes — §11's "once submitted, the form stops
 * being a question… each question beside what was given for it".
 *
 * There are **no controls here at all**, disabled or otherwise. A disabled
 * control still says "this is a thing you could have done"; the record says what
 * the exchange was, which is what the turn afterwards has to read as. It is also
 * what makes "there is no way to submit a second answer" structural rather than
 * a `disabled` attribute one keyboard away from being wrong.
 */
function AnsweredRecord({
  formTs,
  answer,
}: {
  readonly formTs: string;
  readonly answer: AnsweredForm;
}): ReactElement {
  return (
    <div className="form-comment form-answered" data-form={formTs} data-answered="true">
      <dl className="form-record">
        {answer.answers.map((record) => (
          <div className="form-record-row" key={record.question} data-question={record.question}>
            <dt className="form-record-q">{record.question}</dt>
            <dd className="form-record-a">{givenText(record)}</dd>
          </div>
        ))}
      </dl>
      {answer.note === null ? null : <p className="form-record-note">Note: {answer.note}</p>}
    </div>
  );
}

/** What was given for one field, as one readable string. */
export function givenText(record: FormFieldRecord): string {
  if (record.option !== null) return record.option;
  if (record.options !== null) return record.options.join(", ");
  if (record.text !== null) return record.text;
  return "left blank";
}
