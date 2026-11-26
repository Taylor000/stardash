import assert from "node:assert/strict"
process.env.DATABASE_PATH = ":memory:"
const { db } = await import("../lib/db")
const history = await import("../lib/library-history")
for (const user of ["owner", "other"]) db.prepare("insert into profiles(id) values(?)").run(user)

// Losing the user filter would expose another owner's tasks and snapshots.
function addBatch(id: string, userId: string, createdAt: string, count = 1) {
  db.prepare(
    "insert into library_batches(id,user_id,status,idempotency_key,created_at,updated_at) values(?,?,?,?,?,?)",
  ).run(id, userId, "completed", id, createdAt, createdAt)
  for (let i = 0; i < count; i++)
    db.prepare(
      "insert into library_batch_items(batch_id,github_repo_id,snapshot_json,status,attempts,error) values(?,?,?,?,?,?)",
    ).run(
      id,
      String(i + 1),
      JSON.stringify({
        full_name: `example/repo-${i + 1}`,
        notes: "private-note",
        tags: [{ label: "private-tag" }],
      }),
      "succeeded",
      1,
      null,
    )
}
for (let i = 1; i <= 23; i++)
  addBatch(
    `job-${i}`,
    "owner",
    `2026-01-${String(i).padStart(2, "0")}T00:00:00Z`,
    i === 23 ? 55 : 1,
  )
addBatch("other-job", "other", "2026-12-01T00:00:00Z")
const first = history.listTaskHistory("owner", 1)
assert.equal(
  first.total,
  23,
  "history must include completed tasks beyond the dashboard's last five",
)
assert.equal(first.batches.length, 20)
assert.equal(first.batches[0].id, "job-23")
assert.equal(first.batches[0].completed, 55)
assert.equal(first.batches[0].createdAt, "2026-01-23T00:00:00Z")
assert.equal(history.listTaskHistory("owner", 2).batches.length, 3)
assert.equal(history.listTaskHistory("owner", 999).page, 2)
assert.equal(history.listTaskHistory("nobody", 1).total, 0)
assert.equal(history.getTaskHistory("other", "job-23", 1), null)
assert.equal(history.getTaskHistory("owner", "missing", 1), null)
const detail = history.getTaskHistory("owner", "job-23", 1)!
assert.equal(detail.total, 55)
assert.equal(detail.items.length, 50)
assert.equal(
  detail.items[0].fullName,
  "example/repo-1",
  "snapshots remain readable after local stars have been removed",
)
assert.equal(detail.items[0].attempts, 1)
assert(!JSON.stringify(detail).includes("private-note"))
assert(!JSON.stringify(detail).includes("private-tag"))
assert.equal(history.getTaskHistory("owner", "job-23", 2)!.items.length, 5)
assert.equal(history.getTaskHistory("owner", "job-23", 999)!.page, 2)
db.prepare(
  "update library_batch_items set snapshot_json=?,status='failed',error=? where batch_id=? and github_repo_id=?",
).run("invalid-json", "GitHub 返回错误", "job-23", "1")
const malformed = history.getTaskHistory("owner", "job-23", 1)!.items[0]
assert.equal(malformed.fullName, "GitHub 项目 #1")
assert.equal(malformed.error, "GitHub 返回错误")
assert.equal(history.listTaskHistory("owner", 1).batches[0].failed, 1)
assert.equal(history.listTaskHistory("owner", 1).batches[0].completed, 54)
console.log(
  "task history: owner isolation, completed snapshots, safe payload, pagination and malformed snapshots: ok",
)
db.close()
