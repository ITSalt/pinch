import { Pacer } from "pinch";

async function main(): Promise<void> {
  const pacer = new Pacer({
    workingWindow: { start: "09:00", end: "21:00", tz: "Europe/Moscow" },
    hooks: {
      onEnqueued: (e) => console.log(`queued     ${e.taskId} (depth=${e.queueDepth})`),
      onStarted:  (e) => console.log(`▶ started  ${e.taskId} (active=${e.globalActive})`),
      onFinished: (e) => console.log(`✓ finished ${e.taskId} exit=${e.exitCode} (${e.durationMs}ms)`),
      onBlocked:  (e) => console.log(`⏸ blocked  ${e.reason} retry=${e.msUntilRetry ?? "-"}ms`),
    },
  });

  const tasks = [
    "Write a README for this project.",
    "Add JSDoc to src/index.ts.",
    "Summarise the top 3 security concerns in this codebase.",
  ];

  const results = await pacer.runBatch(
    tasks.map((prompt) => ({ prompt, projectId: "my-api", cwd: process.cwd() })),
  );

  for (const r of results) {
    console.log(`---\n${r.stdout}`);
  }

  await pacer.shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
