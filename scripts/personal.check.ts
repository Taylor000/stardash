import assert from "node:assert/strict"
import { mock } from "node:test"
process.env.DATABASE_PATH = ":memory:"
const { sortLibrary, selectPage, csvCell } = await import("../lib/personal-library")
const { db } = await import("../lib/db")
const { upsertStarredRepos, createTag } = await import("../lib/user-metadata")
const {
  applyLibraryBatch,
  createUnstarBatch,
  getBatch,
  controlBatch,
  processBatchItem,
  acquireStarSync,
  releaseStarSync,
} = await import("../lib/library-batches")

const repo = (id: string, at: string | null) => ({
  id,
  owner: "owner",
  name: `repo-${id}`,
  fullName: `owner/repo-${id}`,
  description: "",
  language: "TypeScript",
  languageColor: null,
  topics: [],
  homepage: null,
  license: "MIT",
  stargazersCount: Number(id),
  forksCount: Number(id),
  openIssuesCount: 0,
  starredAt: at ?? "",
  pushedAt: at ?? "",
  avatarUrl: "",
  status: null,
  isPinned: false,
  notes: null,
  tags: [],
  collections: [],
  readme: null,
  archived: false,
})
const a = repo("1", "2020-01-01"),
  b = repo("2", "2025-01-01"),
  unknown = repo("3", null)
for (const field of ["starred", "pushed"] as const) {
  assert.deepEqual(
    sortLibrary([unknown, b, a], `${field}-asc`).map((r) => r.id),
    ["1", "2", "3"],
  )
  assert.deepEqual(
    sortLibrary([unknown, a, b], `${field}-desc`).map((r) => r.id),
    ["2", "1", "3"],
  )
}
assert.deepEqual(
  sortLibrary([b, a], "forks-asc").map((r) => r.id),
  ["1", "2"],
)
assert.deepEqual(
  sortLibrary([b, a], "name-desc").map((r) => r.id),
  ["2", "1"],
)
assert.deepEqual(
  sortLibrary([repo("2", null), repo("1", null)], "starred-desc").map((r) => r.id),
  ["1", "2"],
)
assert.deepEqual(
  selectPage([a, b, unknown], 2, 2).map((r) => r.id),
  ["3"],
)
assert.equal(csvCell("=SUM(A1)"), '"\'=SUM(A1)"')
assert.equal(csvCell('hello,"world"'), '"hello,""world"""')
console.log("personal sorting, pagination and export: ok")

db.prepare("insert into profiles (id,github_id,github_username) values (?,?,?)").run(
  "u1",
  "1",
  "owner",
)
db.prepare("insert into profiles (id,github_id,github_username) values (?,?,?)").run(
  "u2",
  "2",
  "other",
)
upsertStarredRepos([a, b, unknown], "u1")
const tag = createTag("u1", "keep", "#008a1c")
const otherTag = createTag("u2", "private", "#008a1c")
assert.throws(() => applyLibraryBatch("u1", ["1", "999"], "pin"))
assert.equal(db.prepare("select sum(is_pinned) as n from user_starred_repos").get()!.n, 0)
assert.throws(() => applyLibraryBatch("u1", ["1"], "add-tag", otherTag.id))
applyLibraryBatch("u1", ["1", "2"], "add-tag", tag.id)
assert.equal(db.prepare("select count(*) as n from user_starred_repo_tags").get()!.n, 2)
applyLibraryBatch("u1", ["1"], "pin")
assert.throws(() => createUnstarBatch("u1", ["1"], 1, "protected", false))
assert.throws(() => createUnstarBatch("u1", ["2"], 2, "wrong-count", false))
const job = createUnstarBatch("u1", ["2"], 1, "same-key", false)
assert.equal(acquireStarSync("u1"), false, "sync cannot race active batch")
assert.equal(createUnstarBatch("u1", ["2"], 1, "same-key", false).id, job.id)
assert.throws(() => getBatch("u2", job.id))
controlBatch("u1", job.id, "pause")
let writes = 0
const requests: string[] = []
let remoteStarred = true
const github = async (url: string | URL | Request, init?: RequestInit) => {
  const path = String(url)
  requests.push(`${init?.method ?? "GET"} ${path}`)
  if (path.includes("/repositories/"))
    return Response.json({ id: 2, owner: { login: "renamed" }, name: "repo-2" })
  if (init?.method === "DELETE") {
    writes++
    remoteStarred = false
    return new Response(null, { status: 204 })
  }
  return new Response(null, { status: remoteStarred ? 204 : 404 })
}
assert.equal(await processBatchItem({ getToken: async () => "test-only", fetcher: github }), false)
assert.equal(writes, 0)
controlBatch("u1", job.id, "resume")
await processBatchItem({ getToken: async () => "test-only", fetcher: github })
assert.equal(writes, 1)
assert.equal(getBatch("u1", job.id).status, "completed")
assert.ok(requests.some((r) => r.includes("/user/starred/renamed/repo-2")))
assert.equal(db.prepare("select count(*) as n from user_starred_repos").get()!.n, 2)
assert.match(getBatch("u1", job.id).items[0].snapshot_json, /keep/)

