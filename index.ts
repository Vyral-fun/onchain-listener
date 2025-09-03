import app from "@/app";
import parseEnv from "@/zod/env";

parseEnv();

Bun.serve({
  idleTimeout: 40,
  fetch: app.fetch,
});

console.log(`Server is running on PORT: ${process.env.PORT}`);
