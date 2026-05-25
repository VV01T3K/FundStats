import { DurableStreamTestServer } from "@durable-streams/server";

const server = new DurableStreamTestServer({
  host: "127.0.0.1",
  port: 4437,
});

await server.start();

console.log("Durable Streams server listening on http://127.0.0.1:4437");
