// Collects a contributor's public GitHub activity and turns it into progress stats.

const GH = "https://api.github.com";
const cache = new Map(); // key -> { at, data }
const TTL_MS = 10 * 60 * 1000;

function headers() {
  const h = {
    Accept: "application/vnd.github+json",
    "User-Agent": "oss-progress-tracker",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function gh(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const res = await fetch(GH + path, { headers: headers() });
  if (res.status === 404) throw new GitHubError("GitHub user not found", 404);
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    const when = reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : "soon";
    throw new GitHubError(
      `GitHub rate limit hit (resets ${when}). Add a GITHUB_TOKEN to server/.env to raise the limit.`,
      429,
    );
  }
  if (!res.ok) throw new GitHubError(`GitHub API error ${res.status}`, res.status);
  const data = await res.json();
  cache.set(path, { at: Date.now(), data });
  return data;
}

const search = (q, extra = "") =>
  gh(`/search/issues?q=${encodeURIComponent(q)}&per_page=100${extra}`);

const repoFromUrl = (url) => url.replace("https://api.github.com/repos/", ""); // owner/name

function daysBetween(a, b) {
  return Math.floor((b - a) / 86400000);
}

export async function getProgress(username, targetOrgs = []) {
  const user = await gh(`/users/${encodeURIComponent(username)}`);
  const login = user.login;

  // Keep search calls to a minimum: unauthenticated search is limited to 10/minute.
  const [prs, issues, reviews, events] = await Promise.all([
    search(`author:${login} type:pr`, "&sort=created&order=desc"),
    search(`author:${login} type:issue`, "&sort=created&order=desc"),
    search(`reviewed-by:${login} type:pr -author:${login}`),
    gh(`/users/${login}/events/public?per_page=100`).catch(() => []),
  ]);

  // ---- Pull requests ----
  const prItems = prs.items.map((p) => {
    const repo = repoFromUrl(p.repository_url);
    const merged = Boolean(p.pull_request?.merged_at);
    return {
      title: p.title,
      url: p.html_url,
      repo,
      org: repo.split("/")[0],
      state: merged ? "merged" : p.state, // merged | open | closed
      draft: Boolean(p.draft),
      createdAt: p.created_at,
      closedAt: p.closed_at,
      mergedAt: p.pull_request?.merged_at || null,
      comments: p.comments,
    };
  });

  const external = prItems.filter((p) => p.org.toLowerCase() !== login.toLowerCase());
  const count = (arr, s) => arr.filter((p) => p.state === s).length;

  // Per-org breakdown (external contributions only - that's what mentors look at)
  const byOrg = {};
  for (const p of external) {
    byOrg[p.org] ??= { org: p.org, merged: 0, open: 0, closed: 0, repos: new Set() };
    byOrg[p.org][p.state]++;
    byOrg[p.org].repos.add(p.repo);
  }
  const orgs = Object.values(byOrg)
    .map((o) => ({ ...o, repos: [...o.repos], total: o.merged + o.open + o.closed }))
    .sort((a, b) => b.merged - a.merged || b.total - a.total);

  // Stale open PRs (waiting > 14 days) need a nudge
  const now = Date.now();
  const staleOpen = external
    .filter((p) => p.state === "open" && daysBetween(new Date(p.createdAt), now) > 14)
    .map((p) => ({ ...p, ageDays: daysBetween(new Date(p.createdAt), now) }));

  // Monthly PR activity for the last 12 months
  const monthly = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key = d.toISOString().slice(0, 7);
    monthly.push({
      month: key,
      label: d.toLocaleString("en", { month: "short" }),
      opened: prItems.filter((p) => p.createdAt.startsWith(key)).length,
      merged: prItems.filter((p) => p.mergedAt?.startsWith(key)).length,
    });
  }

  // ---- Activity / streak from public events (GitHub only returns ~90 days) ----
  const activeDays = new Set((Array.isArray(events) ? events : []).map((e) => e.created_at.slice(0, 10)));
  let streak = 0;
  for (let i = 0; i < 90; i++) {
    const day = new Date(now - i * 86400000).toISOString().slice(0, 10);
    if (activeDays.has(day)) streak++;
    else if (i > 0) break; // allow today to be empty
  }
  const lastActivity = Array.isArray(events) && events[0] ? events[0].created_at : null;

  // ---- Issues ----
  const issueItems = issues.items.map((i) => ({
    title: i.title,
    url: i.html_url,
    repo: repoFromUrl(i.repository_url),
    state: i.state,
    createdAt: i.created_at,
  }));

  // ---- Good first issues in the orgs that matter to this person ----
  const focusOrgs = (targetOrgs.length ? targetOrgs : orgs.slice(0, 3).map((o) => o.org)).slice(0, 5);
  let goodFirstIssues = [];
  if (focusOrgs.length) {
    const q =
      focusOrgs.map((o) => `org:${o}`).join(" ") +
      ' label:"good first issue" state:open type:issue no:assignee';
    try {
      const gfi = await gh(
        `/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=10`,
      );
      goodFirstIssues = gfi.items.map((i) => ({
        title: i.title,
        url: i.html_url,
        repo: repoFromUrl(i.repository_url),
        comments: i.comments,
        createdAt: i.created_at,
      }));
    } catch {
      // An org name that doesn't exist makes the search fail - not fatal.
    }
  }

  // Target-org progress: query each org directly so older PRs are counted too.
  const targetProgress = await Promise.all(
    targetOrgs.map(async (t) => {
      try {
        const r = await search(`author:${login} type:pr org:${t}`);
        const merged = r.items.filter((p) => p.pull_request?.merged_at).length;
        const open = r.items.filter((p) => p.state === "open").length;
        return {
          org: t,
          merged,
          open,
          closed: r.items.length - merged - open,
          total: r.total_count,
          repos: [...new Set(r.items.map((p) => repoFromUrl(p.repository_url)))],
        };
      } catch {
        const o = orgs.find((x) => x.org.toLowerCase() === t.toLowerCase());
        // Search failed (usually the rate limit) - fall back to the recent-PR sample.
        return { ...(o || { org: t, merged: 0, open: 0, closed: 0, total: 0, repos: [] }), approx: true };
      }
    }),
  );

  return {
    fetchedAt: new Date().toISOString(),
    profile: {
      login,
      name: user.name,
      avatar: user.avatar_url,
      bio: user.bio,
      url: user.html_url,
      followers: user.followers,
      publicRepos: user.public_repos,
      createdAt: user.created_at,
    },
    stats: {
      totalPRs: prs.total_count,
      sampledPRs: prItems.length,
      mergedPRs: count(prItems, "merged"),
      openPRs: count(prItems, "open"),
      closedUnmerged: count(prItems, "closed"),
      externalPRs: external.length,
      externalMerged: count(external, "merged"),
      mergeRate: (() => {
        const decided = external.filter((p) => p.state !== "open").length;
        return decided ? Math.round((count(external, "merged") / decided) * 100) : 0;
      })(),
      issuesOpened: issues.total_count,
      reviewsGiven: reviews.total_count,
      orgsContributed: orgs.length,
      activeDaysLast90: activeDays.size,
      currentStreak: streak,
      lastActivity,
    },
    orgs,
    targetOrgs: targetOrgs,
    targetProgress,
    monthly,
    recentPRs: prItems.slice(0, 15),
    staleOpen,
    recentIssues: issueItems.slice(0, 10),
    goodFirstIssues,
    focusOrgs,
  };
}
