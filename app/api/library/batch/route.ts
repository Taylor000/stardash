import { NextResponse } from "next/server"
import { getUser } from "@/lib/auth"
import {
  applyLibraryBatch,
  createUnstarBatch,
  listBatchSummaries,
  controlBatch,
} from "@/lib/library-batches"

export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(
    { batches: listBatchSummaries(user.id) },
    { headers: { "Cache-Control": "no-store" } },
  )
}
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const origin = process.env.APP_URL ?? new URL(request.url).origin
  if (request.headers.get("origin") !== new URL(origin).origin)
    return NextResponse.json({ error: "跨站请求已拒绝" }, { status: 403 })
  try {
    const body = await request.json()
    const result = body.batchId
      ? controlBatch(user.id, body.batchId, body.action)
      : body.action === "unstar"
        ? createUnstarBatch(
            user.id,
            body.ids,
            body.confirmation,
            body.idempotencyKey,
            body.allowPinned,
          )
        : applyLibraryBatch(user.id, body.ids, body.action, body.targetId)
    return NextResponse.json(
      "items" in result ? { id: result.id, status: result.status } : result,
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失败" },
      { status: 400 },
    )
  }
}
