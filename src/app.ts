import { Hono, type Context } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { createMiddleware } from "hono/factory";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";

//import { createBullBoard } from "@bull-board/api";
//import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
//import { HonoAdapter } from "@bull-board/hono";
//import { serveStatic } from "@hono/node-server/serve-static";

import ApiRoutes from "./api/routes/api-routes";
import {
  runtimeNetworkListeners,
  updateNetworksListeners,
} from "./services/campaign-service";
import {
  initializeListenersFromDatabase,
  stopAllListeners,
} from "./services/listener-service";
//import {
//  leaderboardUpdateQueue,
//  recordYapperClusterQueue,
//  stopJobQueue,
//} from "./services/queue";

const API_KEY = Bun.env.API_KEY;

const app = new Hono();

app.use(logger());
app.use(
  "*",
  createMiddleware(async (c, next) => {
    c.res.headers.set("X-Robots-Tag", "noindex, nofollow");
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
    await next();
  })
);

app.use(
  "*",
  cors({
    origin:
      Bun.env.NODE_ENV === "production"
        ? [Bun.env.CLIENT_URL, Bun.env.YAP_CLIENT_URL]
        : [
            Bun.env.CLIENT_URL,
            "http://localhost:4000",
            "localhost:4000",
            Bun.env.YAP_CLIENT_URL,
          ],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    credentials: true,
  })
);

app.use(
  "*",
  bodyLimit({
    maxSize: 5 * 1024 * 1024, // 5MB
    onError: (c) => c.text("Request body too large", 413),
  })
);

app.use("/api/*", bearerAuth({ token: API_KEY }));

app.get("/health", (c: Context) => {
  return c.text("OK", 200);
});

app.route("/api/v1/onchain-listener", ApiRoutes);
updateNetworksListeners();
initializeListenersFromDatabase();


process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  for (const listener of Object.values(runtimeNetworkListeners)) {
    await listener.stop();
  }

  stopAllListeners();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down gracefully...");
  for (const listener of Object.values(runtimeNetworkListeners)) {
    await listener.stop();
  }
  stopAllListeners();
  process.exit(0);
});

// BullMQ Dashboard setup
//const bullMQBasePath = "/admin/bull-mq/dashboard";

//const serverAdapter = new HonoAdapter(serveStatic);
//createBullBoard({
//  queues: [
//    new BullMQAdapter(recordYapperClusterQueue),
//    new BullMQAdapter(stopJobQueue),
//    new BullMQAdapter(leaderboardUpdateQueue),
//  ],
//  serverAdapter,
//});
//serverAdapter.setBasePath(bullMQBasePath);
//app.route(bullMQBasePath, serverAdapter.registerPlugin());

export default app;
