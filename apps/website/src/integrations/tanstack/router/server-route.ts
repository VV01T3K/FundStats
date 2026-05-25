export type ServerRouteHandlerContext<TParams = Record<string, string | undefined>> = {
  request: Request;
  params: TParams;
  context: unknown;
  pathname: string;
  next: () => Promise<Response>;
};

export type ServerRouteHandler<TParams = Record<string, string | undefined>> = (
  context: ServerRouteHandlerContext<TParams>,
) => Response | Promise<Response>;

export type ServerRouteOptions<TParams = Record<string, string | undefined>> = {
  server: {
    handlers: Partial<
      Record<
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD",
        ServerRouteHandler<TParams>
      >
    >;
  };
};

export function defineServerRoute<TParams = Record<string, string | undefined>>(
  options: ServerRouteOptions<TParams>,
) {
  return options as never;
}
