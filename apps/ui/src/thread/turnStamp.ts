/** `2026-07-19T10:05:00Z` → `Jul 19, 10:05`, the prototype's turn stamp. */
export function turnStamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
