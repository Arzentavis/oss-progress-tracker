import "dotenv/config";
import express from "express";
import cors from "cors";
import { getProgress, GitHubError } from "./github.js";
import { currentPhase, PROGRAMS } from "./programs.js";
import { suggest, activeProvider, ruleBasedPlan } from "./suggest.js";

const app = express();
app.use(cors());
app.use(express.json());

const USERNAME_RE = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const ORG_RE = /^[a-z\d][a-z\d-]{0,38}$/i;

function parseOrgs(raw) {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => ORG_RE.test(s))
    .slice(0, 5);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, aiProvider: activeProvider(), githubToken: Boolean(process.env.GITHUB_TOKEN) });
});

app.get("/api/programs", (_req, res) => {
  res.json(Object.fromEntries(Object.entries(PROGRAMS).map(([k, v]) => [k, v.name])));
});

// One call: GitHub progress + program phase + suggestions
app.get("/api/report/:username", async (req, res) => {
  const { username } = req.params;
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: "Invalid GitHub username" });
  const program = PROGRAMS[req.query.program] ? req.query.program : "gsoc";
  const targetOrgs = parseOrgs(req.query.orgs);
  const withAI = req.query.ai !== "0";

  try {
    const progress = await getProgress(username, targetOrgs);
    const timeline = currentPhase(program);
    const suggestions = withAI
      ? await suggest(progress, timeline)
      : { provider: "rules", plan: ruleBasedPlan(progress, timeline) };
    res.json({ program, timeline, progress, suggestions });
  } catch (err) {
    if (err instanceof GitHubError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Something went wrong while building the report" });
  }
});

export default app;

// Locally we start a server; on Vercel the app is used as a serverless function instead.
if (!process.env.VERCEL) {
  const port = process.env.PORT || 5050;
  app.listen(port, () => {
    console.log(`API on http://localhost:${port}  (AI provider: ${activeProvider()}, GitHub token: ${process.env.GITHUB_TOKEN ? "yes" : "no"})`);
  });
}
