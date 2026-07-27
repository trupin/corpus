import type { TopicSpec } from "../../registry/types.js";
import { replyCommand } from "./reply.js";
import { reopenCommand, resolveCommand } from "./status.js";

/**
 * Conversations (SPEC.md §6, §8). A thread is itself a document — a file under
 * `data/threads/` with an anchor entry in whatever it comments on — so reading
 * and listing threads goes through the document surface; these are the verbs
 * that *write* to a conversation.
 *
 * Thread creation has no verb here on purpose: a thread is anchored to a
 * selection in a document, which is a thing the UI's selection carries and a
 * command line does not. The agent replies to conversations it was invited to.
 */
export const threadTopic: TopicSpec = {
  name: "thread",
  summary: "Reply to conversations and open or close them.",
  description:
    "A comment opens a thread anchored to the text it is about; every later turn appends to that " +
    "thread's file (SPEC.md §6). `reply` is the agent's half of the conversation — the exact " +
    "command §7's comment skill is written in — and `resolve`/`reopen` control whether later " +
    "turns keep waking it (SPEC.md §8).",
  commands: [replyCommand, resolveCommand, reopenCommand],
};
