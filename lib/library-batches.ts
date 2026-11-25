import { randomUUID } from "node:crypto"
import { db, nowIso } from "./db"

type Action = "pin" | "unpin" | "add-tag" | "remove-tag" | "add-collection" | "remove-collection"
type OwnedRepo = {
  id: string
  github_repo_id: number
  owner: string
  name: string
  full_name: string
  star_id: string
  is_pinned: number
  [key: string]: unknown
}
export interface BatchItem {
  github_repo_id: string
  snapshot_json: string
  status: string
  attempts: number
  error: string | null
}
export interface LibraryBatch {
  id: string
  user_id: string
  status: string
  created_at: string
  items: BatchItem[]
}
export function acquireStarSync(userId: string): boolean {
  db.exec("begin immediate")
  try {
    if (
      db
        .prepare(
          "select 1 from library_batches where user_id=? and status in ('queued','running','paused')",
        )
        .get(userId) ||
      db
        .prepare(
          "select 1 from library_batch_items i join library_batches b on b.id=i.batch_id where b.user_id=? and i.status='running'",
        )
        .get(userId) ||
      db
        .prepare("select 1 from library_locks where name=? and expires_at>?")
        .get(`sync:${userId}`, Date.now())
    ) {
      db.exec("commit")
      return false
    }
    db.prepare("insert or replace into library_locks(name,expires_at) values(?,?)").run(
      `sync:${userId}`,
      Date.now() + 600000,
    )
    db.exec("commit")
    return true
  } catch (e) {
    db.exec("rollback")
    throw e
  }
}
export function releaseStarSync(userId: string) {
  db.prepare("delete from library_locks where name=?").run(`sync:${userId}`)
}

