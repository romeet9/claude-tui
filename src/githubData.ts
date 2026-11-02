// GitHub data for the GitHub panel, read through the gh CLI (already signed in).
// Everything here is read-only; changes go through Claude in the chat.
import { execFile } from "node:child_process";

function gh(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("gh", args, { cwd, maxBuffer: 8 * 1024 * 1024, timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split("\n")[0]));
      else resolve(stdout);
    });
  });
}
const json = async <T>(args: string[], cwd?: string): Promise<T> => JSON.parse(await gh(args, cwd));

export type Entry = {
  id: string;
  kind: "push" | "pr" | "issue" | "run" | "commit" | "release" | "branch" | "star" | "notification" | "repo" | "other";
  title: string;
  /** Second line: repo, branch, author, state… */
  meta: string;
  at: string;              // ISO time
  url?: string;
  repo?: string;           // owner/name
  number?: number;         // PR / issue number
  runId?: number;
  state?: "open" | "merged" | "closed" | "draft" | "success" | "failure" | "pending" | "unread";
};

/** "repos/o/r/pulls/7" (API URL) → "https://github.com/o/r/pull/7". */
const htmlUrl = (api?: string) =>
  api?.replace("https://api.github.com/repos/", "https://github.com/").replace("/pulls/", "/pull/").replace("/commits/", "/commit/");

let loginCache: string | null = null;
export async function login(): Promise<string> {
  if (!loginCache) loginCache = (await gh(["api", "user", "--jq", ".login"])).trim();
  return loginCache;
}

// ---------- account ----------

export async function activity(): Promise<Entry[]> {
  const me = await login();
  const events = await json<any[]>(["api", `users/${me}/events?per_page=60`]);
  const out: Entry[] = [];
  for (const e of events) {
    const repo = e.repo?.name;
    const p = e.payload ?? {};
    const base = { id: e.id, at: e.created_at, repo, url: `https://github.com/${repo}` };
    switch (e.type) {
      case "PushEvent": {
        const branch = String(p.ref ?? "").replace("refs/heads/", "");
        const n = p.size ?? p.commits?.length ?? 0;
        out.push({ ...base, kind: "push", title: `Pushed ${n || ""} ${n === 1 ? "commit" : "commits"} to ${branch}`.replace("  ", " "),
          meta: `${repo}${p.commits?.[0]?.message ? " · " + String(p.commits[p.commits.length - 1].message).split("\n")[0] : ""}`,
          url: `https://github.com/${repo}/commits/${branch}` });
        break;
      }
      case "PullRequestEvent":
        out.push({ ...base, kind: "pr", title: `${p.action === "closed" && p.pull_request?.merged ? "Merged" : cap(p.action)} PR #${p.number}: ${p.pull_request?.title ?? ""}`,
          meta: repo, url: p.pull_request?.html_url, number: p.number, state: p.pull_request?.merged ? "merged" : p.action === "closed" ? "closed" : "open" });
        break;
      case "PullRequestReviewEvent":
        out.push({ ...base, kind: "pr", title: `Reviewed PR #${p.pull_request?.number}: ${p.pull_request?.title ?? ""}`, meta: `${repo} · ${p.review?.state ?? ""}`.toLowerCase(),
          url: p.pull_request?.html_url, number: p.pull_request?.number });
        break;
      case "IssuesEvent":
        out.push({ ...base, kind: "issue", title: `${cap(p.action)} issue #${p.issue?.number}: ${p.issue?.title ?? ""}`, meta: repo,
          url: p.issue?.html_url, number: p.issue?.number, state: p.action === "closed" ? "closed" : "open" });
        break;
      case "IssueCommentEvent":
        out.push({ ...base, kind: "issue", title: `Commented on #${p.issue?.number}: ${p.issue?.title ?? ""}`, meta: repo, url: p.comment?.html_url, number: p.issue?.number });
        break;
      case "CreateEvent":
      case "DeleteEvent":
        out.push({ ...base, kind: "branch", title: `${e.type === "CreateEvent" ? "Created" : "Deleted"} ${p.ref_type} ${p.ref ?? ""}`.trim(), meta: repo });
        break;
      case "ReleaseEvent":
        out.push({ ...base, kind: "release", title: `Released ${p.release?.tag_name ?? ""}`, meta: repo, url: p.release?.html_url });
        break;
      case "WatchEvent":
        out.push({ ...base, kind: "star", title: `Starred ${repo}`, meta: "" });
        break;
      default:
        out.push({ ...base, kind: "other", title: e.type.replace(/Event$/, "").replace(/([a-z])([A-Z])/g, "$1 $2"), meta: repo });
    }
  }
  return collapse(out);
}

