"use client"
import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import useSWR from "swr"
import {
  RefreshCw,
  Search,
  Pin,
  ExternalLink,
  LayoutGrid,
  List,
  Download,
  StarOff,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Badge } from "./ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog"
import { RepoCard } from "./repo-card"
import { RepoGridSkeleton } from "./repo-grid"
import { PersonalDetail } from "./personal-detail"
import { useUser } from "./providers/user-provider"
import { useStarredRepos, type StarredReposResponse } from "@/lib/use-starred-repos"
import { setCachedRepos } from "@/lib/repo-cache"
import {
  sortLibrary,
  selectPage,
  displayDate,
  csvCell,
  LIBRARY_SORTS,
  type LibrarySort,
} from "@/lib/personal-library"
import type { StarredRepo, UserMetadata } from "@/lib/types"
import { toast } from "sonner"

type Filters = {
  search: string
  language: string
  health: string
  tag: string
  collection: string
  sort: LibrarySort
  pageSize: number
}
const DEFAULT: Filters = {
  search: "",
  language: "",
  health: "",
  tag: "",
  collection: "",
  sort: "starred-desc",
  pageSize: 100,
}
type Job = {
  id: string
  status: string
  total: number
  completed: number
  failed: number
  errors: string[]
  reauthRequired?: boolean
}
const statusLabels: Record<string, string> = {
  queued: "等待执行",
  running: "正在执行",
  paused: "已暂停",
  completed: "已完成",
  partial_failed: "部分失败",
  cancelled: "已取消",
}
const selectClass =
  "h-9 min-w-0 rounded-md border border-input bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
async function readJson(url: string) {
  const r = await fetch(url)
  if (!r.ok) throw Error(r.status === 401 ? "登录已失效，请重新登录" : "加载失败")
  return r.json()
}
async function post(body: unknown) {
  const r = await fetch("/api/library/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await r.json()
  if (!r.ok) throw Error(data.error ?? "操作失败")
  return data
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function Check({
  checked,
  mixed,
  onChange,
  label,
}: {
  checked: boolean
  mixed?: boolean
  onChange: () => void
  label: string
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = Boolean(mixed)
      }}
      onChange={onChange}
      className="size-4 shrink-0 cursor-pointer accent-emerald-700"
    />
  )
}