function idsOf(ids: unknown): string[] {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 20000 ||
    ids.some((id) => typeof id !== "string" || !/^\d+$/.test(id))
  )
    throw Error("请选择有效的仓库，单次最多 20000 项")
  return [...new Set(ids)]
}
function owned(userId: string, ids: string[]): OwnedRepo[] {
  const rows = db
    .prepare(
      `select r.*, u.id as star_id,u.is_pinned,u.notes,u.starred_at,u.status,
    (select json_group_array(json_object('id',t.id,'label',t.label,'color',t.color)) from user_starred_repo_tags x join tags t on t.id=x.tag_id where x.user_starred_repo_id=u.id) as tags,
    (select json_group_array(json_object('id',c.id,'name',c.name,'emoji',c.emoji,'color',c.color)) from user_starred_repo_collections x join collections c on c.id=x.collection_id where x.user_starred_repo_id=u.id) as collections
    from user_starred_repos u join repos r on r.id=u.repo_id
    where u.user_id=? and cast(r.github_repo_id as text) in (select value from json_each(?))`,
    )
    .all(userId, JSON.stringify(ids)) as unknown as OwnedRepo[]
  if (rows.length !== ids.length) throw Error("选择中有不存在或不属于当前账号的仓库，请刷新后重试")
  return rows
}
export function applyLibraryBatch(
  userId: string,
  requested: unknown,
  action: Action,
  targetId?: string,
) {
  const ids = idsOf(requested)
  if (
    !["pin", "unpin", "add-tag", "remove-tag", "add-collection", "remove-collection"].includes(
      action,
    )
  )
    throw Error("不支持的操作")
  db.exec("begin immediate")
  try {
    const rows = owned(userId, ids)
    if (action.includes("tag") || action.includes("collection")) {
      const table = action.includes("tag") ? "tags" : "collections"
      if (
        !targetId ||
        !db.prepare(`select 1 from ${table} where id=? and user_id=?`).get(targetId, userId)
      )
        throw Error("分类或标签不属于当前账号")
    }
    for (const row of rows) {
      if (action === "pin" || action === "unpin")
        db.prepare(
          "update user_starred_repos set is_pinned=?,updated_at=? where id=? and user_id=?",
        ).run(action === "pin" ? 1 : 0, nowIso(), row.star_id, userId)
      else {
        const tag = action.includes("tag"),
          table = tag ? "user_starred_repo_tags" : "user_starred_repo_collections",
          column = tag ? "tag_id" : "collection_id"
        if (action.startsWith("add"))
          db.prepare(
            `insert or ignore into ${table}(user_starred_repo_id,user_id,${column}) values(?,?,?)`,
          ).run(row.star_id, userId, targetId!)
        else
          db.prepare(
            `delete from ${table} where user_starred_repo_id=? and user_id=? and ${column}=?`,
          ).run(row.star_id, userId, targetId!)
      }
    }
    db.exec("commit")
    return { count: rows.length }
  } catch (e) {
    db.exec("rollback")
    throw e
  }
}
export function getBatch(userId: string, id: string): LibraryBatch {
  const batch = db
    .prepare("select id,user_id,status,created_at from library_batches where id=? and user_id=?")
    .get(id, userId) as unknown as Omit<LibraryBatch, "items"> | undefined
  if (!batch) throw Error("任务不存在")
  const items = db
    .prepare(
      "select github_repo_id,snapshot_json,status,attempts,error from library_batch_items where batch_id=? order by rowid",
    )
    .all(id) as unknown as BatchItem[]
  return { ...batch, items }
}
export function listBatches(userId: string) {
  return (
    db
      .prepare("select id from library_batches where user_id=? order by created_at desc limit 5")
      .all(userId) as { id: string }[]
  ).map((r) => getBatch(userId, r.id))
}
export function listBatchSummaries(userId: string) {
  const rows = db
    .prepare(
      `select b.id,b.status,count(*) as total,
    sum(i.status='succeeded') as completed,sum(i.status='failed') as failed
    from library_batches b join library_batch_items i on i.batch_id=b.id
    where b.user_id=? group by b.id order by b.created_at desc limit 5`,
    )
    .all(userId) as unknown as {
    id: string
    status: string
    total: number
    completed: number
    failed: number
  }[]
  return rows.map((row) => ({
    ...row,
    errors: (
      db
        .prepare(
          "select error from library_batch_items where batch_id=? and error is not null order by rowid limit 3",
        )
        .all(row.id) as { error: string }[]
    ).map((r) => r.error),
  }))
}
export function createUnstarBatch(
  userId: string,
  requested: unknown,
  confirmation: number,
  key: string,
  allowPinned: boolean,
) {
  const ids = idsOf(requested)
  if (confirmation !== ids.length || !key || key.length > 100) throw Error("确认数量不匹配")
  db.exec("begin immediate")
  try {
    const existing = db
      .prepare("select id from library_batches where user_id=? and idempotency_key=?")
      .get(userId, key) as { id: string } | undefined
    if (existing) {
      db.exec("commit")
      return getBatch(userId, existing.id)
    }
    if (
      db
        .prepare("select 1 from library_locks where name=? and expires_at>?")
        .get(`sync:${userId}`, Date.now())
    )
      throw Error("收藏正在同步，请稍后创建批量任务")
    if (
      db
        .prepare(
          "select 1 from library_batches where user_id=? and status in ('queued','running','paused')",
        )
        .get(userId)
    )
      throw Error("请先完成或取消当前批量任务")
    const rows = owned(userId, ids)
    if (rows.some((r) => r.is_pinned) && allowPinned !== true)
      throw Error("选中项包含重点收藏，请明确确认")
    const id = randomUUID(),
      at = nowIso()
    db.prepare(
      "insert into library_batches(id,user_id,idempotency_key,created_at,updated_at) values(?,?,?,?,?)",
    ).run(id, userId, key, at, at)
    const insert = db.prepare(
      "insert into library_batch_items(batch_id,github_repo_id,snapshot_json) values(?,?,?)",
    )
    for (const row of rows) insert.run(id, String(row.github_repo_id), JSON.stringify(row))
    db.exec("commit")
    return getBatch(userId, id)
  } catch (e) {
    if (db.isTransaction) db.exec("rollback")
    throw e
  }
}
export function controlBatch(userId: string, id: string, action: string) {
  const batch = getBatch(userId, id)
  if (!["pause", "resume", "cancel", "retry"].includes(action)) throw Error("不支持的任务操作")
  db.exec("begin immediate")
  try {
    if (action === "retry") {
      if (
        db
          .prepare("select 1 from library_locks where name=? and expires_at>?")
          .get(`sync:${userId}`, Date.now())
      )
        throw Error("收藏正在同步，请稍后重试任务")
      if (!batch.items.some((i) => i.status === "failed")) throw Error("没有需要重试的失败项")
      if (
        db
          .prepare(
            "select 1 from library_batches where user_id=? and id<>? and status in ('queued','running','paused')",
          )
          .get(userId, id)
      )
        throw Error("请先完成当前任务")
      db.prepare(
        "update library_batch_items set status='pending', attempts=0, next_attempt_at=0,error=null where batch_id=? and status='failed'",
      ).run(id)
      db.prepare("update library_batches set status='queued',updated_at=? where id=?").run(
        nowIso(),
        id,
      )
    } else if (action === "cancel") {
      db.prepare(
        "update library_batch_items set status='skipped',error='已取消' where batch_id=? and status='pending'",
      ).run(id)
      db.prepare("update library_batches set status='cancelled',updated_at=? where id=?").run(
        nowIso(),
        id,
      )
    } else if (!["completed", "cancelled", "partial_failed"].includes(batch.status)) {
      db.prepare("update library_batches set status=?,updated_at=? where id=?").run(
        action === "pause" ? "paused" : "queued",
        nowIso(),
        id,
      )
    }
    db.exec("commit")
  } catch (e) {
    db.exec("rollback")
    throw e
  }
  return getBatch(userId, id)
}
type Dependencies = { getToken: (userId: string) => Promise<string | null>; fetcher?: typeof fetch }
function finalizeBatches() {
  db.prepare(
    `update library_batches set status=case when exists(select 1 from library_batch_items i where i.batch_id=library_batches.id and i.status='failed') then 'partial_failed' else 'completed' end,updated_at=?
    where status in ('queued','running','paused') and not exists(select 1 from library_batch_items i where i.batch_id=library_batches.id and i.status in ('pending','running'))`,
  ).run(nowIso())
}
class GithubFailure extends Error {
  response: Response
  constructor(response: Response) {
    super(`GitHub ${response.status}`)
    this.response = response
  }
}
/** One claimed item per invocation. Requests never rely on an HTTP response staying open. */
export async function processBatchItem({
  getToken,
  fetcher = fetch,
}: Dependencies): Promise<boolean> {
  const now = Date.now()
  db.exec("begin immediate")
  let row:
    | {
        batch_id: string
        github_repo_id: string
        snapshot_json: string
        attempts: number
        user_id: string
        batch_status: string
      }
    | undefined
  try {
    finalizeBatches()
    row = db
      .prepare(
        `select i.*,b.user_id,b.status as batch_status from library_batch_items i join library_batches b on b.id=i.batch_id
      where ((b.status in ('queued','running') and (i.status='pending' or (i.status='running' and i.lease_until<?))) or (b.status='cancelled' and i.status='running' and i.lease_until<?)) and i.next_attempt_at<=?
      and not exists(select 1 from library_locks l where l.name='sync:'||b.user_id and l.expires_at>?)
      and not exists(select 1 from library_batch_items x where x.status='running' and x.lease_until>=?)
      order by b.created_at,i.rowid limit 1`,
      )
      .get(now, now, now, now, now) as typeof row
    if (row) {
      db.prepare(
        "update library_batch_items set status='running',lease_until=?,attempts=attempts+1 where batch_id=? and github_repo_id=?",
      ).run(now + 90000, row.batch_id, row.github_repo_id)
      db.prepare(
        "update library_batches set status='running',updated_at=? where id=? and status in ('queued','running')",
      ).run(nowIso(), row.batch_id)
    }
    db.exec("commit")
  } catch (e) {
    db.exec("rollback")
    throw e
  }
  if (!row) return false
  const item = row
  const isCancelled = () =>
    item.batch_status === "cancelled" ||
    (
      db.prepare("select status from library_batches where id=?").get(item.batch_id) as {
        status: string
      }
    ).status === "cancelled"
  const update = (status: string, error: string | null = null, next = 0) =>
    db
      .prepare(
        "update library_batch_items set status=?,error=?,lease_until=0,next_attempt_at=? where batch_id=? and github_repo_id=?",
      )
      .run(status, error, next, item.batch_id, item.github_repo_id)
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    let token: string | null
    try {
      token = await Promise.race([
        getToken(item.user_id),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error("GitHub 授权请求超时")), 20000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    if (!token) {
      if (isCancelled()) {
        update("failed", "在途项目需要重新授权后核对收藏状态")
        return true
      }
      update("pending", "GitHub 授权已失效，请重新登录")
      db.prepare("update library_batches set status='paused' where id=?").run(item.batch_id)
      return true
    }
    const request = async (path: string, method = "GET") =>
      fetcher(`https://api.github.com${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(20000),
      })
    // Resolve renames by immutable repository id, and verify accessibility before interpreting 404.
    const repoResponse = await request(`/repositories/${item.github_repo_id}`)
    if (!repoResponse.ok) throw new GithubFailure(repoResponse)
    const repo = (await repoResponse.json()) as {
      id: number
      owner: { login: string }
      name: string
    }
    if (String(repo.id) !== item.github_repo_id) throw Error("仓库身份核验失败")
    const path = `/user/starred/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}`
    const state = await request(path)
    if (state.status === 204) {
      if (isCancelled()) {
        update("skipped", "已停止，保留原收藏")
        return true
      }
      const response = await request(path, "DELETE")
      if (response.status !== 204) throw new GithubFailure(response)
    } else if (state.status !== 404) throw new GithubFailure(state)
    db.exec("begin immediate")
    try {
      // Snapshot already committed before any GitHub write. Recovered items reconcile remotely first.
      db.prepare(
        "delete from user_starred_repos where user_id=? and repo_id in(select id from repos where github_repo_id=?)",
      ).run(item.user_id, Number(item.github_repo_id))
      db.prepare(
        "update profiles set total_starred_count=(select count(*) from user_starred_repos where user_id=?) where id=?",
      ).run(item.user_id, item.user_id)
      update("succeeded")
      db.exec("commit")
    } catch (e) {
      db.exec("rollback")
      throw e
    }
  } catch (error) {
    const res = error instanceof GithubFailure ? error.response : null
    const message = res ? `GitHub 返回 ${res.status}` : "网络或本地写入失败，重试前将核对收藏状态"
    const limited =
      res &&
      (res.status === 429 ||
        (res.status === 403 &&
          (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after"))))
    if (isCancelled()) {
      if ((!res || res.status >= 500 || limited) && item.attempts < 2) {
        update("running", message, Date.now() + 60000)
      } else update("failed", message)
    } else if (res?.status === 401) {
      update("pending", "GitHub 授权失效，请重新登录")
      db.prepare("update library_batches set status='paused' where id=?").run(item.batch_id)
    } else if (limited || ((!res || res.status >= 500) && item.attempts < 2)) {
      const retry = Number(res?.headers.get("retry-after") ?? 0) * 1000
      const reset = Number(res?.headers.get("x-ratelimit-reset") ?? 0) * 1000 - Date.now()
      update(
        "pending",
        message,
        Date.now() +
          Math.max(5000 * 2 ** Math.min(item.attempts, 5), retry, reset, limited ? 60000 : 0),
      )
    } else update("failed", message)
  }
  finalizeBatches()
  return true
}
