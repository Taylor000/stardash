"use client"

import { Star, GitFork, Clock, Pin, StickyNote, FolderPlus, MoreHorizontal } from "lucide-react"
import { RepoHealthBadges } from "./repo-health-badges"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StarredRepo, STATUS_LABELS } from "@/lib/types"
import { formatDistanceToNow } from "date-fns"
import { cn } from "@/lib/utils"
import { useEffect, useState } from "react"
import { displayDate } from "@/lib/personal-library"
import { zhCN } from "date-fns/locale"

interface RepoCardProps {
  repo: StarredRepo
  onClick: () => void
  onRemoveStar?: (repo: StarredRepo) => void
  selected?: boolean
  onSelect?: () => void
}

function formatNumber(num: number): string {
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, "") + "k"
  }
  return num.toString()
}

export function RepoCard({ repo, onClick, onRemoveStar,selected,onSelect }: RepoCardProps) {
  const statusConfig = repo.status ? STATUS_LABELS[repo.status] : null
  const [timeString, setTimeString] = useState("recently")

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTimeString(Number.isFinite(Date.parse(repo.pushedAt))?formatDistanceToNow(new Date(repo.pushedAt), { addSuffix: true,locale:zhCN }):"未知")
  }, [repo.pushedAt])

  return (
    <div className="h-full">
      <Card
        className={cn(
          "group relative cursor-pointer transition-all duration-200 h-full py-0 overflow-hidden",
          "hover:border-muted-foreground/30 hover:bg-card/80",
          "border-border bg-card",
          selected && "ring-2 ring-emerald-600 border-emerald-600",
        )}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();onClick()}}}
      >
        <CardContent className="p-4 h-full flex flex-col">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarImage src={repo.avatarUrl} alt={repo.owner} />
                <AvatarFallback className="text-xs">{repo.owner[0].toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{repo.owner}</p>
                <h3 className="font-mono font-medium text-sm truncate">{repo.name}</h3>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* Health badges - visible by default, hide on hover */}
              <div className="group-hover:hidden flex items-center gap-1">
                <RepoHealthBadges repo={repo} size="sm" />
              </div>
              {repo.isPinned && <Pin className="h-3 w-3 text-accent fill-accent" />}
              {/* Drag handle and menu - hidden by default, show on hover */}
              {onSelect ? <input type="checkbox" aria-label={`选择 ${repo.fullName}`} checked={selected??false} onClick={e=>e.stopPropagation()} onChange={onSelect} className="size-4 cursor-pointer accent-emerald-700"/> : <button onClick={e=>{e.stopPropagation();onClick()}} aria-label="查看项目详情" className="size-6 text-muted-foreground">
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="5" cy="4" r="1.5" />
                  <circle cx="11" cy="4" r="1.5" />
                  <circle cx="5" cy="8" r="1.5" />
                  <circle cx="11" cy="8" r="1.5" />
                  <circle cx="5" cy="12" r="1.5" />
                  <circle cx="11" cy="12" r="1.5" />
                </svg>
              </button>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 flex"
                    aria-label={`项目操作 ${repo.fullName}`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onSelect={onClick}>
                    <StickyNote className="mr-2 h-4 w-4" />
                    查看 / 编辑备注
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onClick}>
                    <FolderPlus className="mr-2 h-4 w-4" />
                    管理分类与标签
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onClick}>
                    <Pin className="mr-2 h-4 w-4" />
                    {repo.isPinned ? "查看重点收藏" : "标记重点"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => onRemoveStar?.(repo)}
                  >
                    取消收藏
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Description - fixed height area */}
          <div className="mt-3 flex-1 min-h-[2.75rem]">
            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
              {repo.description || "暂无项目描述"}
            </p>
          </div>

          {/* Tags + Topics */}
          <div className="mt-3 min-h-5">
            {(repo.tags.length > 0 || repo.topics.length > 0) && (
              <div className="flex flex-wrap gap-1">
                {repo.tags.slice(0, 3).map((tag) => (
                  <Badge
                    key={tag.id}
                    variant="outline"
                    className="text-xs px-1.5 py-0 h-5 border-0"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.label}
                  </Badge>
                ))}
                {repo.topics.slice(0, 3 - Math.min(repo.tags.length, 3)).map((topic) => (
                  <Badge
                    key={topic}
                    variant="secondary"
                    className="text-xs px-1.5 py-0 h-5 font-normal"
                  >
                    {topic}
                  </Badge>
                ))}
                {repo.tags.length + repo.topics.length > 3 && (
                  <Badge
                    variant="outline"
                    className="text-xs px-1.5 py-0 h-5 text-muted-foreground/50 border-border/40"
                  >
                    +{repo.tags.length + repo.topics.length - 3}
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* Footer - always at bottom */}
          <div className="mt-4 pt-3 border-t border-border/50">
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {repo.language && (
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: repo.languageColor || "#64748b" }}
                    />
                    <span>{repo.language}</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Star className="h-3 w-3" />
                  <span>{formatNumber(repo.stargazersCount)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <GitFork className="h-3 w-3" />
                  <span>{formatNumber(repo.forksCount)}</span>
                </div>
              </div>

              {statusConfig && (
                <Badge
                  variant="outline"
                  className={cn("text-xs px-1.5 py-0 h-5", statusConfig.color)}
                >
                  {statusConfig.label}
                </Badge>
              )}
            </div>

            {/* Last Updated */}
            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground/60">
              <Clock className="h-3 w-3" />
              <span>推送：{timeString}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">收藏：{displayDate(repo.starredAt)}</div>
            {repo.notes&&<p className="mt-2 line-clamp-1 text-xs text-muted-foreground" title={repo.notes}>备注：{repo.notes}</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
