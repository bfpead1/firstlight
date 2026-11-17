// Provider-agnostic LLM client: OpenAI-compatible Chat Completions over fetch, with per-task
// model routing, fallback, a token/request budget per model, a response cache, model checks
// and usage logging. Pure: everything comes in through createLlm(options), so tests can
// drive it with fake servers and a fake clock. src/ai/llm.js builds the app's instance.
//
// Logs never include prompt or response text, only task, provider, model and token counts.
import { createHash } from "node:crypto";
import { toStrictJsonSchema } from "./jsonSchema.js";

export class AiError extends Error {
  /**
   * code: ai_not_configured | ai_bad_key | ai_rate_limited | ai_invalid_output | ai_unavailable
   * retryAfter: seconds, for ai_rate_limited
   */
  constructor(code, message, { retryAfter = null } = {}) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** A failure from one provider, used to decide whether to try the next one. */
class ProviderError extends Error {
  constructor(kind, message, { status = null, retryAfter = null } = {}) {
    super(message);
    this.kind = kind; // rate_limited | server | network | auth | bad_request | invalid_output | too_large
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const WINDOW_MS = 60_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 100;
/** Preview, experimental and deprecated models are not used even if the provider lists them. */
const PREVIEW_PATTERN = /(preview|experimental|[-_]exp\b|[-_]exp[-_]|beta|alpha)/i;

/** Rough token count (about 3.5 characters per token), used only for budgeting before a call. */
export function estimateTokens(text) {
  return Math.ceil(String(text).length / 3.5);
}

/**
 * Per provider+model sliding one-minute budget for tokens and requests. Reserves the
 * prompt estimate plus max_tokens before a call (some providers count requested output
 * against the limit), then settles to the larger of that and the reported usage.
 */
function createBudget({ now, sleep, log }) {
  const windows = new Map(); // key -> [{ at, tokens }]

  function entries(key) {
    const cutoff = now() - WINDOW_MS;
    const list = (windows.get(key) ?? []).filter((e) => e.at > cutoff);
    windows.set(key, list);
    return list;
  }

  return {
    usage(key) {
      const list = entries(key);
      return { tokens: list.reduce((n, e) => n + e.tokens, 0), requests: list.length };
    },
    /** Waits until the call fits under the limits, then reserves it. Returns the reservation. */
    async reserve(key, tokens, { tpm, rpm, maxWaitMs }) {
      const started = now();
      for (;;) {
        const list = entries(key);
        const used = list.reduce((n, e) => n + e.tokens, 0);
        const tokensOk = !tpm || used + tokens <= tpm || list.length === 0;
        const requestsOk = !rpm || list.length < rpm;
        if (tokensOk && requestsOk) {
          const entry = { at: now(), tokens };
          list.push(entry);
          return entry;
        }
        // Wait for the oldest reservation to leave the window.
        const waitMs = Math.max(250, list[0].at + WINDOW_MS - now() + 50);
        if (now() - started + waitMs > maxWaitMs) {
          throw new ProviderError("rate_limited", `local budget for ${key} is full`, {
            retryAfter: Math.ceil(waitMs / 1000),
          });
        }
        log("info", `[ai] waiting ${Math.ceil(waitMs / 1000)}s for ${key} budget (${used}/${tpm ?? "∞"} tokens, ${list.length}/${rpm ?? "∞"} requests this minute)`);
        await sleep(waitMs);
      }
    },
    settle(entry, actualTokens) {
      if (Number.isFinite(actualTokens)) entry.tokens = Math.max(entry.tokens, actualTokens);
    },
  };
}

/**
 * @param options.providers {[name]: { baseUrl, apiKey, tpm?, rpm?, jsonMode?: "schema"|"object",
 *                          reasoningEffort?: "low"|"medium"|"high" }}  providers without apiKey are skipped
 * @param options.routes    {[task]: [{ provider, model }]} first entry is the primary
 * @param options.fetch, now, sleep, log  injectable for tests
 * @param options.maxWaitMs longest the budget will wait before trying the next provider
 * @param options.backoffMs base delay before moving to the next provider after a failure
 */
export function createLlm({
  providers,
  routes,
  fetch: fetchFn = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = (level, message) => console[level === "warn" ? "warn" : "log"](message),
  maxWaitMs = 65_000,
  backoffMs = 500,
  timeoutMs = 90_000,
}) {
  const budget = createBudget({ now, sleep, log });
  const cache = new Map(); // hash -> { at, value }
  // provider:model -> { ok: true } | { ok: false, reason } | { ok: null, reason } (unverified)
  const modelStatus = new Map();
  const stats = { day: null, calls: 0, cached: 0, fallbacks: 0, rateLimited: 0, failures: 0, tokens: {} };

  const keyOf = (p, m) => `${p}:${m}`;
  const configured = (name) => Boolean(providers[name]?.apiKey && providers[name]?.baseUrl);

  function rollStats() {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (stats.day !== day) Object.assign(stats, { day, calls: 0, cached: 0, fallbacks: 0, rateLimited: 0, failures: 0, tokens: {} });
  }

  /** Routes for a task that are usable right now: provider configured and model not known-missing. */
  function usableRoutes(task) {
    return (routes[task] ?? []).filter(({ provider, model }) => {
      if (!configured(provider)) return false;
      return modelStatus.get(keyOf(provider, model))?.ok !== false;
    });
  }

  /**
   * Checks every routed model against each provider's live /models list. Missing, inactive
   * or preview models are marked unusable (their task falls back). A provider whose list
   * can't be read is marked unverified but still used.
   */
  async function checkModels() {
    const byProvider = new Map();
    for (const list of Object.values(routes)) {
      for (const { provider, model } of list) {
        if (!byProvider.has(provider)) byProvider.set(provider, new Set());
        byProvider.get(provider).add(model);
      }
    }
    for (const [name, models] of byProvider) {
      if (!configured(name)) {
        for (const m of models) modelStatus.set(keyOf(name, m), { ok: false, reason: `${name} is not configured` });
        continue;
      }
      let listed;
      try {
        const res = await fetchFn(`${providers[name].baseUrl}/models`, {
          headers: { Authorization: `Bearer ${providers[name].apiKey}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        listed = new Map((body.data ?? []).map((m) => [m.id, m]));
      } catch (err) {
        for (const m of models) {
          modelStatus.set(keyOf(name, m), { ok: null, reason: `couldn't read ${name}'s model list (${err.message})` });
        }
        log("warn", `[ai] model check: couldn't read ${name}'s model list (${err.message}); its models are unverified`);
        continue;
      }
      for (const m of models) {
        const info = listed.get(m);
        let status;
        if (!info) status = { ok: false, reason: `${m} is not in ${name}'s model list` };
        else if (info.active === false) status = { ok: false, reason: `${m} is inactive on ${name}` };
        else if (PREVIEW_PATTERN.test(m)) status = { ok: false, reason: `${m} is a preview model` };
        else status = { ok: true };
        modelStatus.set(keyOf(name, m), status);
        if (!status.ok) log("warn", `[ai] model check: ${status.reason}; tasks using it will fall back`);
      }
    }
    return status();
  }

  /** One HTTP call to one provider. Throws ProviderError. */
  async function callProvider(name, model, body) {
    const p = providers[name];
    let res;
    try {
      res = await fetchFn(`${p.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, model }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ProviderError("network", `couldn't reach ${name}: ${err.message}`);
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new ProviderError("rate_limited", `${name} returned 429`, {
        status: 429,
        retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : null,
      });
    }
    if (res.status === 401 || res.status === 403) throw new ProviderError("auth", `${name} rejected the API key`, { status: res.status });
    if (res.status === 413) throw new ProviderError("too_large", `${name}: request too large`, { status: 413 });
    if (res.status >= 500) throw new ProviderError("server", `${name} returned HTTP ${res.status}`, { status: res.status });
    if (!res.ok) {
      // Error bodies describe the request problem (bad schema, unknown model); they never echo the key.
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new ProviderError("bad_request", `${name} returned HTTP ${res.status}: ${detail}`, { status: res.status });
    }
    return res.json();
  }

  /**
   * One structured-output request for a task, validated with Zod (plus optional business
   * rules). Tries each routed provider in order; an invalid answer gets one corrective retry
   * on the same provider. Returns { data, meta: { provider, model, fallback, cached, usage } }.
   */
  async function generateJson({ task, name, system, user, schema, validate, maxTokens, cache: useCache = true }) {
    rollStats();
    if (!maxTokens) throw new Error(`generateJson(${task}): maxTokens is required`);
    const candidates = usableRoutes(task);
    if (!candidates.length) {
      throw new AiError("ai_not_configured", `No usable model for "${task}". Check the LLM_${task.toUpperCase()}_MODELS setting and provider keys.`);
    }

    const cacheKey = createHash("sha256").update(JSON.stringify([task, name, system, user, maxTokens])).digest("hex");
    const hit = useCache && cache.get(cacheKey);
    if (hit && now() - hit.at < CACHE_TTL_MS) {
      stats.cached++;
      log("info", `[ai] ${task}: cache hit (${hit.value.meta.provider}:${hit.value.meta.model})`);
      return { data: hit.value.data, meta: { ...hit.value.meta, cached: true } };
    }

    const jsonSchema = toStrictJsonSchema(schema);
    const primary = routes[task]?.[0];
    let lastError = null;

    for (let i = 0; i < candidates.length; i++) {
      const { provider, model } = candidates[i];
      const p = providers[provider];
      const key = keyOf(provider, model);
      const messages = [
        { role: "system", content: system },
        { role: "user", content: user },
      ];
      if (i > 0) {
        await sleep(backoffMs * 2 ** (i - 1));
      }

      try {
        for (let attempt = 1; attempt <= 2; attempt++) {
          const promptTokens = estimateTokens(messages.map((m) => m.content).join("\n")) + estimateTokens(JSON.stringify(jsonSchema));
          const reservation = await budget.reserve(key, promptTokens + maxTokens, { tpm: p.tpm, rpm: p.rpm, maxWaitMs });
          const startedAt = now();
          const body = {
            messages,
            max_tokens: maxTokens,
            response_format:
              p.jsonMode === "object"
                ? { type: "json_object" }
                : { type: "json_schema", json_schema: { name, strict: true, schema: jsonSchema } },
            ...(p.reasoningEffort && /gpt-oss/.test(model) ? { reasoning_effort: p.reasoningEffort } : {}),
            ...(p.hideReasoning && /gpt-oss/.test(model) ? { include_reasoning: false } : {}),
          };
          if (p.jsonMode === "object") {
            // Without schema enforcement the model needs to see the shape; validation still applies.
            messages[0] = { role: "system", content: `${system}\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(jsonSchema)}` };
          }

          let response;
          try {
            response = await callProvider(provider, model, body);
          } catch (err) {
            budget.settle(reservation, promptTokens + maxTokens);
            throw err;
          }
          const usage = response.usage ?? {};
          const used = (usage.prompt_tokens ?? promptTokens) + Math.max(usage.completion_tokens ?? 0, maxTokens);
          budget.settle(reservation, used);
          stats.calls++;
          stats.tokens[key] = (stats.tokens[key] ?? 0) + (usage.total_tokens ?? 0);
          const window = budget.usage(key);
          log(
            "info",
            `[ai] ${task} via ${key}: ${usage.prompt_tokens ?? "?"} in + ${usage.completion_tokens ?? "?"} out tokens, ` +
              `${now() - startedAt}ms, minute window ${window.tokens}/${p.tpm ?? "∞"} tokens ${window.requests}/${p.rpm ?? "∞"} requests`,
          );

          const choice = response.choices?.[0];
          const content = choice?.message?.content ?? "";
          let problem;
          if (choice?.finish_reason === "length") {
            problem = "The response was cut off before it finished. Be more concise.";
          } else {
            let parsed;
            try {
              parsed = JSON.parse(content);
            } catch {
              problem = "The response was not valid JSON.";
            }
            if (!problem) {
              const result = schema.safeParse(parsed);
              if (!result.success) {
                problem = `The JSON did not match the schema: ${result.error.issues
                  .slice(0, 5)
                  .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
                  .join("; ")}`;
              } else {
                problem = validate?.(result.data) || null;
                if (!problem) {
                  const meta = {
                    provider,
                    model,
                    fallback: !primary || provider !== primary.provider || model !== primary.model,
                    cached: false,
                    usage: { prompt: usage.prompt_tokens ?? null, completion: usage.completion_tokens ?? null },
                  };
                  if (meta.fallback) stats.fallbacks++;
                  const value = { data: result.data, meta };
                  if (useCache) {
                    cache.set(cacheKey, { at: now(), value });
                    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
                  }
                  return value;
                }
              }
            }
          }

          log("warn", `[ai] ${task} via ${key}: attempt ${attempt} rejected (${problem.slice(0, 160)})`);
          if (attempt === 1) {
            messages.push(
              { role: "assistant", content: content || "(empty)" },
              { role: "user", content: `That response was rejected: ${problem} Return a corrected response that follows every rule.` },
            );
          } else {
            throw new ProviderError("invalid_output", problem);
          }
        }
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
        lastError = err;
        if (err.kind === "rate_limited") stats.rateLimited++;
        const next = candidates[i + 1];
        log(
          "warn",
          `[ai] ${task} via ${key} failed: ${err.kind}${err.status ? ` (HTTP ${err.status})` : ""}${
            next ? `; falling back to ${keyOf(next.provider, next.model)}` : "; no fallback left"
          }`,
        );
      }
    }

    stats.failures++;
    if (lastError?.kind === "rate_limited") {
      throw new AiError("ai_rate_limited", "Every configured AI provider is rate-limited right now", { retryAfter: lastError.retryAfter });
    }
    if (lastError?.kind === "auth") throw new AiError("ai_bad_key", lastError.message);
    if (lastError?.kind === "invalid_output") throw new AiError("ai_invalid_output", lastError.message);
    throw new AiError("ai_unavailable", lastError?.message ?? "AI request failed");
  }

  /** Model checks, routes and today's counters, for logs and the Settings page. */
  function status() {
    rollStats();
    const tasks = {};
    for (const [task, list] of Object.entries(routes)) {
      tasks[task] = list.map(({ provider, model }) => {
        const s = modelStatus.get(keyOf(provider, model));
        return {
          provider,
          model,
          configured: configured(provider),
          available: !configured(provider) ? false : s?.ok ?? null,
          note: !configured(provider) ? `${provider} is not configured` : s?.reason ?? null,
        };
      });
    }
    return { tasks, today: { ...stats, tokens: { ...stats.tokens } } };
  }

  return { generateJson, checkModels, status, usableRoutes };
}
