import Anthropic from "@anthropic-ai/sdk";
import type { AssistantFacts } from "@/lib/domain/assistant-grounding";
import { unsupportedAnswerNotice, verifyAnswer } from "@/lib/domain/assistant-verify";
import { logger } from "@/lib/logger";

/* The assistant, and why it does not stream.
 *
 * Streaming is the obvious choice for a chat box and the wrong one here. Every
 * price this product shows has been checked against something a provider was
 * observed saying, and that check can only run on a finished answer — a token
 * stream puts "$89" on the screen a second before anything can decide whether
 * $89 exists. The reader has already read it by then. So the answer is
 * generated whole, verified, and only then returned, and the interface shows
 * honest progress instead of fake progress.
 *
 * Effort is low on purpose. This is short-form question answering over a fact
 * sheet that is already assembled — there is no research to do and no plan to
 * make, and on Claude Opus 5.5 the cost of the higher levels buys nothing on
 * work of this shape.
 */

const MODEL = "claude-opus-5-5";
/** Generous for a few paragraphs. Truncating an answer mid-sentence would also
 *  truncate a price, and a half-written number is the one thing worse than a
 *  wrong one. */
const MAX_TOKENS = 4_000;

/* Stable, and first in the request, so it caches. Everything that changes
 * between questions — the board, the trip, the question — goes in messages. */
const SYSTEM = `You are the assistant inside RailDrop, a tool that watches Amtrak fares for a trip someone has already booked and tells them when a cheaper listed fare appears.

You are talking to the traveler. Answer in plain, calm prose, in the second person, and stop when the question is answered — two or three sentences is usually right, and a list is better than a paragraph when the answer is several fares.

The rules about money are absolute, because they are the product:

- Every amount you state must appear in the briefing you are given, or be the difference between two amounts in it. You may say "that is $76 cheaper" because that is subtraction of two observed fares. You may not estimate, extrapolate, recall a typical Amtrak price, or reason about what a fare "should" be.
- If the briefing does not contain the number needed to answer, say so and say what would be needed. "The board has not been checked for that date yet" is a good answer. An invented number is never one.
- Never predict a future price. You may describe what this route has cost before, because that was observed; you may not turn it into a forecast. "It has been cheaper than this on most days we looked" is a fact. "It will probably drop" is not.
- A fare that failed to load is unknown, not absent. Never describe a date the board could not read as having no trains.

You cannot search, refresh, book, or change anything. If asked to, explain that the board refreshes on its own and that booking happens on Amtrak. Never claim to have done something you cannot do.

If the question has nothing to do with this trip or with rail travel, say briefly that you only know about this trip, and stop.`;

export interface AskResult {
  answer: string;
  /** True when the model stated a price we could not support and was overruled. */
  blocked: boolean;
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number } | null;
}

export class AssistantNotConfiguredError extends Error {
  constructor() {
    super("The assistant needs ANTHROPIC_API_KEY to be set on this deployment.");
    this.name = "AssistantNotConfiguredError";
  }
}

export interface AskInput {
  question: string;
  facts: AssistantFacts;
  /** Earlier turns, oldest first. Kept short by the caller. */
  history?: readonly { role: "user" | "assistant"; content: string }[];
}

export async function askAssistant(input: AskInput): Promise<AskResult> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new AssistantNotConfiguredError();
  const client = new Anthropic();

  const messages: Anthropic.MessageParam[] = [
    ...(input.history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
    {
      role: "user" as const,
      content: `Here is everything known about this trip right now.\n\n${input.facts.briefing}\n\n---\n\nTheir question: ${input.question}`,
    },
  ];

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Cached: the rules do not change between questions, the briefing does.
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "low" },
      messages,
    });
  } catch (error) {
    // Most specific first — a rate limit and a bad key need different answers.
    if (error instanceof Anthropic.AuthenticationError) {
      logger.error("assistant.auth_failed", { message: error.message });
      throw new AssistantNotConfiguredError();
    }
    if (error instanceof Anthropic.RateLimitError) {
      logger.warn("assistant.rate_limited", { message: error.message });
      throw new Error("The assistant is busy at the moment. Try again in a minute.");
    }
    if (error instanceof Anthropic.APIError) {
      logger.error("assistant.api_error", { status: error.status, message: error.message });
      throw new Error("The assistant could not answer just now.");
    }
    throw error;
  }

  if (response.stop_reason === "refusal") {
    logger.warn("assistant.refused", { category: response.stop_details?.category ?? null });
    return {
      answer: "I can't answer that one. Ask me about this trip and I will.",
      blocked: false,
      usage: usageOf(response),
    };
  }

  const answer = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  /* The check the whole feature rests on. It runs on the finished text, and a
   * failure replaces the answer rather than editing it — a sentence with the
   * number quietly removed still reads as an answer. */
  const verdict = verifyAnswer(answer, input.facts.observedCents);
  if (!verdict.ok) {
    logger.error("assistant.unsupported_price", {
      unsupported: verdict.unsupported.map((mention) => mention.text),
      observed: input.facts.observedCents.length,
    });
    return { answer: unsupportedAnswerNotice(verdict), blocked: true, usage: usageOf(response) };
  }

  return {
    answer: answer || "I don't have an answer for that one.",
    blocked: false,
    usage: usageOf(response),
  };
}

function usageOf(response: Anthropic.Message): AskResult["usage"] {
  return {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cachedTokens: response.usage.cache_read_input_tokens ?? 0,
  };
}
