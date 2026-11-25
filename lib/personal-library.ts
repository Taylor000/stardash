import type { StarredRepo } from "./types"

export const LIBRARY_SORTS = {
  "starred-desc": "收藏时间 · 最新",
  "starred-asc": "收藏时间 · 最早",
  "pushed-desc": "最近推送 · 最新",
  "pushed-asc": "最近推送 · 最早",
  "created-desc": "创建时间 · 最新",
  "created-asc": "创建时间 · 最早",
  "updated-desc": "元数据更新 · 最新",
  "updated-asc": "元数据更新 · 最早",
  "stars-desc": "Stars · 从多到少",
  "stars-asc": "Stars · 从少到多",
  "forks-desc": "Forks · 从多到少",
  "forks-asc": "Forks · 从少到多",
  "name-asc": "名称 · A → Z",
  "name-desc": "名称 · Z → A",
} as const
export type LibrarySort = keyof typeof LIBRARY_SORTS

export function sortLibrary(repos: StarredRepo[], sort: string): StarredRepo[] {
  const [field, direction] = sort.split("-")
  const sign = direction === "asc" ? 1 : -1
  const dateField = {
    starred: "starredAt",
    pushed: "pushedAt",
    created: "createdAt",
    updated: "updatedAt",
  } as const
  return [...repos].sort((a, b) => {
    let result = 0
    if (field in dateField) {
      const key = dateField[field as keyof typeof dateField]
      const av = Date.parse(a[key] ?? ""),
        bv = Date.parse(b[key] ?? "")
      if (!Number.isFinite(av) || !Number.isFinite(bv))
        result = Number(!Number.isFinite(av)) - Number(!Number.isFinite(bv))
      else result = (av - bv) * sign
    } else if (field === "stars" || field === "forks") {
      const key = field === "stars" ? "stargazersCount" : "forksCount"
      result = (a[key] - b[key]) * sign
    } else if (field === "name") result = a.fullName.localeCompare(b.fullName) * sign
    return result || a.id.localeCompare(b.id, undefined, { numeric: true })
  })
}
export function selectPage<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice((Math.max(1, page) - 1) * pageSize, Math.max(1, page) * pageSize)
}
export function csvCell(value: unknown): string {
  let s = String(value ?? "")
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}
export function displayDate(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "未知"
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value))
}
