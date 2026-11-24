// "What should I do next?" - AI suggestions with a rule-based fallback.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const Step = z.object({
  title: z.string(),
  why: z.string(),
  how: z.string(),
  priority: z.enum(["high", "medium", "low"]),
});
const Plan = z.object({
  summary: z.string(),
  readiness_score: z.number(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  next_steps: z.array(Step),
  this_week: z.array(z.string()),
});

export function activeProvider() {
  const forced = (process.env.AI_PROVIDER || "").toLowerCase();
  if (forced) return forced;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "rules";
}

// ---------------- Rule-based engine (always available) ----------------
export function ruleBasedPlan(progress, timeline) {
  const s = progress.stats;
  const steps = [];
  const strengths = [];
  const gaps = [];
  const add = (priority, title, why, how) => steps.push({ priority, title, why, how });

  if (s.externalMerged >= 5) strengths.push(`${s.externalMerged} merged PRs in other people's projects`);
  if (s.reviewsGiven >= 3) strengths.push(`You review others' PRs (${s.reviewsGiven})`);
  if (s.currentStreak >= 3) strengths.push(`${s.currentStreak}-day activity streak`);
  if (s.issuesOpened >= 3) strengths.push(`You report issues (${s.issuesOpened})`);
  if (s.orgsContributed >= 1 && s.orgsContributed <= 3) strengths.push("Focused on a small number of orgs");

  if (s.externalPRs === 0) {
    gaps.push("No pull requests to external projects yet");
    add("high", "Land your first external PR",
      "Mentors pick contributors who have already shown they can work in the codebase.",
      "Pick an org, set up the project locally, and fix a 'good first issue' or a docs bug. Comment on the issue before starting.");
  } else if (s.externalMerged < 3) {
    gaps.push("Fewer than 3 merged external PRs");
    add("high", "Get to 3+ merged PRs in your target org",
      "A few merged PRs is the usual bar that makes a proposal credible.",
      "Choose small, well-scoped issues; follow the CONTRIBUTING guide exactly; respond to review fast.");
  }

  if (progress.staleOpen.length) {
    add("high", `Follow up on ${progress.staleOpen.length} PR(s) waiting 2+ weeks`,
      "Stale PRs rarely merge on their own; polite follow-ups do.",
      "Rebase on main, make CI green, then leave a short comment asking for review or ping in the project chat.");
  }

  if (s.orgsContributed > 4) {
    gaps.push("Contributions spread across many orgs");
    add("medium", "Narrow down to 1-2 target organisations",
      "Depth in one community beats shallow contributions everywhere.",
      "Pick the org where you have the most merged PRs and whose project ideas interest you.");
  }

  if (!progress.targetOrgs.length) {
    add("medium", "Tell the tracker your target org(s)",
      "Suggestions get much sharper when they know where you want to be selected.",
      "Enter org names (e.g. 'kubernetes', 'cncf') in the Target orgs field.");
  } else {
    for (const t of progress.targetProgress) {
      if (t.total === 0)
        add("high", `Start contributing to ${t.org}`,
          `You have no PRs in ${t.org} yet, and it's your target.`,
          `Join their Slack/Discord/mailing list, introduce yourself, and pick from the good-first-issues listed below.`);
    }
  }

  if (s.reviewsGiven < 3) {
    gaps.push("Few code reviews given");
    add("medium", "Review other contributors' PRs",
      "Reviewing shows maturity and makes maintainers notice you.",
      "Test a pending PR locally and leave a constructive review with what you verified.");
  }

  if (s.activeDaysLast90 < 20) {
    gaps.push("Low recent activity (last 90 days)");
    add("medium", "Build a consistent weekly rhythm",
      "Consistency over months is what mentors look for in your history.",
      "Block 3 fixed sessions a week; aim for one PR or review per week.");
  }

  if (s.issuesOpened < 2)
    add("low", "Open well-written issues",
      "Finding and documenting bugs shows you understand the project.",
      "When you hit a bug or doc gap, file a clear issue with reproduction steps - then offer to fix it.");

  add("medium", `Phase: ${timeline.phase.name}`, "Where the program calendar is right now.", timeline.phase.goal);

  const score = Math.max(0, Math.min(100,
    Math.min(s.externalMerged, 8) * 7 +
    Math.min(s.reviewsGiven, 5) * 3 +
    Math.min(s.activeDaysLast90, 40) * 0.5 +
    (progress.staleOpen.length ? -5 : 0) +
    (s.orgsContributed >= 1 && s.orgsContributed <= 3 ? 10 : 0)));

  const order = { high: 0, medium: 1, low: 2 };
  steps.sort((a, b) => order[a.priority] - order[b.priority]);

  return {
    summary: `${progress.profile.name || progress.profile.login} has ${s.externalMerged} merged external PRs across ${s.orgsContributed} org(s). Current ${timeline.program} phase: ${timeline.phase.name}.`,
    readiness_score: Math.round(score),
    strengths: strengths.length ? strengths : ["You've started - that's the hardest part"],
    gaps,
    next_steps: steps.slice(0, 7),
    this_week: steps.slice(0, 3).map((x) => x.title),
  };
}

// ---------------- AI engine ----------------
function buildPrompt(progress, timeline, rules) {
  const slim = {
    profile: progress.profile,
    stats: progress.stats,
    orgs: progress.orgs.slice(0, 8),
    targetOrgs: progress.targetOrgs,
    targetProgress: progress.targetProgress,
    staleOpenPRs: progress.staleOpen.map((p) => ({ title: p.title, repo: p.repo, ageDays: p.ageDays })),
    recentPRs: progress.recentPRs.slice(0, 10).map((p) => ({ title: p.title, repo: p.repo, state: p.state, createdAt: p.createdAt })),
    goodFirstIssues: progress.goodFirstIssues.slice(0, 6).map((i) => ({ title: i.title, repo: i.repo, url: i.url })),
    monthly: progress.monthly,
  };
  return `You are an experienced open-source mentor helping a contributor get selected for ${timeline.program}.
Today is ${new Date().toISOString().slice(0, 10)}. The program's typical current phase is "${timeline.phase.name}": ${timeline.phase.goal}
${timeline.next ? `Next phase: "${timeline.next.name}": ${timeline.next.goal}` : ""}

Here is their real GitHub data (JSON):
${JSON.stringify(slim, null, 2)}

A simple rule engine produced this baseline (improve on it, don't just repeat it):
${JSON.stringify(rules.next_steps.map((s) => s.title))}

Give a concrete, personal plan. Reference their actual repos, orgs, PRs and the listed good-first-issues by name where useful.
- summary: 2-3 sentences on where they stand.
- readiness_score: 0-100, how ready they are to be selected right now.
- strengths / gaps: short bullet strings.
- next_steps: 5-7 actionable steps, ordered by priority, each with why and how.
- this_week: 3 small tasks they can finish in the next 7 days.
Return only the JSON object.`;
}

async function viaAnthropic(prompt) {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(Plan) },
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("Model declined the request");
  if (!response.parsed_output) throw new Error("Model returned no parsable plan");
  return response.parsed_output;
}

