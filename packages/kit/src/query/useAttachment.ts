import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useCorpusClient } from "../client/context.js";

/**
 * The bytes behind one attachment reference, as an object URL (SPEC.md §6).
 *
 * **Why a fetch and not an `<img src>`.** `/attachments/*` is behind the
 * workspace bearer token (SPEC.md §2.1), and a browser sends no `Authorization`
 * header on an image or anchor. The alternatives were both worse: putting the
 * token in the URL would leak it into referrers and proxy logs — the exact
 * reason the server allows `?token=` on `/events` and nowhere else — and
 * dropping the guard would make every attachment world-readable to anything that
 * can reach the port. So the kit fetches with the header it already holds and
 * hands the caller a `blob:` URL.
 *
 * Cached under `["attachments", target]`, which is deliberately outside the
 * SSE key vocabulary: stored attachment bytes never change (the server serves
 * them `immutable`), so nothing on the wire could ever have cause to invalidate
 * this.
 *
 * The object URL is created per mount and revoked on unmount. The *blob* is what
 * TanStack caches, so a second reader of the same attachment reuses the download
 * and still owns its own URL — one component revoking never blanks another.
 */
export interface AttachmentBytes {
  /** `blob:` URL for the fetched bytes, or `null` while loading or on failure. */
  readonly url: string | null;
  readonly isPending: boolean;
  readonly error: Error | null;
}

export function attachmentKey(target: string): readonly unknown[] {
  return ["attachments", target];
}

export function useAttachment(target: string): AttachmentBytes {
  const client = useCorpusClient();
  const [url, setUrl] = useState<string | null>(null);

  const blob = useQuery({
    queryKey: attachmentKey(target),
    queryFn: ({ signal }) => client.fetchAttachment(target, { signal }),
    enabled: target !== "",
    // Bytes at a given path are immutable, so a refetch could only ever produce
    // the same download again.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const data = blob.data;

  useEffect(() => {
    if (data === undefined) {
      setUrl(null);
      return;
    }
    // jsdom implements neither `createObjectURL` nor `revokeObjectURL`.
    if (typeof URL.createObjectURL !== "function") return;
    const objectUrl = URL.createObjectURL(data);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [data]);

  return { url, isPending: blob.isPending, error: blob.error };
}
