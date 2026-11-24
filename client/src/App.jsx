import { useEffect, useState } from "react";

const PROGRAMS = {
  gsoc: "Google Summer of Code",
  lfx: "LFX Mentorship",
  outreachy: "Outreachy",
  general: "General open source",
};

const CHECKLIST = {
  gsoc: [
    "Pick 1-2 target organisations",
    "Join the org's chat / mailing list and introduce yourself",
    "Build the project locally and run the tests",
    "First PR merged in target org",
    "3+ PRs merged in target org",
    "Discuss a project idea with a mentor",
    "Proposal draft shared for feedback",
    "Final proposal submitted",
  ],
  lfx: [
    "Shortlist CNCF / LF projects you like",
    "Join the project's Slack channel",
    "First PR merged in the project",
    "Attend a community meeting",
    "Complete the mentorship pre-task / test",
    "Cover letter + resume ready on LFX profile",
    "Application submitted",
  ],
  outreachy: [
    "Initial application submitted",
    "Choose a project from the list",
    "First contribution recorded",
    "3+ contributions recorded",
    "Final application with timeline submitted",
  ],
  general: [
    "First external PR merged",
    "5 external PRs merged",
    "Reviewed someone else's PR",
    "Opened a well-documented issue",
    "Owned a feature end-to-end",
    "Became a regular in one community",
  ],
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "-");