const retry = createUnstarBatch("u1", ["3"], 1, "recover", false)
db.prepare("update library_batch_items set status='running',lease_until=0 where batch_id=?").run(
  retry.id,
)
let recoveredWrites = 0
await processBatchItem({
  getToken: async () => "test-only",
  fetcher: async (url, init) => {
    if (String(url).includes("/repositories/"))
      return Response.json({ id: 3, owner: { login: "owner" }, name: "repo-3" })
    if (init?.method === "DELETE") recoveredWrites++
    return new Response(null, { status: 404 })
  },
})
assert.equal(recoveredWrites, 0, "recover remote success without repeating DELETE")
assert.equal(getBatch("u1", retry.id).status, "completed")
const failure = createUnstarBatch("u1", ["1"], 1, "missing-repo", true)
await processBatchItem({
  getToken: async () => "test-only",
  fetcher: async () => new Response(null, { status: 404 }),
})
assert.equal(
  getBatch("u1", failure.id).status,
  "partial_failed",
  "inaccessible repo must not count as success",
)
assert.equal(db.prepare("select count(*) as n from user_starred_repos").get()!.n, 1)
assert.equal(acquireStarSync("u1"), true)
assert.throws(() => createUnstarBatch("u1", ["1"], 1, "during-sync", true))
releaseStarSync("u1")
const authJob = createUnstarBatch("u1", ["1"], 1, "auth-failure", true)
await processBatchItem({
  getToken: async () => "test-only",
  fetcher: async () => new Response(null, { status: 401 }),
})
assert.equal(getBatch("u1", authJob.id).status, "paused")
controlBatch("u1", authJob.id, "resume")
await processBatchItem({
  getToken: async () => "test-only",
  fetcher: async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
})
assert.ok(
  Number(
    db
      .prepare("select next_attempt_at as n from library_batch_items where batch_id=?")
      .get(authJob.id)!.n,
  ) >
    Date.now() + 110000,
)
controlBatch("u1", authJob.id, "cancel")
assert.throws(
  () => controlBatch("u1", authJob.id, "retry"),
  "cancelled tasks with no failures cannot be requeued",
)
const cancelled = createUnstarBatch("u1", ["1"], 1, "cancel-inflight", true)
db.prepare("update library_batch_items set status='running',lease_until=? where batch_id=?").run(
  Date.now() + 60000,
  cancelled.id,
)
controlBatch("u1", cancelled.id, "cancel")
assert.equal(acquireStarSync("u1"), false, "cancelled in-flight writes still block sync")
db.prepare("update library_batch_items set lease_until=0 where batch_id=?").run(cancelled.id)
let cancelledWrites = 0
await processBatchItem({
  getToken: async () => "test-only",
  fetcher: async (url, init) => {
    if (String(url).includes("/repositories/"))
      return Response.json({ id: 1, owner: { login: "owner" }, name: "repo-1" })
    if (init?.method === "DELETE") cancelledWrites++
    return new Response(null, { status: 204 })
  },
})
assert.equal(
  cancelledWrites,
  0,
  "cancelled recovered items only reconcile, never send a fresh DELETE",
)
assert.equal(getBatch("u1", cancelled.id).items[0].status, "skipped")
assert.equal(acquireStarSync("u1"), true)
assert.throws(() => controlBatch("u1", failure.id, "retry"), "retry cannot race sync")
releaseStarSync("u1")
const last = createUnstarBatch("u1", ["1"], 1, "pause-last", true)
await processBatchItem({
  getToken: async () => "test-only",
  fetcher: async (url, init) => {
    if (String(url).includes("/repositories/"))
      return Response.json({ id: 1, owner: { login: "owner" }, name: "repo-1" })
    if (init?.method === "DELETE") controlBatch("u1", last.id, "pause")
    return new Response(null, { status: 204 })
  },
})
assert.equal(
  getBatch("u1", last.id).status,
  "completed",
  "pausing the final in-flight item must not strand a completed batch",
)
db.prepare("update library_batches set status='running' where id=?").run(last.id)
assert.equal(await processBatchItem({ getToken: async () => "test-only", fetcher: github }), false)
assert.equal(getBatch("u1", last.id).status, "completed", "recover crash after final item commit")
upsertStarredRepos([repo("4", "2026-01-01")], "u1")
const timed = createUnstarBatch("u1", ["4"], 1, "token-timeout", false)
mock.timers.enable({ apis: ["setTimeout"] })
try {
  const pending = processBatchItem({ getToken: () => new Promise(() => {}), fetcher: github })
  mock.timers.tick(20001)
  await pending
  assert.equal(
    getBatch("u1", timed.id).items[0].status,
    "pending",
    "token timeout releases worker for later ticks",
  )
} finally {
  mock.timers.reset()
}
controlBatch("u1", timed.id, "cancel")
console.log("atomic metadata, ownership, pin protection, durable unstar and recovery: ok")

const { fetchAllStarredRepos } = await import("../lib/github")
const realFetch = globalThis.fetch
let page = 0
globalThis.fetch = async () => {
  page++
  return Response.json(
    [
      {
        starred_at: "2026-01-01",
        repo: {
          id: page,
          name: `r${page}`,
          full_name: `a/r${page}`,
          owner: { id: 1, login: "a", avatar_url: "" },
          topics: [],
          stargazers_count: 0,
          forks_count: 0,
          open_issues_count: 0,
        },
      },
    ],
    {
      headers:
        page < 52 ? { Link: '<https://api.github.com/user/starred?page=2>; rel="next"' } : {},
    },
  )
}
try {
  assert.equal((await fetchAllStarredRepos("test-only")).length, 52)
  assert.equal(page, 52)
} finally {
  globalThis.fetch = realFetch
}
console.log("GitHub pagination beyond 50 pages: ok")
