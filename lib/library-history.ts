import { db } from "./db"

export interface TaskSummary {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  total: number
  completed: number
  failed: number
  skipped: number
}
export interface TaskHistory {
  batches: TaskSummary[]
  total: number
  page: number
  totalPages: number
}
export interface TaskItem {
  githubRepoId: string
  fullName: string
  htmlUrl: string | null
  status: string
  attempts: number
  error: string | null
}
export interface TaskDetail {
  items: TaskItem[]
  total: number
  page: number
  totalPages: number
}

function pagination(total: number, requested: number, size: number) {
  const totalPages = Math.max(1, Math.ceil(total / size))
  const page = Math.min(
    totalPages,
    Number.isSafeInteger(requested) && requested > 0 ? requested : 1,
  )
  return { total, page, totalPages }
}

export function listTaskHistory(userId: string, requestedPage = 1): TaskHistory {
  const { total } = db
    .prepare("select count(*) as total from library_batches where user_id=?")
    .get(userId) as { total: number }
  const page = pagination(total, requestedPage, 20)
  const batches = db
    .prepare(
      `
    select b.id,b.status,b.created_at as createdAt,b.updated_at as updatedAt,
      count(i.github_repo_id) as total,
      coalesce(sum(i.status='succeeded'),0) as completed,
      coalesce(sum(i.status='failed'),0) as failed,
      coalesce(sum(i.status='skipped'),0) as skipped
    from (select * from library_batches where user_id=? order by created_at desc,id desc limit 20 offset ?) b
    left join library_batch_items i on i.batch_id=b.id
    group by b.id order by b.created_at desc,b.id desc
  `,
    )
    .all(userId, (page.page - 1) * 20) as unknown as TaskSummary[]
  return { ...page, batches }
}

export function getTaskHistory(
  userId: string,
  batchId: string,
  requestedPage = 1,
): TaskDetail | null {
  if (!db.prepare("select 1 from library_batches where id=? and user_id=?").get(batchId, userId))
    return null
  const { total } = db
    .prepare("select count(*) as total from library_batch_items where batch_id=?")
    .get(batchId) as { total: number }
  const page = pagination(total, requestedPage, 50)
  const rows = db
    .prepare(
      `select github_repo_id,snapshot_json,status,attempts,error
    from library_batch_items where batch_id=? order by rowid limit 50 offset ?`,
    )
    .all(batchId, (page.page - 1) * 50) as {
    github_repo_id: string
    snapshot_json: string
    status: string
    attempts: number
    error: string | null
  }[]
  const items = rows.map((row): TaskItem => {
    let name: unknown
    try {
      name = (JSON.parse(row.snapshot_json) as { full_name?: unknown } | null)?.full_name
    } catch {
      /* Older or damaged snapshots still show the GitHub ID. */
    }
    const validName =
      typeof name === "string" && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(name) ? name : null
    return {
      githubRepoId: row.github_repo_id,
      fullName: validName ?? `GitHub 项目 #${row.github_repo_id}`,
      htmlUrl: validName ? `https://github.com/${validName}` : null,
      status: row.status,
      attempts: row.attempts,
      error: row.error,
    }
  })
  return { ...page, items }
}
