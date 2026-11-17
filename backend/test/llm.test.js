// Tests for the LLM provider module, using local fake OpenAI-compatible servers and made-up
// data only. Nothing here talks to a real provider. Run: npm test
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { z } from "zod";
import { createLlm } from "../src/ai/llmCore.js";

// Clearly fake sample input; no real email or Canvas content.
const FAKE_USER_PROMPT = `<emails>[{"id":"fake-1","from":"Test Sender <sender@example.com>","subject":"SAMPLE-SUBJECT-123","snippet":"Sample text for testing only."}]</emails>`;
const PlanSchema = z.object({ tasks: z.array(z.object({ title: z.string(), size: z.enum(["quick", "medium", "long"]) })) });
const GOOD_ANSWER = { tasks: [{ title: "Sample task", size: "quick" }] };

/** A fake OpenAI-compatible server. `reply(req, body)` returns { status, json, headers }. */
function fakeProvider(reply, models = []) {
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    server.hits.push({ url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: models.map((m) => (typeof m === "string" ? { id: m } : m)) }));
    }
    const out = reply(req, raw ? JSON.parse(raw) : null);
    res.writeHead(out.status, { "content-type": "application/json", ...(out.headers ?? {}) });
    res.end(JSON.stringify(out.json ?? {}));
  });
  server.hits = [];
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      server.url = `http://127.0.0.1:${server.address().port}/v1`;
      resolve(server);
    }),
  );
}

const ok = (content, usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }) => ({
  status: 200,
  json: { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }], usage },
});

function setup({ groqReply, cloudflareReply, logs, groqModels = ["model-a"], cfModels = ["model-b"], ...rest }) {
  return Promise.all([fakeProvider(groqReply, groqModels), fakeProvider(cloudflareReply, cfModels)]).then(([groq, cf]) => {
    const llm = createLlm({
      providers: {
        groq: { baseUrl: groq.url, apiKey: "fake-groq-key", tpm: 8000, rpm: 30, jsonMode: "schema" },
        cloudflare: { baseUrl: cf.url, apiKey: "fake-cf-key", jsonMode: "schema" },
      },
      routes: { plan: [{ provider: "groq", model: "model-a" }, { provider: "cloudflare", model: "model-b" }] },
      log: (level, message) => logs.push(`${level} ${message}`),
      backoffMs: 1,
      ...rest,
    });
    return { llm, groq, cf, close: () => Promise.all([groq, cf].map((s) => new Promise((r) => s.close(r)))) };
  });
}

const request = { task: "plan", name: "test_plan", system: "You plan.", user: FAKE_USER_PROMPT, schema: PlanSchema, maxTokens: 500 };

describe("fallback", () => {
  test("a forced 429 from Groq still produces a plan through Cloudflare", async () => {
    const logs = [];
    const env = await setup({
      logs,
      groqReply: () => ({ status: 429, json: { error: { message: "rate limited" } }, headers: { "retry-after": "30" } }),
      cloudflareReply: () => ok(GOOD_ANSWER),
    });
    try {
      const { data, meta } = await env.llm.generateJson(request);
      assert.deepEqual(data, GOOD_ANSWER);
      assert.equal(meta.provider, "cloudflare");
      assert.equal(meta.fallback, true);
      assert.equal(env.groq.hits.filter((h) => h.url.endsWith("/chat/completions")).length, 1);
      assert.equal(env.cf.hits.length, 1);
      assert.equal(env.cf.hits[0].auth, "Bearer fake-cf-key");
      assert.equal(env.llm.status().today.rateLimited, 1);
      assert.equal(env.llm.status().today.fallbacks, 1);
      assert.ok(logs.some((l) => l.includes("429") && l.includes("falling back to cloudflare:model-b")));
    } finally {
      await env.close();
    }
  });

  test("a 5xx from Groq falls back too", async () => {
    const logs = [];
    const env = await setup({ logs, groqReply: () => ({ status: 503 }), cloudflareReply: () => ok(GOOD_ANSWER) });
    try {
      const { meta } = await env.llm.generateJson(request);
      assert.equal(meta.provider, "cloudflare");
    } finally {
      await env.close();
    }
  });

  test("when every provider fails, the error says so instead of returning anything", async () => {
    const logs = [];
    const env = await setup({ logs, groqReply: () => ({ status: 429 }), cloudflareReply: () => ({ status: 500 }) });
    try {
      await assert.rejects(env.llm.generateJson(request), (err) => err.code === "ai_unavailable");
      assert.equal(env.llm.status().today.failures, 1);
    } finally {
      await env.close();
    }
  });

  test("an unconfigured fallback is skipped cleanly", async () => {
    const logs = [];
    const groq = await fakeProvider(() => ok(GOOD_ANSWER), ["model-a"]);
    try {
      const llm = createLlm({
        providers: {
          groq: { baseUrl: groq.url, apiKey: "fake", jsonMode: "schema" },
          cloudflare: { baseUrl: null, apiKey: undefined },
        },
        routes: { plan: [{ provider: "groq", model: "model-a" }, { provider: "cloudflare", model: "model-b" }] },
        log: (l, m) => logs.push(m),
      });
      const { meta } = await llm.generateJson(request);
      assert.equal(meta.provider, "groq");
      assert.equal(llm.status().tasks.plan[1].configured, false);
    } finally {
      await new Promise((r) => groq.close(r));
    }
  });
});

