import threading
from datetime import datetime

from camai.store import Store


def test_concurrent_reads_from_api_threads(tmp_path):
    """The API serves requests from several threads on one connection; reads must not collide."""
    st = Store(tmp_path / "db.sqlite")
    for i in range(50):
        st.upsert_event(site_id="s", camera_id="c", kind="motion", start_s=i, end_s=i + 1, peak_s=i, bbox=[0, 0, 1, 1],
                        ts=datetime(2026, 11, 10, 22, 0, i % 60, i), end_ts=None, media={"dir": "x"}, report=None, llm=None)
    errors = []

    def work():
        try:
            for _ in range(150):
                st.events("s")
                st.rules("s")
                st.incidents("s")
        except Exception as e:  # noqa: BLE001
            errors.append(repr(e))

    threads = [threading.Thread(target=work) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
