"use client"
import { useState } from "react"
import useSWR from "swr"
import { Plus, Trash2, Save } from "lucide-react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import type { UserMetadata } from "@/lib/types"
import {
  createTag,
  createCollection,
  updateTag,
  updateCollection,
  deleteTag,
  deleteCollection,
} from "@/lib/metadata-actions"
import { pickTagColor } from "@/lib/tag-color"
import { toast } from "sonner"

function NameRow({
  name,
  color,
  onSave,
  onDelete,
}: {
  name: string
  color: string
  onSave: (name: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [value, setValue] = useState(name),
    [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch {
      toast.error("操作失败，请重试")
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="flex items-center gap-2 border-t py-3 first:border-t-0"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => onSave(value.trim()))
      }}
    >
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <Input
        aria-label={`编辑 ${name}`}
        maxLength={50}
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-w-0 flex-1"
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={`保存 ${name}`}
        type="submit"
        disabled={busy || !value.trim() || value === name}
      >
        <Save className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`删除 ${name}`}
        type="button"
        disabled={busy}
        onClick={() => {
          if (window.confirm(`删除“${name}”及其本地关联？GitHub 收藏不会被取消。`))
            void run(onDelete)
        }}
      >
        <Trash2 className="size-4 text-muted-foreground" />
      </Button>
    </form>
  )
}
export function PersonalSettings() {
  const { data, mutate, error } = useSWR<UserMetadata>(
    "/api/user/metadata",
    async (url) => {
      const r = await fetch(url)
      if (!r.ok) throw Error("加载失败")
      return r.json()
    },
    { revalidateOnFocus: false },
  )
  const [tag, setTag] = useState(""),
    [collection, setCollection] = useState(""),
    [busy, setBusy] = useState(false)
  const save = async (fn: () => Promise<unknown>) => {
    await fn()
    await mutate()
    toast.success("已保存")
  }
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold">分类与标签</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          在这里维护名称，回到收藏库即可批量分配给项目。
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          加载失败，请刷新页面后重试。
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        {(["collection", "tag"] as const).map((kind) => {
          const isTag = kind === "tag",
            label = isTag ? "标签" : "分类",
            value = isTag ? tag : collection,
            set = isTag ? setTag : setCollection
          return (
            <section key={kind} className="min-w-0 rounded-lg border bg-white p-5">
              <h2 className="mb-4 font-medium">
                {label}{" "}
                <span className="text-sm text-muted-foreground">
                  {isTag ? (data?.tags.length ?? 0) : (data?.collections.length ?? 0)}
                </span>
              </h2>
              <form
                className="mb-3 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!value.trim()) return
                  setBusy(true)
                  try {
                    await save(() =>
                      isTag
                        ? createTag(value.trim(), pickTagColor(value.trim()))
                        : createCollection(value.trim(), "📁", "#008a1c"),
                    )
                    set("")
                  } catch {
                    toast.error("创建失败，请检查是否重名")
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Input
                  aria-label={`新${label}名称`}
                  placeholder={`新${label}名称`}
                  maxLength={50}
                  required
                  value={value}
                  onChange={(e) => set(e.target.value)}
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label={`添加${label}`}
                  disabled={busy || !value.trim()}
                >
                  <Plus className="size-4" />
                </Button>
              </form>
              {!data ? (
                <p className="py-6 text-sm text-muted-foreground">加载中…</p>
              ) : isTag ? (
                data.tags.length ? (
                  data.tags.map((t) => (
                    <NameRow
                      key={t.id}
                      name={t.label}
                      color={t.color}
                      onSave={(name) => save(() => updateTag(t.id, name, t.color))}
                      onDelete={() => save(() => deleteTag(t.id))}
                    />
                  ))
                ) : (
                  <p className="py-6 text-sm text-muted-foreground">还没有标签。</p>
                )
              ) : data.collections.length ? (
                data.collections.map((c) => (
                  <NameRow
                    key={c.id}
                    name={c.name}
                    color={c.color}
                    onSave={(name) => save(() => updateCollection(c.id, name, c.emoji, c.color))}
                    onDelete={() => save(() => deleteCollection(c.id))}
                  />
                ))
              ) : (
                <p className="py-6 text-sm text-muted-foreground">还没有分类。</p>
              )}
            </section>
          )
        })}
      </div>
    </main>
  )
}
