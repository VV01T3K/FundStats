import { fetchServerSentEvents, useChat } from "@tanstack/ai-solid";

export function useFundStatsChat() {
  return useChat({
    connection: fetchServerSentEvents("/api/ai/chat"),
    forwardedProps: {
      feature: "fund-stats",
    },
  });
}