/** Runs of the same "created/deleted tag|branch" in one repo fold into one line. */
function collapse(list: Entry[]): Entry[] {
  const out: Entry[] = [];
  for (const e of list.sort((a, b) => b.at.localeCompare(a.at))) {
    const prev = out[out.length - 1];
    const key = (x: Entry) => x.kind === "branch" && x.title.split(" ").slice(0, 2).join(" ") + "|" + x.repo;
    if (prev && key(prev) && key(prev) === key(e)) {
      const n = Number(prev.title.match(/^(\w+) (\d+)/)?.[2] ?? 1) + 1;
      const [verb, , type] = e.title.split(" ");
      prev.title = `${verb} ${n} ${type}${type?.endsWith("s") ? "" : "s"}`;
      continue;
    }
    out.push({ ...e });
  }
  return out;
}

export async function inbox(): Promise<Entry[]> {
  const list = await json<any[]>(["api", "notifications?all=false&per_page=40"]);
  return list.map((n) => ({
    id: n.id, kind: "notification" as const, at: n.updated_at,
    title: n.subject?.title ?? "",
    meta: `${n.repository?.full_name} · ${String(n.subject?.type ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} · ${String(n.reason ?? "").replace(/_/g, " ")}`,
    url: htmlUrl(n.subject?.url) ?? `https://github.com/${n.repository?.full_name}`,
    repo: n.repository?.full_name,
    number: Number(String(n.subject?.url ?? "").match(/\/(\d+)$/)?.[1]) || undefined,
    state: n.unread ? "unread" : undefined,
  }));
}

const FIELDS_PR = "number,title,repository,updatedAt,url,isDraft,author,state";
export async function myPrs(): Promise<Entry[]> {
  const [mine, review] = await Promise.all([
    json<any[]>(["search", "prs", "--author=@me", "--state=open", "--limit", "20", "--json", FIELDS_PR]),
    json<any[]>(["search", "prs", "--review-requested=@me", "--state=open", "--limit", "20", "--json", FIELDS_PR]),
  ]);
  const map = (p: any, why: string): Entry => ({
    id: p.url, kind: "pr", at: p.updatedAt, title: `#${p.number} ${p.title}`, url: p.url,
    meta: `${p.repository?.nameWithOwner} · ${why}${p.isDraft ? " · draft" : ""}`, repo: p.repository?.nameWithOwner, number: p.number,
    state: p.isDraft ? "draft" : "open",
  });
  return [...review.map((p) => map(p, "review requested")), ...mine.map((p) => map(p, "yours"))];
}

export async function myIssues(): Promise<Entry[]> {
  const list = await json<any[]>(["search", "issues", "--involves=@me", "--state=open", "--limit", "30", "--sort", "updated",
    "--json", "number,title,repository,updatedAt,url,author,labels"]);
  return list.map((i) => ({
    id: i.url, kind: "issue", at: i.updatedAt, title: `#${i.number} ${i.title}`, url: i.url, repo: i.repository?.nameWithOwner, number: i.number,
    meta: `${i.repository?.nameWithOwner} · ${i.author?.login ?? ""}${i.labels?.length ? " · " + i.labels.map((l: any) => l.name).join(", ") : ""}`,
    state: "open",
  }));
}

export async function repos(): Promise<Entry[]> {
  const list = await json<any[]>(["api", "user/repos?sort=pushed&per_page=30"]);
  return list.map((r) => ({
    id: r.full_name, kind: "repo", at: r.pushed_at, title: r.full_name, url: r.html_url, repo: r.full_name,
    meta: [r.private ? "private" : "public", r.language, r.stargazers_count ? `★ ${r.stargazers_count}` : "", r.open_issues_count ? `${r.open_issues_count} open` : "", r.description]
      .filter(Boolean).join(" · "),
  }));
}

// ---------- one repository ----------

/** owner/name of the GitHub repo a folder belongs to, if any. */
export async function repoOf(cwd: string): Promise<string | null> {
  try {
    return (await gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], cwd)).trim() || null;
  } catch {
    return null;
  }
}

