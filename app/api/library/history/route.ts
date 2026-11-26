import { NextResponse } from "next/server"
import { getUser } from "@/lib/auth"
import { getTaskHistory, listTaskHistory } from "@/lib/library-history"

export async function GET(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const params = new URL(request.url).searchParams
  const page = Number(params.get("page") ?? 1)
  const id = params.get("id")
  if (!Number.isSafeInteger(page) || page < 1 || (id !== null && (!id || id.length > 80)))
    return NextResponse.json({ error: "无效的分页或任务编号" }, { status: 400 })
  const result = id === null ? listTaskHistory(user.id, page) : getTaskHistory(user.id, id, page)
  if (!result) return NextResponse.json({ error: "任务不存在" }, { status: 404 })
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
}
