"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Star, LogOut } from "lucide-react"
import { signOut } from "@/lib/auth"
import { useUser } from "./providers/user-provider"
import { Button } from "./ui/button"
export function PersonalShell({ children }: { children: React.ReactNode }) {
  const { user } = useUser(),
    path = usePathname()
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <Star className="size-5 text-emerald-700" />
            StarDash
          </Link>
          <nav aria-label="主导航" className="flex flex-wrap gap-1 text-sm">
            {[
              ["/dashboard", "收藏库"],
              ["/settings", "分类与标签"],
              ["/tasks", "任务记录"],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                aria-current={path === href ? "page" : undefined}
                className={`rounded-md px-3 py-2 ${path === href ? "bg-emerald-50 font-medium text-emerald-800" : "text-muted-foreground hover:bg-muted"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">@{user.login}</span>
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
              <LogOut className="size-4" />
              <span className="sr-only sm:not-sr-only">退出</span>
            </Button>
          </div>
        </div>
      </header>
      {children}
    </div>
  )
}
