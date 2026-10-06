import { Hono } from "hono";
import { browserPolicy } from "./browser-policy";
import { handleError, notFound } from "./http/errors";
import { requestPolicy } from "./middleware/request-policy";
import { requireActiveService } from "./middleware/service-mode";
import secrets from "./routes/secrets";
import status from "./routes/status";
import { scheduled } from "./scheduled";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();
app.use("*", requestPolicy);
app.onError(handleError);

for (const path of ["/secrets", "/secrets/*"]) {
  app.use(path, browserPolicy);
  app.use(path, requireActiveService);
}

app.route("/secrets", secrets);
app.route("/", status);
app.notFound(notFound);

export default { fetch: app.fetch, scheduled };
