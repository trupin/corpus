import { useEffect, type ReactElement } from "react";
import { MAX_NOTICES, useNotices } from "../shell/Toasts";
import {
  droppedNoticesLine,
  NO_NOTICES_NOTE,
  NOTICES_LIST_LABEL,
  noticeTimeLabel,
  noticeToneLabel,
} from "./noticesModel";

/**
 * **What this session raised** — the console's Notices tab (SPEC.md §10's
 * Notices paragraph, rider authorized 2026-08-21; UI-139).
 *
 * Every warning and refusal, newest first, each with its whole text, its tone
 * and when it arrived. A toast is a notice arriving and this is where it stays,
 * so a refusal is still readable after its six seconds are up — and readable
 * without a pointer, which the toast's `title` never was.
 *
 * ## One pane, not two
 *
 * Jobs and Residents are master-detail because each has a row to pick and a
 * body to show for it. A notice has no detail: its whole content is the string
 * the server sent, and putting that string behind a selection would be a second
 * click between a person and the reason their write was refused. So this tab is
 * one full-width list, and the message is rendered in it **unclamped** — this
 * surface is the reveal, and a reveal that cuts is not one.
 *
 * ## Reading it is what clears the marker
 *
 * The strip marks the console while an unread error notice exists. This
 * component is mounted only when the drawer is open *and* this tab is selected,
 * so its own presence is the event "the tab has been opened" — which is why the
 * clearing lives here and not in a click handler on the tab button. The effect
 * runs again when a notice arrives, so an error raised while a person is
 * already looking at the list never leaves the marker lit behind them.
 */

export function Notices(): ReactElement {
  const { notices, dropped, markNoticesRead } = useNotices();

  useEffect(() => {
    markNoticesRead();
  }, [markNoticesRead, notices]);

  return (
    /*
     * Focusable because it scrolls: a scroll container the keyboard cannot put
     * focus into is a list a keyboard-only person cannot page through, and this
     * whole tab exists for that person.
     *
     * `role="group"` so the label means something — a bare `aria-label` on a
     * generic container is ignored. Never `role="log"`, whose implicit
     * `aria-live` would announce every notice a second time: the toast's live
     * region already read it out, and this tab is the *durable* copy, not a
     * second announcement of the same event.
     */
    <div className="notice-list" role="group" tabIndex={0} aria-label={NOTICES_LIST_LABEL}>
      {notices.length === 0 ? <div className="notice-empty">{NO_NOTICES_NOTE}</div> : null}
      {notices.map((notice) => (
        <div key={notice.id} className="notice" data-tone={notice.tone}>
          <span className="notice-tick" aria-hidden="true">
            {notice.tone === "error" ? "!" : "✓"}
          </span>
          <span className="notice-time">{noticeTimeLabel(notice.at)}</span>
          <span className="notice-tone">{noticeToneLabel(notice.tone)}</span>
          <span className="notice-msg">{notice.message}</span>
        </div>
      ))}
      {dropped === 0 ? null : (
        <div className="notice-dropped">{droppedNoticesLine(dropped, MAX_NOTICES)}</div>
      )}
    </div>
  );
}
