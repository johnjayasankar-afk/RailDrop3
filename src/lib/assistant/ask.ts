import Anthropic from "@anthropic-ai/sdk";
import type { AssistantFacts } from "@/lib/domain/assistant-grounding";
import { unsupportedAnswerNotice, verifyAnswer } from "@/lib/domain/assistant-verify";
import { ASSISTANT_TOOLS, runAssistantTool, type ToolContext } from "./tools";
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

When you are given tools, they only read. list_trips gives you every trip this traveller is watching; get_trip_board opens one of them in full. Look things up rather than guessing across trips, and when a question spans several, check the ones it actually depends on instead of answering from the summary line. A fare that came back from a tool is observed and you may quote it.

You cannot search, refresh, book, cancel, or change anything, with or without tools. If asked to, explain that the board refreshes on its own and that booking happens on Amtrak. Never claim to have done something you cannot do.

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
  /**
   * Present when the question is about the whole dashboard rather than one
   * trip. Gives the model the read-only tools in tools.ts; without it there is
   * nothing to look up, because the single-trip fact sheet is already complete.
   */
  tools?: ToolContext;
}

/**
 * How many times it may look something up before answering.
 *
 * Four covers the realistic shape — list the trips, then open two or three of
 * them. A loop without a ceiling is one malformed argument away from spending
 * a request's whole budget rediscovering the same board.
 */
const MAX_TOOL_ROUNDS = 4;

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

  /* A manual loop rather than the SDK's tool runner.
   *
   * The runner would drive the turns perfectly well, but two things have to
   * happen around them: every fare a tool returns is added to the set the
   * answer is allowed to quote, and the finished text is checked against that
   * set before anyone sees it. Owning the loop keeps both of those in one
   * place, next to the rule they enforce. */
  let response: Anthropic.Message;
  try {
    response = await runConversation(client, messages, input.tools);
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
  /* The briefing's own fares plus anything the tools actually returned.
     The allowance only ever grows through an observation that came back, never
     through the model asking for one. */
  const observed = [...input.facts.observedCents, ...(input.tools?.observedCents ?? [])];
  const verdict = verifyAnswer(answer, observed);
  if (!verdict.ok) {
    logger.error("assistant.unsupported_price", {
      unsupported: verdict.unsupported.map((mention) => mention.text),
      observed: observed.length,
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

/**
 * Turns until the model stops asking for things.
 *
 * All tool results for one assistant turn go back in a single user message.
 * Splitting them across messages is the quiet way to teach a model to stop
 * calling tools in parallel, and a failed call still has to come back as a
 * result — dropping it leaves the conversation with a call that never
 * resolved.
 */
async function runConversation(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  tools: ToolContext | undefined,
): Promise<Anthropic.Message> {
  const thread = [...messages];

  for (let round = 0; ; round += 1) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Cached: the rules do not change between questions, the briefing does.
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "low" },
      // tool_choice stays auto: Opus 5.5 rejects the forced forms with a 400.
      ...(tools ? { tools: ASSISTANT_TOOLS } : {}),
      messages: thread,
    });

    const calls = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (response.stop_reason !== "tool_use" || calls.length === 0 || !tools) return response;

    if (round >= MAX_TOOL_ROUNDS) {
      logger.warn("assistant.tool_rounds_exhausted", { rounds: round });
      // Tell it to answer with what it has rather than truncating mid-loop.
      thread.push(
        { role: "assistant", content: response.content },
        {
          role: "user",
          content: calls.map((call) => ({
            type: "tool_result" as const,
            tool_use_id: call.id,
            content: "No more lookups are available. Answer from what you already have.",
            is_error: true,
          })),
        },
      );
      continue;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      try {
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: await runAssistantTool(call.name, call.input, tools),
        });
      } catch (error) {
        logger.error("assistant.tool_failed", {
          tool: call.name,
          message: error instanceof Error ? error.message : String(error),
        });
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: "That lookup failed. Say so rather than guessing what it would have returned.",
          is_error: true,
        });
      }
    }

    thread.push(
      { role: "assistant", content: response.content },
      { role: "user", content: results },
    );
  }
}
