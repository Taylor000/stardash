"use client"
import { useState } from "react"
import useSWR from "swr"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ExternalLink, Pin } from "lucide-react"
import { Button } from "./ui/button"
import { Textarea } from "./ui/textarea"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet"
import { updateRepoNotes } from "@/lib/metadata-actions"
import { displayDate } from "@/lib/personal-library"
import type { StarredRepo, UserMetadata } from "@/lib/types"
import { toast } from "sonner"

export function PersonalDetail({
  repo,
  metadata,
  onClose,
  onChanged,
  onBatch,
}: {
  repo: StarredRepo
  metadata?: UserMetadata
  onClose: () => void
  onChanged: () => Promise<unknown>
  onBatch: (action: string, targetId?: string) => Promise<void>
}) {
  const [notes, setNotes] = useState(repo.notes ?? ""),
    [saving, setSaving] = useState(false)
  const meta = metadata?.repoMeta[repo.id]
  const { data, error, isLoading } = useSWR<{ readme: string | null }>(
    `/api/github/readme?owner=${encodeURIComponent(repo.owner)}&repo=${encodeURIComponent(repo.name)}`,
    async (url) => {
      const r = await fetch(url)
      if (!r.ok) throw Error("无法加载 README")
      return r.json()
    },
    { revalidateOnFocus: false },
  )
  const repoUrl = `https://github.com/${repo.owner}/${repo.name}`
  const asset = (src: string) =>
    /^(https?:|data:)/i.test(src)
      ? src
      : `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/HEAD/${src.replace(/^\.\//, "").replace(/^\//, "")}`
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b p-6 pr-12">
          <SheetTitle className="break-all font-mono">{repo.fullName}</SheetTitle>
          <SheetDescription>{repo.description || "暂无项目描述"}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 p-6">
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href={repoUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                GitHub
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onBatch(repo.isPinned ? "unpin" : "pin")}
            >
              <Pin className="size-4" />
              {repo.isPinned ? "取消重点" : "标记重点"}
            </Button>
            {repo.archived && <span className="self-center text-sm text-amber-700">已归档</span>}
          </div>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
            {[
              ["语言", repo.language ?? "未知"],
              ["许可证", repo.license ?? "未知"],
              ["Stars", repo.stargazersCount.toLocaleString()],
              ["Forks", repo.forksCount.toLocaleString()],
              ["收藏时间", displayDate(repo.starredAt)],
              ["最近推送", displayDate(repo.pushedAt)],
              ["创建时间", displayDate(repo.createdAt)],
              ["元数据更新", displayDate(repo.updatedAt)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1">{value}</dd>
              </div>
            ))}
          </dl>
          <section className="space-y-3">
            <h2 className="text-sm font-medium">分类与标签</h2>
            <div className="flex flex-wrap gap-2">
              {repo.tags.map((t) => (
                <Button
                  size="sm"
                  variant="outline"
                  key={t.id}
                  onClick={() => onBatch("remove-tag", t.id)}
                  title="点击移除标签"
                >
                  {t.label} ×
                </Button>
              ))}
              {repo.collections.map((id) => (
                <Button
                  size="sm"
                  variant="outline"
                  key={id}
                  onClick={() => onBatch("remove-collection", id)}
                  title="点击移除分类"
                >
                  {metadata?.collections.find((c) => c.id === id)?.name ?? "分类"} ×
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="添加标签"
                className="h-9 min-w-0 rounded-md border bg-white px-2 text-sm"
                value=""
                onChange={(e) => {
                  if (e.target.value) void onBatch("add-tag", e.target.value)
                }}
              >
                <option value="">添加标签…</option>
                {metadata?.tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="添加分类"
                className="h-9 min-w-0 rounded-md border bg-white px-2 text-sm"
                value=""
                onChange={(e) => {
                  if (e.target.value) void onBatch("add-collection", e.target.value)
                }}
              >
                <option value="">添加分类…</option>
                {metadata?.collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </section>
          <section className="space-y-2">
            <label htmlFor="repo-notes" className="text-sm font-medium">
              我的备注
            </label>
            <Textarea
              id="repo-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={5000}
              placeholder="记录收藏原因或使用心得…"
            />
            <Button
              size="sm"
              disabled={saving || !meta || notes === (repo.notes ?? "")}
              onClick={async () => {
                if (!meta) return
                setSaving(true)
                try {
                  await updateRepoNotes(meta.dbId, notes)
                  await onChanged()
                  toast.success("备注已保存")
                } catch {
                  toast.error("保存失败，请重试")
                } finally {
                  setSaving(false)
                }
              }}
            >
              {saving ? "保存中…" : "保存备注"}
            </Button>
          </section>
          <section className="min-w-0 border-t pt-5">
            <h2 className="mb-4 font-medium">README</h2>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">正在加载…</p>
            ) : error ? (
              <p className="text-sm text-destructive">README 加载失败，可前往 GitHub 查看。</p>
            ) : (
              <div className="prose prose-sm max-w-none break-words prose-pre:overflow-x-auto prose-img:max-w-full prose-a:text-emerald-700">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={
                          href?.startsWith("http") ? href : `${repoUrl}/blob/HEAD/${href ?? ""}`
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        {children}
                      </a>
                    ),
                    img: ({ src, alt }) => {
                      return (
                        // README 图片来自用户的 GitHub 项目，按原始比例展示。
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={typeof src === "string" ? asset(src) : undefined}
                          alt={alt ?? ""}
                          loading="lazy"
                        />
                      )
                    },
                  }}
                >
                  {data?.readme ?? "暂无 README"}
                </ReactMarkdown>
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