export function PersonalDashboard() {
  const { user, reauthenticate } = useUser(),
    params = useSearchParams(),
    router = useRouter()
  const [filters, setFilters] = useState<Filters>(DEFAULT),
    [view, setView] = useState<"grid" | "list">("grid"),
    [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [opened, setOpened] = useState<string | null>(null),
    [busy, setBusy] = useState(false)
  const [action, setAction] = useState("pin"),
    [target, setTarget] = useState("")
  const [confirm, setConfirm] = useState<StarredRepo[] | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [allowPinned, setAllowPinned] = useState(false)
  const idempotency = useRef("")
  const [observedAt] = useState(() => Date.now())
  const { data, mutate, refresh, isLoading, isRefreshing, error } = useStarredRepos(user.id)
  const {
    data: metadata,
    mutate: mutateMetadata,
    error: metadataError,
  } = useSWR<UserMetadata>("/api/user/metadata", readJson, { revalidateOnFocus: false })
  const { data: jobs, mutate: mutateJobs } = useSWR<{ batches: Job[] }>(
    "/api/library/batch",
    readJson,
    { refreshInterval: 2000, revalidateOnFocus: false },
  )
  const active =
    jobs?.batches.some((j) => ["queued", "running", "paused"].includes(j.status)) ?? false
  useEffect(() => {
    try {
      const preferences = JSON.parse(localStorage.getItem(`stardash-personal-${user.id}`) ?? "{}")
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilters((f) => ({
        ...f,
        sort: preferences.sort in LIBRARY_SORTS ? preferences.sort : f.sort,
        pageSize:
          preferences.pageSize === 50 && preferences.pageSizeVersion !== 2
            ? 100
            : [20, 50, 100, 200].includes(preferences.pageSize)
              ? preferences.pageSize
              : f.pageSize,
      }))
      if (preferences.view === "list" || preferences.view === "grid") setView(preferences.view)
    } catch {}
  }, [user.id])
  const repos = useMemo(
    () =>
      (data?.repos ?? []).map((repo) => {
        const m = metadata?.repoMeta[repo.id]
        return m
          ? {
              ...repo,
              isPinned: m.isPinned,
              notes: m.notes,
              tags: metadata!.tags.filter((t) => m.tagIds.includes(t.id)),
              collections: m.collectionIds,
            }
          : repo
      }),
    [data?.repos, metadata],
  )
  const filtered = useMemo(
    () =>
      sortLibrary(
        repos.filter((r) => {
          const q = filters.search.trim().toLowerCase()
          return (
            (!q ||
              [r.fullName, r.description, r.notes, ...r.tags.map((t) => t.label)].some((s) =>
                s?.toLowerCase().includes(q),
              )) &&
            (!filters.language || r.language === filters.language) &&
            (!filters.tag || r.tags.some((t) => t.id === filters.tag)) &&
            (!filters.collection ||
              (filters.collection === "none"
                ? !r.collections.length
                : r.collections.includes(filters.collection))) &&
            (!filters.health ||
              (filters.health === "pinned"
                ? r.isPinned
                : filters.health === "archived"
                  ? r.archived
                  : filters.health === "dormant"
                    ? Boolean(r.pushedAt && observedAt - Date.parse(r.pushedAt) > 180 * 86400000)
                    : true))
          )
        }),
        filters.sort,
      ),
    [repos, filters, observedAt],
  )
  const pages = Math.max(1, Math.ceil(filtered.length / filters.pageSize)),
    safePage = Math.min(page, pages)
  const visible = selectPage(filtered, safePage, filters.pageSize),
    languages = [
      ...new Set(repos.map((r) => r.language).filter((s): s is string => Boolean(s))),
    ].sort()
  const chosen = repos.filter((r) => selected.has(r.id)),
    detail = repos.find((r) => r.id === (opened ?? params.get("repo")))
  const pageChecked = visible.length > 0 && visible.every((r) => selected.has(r.id))
  const jobFingerprint =
    jobs?.batches.map((j) => `${j.id}:${j.completed}:${j.status}`).join("|") ?? ""
  const previousJobs = useRef("")
  const reloadLocal = useCallback(async () => {
    const latest = (await readJson("/api/github/starred?cache=local")) as StarredReposResponse
    setCachedRepos(user.id, latest.repos)
    await mutate(latest, { revalidate: false })
    await mutateMetadata()
  }, [mutate, mutateMetadata, user.id])
  useEffect(() => {
    if (!jobFingerprint || previousJobs.current === jobFingerprint) return
    previousJobs.current = jobFingerprint
    void reloadLocal().catch(() => {})
  }, [jobFingerprint, reloadLocal])
  const change = (patch: Partial<Filters>) => {
    setFilters((f) => {
      const next = { ...f, ...patch }
      localStorage.setItem(
        `stardash-personal-${user.id}`,
        JSON.stringify({ sort: next.sort, pageSize: next.pageSize, pageSizeVersion: 2, view }),
      )
      return next
    })
    setPage(1)
    if (Object.keys(patch).some((k) => k !== "sort" && k !== "pageSize")) {
      if (selected.size) toast.info("筛选已改变，已清空选择")
      setSelected(new Set())
    }
  }
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const selectVisible = () =>
    setSelected((current) => {
      const next = new Set(current)
      for (const r of visible) {
        if (pageChecked) next.delete(r.id)
        else next.add(r.id)
      }
      return next
    })
  const run = async (kind: string, targetId?: string, ids = [...selected]) => {
    setBusy(true)
    try {
      await post({ action: kind, ids, targetId })
      await mutateMetadata()
      toast.success(`已更新 ${ids.length} 个项目`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const preview = (items: StarredRepo[]) => {
    setConfirm([...items])
    setConfirmation("")
    setAllowPinned(false)
    idempotency.current = crypto.randomUUID()
  }
  const exportRepos = (type: "json" | "csv") => {
    const items = chosen.length ? chosen : filtered
    const content =
      type === "json"
        ? JSON.stringify(items, null, 2)
        : "\uFEFF" +
          [
            ["仓库", "描述", "语言", "Stars", "Forks", "收藏时间", "推送时间", "标签", "备注"],
            ...items.map((r) => [
              r.fullName,
              r.description,
              r.language,
              r.stargazersCount,
              r.forksCount,
              r.starredAt,
              r.pushedAt,
              r.tags.map((t) => t.label).join(";"),
              r.notes,
            ]),
          ]
            .map((row) => row.map(csvCell).join(","))
            .join("\r\n")
    download(
      `stars-${new Date().toISOString().slice(0, 10)}.${type}`,
      content,
      type === "json" ? "application/json" : "text/csv;charset=utf-8",
    )
  }
  const sortHeader = (field: string) =>
    change({
      sort: (filters.sort === `${field}-desc` ? `${field}-asc` : `${field}-desc`) as LibrarySort,
    })
  return (
    <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            我的收藏库{" "}
            <span className="ml-2 text-base font-normal text-muted-foreground">
              {repos.length.toLocaleString()}
            </span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {data?.lastSynced
              ? `上次同步：${displayDate(data.lastSynced)}`
              : "连接 GitHub 后同步收藏"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportRepos("json")}>
            <Download className="size-4" />
            导出 JSON
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportRepos("csv")}>
            CSV
          </Button>
          <Button
            size="sm"
            disabled={isRefreshing || busy || active}
            onClick={() => refresh({ manual: true }).catch(() => {})}
          >
            <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "同步中…" : "同步收藏"}
          </Button>
        </div>
      </div>
      {(error || metadataError) && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <span>{error?.message ?? metadataError?.message}；已有数据仍可查看。</span>
          <Button variant="outline" size="sm" onClick={() => reauthenticate()}>
            重新登录
          </Button>
        </div>
      )}
      <section aria-label="搜索和筛选" className="space-y-3 rounded-lg border bg-white p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 sm:flex">
          <div className="relative col-span-2 min-w-0 flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="搜索项目"
              placeholder="搜索名称、描述、标签或备注…"
              value={filters.search}
              onChange={(e) => change({ search: e.target.value })}
              className="h-9 pl-9"
            />
          </div>
          <select
            aria-label="排序方式"
            value={filters.sort}
            onChange={(e) => change({ sort: e.target.value as LibrarySort })}
            className={`${selectClass} sm:w-52`}
          >
            {Object.entries(LIBRARY_SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <div className="flex gap-1 rounded-md border p-0.5">
            {(["grid", "list"] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={view === mode ? "secondary" : "ghost"}
                aria-label={mode === "grid" ? "卡片视图" : "表格视图"}
                aria-pressed={view === mode}
                onClick={() => {
                  setView(mode)
                  localStorage.setItem(
                    `stardash-personal-${user.id}`,
                    JSON.stringify({
                      sort: filters.sort,
                      pageSize: filters.pageSize,
                      pageSizeVersion: 2,
                      view: mode,
                    }),
                  )
                }}
              >
                {mode === "grid" ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
              </Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
          <select
            aria-label="语言筛选"
            value={filters.language}
            onChange={(e) => change({ language: e.target.value })}
            className={selectClass}
          >
            <option value="">全部语言</option>
            {languages.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <select
            aria-label="项目状态"
            value={filters.health}
            onChange={(e) => change({ health: e.target.value })}
            className={selectClass}
          >
            <option value="">全部状态</option>
            <option value="pinned">重点收藏</option>
            <option value="archived">已归档</option>
            <option value="dormant">180 天未推送</option>
          </select>
          <select
            aria-label="分类筛选"
            value={filters.collection}
            onChange={(e) => change({ collection: e.target.value })}
            className={selectClass}
          >
            <option value="">全部分类</option>
            <option value="none">未分类</option>
            {metadata?.collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="标签筛选"
            value={filters.tag}
            onChange={(e) => change({ tag: e.target.value })}
            className={selectClass}
          >
            <option value="">全部标签</option>
            {metadata?.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {Object.entries(filters).some(([k, v]) => !["sort", "pageSize"].includes(k) && v) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => change({ ...DEFAULT, sort: filters.sort, pageSize: filters.pageSize })}
            >
              重置筛选
            </Button>
          )}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <Check
            checked={pageChecked}
            mixed={!pageChecked && visible.some((r) => selected.has(r.id))}
            onChange={selectVisible}
            label="全选本页"
          />
          本页全选
        </label>
        <button
          className="text-emerald-800 hover:underline disabled:opacity-50"
          disabled={!filtered.length}
          onClick={() => setSelected(new Set(filtered.map((r) => r.id)))}
        >
          选择筛选结果（{filtered.length}）
        </button>
        <span className="text-muted-foreground">已选 {selected.size} 项</span>
        {selected.size > 0 && (
          <button
            onClick={() => setSelected(new Set())}
            className="text-muted-foreground hover:underline"
          >
            清空选择
          </button>
        )}
      </div>
      {selected.size > 0 && (
        <section
          aria-label="批量操作"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3"
        >
          <select
            aria-label="批量操作类型"
            value={action}
            onChange={(e) => {
              setAction(e.target.value)
              setTarget("")
            }}
            className={selectClass}
          >
            <option value="pin">标记重点</option>
            <option value="unpin">取消重点</option>
            <option value="add-tag">添加标签</option>
            <option value="remove-tag">移除标签</option>
            <option value="add-collection">添加分类</option>
            <option value="remove-collection">移除分类</option>
          </select>
          {action.includes("tag") && (
            <select
              aria-label="目标标签"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={selectClass}
            >
              <option value="">选择标签</option>
              {metadata?.tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
          {action.includes("collection") && (
            <select
              aria-label="目标分类"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={selectClass}
            >
              <option value="">选择分类</option>
              {metadata?.collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            disabled={busy || (!["pin", "unpin"].includes(action) && !target)}
            onClick={() => run(action, target)}
          >
            {busy ? "处理中…" : "应用到选中项"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto text-destructive"
            disabled={active || busy}
            onClick={() => preview(chosen)}
          >
            <StarOff className="size-4" />
            取消收藏
          </Button>
        </section>
      )}
      {jobs?.batches.some((j) =>
        ["queued", "running", "paused", "partial_failed"].includes(j.status),
      ) && (
        <section aria-label="批量任务进度" className="space-y-3 rounded-lg border bg-white p-4">
          {jobs.batches
            .filter((j) => ["queued", "running", "paused", "partial_failed"].includes(j.status))
            .map((job) => (
              <div key={job.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">取消收藏 · {statusLabels[job.status]}</span>
                  <span className="text-muted-foreground">
                    成功 {job.completed} / {job.total}
                    {job.failed ? `，失败 ${job.failed}` : ""}
                  </span>
                  <div className="ml-auto flex gap-2">
                    {(job.status === "paused"
                      ? ["resume", "cancel"]
                      : job.status === "partial_failed"
                        ? ["retry"]
                        : ["pause", "cancel"]
                    ).map((a) => (
                      <Button
                        key={a}
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await post({ batchId: job.id, action: a })
                            await mutateJobs()
                          } catch (e) {
                            toast.error((e as Error).message)
                          }
                        }}
                      >
                        {
                          {
                            resume: "继续",
                            cancel: "停止剩余项",
                            retry: "重试失败项",
                            pause: "暂停",
                          }[a]
                        }
                      </Button>
                    ))}
                  </div>
                </div>
                <progress
                  aria-label="任务完成进度"
                  value={job.completed + job.failed}
                  max={job.total}
                  className="h-2 w-full accent-emerald-700"
                />
                {job.errors.slice(0, 2).map((e, i) => (
                  <p key={i} className="text-xs text-amber-800">
                    {e}
                  </p>
                ))}
                {job.reauthRequired && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" variant="outline" asChild>
                      <a href="/auth/login?reauth=1&next=%2Fdashboard">更换授权（个人令牌）</a>
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <a href="/api/auth/github/start?next=%2Fdashboard">重新授权 GitHub</a>
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      更新授权后点击“继续”，原来的选择和已完成进度会保留。
                    </span>
                  </div>
                )}
              </div>
            ))}
        </section>
      )}
      {isLoading ? (
        <RepoGridSkeleton count={8} />
      ) : !filtered.length ? (
        <div className="rounded-lg border border-dashed bg-white py-20 text-center">
          <p className="font-medium">{repos.length ? "没有符合条件的项目" : "还没有收藏项目"}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {repos.length ? "调整搜索或筛选条件试试。" : "点击同步收藏，加载你的 GitHub Stars。"}
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((r) => (
            <RepoCard
              key={r.id}
              repo={r}
              onClick={() => setOpened(r.id)}
              selected={selected.has(r.id)}
              onSelect={() => toggle(r.id)}
              onRemoveStar={(r) => {
                if (active) {
                  toast.info("请先完成当前任务")
                  return
                }
                preview([r])
              }}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="p-3">
                  <Check
                    checked={pageChecked}
                    mixed={!pageChecked && visible.some((r) => selected.has(r.id))}
                    onChange={selectVisible}
                    label="全选当前页"
                  />
                </th>
                {[
                  ["name", "项目"],
                  ["", "语言"],
                  ["stars", "Stars"],
                  ["forks", "Forks"],
                  ["starred", "收藏时间"],
                  ["pushed", "最近推送"],
                  ["created", "创建时间"],
                  ["updated", "元数据更新"],
                ].map(([field, label]) => (
                  <th key={label} className="whitespace-nowrap p-3 font-medium">
                    {field ? (
                      <button onClick={() => sortHeader(field)}>
                        {label}{" "}
                        {filters.sort.startsWith(field + "-")
                          ? filters.sort.endsWith("desc")
                            ? "↓"
                            : "↑"
                          : "↕"}
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.id}
                  className={`border-b last:border-0 hover:bg-muted/20 ${selected.has(r.id) ? "bg-emerald-50/50" : ""}`}
                >
                  <td className="p-3">
                    <Check
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      label={`选择 ${r.fullName}`}
                    />
                  </td>
                  <td className="max-w-[360px] p-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setOpened(r.id)}
                        className="truncate text-left font-mono font-medium hover:text-emerald-800"
                      >
                        {r.fullName}
                      </button>
                      {r.isPinned && <Pin className="size-3 shrink-0 text-emerald-700" />}
                      <a
                        href={`https://github.com/${r.fullName}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`在 GitHub 打开 ${r.fullName}`}
                      >
                        <ExternalLink className="size-3 text-muted-foreground" />
                      </a>
                    </div>
                    <p
                      className="mt-1 line-clamp-1 text-xs text-muted-foreground"
                      title={r.description}
                    >
                      {r.description}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.archived && <Badge variant="outline">已归档</Badge>}
                      {r.tags.slice(0, 3).map((t) => (
                        <Badge variant="secondary" key={t.id}>
                          {t.label}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="p-3">{r.language ?? "—"}</td>
                  <td className="p-3 tabular-nums">{r.stargazersCount.toLocaleString()}</td>
                  <td className="p-3 tabular-nums">{r.forksCount.toLocaleString()}</td>
                  {[r.starredAt, r.pushedAt, r.createdAt, r.updatedAt].map((v, i) => (
                    <td key={i} className="whitespace-nowrap p-3 text-xs text-muted-foreground">
                      {displayDate(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          共 {filtered.length} 项 · 第 {safePage} / {pages} 页
        </span>
        <div className="flex items-center gap-2">
          <select
            aria-label="每页项目数"
            className={selectClass}
            value={filters.pageSize}
            onChange={(e) => change({ pageSize: Number(e.target.value) })}
          >
            {[20, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n} 项 / 页
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            aria-label="上一页"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="下一页"
            disabled={safePage >= pages}
            onClick={() => setPage(safePage + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </footer>
      {detail && (
        <PersonalDetail
          key={detail.id}
          repo={detail}
          metadata={metadata}
          onClose={() => {
            setOpened(null)
            if (params.has("repo")) router.replace("/dashboard", { scroll: false })
          }}
          onChanged={mutateMetadata}
          onBatch={(kind, id) => run(kind, id, [detail.id])}
        />
      )}
      <Dialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null)
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>取消 {confirm?.length ?? 0} 个项目的收藏？</DialogTitle>
            <DialogDescription>
              这会真实取消 GitHub Star。重新收藏时，GitHub
              会生成新的收藏时间。项目资料将先保存为操作快照。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-52 overflow-y-auto rounded-md border p-3 text-sm">
            {confirm?.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-1">
                <span className="break-all font-mono">{r.fullName}</span>
                {r.isPinned && <Badge variant="outline">重点</Badge>}
              </div>
            ))}
          </div>
          {confirm?.some((r) => r.isPinned) && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowPinned}
                onChange={(e) => setAllowPinned(e.target.checked)}
                className="size-4 accent-emerald-700"
              />
              同时取消这些重点收藏
            </label>
          )}
          {(confirm?.length ?? 0) > 100 && (
            <label className="space-y-2 text-sm">
              输入项目数量 {confirm?.length} 确认
              <Input
                aria-label="确认取消数量"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                inputMode="numeric"
              />
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
              保留收藏
            </Button>
            <Button
              variant="destructive"
              disabled={
                busy ||
                !confirm?.length ||
                (confirm.some((r) => r.isPinned) && !allowPinned) ||
                (confirm.length > 100 && confirmation !== String(confirm.length))
              }
              onClick={async () => {
                if (!confirm) return
                setBusy(true)
                try {
                  await post({
                    action: "unstar",
                    ids: confirm.map((r) => r.id),
                    confirmation: confirm.length,
                    idempotencyKey: idempotency.current,
                    allowPinned,
                  })
                  setConfirm(null)
                  setSelected(new Set())
                  await mutateJobs()
                  toast.success("任务已创建，可在页面查看进度")
                } catch (e) {
                  toast.error((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? "创建任务中…" : "确认取消收藏"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