const checkState = (rollup: any[] | undefined): Entry["state"] | undefined => {
  if (!rollup?.length) return undefined;
  const c = rollup.map((r) => r.conclusion ?? r.state ?? r.status);
  if (c.some((x) => /FAIL|ERROR|CANCEL|TIMED/i.test(x))) return "failure";
  if (c.some((x) => /PEND|QUEUE|PROGRESS|EXPECTED/i.test(x))) return "pending";
  return "success";
};

export async function repoPrs(repo: string): Promise<Entry[]> {
  const list = await json<any[]>(["pr", "list", "-R", repo, "--state", "all", "--limit", "25",
    "--json", "number,title,author,updatedAt,isDraft,reviewDecision,statusCheckRollup,headRefName,url,state"]);
  return list.map((p) => ({
    id: p.url, kind: "pr", at: p.updatedAt, title: `#${p.number} ${p.title}`, url: p.url, repo, number: p.number,
    meta: [p.author?.login, p.headRefName, p.reviewDecision?.toLowerCase().replace(/_/g, " "), checkLabel(checkState(p.statusCheckRollup))].filter(Boolean).join(" · "),
    state: p.state === "MERGED" ? "merged" : p.state === "CLOSED" ? "closed" : p.isDraft ? "draft" : checkState(p.statusCheckRollup) === "failure" ? "failure" : "open",
  }));
}

export async function repoIssues(repo: string): Promise<Entry[]> {
  const list = await json<any[]>(["issue", "list", "-R", repo, "--state", "all", "--limit", "25", "--json", "number,title,author,updatedAt,labels,url,state,comments"]);
  return list.map((i) => ({
    id: i.url, kind: "issue", at: i.updatedAt, title: `#${i.number} ${i.title}`, url: i.url, repo, number: i.number,
    meta: [i.author?.login, i.comments?.length ? `${i.comments.length} comments` : "", ...(i.labels ?? []).map((l: any) => l.name)].filter(Boolean).join(" · "),
    state: i.state === "CLOSED" ? "closed" : "open",
  }));
}

export async function repoRuns(repo: string): Promise<Entry[]> {
  const list = await json<any[]>(["run", "list", "-R", repo, "-L", "20", "--json", "databaseId,displayTitle,status,conclusion,workflowName,headBranch,createdAt,url,event"]);
  return list.map((r) => ({
    id: String(r.databaseId), kind: "run", at: r.createdAt, title: r.displayTitle, url: r.url, repo, runId: r.databaseId,
    meta: [r.workflowName, r.headBranch, r.event, r.status !== "completed" ? r.status.replace(/_/g, " ") : r.conclusion].filter(Boolean).join(" · "),
    state: r.status !== "completed" ? "pending" : r.conclusion === "success" ? "success" : "failure",
  }));
}

export async function repoCommits(repo: string): Promise<Entry[]> {
  const list = await json<any[]>(["api", `repos/${repo}/commits?per_page=20`]);
  return list.map((c) => ({
    id: c.sha, kind: "commit", at: c.commit?.author?.date, title: String(c.commit?.message ?? "").split("\n")[0], url: c.html_url, repo,
    meta: `${c.sha.slice(0, 7)} · ${c.author?.login ?? c.commit?.author?.name ?? ""}`,
  }));
}

export async function repoActivity(repo: string): Promise<Entry[]> {
  const parts = await Promise.allSettled([repoCommits(repo), repoPrs(repo), repoRuns(repo), repoIssues(repo)]);
  return parts.flatMap((p) => (p.status === "fulfilled" ? p.value : [])).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
}

// ---------- details ----------

export type Detail = { title: string; lines: { text: string; tone?: "good" | "bad" | "warn" | "muted" | "head" }[]; url?: string };

