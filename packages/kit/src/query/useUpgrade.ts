import type { UpgradeCheck, UpgradeStarted } from "@corpus/contract";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";

/**
 * SPEC.md §2.4's two acts, as the only two hooks in this package that read the
 * server without being queries.
 *
 * **The check is a mutation, and that is the design rather than an oversight.**
 * §2.4 opens with "never checks for, downloads, or installs anything in the
 * background, and never phones home". A `useQuery` is a thing react-query is
 * entitled to run again — on a window focus, on a network reconnect, on a
 * remount — and every one of those is a check nobody asked for. Structuring the
 * check as a mutation makes the promise unfakeable: a mutation runs when
 * something calls `mutate` and at no other moment. There is no `enabled: false`
 * to get wrong later, and no cache to accidentally serve as a fresh answer.
 *
 * Neither hook caches. The check's answer is stale the moment it arrives, and
 * remembering one is a background check with extra steps.
 */

/** `GET /api/upgrade/check`. Runs only when called; never retried. */
export function useCheckUpgrade(): UseMutationResult<UpgradeCheck, Error, void> {
  const client = useCorpusClient();
  return useMutation({
    mutationFn: () => client.checkUpgrade(),
    // A failed check is a sentence for a person, not something to try again
    // behind their back — and the ordinary failure (an offline laptop) already
    // arrives as a successful answer with `reachable: false`.
    retry: false,
  });
}

/**
 * `POST /api/upgrade`. Resolves when a process exists — not when it finishes.
 *
 * **Never retried, and this one matters.** A retry after a timeout would be a
 * second `npm install -g` racing the first over one prefix; the server refuses
 * that with a `409`, and asking for the refusal on the caller's behalf is not a
 * recovery.
 */
export function useStartUpgrade(): UseMutationResult<UpgradeStarted, Error, void> {
  const client = useCorpusClient();
  return useMutation({ mutationFn: () => client.startUpgrade(), retry: false });
}
