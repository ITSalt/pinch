import { Pacer } from "pinch";
import type { Task } from "pinch";

const PROJECTS = [
  { id: "api-gateway",  cwd: "/repos/api-gateway" },
  { id: "web-frontend", cwd: "/repos/web-frontend" },
  { id: "cron-jobs",    cwd: "/repos/cron-jobs" },
];

const PROMPTS = [
  "List the three most recent TODO comments and their file paths.",
  "Summarise the last 5 commits in one sentence each.",
  "Suggest one readability improvement to the largest file in src/.",
  "Check for obvious security issues in the auth module, if any.",
];

async function main(): Promise<void> {
  const pacer = new Pacer({
    workingWindow: { start: "08:00", end: "22:00", tz: "Europe/Moscow" },
    hooks: {
      onStarted:  (e) => console.log(`▶ ${e.projectId}/${e.taskId} (global=${e.globalActive} project=${e.projectActive})`),
      onFinished: (e) => console.log(`✓ ${e.projectId}/${e.taskId} exit=${e.exitCode} ${e.durationMs}ms`),
      onBlocked:  (e) => console.log(`⏸ ${e.reason}${e.msUntilRetry ? ` retry in ${Math.round(e.msUntilRetry / 1000)}s` : ""}`),
    },
  });

  const tasks: Task[] = [];
  for (const proj of PROJECTS) {
    for (const prompt of PROMPTS) {
      tasks.push({ prompt, projectId: proj.id, cwd: proj.cwd });
    }
  }
  console.log(`enqueueing ${tasks.length} tasks across ${PROJECTS.length} projects`);

  const results = await pacer.runBatch(tasks);

  const byProject = new Map<string, number>();
  for (const r of results) {
    byProject.set(r.projectId, (byProject.get(r.projectId) ?? 0) + 1);
  }
  console.log("\nSummary by project:");
  for (const [id, count] of byProject) {
    console.log(`  ${id}: ${count} tasks completed`);
  }

  await pacer.shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
