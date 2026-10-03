// Runs once per server start. Background jobs (appointment reminders,
// email outbox, document retention) only run in the Node.js runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/jobs/scheduler")
    startScheduler()
  }
}
