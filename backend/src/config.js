import { z } from "zod";

/** Optional env var where a blank `KEY=` line counts as unset. */
const optional = (schema) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const env = z
  .object({
    PORT: z.coerce.number().default(4000),
    NODE_ENV: z.string().default("development"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    // Goes through the Vite proxy in dev so the session cookie stays on the frontend's origin.
    GOOGLE_REDIRECT_URI: z.url().default("http://localhost:5173/api/auth/google/callback"),
    FRONTEND_URL: z.url().default("http://localhost:5173"),
    // ── AI providers (OpenAI-compatible). See .env.example for the full list. ──
    GROQ_API_KEY: optional(z.string()),
    // gpt-oss models: low | medium | high. Lower uses fewer tokens of the free-tier budget.
    GROQ_REASONING_EFFORT: optional(z.enum(["low", "medium", "high"])),
    // Per-model limits from Groq console > Settings > Limits; the client waits instead of hitting them.
    LLM_GROQ_TPM: z.coerce.number().int().positive().default(8000),
    LLM_GROQ_RPM: z.coerce.number().int().positive().default(30),
    CLOUDFLARE_ACCOUNT_ID: optional(z.string()),
    CLOUDFLARE_API_TOKEN: optional(z.string()),
    LLM_CLOUDFLARE_TPM: optional(z.coerce.number().int().positive()),
    LLM_CLOUDFLARE_RPM: optional(z.coerce.number().int().positive()),
    // Per-task routing, "provider:model" comma-separated, first is primary. Model ids live only here.
    LLM_TRIAGE_MODELS: optional(z.string()),
    LLM_EXTRACT_MODELS: optional(z.string()),
    LLM_PLAN_MODELS: optional(z.string()),
    LLM_WORKOUT_MODELS: optional(z.string()),
    // Timezone for "today" and the morning job.
    APP_TIMEZONE: z.string().min(1).default("America/Denver"),
    // Local time (24h HH:MM) the daily plan is generated each morning.
    PLAN_JOB_TIME: z.string().regex(/^\d{2}:\d{2}$/).default("05:30"),
    // Optional: when both are set, data lives in Supabase instead of backend/data/db.json.
    SUPABASE_URL: optional(z.url()),
    SUPABASE_SERVICE_ROLE_KEY: optional(z.string()),
    // Optional: comma-separated Google emails allowed to sign in. Blank lets any Google account in.
    ALLOWED_EMAILS: optional(z.string()),
  })
  .refine((e) => !e.SUPABASE_URL === !e.SUPABASE_SERVICE_ROLE_KEY, {
    message: "Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or neither",
  })
  // Hosts like Render wipe the disk on every restart, so the JSON file store would lose data.
  .refine((e) => e.NODE_ENV !== "production" || e.SUPABASE_URL, {
    message: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production",
  })
  // Without an allowlist any Google account could sign in and use the AI and Canvas features.
  .refine((e) => e.NODE_ENV !== "production" || e.ALLOWED_EMAILS, {
    message: "ALLOWED_EMAILS is required in production (comma-separated Google emails)",
  })
  .safeParse(process.env);

if (!env.success) {
  console.error("Invalid environment configuration. Copy .env.example to .env and fill it in.");
  console.error(z.prettifyError(env.error));
  process.exit(1);
}

/** "groq:openai/gpt-oss-120b,cloudflare:@cf/openai/gpt-oss-120b" -> [{ provider, model }] */
function parseRoute(value) {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf(":");
      return { provider: part.slice(0, i).trim().toLowerCase(), model: part.slice(i + 1).trim() };
    })
    .filter((r) => r.provider && r.model);
}

/**
 * OpenAI-compatible providers. groq and cloudflare are built in; any other provider can be
 * added without code changes with LLM_PROVIDER_<NAME>_BASE_URL and LLM_PROVIDER_<NAME>_API_KEY
 * (optional _TPM, _RPM, _JSON_MODE=schema|object). A provider without a key is skipped.
 */
function buildProviders(e) {
  const providers = {
    groq: {
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: e.GROQ_API_KEY,
      tpm: e.LLM_GROQ_TPM,
      rpm: e.LLM_GROQ_RPM,
      jsonMode: "schema",
      reasoningEffort: e.GROQ_REASONING_EFFORT ?? "low",
      hideReasoning: true,
    },
    cloudflare: {
      baseUrl: e.CLOUDFLARE_ACCOUNT_ID
        ? `https://api.cloudflare.com/client/v4/accounts/${e.CLOUDFLARE_ACCOUNT_ID}/ai/v1`
        : null,
      apiKey: e.CLOUDFLARE_ACCOUNT_ID ? e.CLOUDFLARE_API_TOKEN : undefined,
      tpm: e.LLM_CLOUDFLARE_TPM,
      rpm: e.LLM_CLOUDFLARE_RPM,
      jsonMode: "schema",
    },
  };
  for (const [key, value] of Object.entries(process.env)) {
    const m = key.match(/^LLM_PROVIDER_([A-Z0-9_]+)_BASE_URL$/);
    if (!m || !value) continue;
    const name = m[1].toLowerCase();
    const get = (suffix) => process.env[`LLM_PROVIDER_${m[1]}_${suffix}`] || undefined;
    providers[name] = {
      baseUrl: value.replace(/\/+$/, ""),
      apiKey: get("API_KEY"),
      tpm: Number(get("TPM")) || undefined,
      rpm: Number(get("RPM")) || undefined,
      jsonMode: get("JSON_MODE") === "object" ? "object" : "schema",
    };
  }
  return providers;
}

const llmProviders = buildProviders(env.data);
const llmRoutes = {
  triage: parseRoute(env.data.LLM_TRIAGE_MODELS),
  extract: parseRoute(env.data.LLM_EXTRACT_MODELS),
  plan: parseRoute(env.data.LLM_PLAN_MODELS),
  workout: parseRoute(env.data.LLM_WORKOUT_MODELS),
};

export const config = {
  port: env.data.PORT,
  isProduction: env.data.NODE_ENV === "production",
  sessionSecret: env.data.SESSION_SECRET,
  google: {
    clientId: env.data.GOOGLE_CLIENT_ID,
    clientSecret: env.data.GOOGLE_CLIENT_SECRET,
    redirectUri: env.data.GOOGLE_REDIRECT_URI,
  },
  frontendUrl: env.data.FRONTEND_URL,
  allowedEmails: env.data.ALLOWED_EMAILS
    ? env.data.ALLOWED_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
    : null,
  llm: { providers: llmProviders, routes: llmRoutes },
  // AI is on when the daily plan has at least one route whose provider has a key.
  aiEnabled: llmRoutes.plan.some(({ provider }) => llmProviders[provider]?.apiKey && llmProviders[provider]?.baseUrl),
  timeZone: env.data.APP_TIMEZONE,
  planJobTime: env.data.PLAN_JOB_TIME,
  supabase: env.data.SUPABASE_URL
    ? { url: env.data.SUPABASE_URL, serviceRoleKey: env.data.SUPABASE_SERVICE_ROLE_KEY }
    : null,
};

/** True when this email may use the app (always true when no allowlist is set). */
export function isAllowedEmail(email) {
  return !config.allowedEmails || config.allowedEmails.includes(String(email ?? "").toLowerCase());
}
