# OSS Progress Tracker

Track your progress toward **GSoC, LFX Mentorship, Outreachy** or general open source,
straight from your GitHub account, and get a personal "what should I do next" plan.

- **client/**: React (Vite) dashboard
- **server/**: Node.js + Express API (GitHub data + AI suggestions)

## What it shows

- Merged / open / stale PRs, merge rate, reviews given, issues opened, active days and streak
- PRs per organisation, plus exact progress in your **target orgs**
- 12-month PR activity chart
- Where the selected program usually is in its yearly cycle, and what comes next
- Unassigned **good first issues** in your target orgs
- A milestone checklist (saved in your browser)
- **Next steps**: an instant rule-based plan, replaced by an AI plan when an API key is set

## Run it

```bash
# 1. backend
cd server
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run dev               # http://localhost:5050

# 2. frontend (new terminal)
cd client
npm install
npm run dev               # http://localhost:5173
```

Open http://localhost:5173, enter your GitHub username, choose a program, and optionally add target orgs.

## API keys (`server/.env`)

| Variable | Needed? | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | Recommended | Raises GitHub limits (10 → 30 searches/min). A token with no scopes is enough. |
| `ANTHROPIC_API_KEY` | One AI key, optional | Claude (`claude-opus-5-5` by default) |
| `GEMINI_API_KEY` | | Google Gemini |
| `OPENAI_API_KEY` | | OpenAI |

Set whichever AI key you have and restart the server. The provider is detected automatically
(force one with `AI_PROVIDER=anthropic|gemini|openai|rules`). With no key, the app uses the built-in rule engine.
Keys stay on the server and are never sent to the browser.

## API

`GET /api/report/:username?program=gsoc|lfx|outreachy|general&orgs=org1,org2&ai=0|1`
`GET /api/health`: shows which AI provider is active
