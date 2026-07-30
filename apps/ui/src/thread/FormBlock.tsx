import { useRespondToForm, type RowNotice } from "@corpus/kit";
import type { Form } from "@corpus/contract";
import { useState, type ReactElement } from "react";
import { optionParts } from "./parseFormBlock";

/**
 * A ```` ```form ```` fence rendered as live controls (SPEC.md §6,
 * `design/index.html`'s `.form-comment`).
 *
 * **Submitting goes through `POST /api/threads/{id}/turns/{ts}/form`**, never a
 * hand-composed turn posted to `/turns`. That route is what validates the option
 * against the fence, writes the structured answer turn *and* enqueues the
 * `form.respond` event that re-triggers the agent (SPEC.md §8). A UI that built
 * the answer itself would produce a conversation that looks right and an agent
 * that never wakes up — and the difference is invisible until someone reads
 * `.corpus/queue/pending/`.
 *
 * Single-select and verbatim: the contract pins both (`schemas/form.ts`), so the
 * whole option string is what travels, and the `.price` split is presentation.
 */

export interface FormBlockProps {
  readonly form: Form;
  readonly threadId: string;
  /** The carrying turn's timestamp — the form's identity (SPEC.md §6). */
  readonly formTs: string;
  /** The option a later answer turn recorded, or `null` while unanswered. */
  readonly answered: string | null;
  /**
   * This form was answered from here, with this option.
   *
   * The route addresses the form by `ts`; the turn it writes back is prose and
   * says only which option was chosen. Reporting the pairing lets the thread
   * attribute the answer to the form the user clicked rather than inferring it
   * from the conversation's order — which two open forms offering the same
   * option make ambiguous (PR #10 finding 12).
   */
  readonly onAnswered?: ((formTs: string, option: string) => void) | undefined;
  readonly onNotify: (notice: RowNotice) => void;
}

export function FormBlock({
  form,
  threadId,
  formTs,
  answered,
  onAnswered,
  onNotify,
}: FormBlockProps): ReactElement {
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const respond = useRespondToForm(threadId);

  const chosen = answered ?? picked;
  const isAnswered = answered !== null;

  return (
    <div className="form-comment" data-form={formTs}>
      <p className="form-prompt">{form.prompt}</p>
      {form.options.map((option) => {
        const { label, detail } = optionParts(option);
        const isPicked = chosen === option;
        return (
          <button
            type="button"
            key={option}
            className={isPicked ? "form-opt picked" : "form-opt"}
            aria-pressed={isPicked}
            // An answered form is a record, not a control.
            disabled={isAnswered}
            onClick={() => {
              setPicked(option);
            }}
          >
            <span className="form-opt-label">{label}</span>
            {detail === null ? null : <span className="price">{detail}</span>}
          </button>
        );
      })}

      {isAnswered ? (
        <p className="form-answered">Answered — {answered}</p>
      ) : (
        <>
          <input
            className="form-note"
            placeholder="Note (optional)"
            aria-label="Note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <button
            type="button"
            className="form-submit"
            disabled={picked === null || respond.isPending}
            onClick={() => {
              if (picked === null) return;
              respond.mutate(
                {
                  ts: formTs,
                  option: picked,
                  ...(note.trim() === "" ? {} : { note: note.trim() }),
                },
                {
                  onSuccess: (result) => {
                    setNote("");
                    onAnswered?.(formTs, picked);
                    onNotify({
                      tone: "info",
                      message:
                        result.eventId === null
                          ? `Answered “${picked}” — recorded; the agent was not re-triggered.`
                          : `Answered “${picked}” — the agent was asked to continue.`,
                    });
                  },
                  onError: (error) => {
                    onNotify({ tone: "error", message: `Answer failed — ${error.message}` });
                  },
                },
              );
            }}
          >
            Answer
          </button>
        </>
      )}
    </div>
  );
}
