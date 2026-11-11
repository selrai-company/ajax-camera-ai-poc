from conftest import FakeBackend

from camai.checks import HaikuChecker, JevChecker, JevNotConfigured, available_checkers
from camai.llm import Claude, Image


def test_haiku_checker_returns_answer_and_confidence(monkeypatch):
    monkeypatch.delenv("JEV_API_KEY", raising=False)
    claude = Claude(FakeBackend(), None)
    r = HaikuChecker(claude).check("Is the gate open?", ["yes", "no"], [Image(b"\xff\xd8")])
    assert r.answer == "yes" and 0 < r.confidence <= 1
    assert [c.name for c in available_checkers(claude)] == ["haiku-5.5"]


def test_jev_is_off_without_a_key(monkeypatch):
    monkeypatch.delenv("JEV_API_KEY", raising=False)
    try:
        JevChecker()
        raise AssertionError("expected JevNotConfigured")
    except JevNotConfigured:
        pass
