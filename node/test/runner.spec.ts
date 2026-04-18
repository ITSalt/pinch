import { describe, expect, it } from "vitest";
import { ClaudeRunner, detectUpstreamFailure } from "../src/runner.js";
import type { ExecFn } from "../src/types.js";

function mockExec(result: { stdout?: string; stderr?: string; exitCode?: number }): ExecFn {
  return async () => ({
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.exitCode ?? 0,
  });
}

describe("ClaudeRunner", () => {
  it("passes binary and args correctly", async () => {
    const seen: { binary: string; args: readonly string[] } = { binary: "", args: [] };
    const exec: ExecFn = async (binary, args) => {
      seen.binary = binary;
      seen.args = args;
      return { stdout: "ok", stderr: "", exitCode: 0 };
    };
    const runner = new ClaudeRunner("claude", ["--print"], exec);
    await runner.execute({ prompt: "hi", timeoutMs: 1000 });
    expect(seen.binary).toBe("claude");
    expect(seen.args).toEqual(["--print", "hi"]);
  });

  it("appends per-task extra args before the prompt", async () => {
    let observed: readonly string[] = [];
    const exec: ExecFn = async (_b, args) => {
      observed = args;
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const runner = new ClaudeRunner("claude", ["--print"], exec);
    await runner.execute({ prompt: "p", extraArgs: ["--model", "opus"], timeoutMs: 1000 });
    expect(observed).toEqual(["--print", "--model", "opus", "p"]);
  });

  it("forwards cwd and timeoutMs to exec", async () => {
    let observed: Record<string, unknown> = {};
    const exec: ExecFn = async (_b, _a, opts) => {
      observed = { ...opts };
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const runner = new ClaudeRunner("claude", [], exec);
    await runner.execute({ prompt: "p", cwd: "/tmp", timeoutMs: 5000 });
    expect(observed.cwd).toBe("/tmp");
    expect(observed.timeoutMs).toBe(5000);
  });

  it("computes durationMs via injected clock", async () => {
    let t = 0;
    const exec: ExecFn = async () => {
      t = 50;
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const runner = new ClaudeRunner("claude", [], exec, () => t);
    const out = await runner.execute({ prompt: "p", timeoutMs: 1000 });
    expect(out.durationMs).toBe(50);
  });

  it("flags upstream failure on matching stderr + non-zero exit", async () => {
    const runner = new ClaudeRunner(
      "claude",
      [],
      mockExec({ exitCode: 1, stderr: "401 Unauthorized" }),
    );
    const out = await runner.execute({ prompt: "p", timeoutMs: 1000 });
    expect(out.upstream).toBe(true);
    expect(out.exitCode).toBe(1);
  });

  it("does not flag upstream on zero exit even with suspicious stderr", async () => {
    const runner = new ClaudeRunner("claude", [], mockExec({ stderr: "warning: 401 mention" }));
    const out = await runner.execute({ prompt: "p", timeoutMs: 1000 });
    expect(out.upstream).toBe(false);
  });
});

describe("detectUpstreamFailure", () => {
  it("catches rate-limit patterns", () => {
    expect(detectUpstreamFailure("Error: Rate limit exceeded")).toBe(true);
    expect(detectUpstreamFailure("rate-limited, retry later")).toBe(true);
    expect(detectUpstreamFailure("HTTP 401 unauthorized")).toBe(true);
    expect(detectUpstreamFailure("too many requests")).toBe(true);
    expect(detectUpstreamFailure("overloaded, try again")).toBe(true);
    expect(detectUpstreamFailure("quota exceeded")).toBe(true);
  });

  it("returns false on benign stderr", () => {
    expect(detectUpstreamFailure("")).toBe(false);
    expect(detectUpstreamFailure("warning: deprecated flag")).toBe(false);
    expect(detectUpstreamFailure("syntax error in file")).toBe(false);
  });
});
