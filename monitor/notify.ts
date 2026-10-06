import type { MonitorBindings } from "./types.ts";

export async function notify(
  env: MonitorBindings,
  kind: "outage" | "recovery",
  at: number,
  request: typeof fetch,
) {
  const url = new URL(env.ALERT_WEBHOOK_URL ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("Invalid alert configuration.");
  const timestamp = new Date(at).toISOString();
  const message =
    kind === "outage"
      ? `Xasha production is unavailable after three consecutive readiness failures. Checked at ${timestamp}.`
      : `Xasha production is ready again. Checked at ${timestamp}.`;
  let payload: object;
  if (env.WEBHOOK_FORMAT === "slack") payload = { text: message };
  else if (env.WEBHOOK_FORMAT === "discord")
    payload = { content: message, allowed_mentions: { parse: [] } };
  else if (env.WEBHOOK_FORMAT === "json")
    payload = { service: "xasha", event: kind, checkedAt: timestamp, message };
  else throw new Error("Invalid alert configuration.");
  const response = await request(url.href, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error("Alert delivery failed.");
}
