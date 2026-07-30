/**
 * Callbacks that have to outlive the component that started the mutation
 * (UI-012).
 *
 * TanStack Query v5 delivers a `mutate(variables, { onSuccess })` callback
 * through the **observer**, and skips it entirely once that observer has no
 * listeners left — `MutationObserver#notify` is guarded by `hasListeners()`.
 * A surface that closes itself on click therefore silences its own result: the
 * write commits and nothing is ever said about it. Callbacks handed to
 * `useMutation` instead ride on the mutation's own options, which the mutation
 * snapshots when the request starts, so they fire wherever the component went.
 *
 * The split is a real one, not a preference:
 *
 * - Anything the **user** must be told — a toast, an error notice — belongs
 *   here, because a committed write with no feedback is the failure mode
 *   `shell/Toasts.tsx` exists to prevent.
 * - Anything that only means something while the surface is still on screen —
 *   moving focus, popping a navigation stack, disarming a confirm — stays in
 *   the per-call callbacks, where being skipped after unmount is correct.
 */
export interface SettledCallbacks<TData, TVariables> {
  readonly onSuccess?: ((data: TData, variables: TVariables) => void) | undefined;
  readonly onError?: ((error: Error, variables: TVariables) => void) | undefined;
}
