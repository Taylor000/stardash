import assert from "node:assert/strict"
process.env.DATABASE_PATH = ":memory:"
const { db } = await import("../lib/db")
const { upsertStarredRepos } = await import("../lib/user-metadata")
const { createUnstarBatch, processBatchItem, getBatch, controlBatch, listBatchSummaries } =
  await import("../lib/library-batches")
const user = "permission-test"
db.prepare("insert into profiles(id,github_id,github_username) values(?,?,?)").run(user, "99", user)
const repo = (id: string) => ({
  id,
  owner: "sample",
  name: `repo-${id}`,
  fullName: `sample/repo-${id}`,
  description: "",
  language: null,
  languageColor: null,
  topics: [],
  homepage: null,
  license: null,
  stargazersCount: 1,
  forksCount: 0,
  openIssuesCount: 0,
  pushedAt: "2026-01-01",
  starredAt: "2026-01-01",
  avatarUrl: "",
  status: null,
  isPinned: false,
  notes: null,
  tags: [],
  collections: [],
  readme: null,
})
upsertStarredRepos([repo("1"), repo("2")], user)
const batch = createUnstarBatch(user, ["1", "2"], 2, "permission", false)
let allowed = false,
  writes = 0
const fetcher: typeof fetch = async (url, init) => {
  if (String(url).includes("/repositories/")) {
    const id = Number(String(url).split("/").pop())
    return Response.json({ id, owner: { login: "sample" }, name: `repo-${id}` })
  }
  if (init?.method === "DELETE") {
    writes++
    return allowed
      ? new Response(null, { status: 204 })
      : Response.json(
          {
            message: "Resource not accessible by integration",
            documentation_url:
              "https://docs.github.com/rest/activity/starring#unstar-a-repository-for-the-authenticated-user",
          },
          {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "4900",
              "x-accepted-github-permissions": "starring=write,metadata=read",
            },
          },
        )
  }
  return new Response(null, { status: 204 })
}
await processBatchItem({ getToken: async () => "test-only", fetcher })
let current = getBatch(user, batch.id)
assert.equal(
  current.status,
  "paused",
  "permission 403 must pause the batch instead of failing each selected repo",
)
assert.equal(current.items[0].status, "pending", "preserve the blocked item for resume")
assert.equal(
  current.items[1].attempts,
  0,
  "do not drain remaining items with the same invalid grant",
)
assert.match(current.items[0].error ?? "", /授权.*Starring/)
assert.equal(listBatchSummaries(user)[0].reauthRequired, true)
assert.equal(await processBatchItem({ getToken: async () => "test-only", fetcher }), false)
assert.equal(writes, 1)
assert.equal(db.prepare("select count(*) as n from user_starred_repos").get()!.n, 2)
allowed = true
controlBatch(user, batch.id, "resume")
await processBatchItem({ getToken: async () => "new-test-grant", fetcher })
await processBatchItem({ getToken: async () => "new-test-grant", fetcher })
current = getBatch(user, batch.id)
assert.equal(current.status, "completed")
assert.equal(current.items.filter((i) => i.status === "succeeded").length, 2)
assert.equal(
  listBatchSummaries(user)[0].reauthRequired,
  false,
  "clear old authorization errors after success",
)
console.log("permission 403 pause, actionable reauthorization, exact selection resume: ok")

upsertStarredRepos([repo("3")], user)
const rate = createUnstarBatch(user, ["3"], 1, "secondary", false)
const start = Date.now()
await processBatchItem({
  getToken: async () => "test-only",
  fetcher: async () =>
    Response.json(
      {
        message:
          "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
      },
      {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "4990",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3500),
        },
      },
    ),
})
assert.equal(
  getBatch(user, rate.id).items[0].status,
  "pending",
  "secondary limit is retryable even without Retry-After",
)
assert.equal(listBatchSummaries(user)[0].reauthRequired, false)
let next = Number(
  db.prepare("select next_attempt_at as n from library_batch_items where batch_id=?").get(rate.id)!
    .n,
)
assert.ok(
  next >= start + 59000 && next < start + 10 * 60000,
  "secondary limit should wait a minute, not the primary reset hour",
)
controlBatch(user, rate.id, "cancel")
const server = createUnstarBatch(user, ["3"], 1, "server", false)
await processBatchItem({
  getToken: async () => "test-only",
  fetcher: async () =>
    Response.json(
      { message: "Server error" },
      {
        status: 500,
        headers: {
          "x-ratelimit-remaining": "4990",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3500),
        },
      },
    ),
})
next = Number(
  db
    .prepare("select next_attempt_at as n from library_batch_items where batch_id=?")
    .get(server.id)!.n,
)
assert.ok(
  next < Date.now() + 30000,
  "ordinary server errors must not wait until the unrelated rate-limit reset",
)
controlBatch(user, server.id, "cancel")
const blocked = createUnstarBatch(user, ["3"], 1, "blocked-repository", false)
await processBatchItem({
  getToken: async () => "test-only",
  fetcher: async () => Response.json({ message: "Repository access blocked" }, { status: 403 }),
})
assert.equal(getBatch(user, blocked.id).status, "partial_failed")
assert.equal(
  listBatchSummaries(user)[0].reauthRequired,
  false,
  "repository policy blocks are not grant errors",
)
console.log("secondary 403, server backoff and repository-specific 403: ok")

upsertStarredRepos(["10", "11", "12", "13", "14"].map(repo), user)
const mixed = createUnstarBatch(user, ["10", "11", "12", "13", "14"], 5, "mixed-errors", false)
let failures = 0
for (let n = 0; n < 4; n++)
  await processBatchItem({
    getToken: async () => "test-only",
    fetcher: async () => {
      failures++
      return Response.json(
        {
          message:
            failures <= 3 ? "Repository access blocked" : "Resource not accessible by integration",
        },
        { status: 403 },
      )
    },
  })
const summary = listBatchSummaries(user).find((b) => b.id === mixed.id)!
assert.equal(summary.status, "paused")
assert.equal(
  summary.reauthRequired,
  true,
  "authorization failure must stay actionable after three earlier repository errors",
)
assert.ok(
  summary.errors.some((message) => message.startsWith("GitHub 授权")),
  "display the actual permission error ahead of older failures",
)
console.log("mixed repository and authorization failures remain actionable: ok")