async function viaGemini(prompt) {
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  // Try the configured model first, then backups; retry briefly on overload (429/503).
  const models = [...new Set([model, "gemini-flash-latest", "gemini-flash-lite-latest"])];
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: GEMINI_SCHEMA },
  });
  let lastError;
  const errors = [];
  const deadline = Date.now() + 45000; // stay inside serverless time limits
  for (const m of models) {
    if (Date.now() > deadline) break;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
            body,
            signal: AbortSignal.timeout(40000),
          },
        );
      } catch (e) {
        lastError = new Error(`Gemini ${m} timed out or network error (${e.name})`);
        errors.push(`${m}: timeout`);
        break; // try the next model
      }
      if (res.ok) {
        const data = await res.json();
        const raw = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
        raw.next_steps?.forEach((s) => (s.priority = String(s.priority).toLowerCase()));
        return Plan.parse(raw);
      }
      const msg = (await res.text()).match(/"message":\s*"([^"]+)"/)?.[1] ?? res.statusText;
      lastError = new Error(`Gemini ${m} error ${res.status}: ${msg}`);
      errors.push(`${m}: ${res.status}`);
      if (res.status === 400 || res.status === 401 || res.status === 403) throw lastError; // bad key/request
      if (res.status !== 429 && res.status !== 503) break; // e.g. 404 -> next model
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error(`All Gemini models failed (${errors.join(", ")}). ${lastError?.message ?? ""}`);
}

const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    readiness_score: { type: "NUMBER" },
    strengths: { type: "ARRAY", items: { type: "STRING" } },
    gaps: { type: "ARRAY", items: { type: "STRING" } },
    next_steps: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          why: { type: "STRING" },
          how: { type: "STRING" },
          priority: { type: "STRING", enum: ["high", "medium", "low"] },
        },
        required: ["title", "why", "how", "priority"],
      },
    },
    this_week: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["summary", "readiness_score", "strengths", "gaps", "next_steps", "this_week"],
};

async function viaOpenAI(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt + "\nJSON keys: summary, readiness_score, strengths, gaps, next_steps[{title,why,how,priority}], this_week" }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return Plan.parse(JSON.parse(data.choices?.[0]?.message?.content ?? "{}"));
}

export async function suggest(progress, timeline) {
  const rules = ruleBasedPlan(progress, timeline);
  const provider = activeProvider();
  if (provider === "rules") return { provider: "rules", plan: rules };

  const prompt = buildPrompt(progress, timeline, rules);
  try {
    const run = { anthropic: viaAnthropic, gemini: viaGemini, openai: viaOpenAI }[provider];
    if (!run) throw new Error(`Unknown AI_PROVIDER "${provider}"`);
    return { provider, plan: await run(prompt) };
  } catch (err) {
    let reason = err.message;
    if (err instanceof Anthropic.AuthenticationError) reason = "Invalid Anthropic API key";
    else if (err instanceof Anthropic.RateLimitError) reason = "Anthropic rate limit - try again shortly";
    else if (err instanceof Anthropic.APIError) reason = `Anthropic API error ${err.status}: ${err.message}`;
    console.error(`[suggest] ${provider} failed, using rules:`, reason);
    return { provider: "rules", fallbackReason: reason, plan: rules };
  }
}
