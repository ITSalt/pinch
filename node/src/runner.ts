import { execFile } from "node:child_process";
import type { ExecFn, ExecOptions, ExecResult } from "./types.js";

const UPSTREAM_SIGNALS = [
  /\b401\b/i,
  /\brate[- ]?limit(?:ed|ing)?\b/i,
  /\bunauthori[sz]ed\b/i,
  /\bquota\b/i,
  /\btoo many requests\b/i,
  /\boverloaded\b/i,
];

export function defaultExec(): ExecFn {
  return (binary, args, opts) => execFilePromise(binary, args, opts);
}

function execFilePromise(
  binary: string,
  args: readonly string[],
  opts: ExecOptions,
): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve, reject) => {
    const child = execFile(
      binary,
      [...args],
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        shell: false,
      },
      (err, stdout, stderr) => {
        const stdoutStr = toStr(stdout);
        const stderrStr = toStr(stderr);
        if (err) {
          const exitCode =
            typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number"
              ? Number((err as NodeJS.ErrnoException & { code?: unknown }).code)
              : null;
          if (exitCode !== null) {
            resolve({ stdout: stdoutStr, stderr: stderrStr, exitCode });
            return;
          }
          reject(err);
          return;
        }
        resolve({ stdout: stdoutStr, stderr: stderrStr, exitCode: 0 });
      },
    );
    if (child.stdin) child.stdin.end();
    if (opts.signal) {
      if (opts.signal.aborted) {
        child.kill("SIGTERM");
      } else {
        opts.signal.addEventListener(
          "abort",
          () => {
            child.kill("SIGTERM");
          },
          { once: true },
        );
      }
    }
  });
}

export interface RunnerInvocation {
  readonly prompt: string;
  readonly cwd?: string;
  readonly extraArgs?: readonly string[];
  readonly timeoutMs: number;
}

export interface RunnerOutcome extends ExecResult {
  readonly durationMs: number;
  readonly upstream: boolean;
}

export class ClaudeRunner {
  constructor(
    private readonly binary: string,
    private readonly baseArgs: readonly string[],
    private readonly exec: ExecFn = defaultExec(),
    private readonly monotonicMs: () => number = () => performance.now(),
  ) {}

  async execute(inv: RunnerInvocation, signal?: AbortSignal): Promise<RunnerOutcome> {
    const args = [...this.baseArgs, ...(inv.extraArgs ?? []), inv.prompt];
    const start = this.monotonicMs();
    const result = await this.exec(this.binary, args, {
      ...(inv.cwd !== undefined ? { cwd: inv.cwd } : {}),
      timeoutMs: inv.timeoutMs,
      ...(signal !== undefined ? { signal } : {}),
    });
    const durationMs = Math.max(this.monotonicMs() - start, 0);
    return {
      ...result,
      durationMs,
      upstream: result.exitCode !== 0 && detectUpstreamFailure(result.stderr),
    };
  }
}

export function detectUpstreamFailure(stderr: string): boolean {
  if (!stderr) return false;
  return UPSTREAM_SIGNALS.some((rx) => rx.test(stderr));
}

function toStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof (v as { toString?: unknown }).toString === "function") {
    return String(v);
  }
  return "";
}