export async function detail(e: Entry): Promise<Detail> {
  if (e.kind === "pr" && e.repo && e.number) {
    const p = await json<any>(["pr", "view", String(e.number), "-R", e.repo, "--json",
      "title,body,state,author,reviewDecision,statusCheckRollup,comments,additions,deletions,changedFiles,headRefName,baseRefName,mergeable,url,createdAt,reviews,isDraft"]);
    const lines: Detail["lines"] = [
      { text: `${p.state.toLowerCase()}${p.isDraft ? " · draft" : ""} · ${p.author?.login} · ${p.headRefName} → ${p.baseRefName}`, tone: "muted" },
      { text: `+${p.additions} −${p.deletions} in ${p.changedFiles} files · ${p.mergeable?.toLowerCase() ?? ""}${p.reviewDecision ? " · " + p.reviewDecision.toLowerCase().replace(/_/g, " ") : ""}`, tone: "muted" },
    ];
    if (p.statusCheckRollup?.length) {
      lines.push({ text: "Checks", tone: "head" });
      for (const c of p.statusCheckRollup.slice(0, 12)) {
        const s = c.conclusion ?? c.state ?? c.status ?? "";
        lines.push({ text: `${/SUCCESS/i.test(s) ? "✓" : /FAIL|ERROR/i.test(s) ? "✗" : "◌"} ${c.name ?? c.context}`, tone: /SUCCESS/i.test(s) ? "good" : /FAIL|ERROR/i.test(s) ? "bad" : "warn" });
      }
    }
    if (p.reviews?.length) {
      lines.push({ text: "Reviews", tone: "head" });
      for (const r of p.reviews.slice(-5)) lines.push({ text: `${r.author?.login}: ${r.state.toLowerCase().replace(/_/g, " ")}`, tone: r.state === "APPROVED" ? "good" : r.state === "CHANGES_REQUESTED" ? "bad" : "muted" });
    }
    pushBody(lines, p.body);
    if (p.comments?.length) {
      lines.push({ text: `Comments (${p.comments.length})`, tone: "head" });
      for (const c of p.comments.slice(-4)) lines.push({ text: `${c.author?.login}: ${oneLine(c.body)}` });
    }
    return { title: `#${e.number} ${p.title}`, lines, url: p.url };
  }
  if (e.kind === "issue" && e.repo && e.number) {
    const i = await json<any>(["issue", "view", String(e.number), "-R", e.repo, "--json", "title,body,state,author,comments,labels,assignees,url,createdAt"]);
    const lines: Detail["lines"] = [
      { text: `${i.state.toLowerCase()} · ${i.author?.login}${i.assignees?.length ? " · → " + i.assignees.map((a: any) => a.login).join(", ") : ""}`, tone: "muted" },
    ];
    if (i.labels?.length) lines.push({ text: i.labels.map((l: any) => l.name).join(" · "), tone: "warn" });
    pushBody(lines, i.body);
    if (i.comments?.length) {
      lines.push({ text: `Comments (${i.comments.length})`, tone: "head" });
      for (const c of i.comments.slice(-5)) lines.push({ text: `${c.author?.login}: ${oneLine(c.body)}` });
    }
    return { title: `#${e.number} ${i.title}`, lines, url: i.url };
  }
  if (e.kind === "run" && e.repo && e.runId) {
    const r = await json<any>(["run", "view", String(e.runId), "-R", e.repo, "--json", "jobs,conclusion,status,displayTitle,url,workflowName,headBranch,event"]);
    const lines: Detail["lines"] = [{ text: `${r.workflowName} · ${r.headBranch} · ${r.event} · ${r.status === "completed" ? r.conclusion : r.status}`, tone: "muted" }];
    for (const j of r.jobs ?? []) {
      const ok = j.conclusion === "success";
      lines.push({ text: `${ok ? "✓" : j.status !== "completed" ? "◌" : "✗"} ${j.name}`, tone: ok ? "good" : j.status !== "completed" ? "warn" : "bad" });
      for (const s of (j.steps ?? []).filter((s: any) => s.conclusion === "failure").slice(0, 3)) lines.push({ text: `    ✗ ${s.name}`, tone: "bad" });
    }
    return { title: r.displayTitle, lines, url: r.url };
  }
  return { title: e.title, lines: [{ text: e.meta, tone: "muted" }], url: e.url };
}

function pushBody(lines: Detail["lines"], body?: string) {
  const text = String(body ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").replace(/\r/g, "").trim();
  if (!text) return;
  lines.push({ text: "Description", tone: "head" });
  for (const l of text.split("\n").slice(0, 30)) lines.push({ text: l });
}

/** Comment text without HTML comments/tags, on one line. */
const oneLine = (s: string) =>
  String(s ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 200);
const cap = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1) : "");
export const checkLabel = (s?: Entry["state"]) => (s === "success" ? "✓ checks" : s === "failure" ? "✗ checks" : s === "pending" ? "◌ checks" : "");
