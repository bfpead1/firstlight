// The app's single LLM entry point. Providers, per-task model routing and limits all come
// from env vars (see config.js and .env.example), so providers can be swapped without code
// changes. Keys are read only on the server and never logged or sent to the browser.
import { config } from "../config.js";
import { AiError, createLlm } from "./llmCore.js";

export { AiError };

const llm = createLlm({ providers: config.llm.providers, routes: config.llm.routes });

/** See createLlm().generateJson. `task` is one of: triage, extract, plan, workout. */
export const generateJson = llm.generateJson;

/** Model availability per task plus today's counters (no prompt content). */
export const aiStatus = llm.status;

/** Checks every routed model against the providers' live model lists. Run once at startup. */
export async function checkModels() {
  const result = await llm.checkModels();
  for (const [task, list] of Object.entries(result.tasks)) {
    if (!list.length) continue;
    const usable = list.filter((r) => r.available !== false);
    const summary = list
      .map((r) => `${r.provider}:${r.model} ${r.available === true ? "ok" : r.available === null ? "unverified" : "unavailable"}`)
      .join(", ");
    console.log(`[ai] ${task}: ${summary}${usable.length ? "" : "  <- no usable model"}`);
  }
  return result;
}

/** Express helper: turns AiError into a JSON response the frontend understands. */
export function sendAiError(res, err) {
  if (!(err instanceof AiError)) throw err;
  const status =
    err.code === "ai_not_configured" || err.code === "ai_bad_key" ? 503 : err.code === "ai_rate_limited" ? 429 : 502;
  res.status(status).json({ error: err.code, message: err.message, retryAfter: err.retryAfter });
}
