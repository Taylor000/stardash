import { processBatchItem } from "./library-batches"
import { getValidGitHubToken } from "./tokens"

const globalWorker = globalThis as typeof globalThis & { __libraryWorker?: boolean }
export function startLibraryWorker() {
  if (
    globalWorker.__libraryWorker ||
    process.env.DISABLE_LIBRARY_WORKER === "1" ||
    process.env.NODE_ENV !== "production"
  )
    return
  globalWorker.__libraryWorker = true
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      await processBatchItem({ getToken: async (id) => (await getValidGitHubToken(id)).token })
    } catch {
      console.error("[library-worker] 批量任务执行失败，下次自动重试")
    } finally {
      busy = false
    }
  }
  setInterval(tick, 1500).unref()
  console.info("[library-worker] started")
}
