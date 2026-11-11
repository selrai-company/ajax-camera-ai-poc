import json
import os
import stat
from types import SimpleNamespace

from conftest import FakeBackend

from camai.llm import HAIKU, SONNET, ApiBackend, Claude, Image, LLMResult, SubscriptionBackend, build_content


def test_cost_estimate_uses_list_prices():
    r = LLMResult(data={}, model=HAIKU, input_tokens=1_000_000, output_tokens=1_000_000, backend="x")
    assert abs(r.est_api_cost_usd - 0.60) < 1e-9
    r = LLMResult(data={}, model=SONNET, input_tokens=1000, output_tokens=100, backend="x")
    assert abs(r.est_api_cost_usd - 0.003) < 1e-9


def test_content_labels_precede_images():
    c = build_content([Image(b"\xff\xd8", "Frame 1")], "Describe")
    assert [b["type"] for b in c] == ["text", "image", "text"]
    assert c[1]["source"]["media_type"] == "image/jpeg"


def test_cache_makes_repeat_calls_free(tmp_path):
    fb = FakeBackend()
    claude = Claude(fb, tmp_path)
    kw = dict(model=HAIKU, system="s", images=[], text="t", schema={"type": "object", "properties": {}})
    a, b = claude.complete_json(**kw), claude.complete_json(**kw)
    assert len(fb.calls) == 1 and not a.cached and b.cached and b.data == a.data


def test_api_backend_parses_structured_output_and_counts_tokens():
    resp = SimpleNamespace(
        stop_reason="end_turn",
        content=[SimpleNamespace(type="text", text='{"ok": true}')],
        usage=SimpleNamespace(input_tokens=100, cache_creation_input_tokens=0, cache_read_input_tokens=0, output_tokens=20),
    )
    seen = {}

    def create(**kw):
        seen.update(kw)
        return resp

    client = SimpleNamespace(messages=SimpleNamespace(create=create), beta=SimpleNamespace(messages=SimpleNamespace(create=create)))
    r = ApiBackend(client).complete_json(model=HAIKU, system="s", content=[], schema={"type": "object"}, effort="low", max_tokens=10)
    assert r.data == {"ok": True} and r.input_tokens == 100 and r.output_tokens == 20
    assert seen["output_config"]["format"]["type"] == "json_schema" and "temperature" not in seen


def test_subscription_backend_reads_cli_result(tmp_path):
    result = {"type": "result", "is_error": False, "structured_output": {"ok": 1}, "duration_ms": 900,
              "num_turns": 2, "usage": {"input_tokens": 2, "output_tokens": 7}}
    cli = tmp_path / "claude"
    cli.write_text(f"#!/bin/sh\ncat >/dev/null\necho '{json.dumps(result)}'\n")
    cli.chmod(cli.stat().st_mode | stat.S_IEXEC)
    content = [{"type": "text", "text": "x" * 400}]
    r = SubscriptionBackend(cli=str(cli)).complete_json(model=HAIKU, system="", content=content, schema={}, effort="low", max_tokens=10)
    # input tokens are estimated from what was sent (400 chars + "{}" ~= 100 tokens), not the CLI's multi-turn counters
    assert r.data == {"ok": 1} and r.input_tokens == 100 and r.output_tokens == 7 and r.latency_ms == 900
    assert os.path.exists(cli)


def test_image_token_estimate_matches_rule_of_thumb():
    import cv2
    import numpy as np

    ok, buf = cv2.imencode(".jpg", np.zeros((432, 768, 3), np.uint8))
    from camai.llm import image_tokens

    assert abs(image_tokens(buf.tobytes()) - 768 * 432 // 750) <= 2


def test_subscription_backend_never_passes_an_api_key_to_the_cli(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-leak")
    ok = {"type": "result", "is_error": False, "structured_output": {"key_seen": False}, "usage": {"output_tokens": 1}}
    leak = {**ok, "structured_output": {"key_seen": True}}
    cli = tmp_path / "claude"
    cli.write_text(
        "#!/bin/sh\ncat >/dev/null\n"
        f"if [ -n \"$ANTHROPIC_API_KEY\" ]; then echo '{json.dumps(leak)}'; else echo '{json.dumps(ok)}'; fi\n"
    )
    cli.chmod(cli.stat().st_mode | stat.S_IEXEC)
    r = SubscriptionBackend(cli=str(cli)).complete_json(model=HAIKU, system="", content=[], schema={}, effort="low", max_tokens=10)
    assert r.data == {"key_seen": False}
