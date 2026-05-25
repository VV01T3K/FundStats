import { fetchServerSentEvents, useChat } from "@tanstack/ai-solid";

const CHAT_ENDPOINT = "/api/ai/chat";

export function useAppChat(feature: string) {
  return useChat({
    connection: fetchServerSentEvents(CHAT_ENDPOINT),
    forwardedProps: { feature },
  });
}
