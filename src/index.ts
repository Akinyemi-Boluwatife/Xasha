import { createOpenAPIApp, openAPIConfiguration } from "./openapi";
import { browserPolicy } from "./browser-policy";
import { handleError, notFound } from "./http/errors";
import { requestPolicy } from "./middleware/request-policy";
import { requireActiveService } from "./middleware/service-mode";
import secrets from "./routes/secrets";
import status from "./routes/status";
import { scheduled } from "./scheduled";
import { documentation } from "./routes/documentation";

const app = createOpenAPIApp();
app.use("*", requestPolicy);
app.onError(handleError);

for (const path of ["/secrets", "/secrets/*"]) {
  app.use(path, browserPolicy);
  app.use(path, requireActiveService);
}

app.route("/secrets", secrets);
app.route("/", status);
// Generate once per isolate, from the schemas registered by the mounted apps.
let document: ReturnType<typeof app.getOpenAPI31Document> | undefined;
app.route("/", documentation(() => document ??= app.getOpenAPI31Document(openAPIConfiguration)));
app.notFound(notFound);

export default { fetch: app.fetch, scheduled };
