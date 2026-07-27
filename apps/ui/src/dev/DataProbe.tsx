import {
  isPendingTurn,
  useAppendTurn,
  useConnectionState,
  useDocs,
  useJobs,
  useLocks,
  useThread,
  useTree,
  type ConnectionState,
} from "@corpus/kit";
import { useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import "./DataProbe.css";

/**
 * A development-only surface that mounts every kit read hook at once, plus the
 * connection state, so the live-update loop can be observed in a real browser
 * before any real board column exists (UI-003).
 *
 * It is not product UI and it is not linked from anywhere. It exists because
 * "exactly one `/events` connection with several hooks mounted", "the list
 * repaints on an out-of-band mutation" and "the optimistic turn is replaced,
 * not duplicated" are claims only a real browser against a real server can
 * settle — and because a wrong query key is invisible to every other kind of
 * test.
 *
 * `?thread=<id>` adds the thread half: the thread's turns and a button that
 * appends one through `useAppendTurn`.
 */

interface QueryLike {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
}

function statusOf(query: QueryLike): string {
  if (query.isPending) return "pending";
  if (query.isError) return `error: ${query.error?.message ?? "unknown"}`;
  return "ok";
}

function Row({
  label,
  state,
  detail,
}: {
  readonly label: string;
  readonly state: string;
  readonly detail: string;
}): ReactElement {
  return (
    <tr data-probe={label}>
      <th scope="row">{label}</th>
      <td data-probe-state={state}>{state}</td>
      <td>{detail}</td>
    </tr>
  );
}

function ThreadPanel({ threadId }: { readonly threadId: string }): ReactElement {
  const thread = useThread(threadId);
  const append = useAppendTurn(threadId);
  const [draft, setDraft] = useState("probe turn");

  return (
    <section className="probe-thread" data-probe-thread={threadId}>
      <h2>
        useThread(<code>{threadId}</code>) —{" "}
        <span data-probe-state={statusOf(thread)}>{statusOf(thread)}</span>
      </h2>
      <ol className="probe-turns">
        {(thread.data?.turns ?? []).map((turn, index) => (
          <li
            key={`${turn.ts}-${String(index)}`}
            data-turn-ts={turn.ts}
            data-turn-pending={String(isPendingTurn(turn))}
          >
            <strong>{turn.author}</strong> · {turn.ts} — {turn.body}
          </li>
        ))}
      </ol>
      <input
        aria-label="Turn body"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
      />
      <button
        type="button"
        data-probe-append
        onClick={() => {
          append.mutate({ body: draft, requestsAgent: false });
        }}
      >
        append turn
      </button>
      <span data-probe-append-state={append.status}>{append.status}</span>
      {append.error ? <span data-probe-append-error>{append.error.message}</span> : null}
    </section>
  );
}

export function DataProbe(): ReactElement {
  const connection: ConnectionState = useConnectionState();
  const [params] = useSearchParams();
  const threadId = params.get("thread");
  const docs = useDocs({});
  const tree = useTree();
  const jobs = useJobs({});
  const locks = useLocks();

  return (
    <main className="probe" aria-label="Kit data probe">
      <h1>@corpus/kit data probe</h1>
      <p>
        connection: <strong data-probe-connection={connection}>{connection}</strong>
      </p>
      <table className="probe-table">
        <tbody>
          <Row
            label="useDocs"
            state={statusOf(docs)}
            detail={`${String(docs.data?.items.length ?? 0)} rows`}
          />
          <Row
            label="useTree"
            state={statusOf(tree)}
            detail={`${String(tree.data?.folders.length ?? 0)} folders`}
          />
          <Row
            label="useJobs"
            state={statusOf(jobs)}
            detail={`${String(jobs.data?.jobs.length ?? 0)} jobs`}
          />
          <Row
            label="useLocks"
            state={statusOf(locks)}
            detail={`${String(locks.data?.locks.length ?? 0)} locks`}
          />
        </tbody>
      </table>
      <ul className="probe-docs">
        {(docs.data?.items ?? []).map((row) => (
          <li key={row.id} data-doc-id={row.id} data-doc-type={row.type}>
            {row.title}
          </li>
        ))}
      </ul>
      {threadId === null ? null : <ThreadPanel threadId={threadId} />}
    </main>
  );
}
