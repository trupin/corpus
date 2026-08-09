/**
 * Whether a composer says sending **will** reach the agent (SPEC.md §8, §11).
 *
 * ## One derivation, on purpose
 *
 * Two things want this answer and only one of them exists yet. §11's liveness
 * rule — "the control is live exactly when the composer says sending will reach
 * the agent, and shows as having nothing to act on when it says it will not" —
 * needs it today. §11's "A composer says who it will reach, before you send"
 * (signed 2026-08-05, SHARED-016) will need it when someone builds it; a grep of
 * `apps/ui/src` finds no implementation and no issue filed. Deriving it twice is
 * how the two end up disagreeing about one sentence, so it is derived here and
 * the reach statement is expected to consume this rather than re-answer it.
 *
 * ## It is presentation, and nothing else
 *
 * §11 is explicit that the coupling runs one way: "a presentation rule only: §8
 * alone decides what reaches the agent, and choosing a weight neither asks the
 * agent nor stops it being asked." So this function is read *by* the control and
 * never written *by* it — it takes the composer's own ask-agent state as an
 * input, must not be used to enable or disable that toggle, and is not part of
 * any send decision. Nothing here is on the path between pressing send and a
 * request leaving.
 *
 * ## Why it takes a tri-state
 *
 * `requestsAgent` is tri-state on the wire (§8): `true` asks, `false` is note
 * only, and **omitted** means "enqueue if this thread is already engaged" — the
 * server's rule, which needs the thread's own state to answer. Every first-party
 * composer sends an explicit `true` or `false` today, so `engaged` is unused by
 * them; it is here because a plugin composer may legitimately omit the flag, and
 * a derivation that answered `false` for it would tell that composer its control
 * is dead on precisely the threads where sending does wake the agent.
 */

export interface ComposerReach {
  /**
   * The composer's own ask-agent signal, exactly as it will be sent: `true`,
   * `false`, or omitted for the server's default.
   */
  readonly requestsAgent?: boolean | undefined;
  /**
   * Whether the agent is already in this conversation (SPEC.md §8's `engaged`).
   * Consulted only when {@link requestsAgent} is omitted. A composer that cannot
   * tell — a thread that does not exist yet — leaves it out, and an omitted flag
   * on a thread that does not exist enqueues nothing.
   */
  readonly engaged?: boolean | undefined;
}

/** True when this composer, as configured right now, says sending reaches the agent. */
export function composerReachesAgent(reach: ComposerReach): boolean {
  if (reach.requestsAgent === true) return true;
  if (reach.requestsAgent === false) return false;
  return reach.engaged === true;
}
