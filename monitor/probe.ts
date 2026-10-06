export async function probe(
  url: string,
  request: typeof fetch,
): Promise<{ ready: boolean; status: number | null }> {
  let response: Response | undefined;
  try {
    response = await request(url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status !== 200)
      return { ready: false, status: response.status };
    // Read only a bounded status response; never retain its body in monitor state.
    const reader = response.body?.getReader();
    if (!reader) return { ready: false, status: response.status };
    const decoder = new TextDecoder();
    let text = "",
      bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1024) return { ready: false, status: response.status };
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      const body = JSON.parse(text);
      return {
        ready: body?.status === "ready" && body?.service === "xasha",
        status: response.status,
      };
    } finally {
      await reader.cancel().catch(() => {});
    }
  } catch {
    return { ready: false, status: response?.status ?? null };
  } finally {
    if (response?.body && !response.body.locked)
      await response.body.cancel().catch(() => {});
  }
}
