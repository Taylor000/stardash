"use client"

import { useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { ChevronDown, ChevronUp, ExternalLink, History, RefreshCw } from "lucide-react"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import type { TaskHistory, TaskDetail, TaskSummary } from "@/lib/library-history"

const statusLabels: Record<string, string> = {
  queued: "等待执行",
  running: "执行中",
  paused: "已暂停",
  completed: "已完成",
  partial_failed: "部分失败",
  cancelled: "已取消",
  pending: "待执行",
  succeeded: "成功",
  failed: "失败",
  skipped: "已跳过",
}
function Status({ status }: { status: string }) {
  const color = ["completed", "succeeded"].includes(status)
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : ["partial_failed", "failed"].includes(status)
      ? "border-red-200 bg-red-50 text-red-800"
      : ["paused", "pending", "queued"].includes(status)
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : ""
  return (
    <Badge variant="outline" className={color}>
      {statusLabels[status] ?? status}
    </Badge>
  )
}
async function fetchHistory<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok)
    throw Error(response.status === 401 ? "登录已过期，请重新登录。" : "任务记录加载失败，请重试。")
  return response.json()
}
function timestamp(value: string) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
}
function Pager({
  page,
  totalPages,
  onChange,
  label,
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
  label: string
}) {
  if (totalPages <= 1) return null
  return (
    <nav
      aria-label={`${label}分页`}
      className="flex flex-wrap items-center justify-end gap-3 text-sm"
    >
      <span className="text-muted-foreground">
        第 {page} / {totalPages} 页
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-label={`${label}上一页`}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        上一页
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label={`${label}下一页`}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        下一页
      </Button>
    </nav>
  )
}
function TaskItems({ id }: { id: string }) {
  const [page, setPage] = useState(1)
  const { data, error, mutate } = useSWR<TaskDetail>(
    `/api/library/history?id=${encodeURIComponent(id)}&page=${page}`,
    fetchHistory<TaskDetail>,
    {
      refreshInterval: (data) =>
        data?.items.some((item) => ["pending", "running"].includes(item.status)) ? 5000 : 0,
    },
  )
  return (
    <div id={`task-${id}`} className="border-t bg-muted/20 px-4 py-3 sm:px-5">
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          {error.message}
          <Button variant="outline" size="sm" onClick={() => void mutate()}>
            重试
          </Button>
        </div>
      ) : !data ? (
        <p role="status" className="py-3 text-sm text-muted-foreground">
          加载项目明细…
        </p>
      ) : (
        <>
          <ul aria-label="任务项目明细" className="divide-y">
            {data.items.map((item) => (
              <li key={item.githubRepoId} className="space-y-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  {item.htmlUrl ? (
                    <a
                      href={item.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 break-all text-sm font-medium text-emerald-800 hover:underline"
                    >
                      {item.fullName}
                      <ExternalLink aria-hidden="true" className="ml-1 inline size-3" />
                      <span className="sr-only">（在新标签页打开 GitHub）</span>
                    </a>
                  ) : (
                    <span className="break-all text-sm font-medium">{item.fullName}</span>
                  )}
                  <Status status={item.status} />
                </div>
                <p className="text-xs text-muted-foreground">已尝试 {item.attempts} 次</p>
                {item.error && <p className="break-words text-xs text-amber-900">{item.error}</p>}
              </li>
            ))}
          </ul>
          {!data.items.length && (
            <p className="py-3 text-sm text-muted-foreground">暂无项目明细。</p>
          )}
          <Pager page={data.page} totalPages={data.totalPages} onChange={setPage} label="明细" />
        </>
      )}
    </div>
  )
}
function TaskRow({ task }: { task: TaskSummary }) {
  const [open, setOpen] = useState(false)
  return (
    <article className="overflow-hidden rounded-lg border bg-white">
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-medium">批量取消收藏</h2>
            <Status status={task.status} />
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={`task-${task.id}`}
            onClick={() => setOpen(!open)}
          >
            {open ? "收起明细" : "查看明细"}
            {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>共 {task.total} 项</span>
          <span className="text-emerald-800">成功 {task.completed}</span>
          {task.failed > 0 && <span className="text-red-800">失败 {task.failed}</span>}
          {task.skipped > 0 && <span>跳过 {task.skipped}</span>}
          {task.total - task.completed - task.failed - task.skipped > 0 && (
            <span>待完成 {task.total - task.completed - task.failed - task.skipped}</span>
          )}
        </p>
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>
            创建于 <time dateTime={task.createdAt}>{timestamp(task.createdAt)}</time>
          </span>
          <span>
            更新于 <time dateTime={task.updatedAt}>{timestamp(task.updatedAt)}</time>
          </span>
        </p>
      </div>
      {open && <TaskItems id={task.id} />}
    </article>
  )
}
export function TaskHistoryPage() {
  const [page, setPage] = useState(1)
  const { data, error, isValidating, mutate } = useSWR<TaskHistory>(
    `/api/library/history?page=${page}`,
    fetchHistory<TaskHistory>,
    {
      refreshInterval: (data) =>
        data?.batches.some((task) => ["queued", "running", "paused"].includes(task.status))
          ? 5000
          : 0,
    },
  )
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">任务记录</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            查看批量取消收藏的历史与项目结果，已完成的任务也会保留。
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={isValidating} onClick={() => void mutate()}>
          <RefreshCw
            className={`size-4 ${isValidating ? "animate-spin motion-reduce:animate-none" : ""}`}
          />
          刷新
        </Button>
      </div>
      {error ? (
        <div role="alert" className="rounded-lg border p-5 text-sm text-destructive">
          {error.message}
          <Button className="ml-3" size="sm" variant="outline" onClick={() => void mutate()}>
            重试
          </Button>
        </div>
      ) : !data ? (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          加载任务记录…
        </p>
      ) : !data.total ? (
        <div className="rounded-lg border bg-white px-5 py-12 text-center">
          <History className="mx-auto mb-4 size-8 text-muted-foreground" />
          <h2 className="font-medium">还没有任务记录</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            在收藏库执行批量取消收藏后，任务会保存在这里。
          </p>
          <Button className="mt-5" variant="outline" asChild>
            <Link href="/dashboard">返回收藏库</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>共 {data.total} 个任务，按创建时间倒序</span>
            <Link href="/dashboard" className="text-emerald-800 hover:underline">
              返回收藏库管理进行中的任务
            </Link>
          </div>
          <div className="space-y-4">
            {data.batches.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
          <Pager page={data.page} totalPages={data.totalPages} onChange={setPage} label="任务" />
        </>
      )}
    </main>
  )
}
