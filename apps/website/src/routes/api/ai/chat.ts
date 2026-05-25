import { createFileRoute } from "@tanstack/solid-router";
import { defineServerRoute } from "../../../integrations/tanstack/router/server-route.ts";
import type { GroqChatModels } from "@tanstack/ai-groq";

const defaultGroqModel = "llama-3.3-70b-versatile" satisfies GroqChatModels;
const groqChatModels = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-guard-4-12b",
  "meta-llama/llama-prompt-guard-2-86m",
  "meta-llama/llama-prompt-guard-2-22m",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-safeguard-20b",
  "moonshotai/kimi-k2-instruct-0905",
  "qwen/qwen3-32b",
] satisfies Array<GroqChatModels>;

function getGroqModel(value: string | undefined): GroqChatModels {
  if (value && groqChatModels.includes(value as GroqChatModels)) {
    return value as GroqChatModels;
  }

  return defaultGroqModel;
}

export const Route = createFileRoute("/api/ai/chat")(
  defineServerRoute({
    server: {
      handlers: {
        POST: async ({ request }) => {
          const apiKey = process.env.GROQ_API_KEY;

          if (!apiKey) {
            return Response.json(
              { error: "GROQ_API_KEY is required to use the FundStats AI endpoint." },
              { status: 500 },
            );
          }

          const { chat, chatParamsFromRequest, toServerSentEventsResponse } =
            await import("@tanstack/ai");
          const { createGroqText } = await import("@tanstack/ai-groq");
          const abortController = new AbortController();
          let params: Awaited<ReturnType<typeof chatParamsFromRequest>>;

          try {
            params = await chatParamsFromRequest(request);
          } catch (error) {
            if (error instanceof Response) {
              return error;
            }

            return Response.json(
              { error: error instanceof Error ? error.message : "Invalid chat request." },
              { status: 400 },
            );
          }

          const stream = chat({
            adapter: createGroqText(getGroqModel(process.env.GROQ_MODEL), apiKey),
            messages: params.messages,
            threadId: params.threadId,
            runId: params.runId,
            parentRunId: params.parentRunId,
            systemPrompts: [
              "You are FundStats AI. Help users inspect fund metrics, compare risk and return, and explain calculations succinctly.",
              "Do not claim live market access unless data is provided in the conversation.",
            ],
            abortController,
          });

          return toServerSentEventsResponse(stream, {
            abortController,
            headers: {
              "X-Accel-Buffering": "no",
              "X-Content-Type-Options": "nosniff",
            },
          });
        },
      },
    },
  }),
);
