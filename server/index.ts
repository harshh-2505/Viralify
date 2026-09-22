import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be an integer between 1 and 65535.");
const server = createApp().listen(port, host, () =>
  console.log(`Viralify is ready at http://${host}:${port}`),
);
server.requestTimeout = 240_000;
server.headersTimeout = 30_000;
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
