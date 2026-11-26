import { AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { GitHubIcon } from "@/components/icons/github-icon"
import { PatLoginForm } from "@/components/pat-login-form"
import { getGitHubApp } from "@/lib/github-app"
import { safeNext } from "@/lib/safe-next"
import { getUser } from "@/lib/auth"
import { redirect } from "next/navigation"

const ERRORS: Record<string, string> = {
  state: "That sign-in link expired. Try again.",
  manifest: "GitHub did not finish creating the app. Try again.",
  access_denied: "You cancelled the GitHub authorization.",
  owner: "This instance already has an owner. Sign in with their token first to connect GitHub.",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; reauth?: string }>
}) {
  const { next: rawNext, error, reauth } = await searchParams
  const replacing = reauth === "1"
  if ((await getUser()) && !replacing) redirect("/dashboard")
  const next = safeNext(rawNext)
  const configured = Boolean(getGitHubApp())
  const connectHref = `/api/auth/github/${configured ? "start" : "setup"}?next=${encodeURIComponent(next)}`

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <GitHubIcon className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">
            {replacing ? "更新 GitHub 授权" : "我的收藏库"}
          </CardTitle>
          <CardDescription>
            {replacing
              ? "当前授权被 GitHub 拒绝取消收藏时，可改用经典个人访问令牌。原账号、收藏及批量任务都会保留。"
              : configured
                ? "登录后查看、排序和批量管理 GitHub 收藏。"
                : "连接自己的 GitHub 账号，开始整理收藏。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> {ERRORS[error] ?? error}
            </p>
          )}
          {!replacing && (
            <Button className="w-full" asChild>
              <a href={connectHref}>
                <GitHubIcon className="h-4 w-4" />
                {configured ? "使用 GitHub 登录" : "连接 GitHub"}
              </a>
            </Button>
          )}
          <PatLoginForm next={next} initialOpen={replacing} />
          {replacing && (
            <a
              href="/dashboard"
              className="block text-center text-sm text-muted-foreground hover:underline"
            >
              返回收藏库
            </a>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
