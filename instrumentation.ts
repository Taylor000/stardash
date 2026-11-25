import * as Sentry from "@sentry/nextjs"
import type { LangfuseSpanProcessor } from "@langfuse/otel"
// Compatibility for retained, unreachable upstream modules. No AI tracing is started.
export const langfuseSpanProcessor: LangfuseSpanProcessor | undefined = undefined
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
    const { startLibraryWorker } = await import("./lib/library-worker")
    startLibraryWorker()
  }
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config")
}
export const onRequestError = Sentry.captureRequestError
