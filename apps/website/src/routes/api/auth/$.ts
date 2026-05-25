import { createFileRoute } from "@tanstack/solid-router";
import { createServerOnlyFn } from "@tanstack/solid-start";
import { defineServerRoute } from "../../../integrations/tanstack/router/server-route.ts";

const getAuth = createServerOnlyFn(() => import("../../../integrations/better-auth/server.ts"));

export const Route = createFileRoute("/api/auth/$")(
  defineServerRoute({
    server: {
      handlers: {
        GET: async ({ request }) => {
          const { auth } = await getAuth();

          return auth.handler(request);
        },
        POST: async ({ request }) => {
          const { auth } = await getAuth();

          return auth.handler(request);
        },
      },
    },
  }),
);