describe("validation", () => {
  test("output that fails the schema gets one corrective retry", async () => {
    const logs = [];
    let calls = 0;
    const env = await setup({
      logs,
      groqReply: () => (++calls === 1 ? ok({ tasks: [{ title: "x", size: "huge" }] }) : ok(GOOD_ANSWER)),
      cloudflareReply: () => ok(GOOD_ANSWER),
    });
    try {
      const { data, meta } = await env.llm.generateJson(request);
      assert.deepEqual(data, GOOD_ANSWER);
      assert.equal(meta.provider, "groq");
      const second = env.groq.hits.filter((h) => h.url.endsWith("/chat/completions"))[1].body;
      assert.match(second.messages.at(-1).content, /rejected/);
    } finally {
      await env.close();
    }
  });

  test("every request sets max_tokens and a strict JSON schema", async () => {
    const logs = [];
    const env = await setup({ logs, groqReply: () => ok(GOOD_ANSWER), cloudflareReply: () => ok(GOOD_ANSWER) });
    try {
      await env.llm.generateJson(request);
      const body = env.groq.hits.find((h) => h.url.endsWith("/chat/completions")).body;
      assert.equal(body.max_tokens, 500);
      assert.equal(body.response_format.type, "json_schema");
      assert.equal(body.response_format.json_schema.strict, true);
      assert.equal(body.model, "model-a");
    } finally {
      await env.close();
    }
  });
});

describe("cache", () => {
  test("identical input is answered from the cache without another request", async () => {
    const logs = [];
    const env = await setup({ logs, groqReply: () => ok(GOOD_ANSWER), cloudflareReply: () => ok(GOOD_ANSWER) });
    try {
      await env.llm.generateJson(request);
      const second = await env.llm.generateJson(request);
      assert.equal(second.meta.cached, true);
      assert.equal(env.groq.hits.filter((h) => h.url.endsWith("/chat/completions")).length, 1);
    } finally {
      await env.close();
    }
  });
});

describe("rate-limit budget", () => {
  test("waits for the minute window instead of exceeding the tokens-per-minute cap", async () => {
    const logs = [];
    let clock = 1_000_000;
    const sleeps = [];
    const env = await setup({
      logs,
      groqReply: () => ok(GOOD_ANSWER, { prompt_tokens: 3000, completion_tokens: 200, total_tokens: 3200 }),
      cloudflareReply: () => ok(GOOD_ANSWER),
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    try {
      // 3000 prompt + 4000 reserved output = 7000 of 8000: the second call must wait.
      const big = { ...request, maxTokens: 4000 };
      await env.llm.generateJson(big);
      await env.llm.generateJson({ ...big, user: `${FAKE_USER_PROMPT} second` });
      assert.ok(sleeps.some((ms) => ms >= 59_000), `expected a ~60s wait, got ${sleeps}`);
      assert.equal(env.cf.hits.length, 0, "should wait, not fall back");
      assert.ok(logs.some((l) => l.includes("waiting")));
    } finally {
      await env.close();
    }
  });
});

describe("model checks", () => {
  test("a missing or preview model is marked unavailable and its task falls back", async () => {
    const logs = [];
    const env = await setup({
      logs,
      groqModels: ["something-else", "model-a-preview"],
      groqReply: () => ok(GOOD_ANSWER),
      cloudflareReply: () => ok(GOOD_ANSWER),
    });
    try {
      const status = await env.llm.checkModels();
      assert.equal(status.tasks.plan[0].available, false);
      assert.match(status.tasks.plan[0].note, /not in groq's model list/);
      assert.equal(status.tasks.plan[1].available, true);
      const { meta } = await env.llm.generateJson(request);
      assert.equal(meta.provider, "cloudflare");
      assert.equal(env.groq.hits.filter((h) => h.url.endsWith("/chat/completions")).length, 0);
    } finally {
      await env.close();
    }
  });

  test("an inactive model is unavailable", async () => {
    const logs = [];
    const env = await setup({
      logs,
      groqModels: [{ id: "model-a", active: false }],
      groqReply: () => ok(GOOD_ANSWER),
      cloudflareReply: () => ok(GOOD_ANSWER),
    });
    try {
      const status = await env.llm.checkModels();
      assert.equal(status.tasks.plan[0].available, false);
    } finally {
      await env.close();
    }
  });
});

describe("privacy", () => {
  test("logs contain counts, never prompt or response text", async () => {
    const logs = [];
    const env = await setup({
      logs,
      groqReply: () => ({ status: 429 }),
      cloudflareReply: () => ok(GOOD_ANSWER),
    });
    try {
      await env.llm.generateJson(request);
      const all = logs.join("\n");
      assert.ok(!all.includes("SAMPLE-SUBJECT-123"), "prompt text leaked into logs");
      assert.ok(!all.includes("Sample task"), "response text leaked into logs");
      assert.ok(!all.includes("fake-groq-key") && !all.includes("fake-cf-key"), "API key leaked into logs");
    } finally {
      await env.close();
    }
  });
});
