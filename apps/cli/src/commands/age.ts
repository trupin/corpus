/**
 * How long ago, in one significant unit — the CLI's single rendering of an
 * elapsed time.
 *
 * Every instant this tool prints arrives on the wire as an ISO instant and is
 * turned into an age here, because the contract assigns that job to the client
 * on purpose: an instant lets the caller subtract against whichever clock it
 * trusts, while a duration is stale the moment the response is read
 * (`InProgressEvent.heldSince`, `AgentLane.since`). Two verbs now do it — the
 * queue's in-progress block and `corpus agents` — and one ladder is what keeps
 * `held 3h` and `last parked 3h ago` from disagreeing about what three hours
 * looks like.
 *
 * One unit and no more: the reader is deciding whether they recognise the work
 * or whether anybody is listening, not measuring anything.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * `45s` / `12m` / `3h` / `2d`.
 *
 * A negative span — clock skew between the server and this machine — clamps to
 * `0s` rather than rendering as a time in the future, which is the one reading
 * that would be certainly wrong.
 */
export function formatAge(ms: number): string {
  const span = Math.max(0, ms);
  if (span < MINUTE) return `${String(Math.floor(span / SECOND))}s`;
  if (span < HOUR) return `${String(Math.floor(span / MINUTE))}m`;
  if (span < DAY) return `${String(Math.floor(span / HOUR))}h`;
  return `${String(Math.floor(span / DAY))}d`;
}
