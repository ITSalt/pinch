from __future__ import annotations

from pinch.runner import ClaudeRunner, RunnerInvocation, detect_upstream_failure


def _mock_exec(**result):
    async def fn(binary, args, opts):
        fn.seen = {"binary": binary, "args": list(args), "opts": dict(opts)}
        return {
            "stdout": result.get("stdout", ""),
            "stderr": result.get("stderr", ""),
            "exit_code": result.get("exit_code", 0),
        }
    fn.seen = {}
    return fn


async def test_binary_and_args():
    exec_fn = _mock_exec()
    runner = ClaudeRunner("claude", ("--print",), exec_fn)
    await runner.execute(RunnerInvocation(prompt="hi", cwd=None, extra_args=(), timeout_ms=1000))
    assert exec_fn.seen["binary"] == "claude"
    assert exec_fn.seen["args"] == ["--print", "hi"]


async def test_extra_args_before_prompt():
    exec_fn = _mock_exec()
    runner = ClaudeRunner("claude", ("--print",), exec_fn)
    await runner.execute(
        RunnerInvocation(prompt="p", cwd=None, extra_args=("--model", "opus"), timeout_ms=1000)
    )
    assert exec_fn.seen["args"] == ["--print", "--model", "opus", "p"]


async def test_forwards_cwd_and_timeout():
    exec_fn = _mock_exec()
    runner = ClaudeRunner("claude", (), exec_fn)
    await runner.execute(
        RunnerInvocation(prompt="p", cwd="/tmp", extra_args=(), timeout_ms=5000)
    )
    assert exec_fn.seen["opts"]["cwd"] == "/tmp"
    assert exec_fn.seen["opts"]["timeout_ms"] == 5000


async def test_duration_ms_via_injected_clock():
    t = [0.0]

    async def exec_fn(binary, args, opts):
        t[0] = 50.0
        return {"stdout": "", "stderr": "", "exit_code": 0}

    runner = ClaudeRunner("claude", (), exec_fn, monotonic_ms=lambda: t[0])
    out = await runner.execute(RunnerInvocation(prompt="p", cwd=None, extra_args=(), timeout_ms=1000))
    assert out.duration_ms == 50


async def test_flags_upstream_on_401_and_nonzero_exit():
    runner = ClaudeRunner("claude", (), _mock_exec(exit_code=1, stderr="401 Unauthorized"))
    out = await runner.execute(RunnerInvocation(prompt="p", cwd=None, extra_args=(), timeout_ms=1000))
    assert out.upstream is True
    assert out.exit_code == 1


async def test_does_not_flag_upstream_on_zero_exit():
    runner = ClaudeRunner("claude", (), _mock_exec(stderr="warning: 401 mention"))
    out = await runner.execute(RunnerInvocation(prompt="p", cwd=None, extra_args=(), timeout_ms=1000))
    assert out.upstream is False


def test_detect_upstream_patterns():
    assert detect_upstream_failure("Error: Rate limit exceeded")
    assert detect_upstream_failure("rate-limited, retry later")
    assert detect_upstream_failure("HTTP 401 unauthorized")
    assert detect_upstream_failure("too many requests")
    assert detect_upstream_failure("overloaded, try again")
    assert detect_upstream_failure("quota exceeded")


def test_detect_upstream_benign():
    assert not detect_upstream_failure("")
    assert not detect_upstream_failure("warning: deprecated flag")
    assert not detect_upstream_failure("syntax error in file")