export default function App() {
  const saved = JSON.parse(localStorage.getItem("oss-tracker-form") || "{}");
  const [form, setForm] = useState({ username: saved.username || "", program: saved.program || "gsoc", orgs: saved.orgs || "" });
  const [data, setData] = useState(null);
  const [ai, setAi] = useState(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false }));
    if (saved.username) load(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(f = form) {
    const username = f.username.trim().replace(/^@/, "").replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
    if (!username) return;
    localStorage.setItem("oss-tracker-form", JSON.stringify({ ...f, username }));
    setError("");
    setLoading(true);
    setAi(null);
    const qs = `program=${f.program}&orgs=${encodeURIComponent(f.orgs)}`;
    try {
      // 1) fast: GitHub data + rule-based plan
      const res = await fetch(`/api/report/${username}?${qs}&ai=0`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
      setData(json);
      setLoading(false);
      // 2) slower: AI plan
      setAiLoading(true);
      const res2 = await fetch(`/api/report/${username}?${qs}`);
      const json2 = await res2.json();
      if (res2.ok) setAi(json2.suggestions);
    } catch (e) {
      setError(e.message === "Failed to fetch" ? "Can't reach the backend - is the server running on port 5050?" : e.message);
      setData(null);
    } finally {
      setLoading(false);
      setAiLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>OSS Progress Tracker</h1>
          <p className="muted">Track your GSoC / LFX / open-source journey and get your next move.</p>
        </div>
        {health && (
          <div className="pills">
            <span className={`pill ${health.ok ? "ok" : "bad"}`}>{health.ok ? "API online" : "API offline"}</span>
            {health.ok && <span className="pill">AI: {health.aiProvider === "rules" ? "rules (no key yet)" : health.aiProvider}</span>}
            {health.ok && !health.githubToken && <span className="pill warn" title="Add GITHUB_TOKEN in server/.env">no GitHub token</span>}
          </div>
        )}
      </header>

      <form className="card search" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <label>
          GitHub username
          <input value={form.username} placeholder="e.g. torvalds" onChange={(e) => setForm({ ...form, username: e.target.value })} required />
        </label>
        <label>
          Program
          <select value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })}>
            {Object.entries(PROGRAMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="grow">
          Target orgs <span className="muted">(optional, comma separated)</span>
          <input value={form.orgs} placeholder="e.g. kubernetes, cncf, numpy" onChange={(e) => setForm({ ...form, orgs: e.target.value })} />
        </label>
        <button disabled={loading}>{loading ? "Loading..." : "Check progress"}</button>
      </form>

      {error && <div className="card error">{error}</div>}
      {loading && !data && <div className="card muted">Fetching your GitHub activity...</div>}

      {data && <Dashboard data={data} ai={ai} aiLoading={aiLoading} program={form.program} />}
    </div>
  );
}

function Dashboard({ data, ai, aiLoading, program }) {
  const { progress: p, timeline } = data;
  const s = p.stats;
  const plan = ai || data.suggestions; // rule-based plan shows instantly, AI plan replaces it

  return (
    <>
      <section className="card profile">
        <img src={p.profile.avatar} alt="" />
        <div>
          <h2><a href={p.profile.url} target="_blank" rel="noreferrer">{p.profile.name || p.profile.login}</a> <span className="muted">@{p.profile.login}</span></h2>
          {p.profile.bio && <p>{p.profile.bio}</p>}
          <p className="muted small">On GitHub since {fmtDate(p.profile.createdAt)} Â· {p.profile.followers} followers Â· last public activity {fmtDate(s.lastActivity)}</p>
        </div>
      </section>

      <section className="tiles">
        <Tile label="Merged PRs (external)" value={s.externalMerged} sub={`${s.mergedPRs} incl. own repos`} />
        <Tile label="Open PRs" value={s.openPRs} sub={p.staleOpen.length ? `${p.staleOpen.length} waiting 14+ days` : "none stale"} warn={p.staleOpen.length > 0} />
        <Tile label="Merge rate" value={`${s.mergeRate}%`} sub="of decided external PRs" />
        <Tile label="Orgs contributed" value={s.orgsContributed} />
        <Tile label="Reviews given" value={s.reviewsGiven} />
        <Tile label="Issues opened" value={s.issuesOpened} />
        <Tile label="Active days (90d)" value={s.activeDaysLast90} sub={`streak: ${s.currentStreak}d`} />
        <Tile label="Total PRs" value={s.totalPRs} sub={s.totalPRs > s.sampledPRs ? `stats from latest ${s.sampledPRs}` : ""} />
      </section>

      <div className="grid">
        <section className="card span2">
          <div className="row">
            <h3>What to do next</h3>
            <span className="pill">{aiLoading ? "AI is thinking..." : ai ? `by ${ai.provider === "rules" ? "rule engine" : ai.provider}` : ""}</span>
          </div>
          {ai?.fallbackReason && <p className="warnText small">AI unavailable ({ai.fallbackReason}) - showing rule-based plan.</p>}
          {plan ? <Plan plan={plan.plan} /> : <p className="muted">Generating your plan...</p>}
        </section>

        <section className="card">
          <h3>{timeline.program}</h3>
          <p className="muted small">Typical yearly cycle - confirm dates on the <a href={timeline.site} target="_blank" rel="noreferrer">official site</a>.</p>
          <div className="phase now">
            <b>Now: {timeline.phase.name}</b>
            <p>{timeline.phase.goal}</p>
          </div>
          {timeline.next && (
            <div className="phase">
              <b>Next: {timeline.next.name}</b>
              <p>{timeline.next.goal}</p>
            </div>
          )}
          <Checklist program={program} login={p.profile.login} />
        </section>

        <section className="card span2">
          <h3>PR activity - last 12 months</h3>
          <Bars monthly={p.monthly} />
        </section>

        <section className="card">
          <h3>Organisations</h3>
          {p.targetProgress.length > 0 && (
            <>
              <p className="small muted">Your targets</p>
              <OrgList orgs={p.targetProgress} highlight />
            </>
          )}
          <p className="small muted">Where you contribute</p>
          {p.orgs.length ? <OrgList orgs={p.orgs.slice(0, 8)} /> : <p className="muted">No external PRs yet.</p>}
        </section>

        {p.staleOpen.length > 0 && (
          <section className="card span3">
            <h3>PRs that need a follow-up</h3>
            <ItemList items={p.staleOpen} render={(x) => <><span className="badge open">{x.ageDays}d</span> {x.repo}</>} />
          </section>
        )}

        <section className="card span2">
          <h3>Recent pull requests</h3>
          {p.recentPRs.length ? (
            <ItemList items={p.recentPRs} render={(x) => <><span className={`badge ${x.state}`}>{x.state}</span> {x.repo} Â· {fmtDate(x.createdAt)}</>} />
          ) : <p className="muted">No PRs yet.</p>}
        </section>

        <section className="card">
          <h3>Good first issues {p.focusOrgs.length > 0 && <span className="muted small">in {p.focusOrgs.join(", ")}</span>}</h3>
          {p.goodFirstIssues.length ? (
            <ItemList items={p.goodFirstIssues} render={(x) => <>{x.repo} Â· {x.comments} comments</>} />
          ) : <p className="muted small">None found. Add target orgs above to search them for unassigned good first issues.</p>}
        </section>
      </div>
    </>
  );
}

function Tile({ label, value, sub, warn }) {
  return (
    <div className={`card tile ${warn ? "warn" : ""}`}>
      <div className="muted small">{label}</div>
      <div className="big">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

function Plan({ plan }) {
  const score = Math.max(0, Math.min(100, Math.round(plan.readiness_score)));
  return (
    <div className="plan">
      <div className="scoreRow">
        <div className="score" style={{ "--p": score }}><span>{score}</span></div>
        <div>
          <div className="small muted">Readiness score</div>
          <p>{plan.summary}</p>
        </div>
      </div>
      {plan.this_week?.length > 0 && (
        <div className="week">
          <b>This week</b>
          <ul>{plan.this_week.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}
      <ol className="steps">
        {plan.next_steps.map((st, i) => (
          <li key={i}>
            <div className="row"><b>{st.title}</b><span className={`badge ${st.priority}`}>{st.priority}</span></div>
            <p className="small"><i>Why:</i> {st.why}</p>
            <p className="small"><i>How:</i> {st.how}</p>
          </li>
        ))}
      </ol>
      <div className="two">
        <div><b>Strengths</b><ul>{plan.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><b>Gaps</b><ul>{plan.gaps.length ? plan.gaps.map((x, i) => <li key={i}>{x}</li>) : <li>None obvious - keep going!</li>}</ul></div>
      </div>
    </div>
  );
}

function Bars({ monthly }) {
  const max = Math.max(1, ...monthly.map((m) => m.opened));
  return (
    <div>
      <div className="bars">
        {monthly.map((m) => (
          <div key={m.month} className="barCol" title={`${m.month}: ${m.opened} opened, ${m.merged} merged`}>
            <div className="barStack">
              <div className="bar opened" style={{ height: `${(m.opened / max) * 100}%` }} />
              <div className="bar merged" style={{ height: `${(m.merged / max) * 100}%` }} />
            </div>
            <span className="small muted">{m.label}</span>
          </div>
        ))}
      </div>
      <div className="legend small muted"><span className="dot opened" /> opened <span className="dot merged" /> merged</div>
    </div>
  );
}

function OrgList({ orgs, highlight }) {
  return (
    <ul className="orgs">
      {orgs.map((o) => (
        <li key={o.org} className={highlight ? "target" : ""}>
          <a href={`https://github.com/${o.org}`} target="_blank" rel="noreferrer">{o.org}</a>
          <span className="small">
            <span className="badge merged">{o.merged} merged</span>
            {o.open > 0 && <span className="badge open">{o.open} open</span>}
            {o.approx && <span className="muted" title="GitHub rate limit hit - counted from your latest 100 PRs only. Add GITHUB_TOKEN for exact numbers."> ~est.</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ItemList({ items, render }) {
  return (
    <ul className="items">
      {items.map((x) => (
        <li key={x.url}>
          <a href={x.url} target="_blank" rel="noreferrer">{x.title}</a>
          <div className="small muted">{render(x)}</div>
        </li>
      ))}
    </ul>
  );
}

function Checklist({ program, login }) {
  const key = `oss-tracker-check-${login}-${program}`;
  const [done, setDone] = useState(() => JSON.parse(localStorage.getItem(key) || "[]"));
  useEffect(() => setDone(JSON.parse(localStorage.getItem(key) || "[]")), [key]);
  const toggle = (i) => {
    const next = done.includes(i) ? done.filter((x) => x !== i) : [...done, i];
    setDone(next);
    localStorage.setItem(key, JSON.stringify(next));
  };
  const items = CHECKLIST[program];
  return (
    <div className="checklist">
      <div className="row"><b>Milestones</b><span className="small muted">{done.length}/{items.length}</span></div>
      <div className="progress"><div style={{ width: `${(done.length / items.length) * 100}%` }} /></div>
      {items.map((t, i) => (
        <label key={i} className={done.includes(i) ? "done" : ""}>
          <input type="checkbox" checked={done.includes(i)} onChange={() => toggle(i)} /> {t}
        </label>
      ))}
    </div>
  );
}
