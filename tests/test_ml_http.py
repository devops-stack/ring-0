"""Stage 9 HTTP attempt model, labels, join, gap, DNA mapping."""

from kernel_ai.ml.http_features import HTTP_FEATURE_ORDER, build_windows, features_of
from kernel_ai.ml.http_gap import report_gap
from kernel_ai.ml.http_join import join_success
from kernel_ai.ml.http_model import HttpAttemptModel
from kernel_ai.ml.http_parse import HttpEvent, parse_line
from kernel_ai.ml.http_polygon import benign_events, run_http_rce, run_http_wordlist, wordlist_events
from kernel_ai.ml.http_rules import classify_event, named_attempt_class
from kernel_ai.ml.http_tail import HttpLogTail
from kernel_ai.services.telemetry_orchestration import _ml_anomalies_to_mutations


def test_parse_nginx_and_ecs():
    nginx = parse_line(
        '{"time_iso8601":"2026-08-15T12:00:00+00:00","remote_addr":"1.2.3.4",'
        '"http_x_forwarded_for":"9.9.9.9","request_method":"GET",'
        '"request_uri":"/.env?x=1","status":404}'
    )
    assert nginx is not None
    assert nginx.src_ip == "9.9.9.9"
    assert nginx.path == "/.env"
    assert nginx.status == 404
    ecs = parse_line(
        '{"@timestamp":"2026-08-15T12:00:01Z","source.ip":"8.8.8.8",'
        '"http.request.method":"POST","url.path":"/api",'
        '"url.query":"q=1","http.response.status_code":200,'
        '"http.request.body.content":"{\\"x\\":1}","event.dataset":"kernel_ai.http"}'
    )
    assert ecs is not None
    assert ecs.src_ip == "8.8.8.8"
    assert ecs.dataset == "kernel_ai.http"


def test_rules_classify_patterns():
    ev = HttpEvent(1, "1.1.1.1", "GET", "/../../etc/passwd", "", 404, "", "", "nginx")
    assert classify_event(ev) == "lfi"
    ev = HttpEvent(1, "1.1.1.1", "GET", "/x", "id=1'+or+1=1", 200, "", "", "nginx")
    assert classify_event(ev) == "sqli"
    ev = HttpEvent(1, "1.1.1.1", "GET", "/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php", "", 404, "", "", "nginx")
    assert classify_event(ev) == "scanner"


def test_named_attempt_skips_quiet_model_hit():
    assert named_attempt_class("benign", "benign") is None
    assert named_attempt_class("attempt", "anomaly") is None
    assert named_attempt_class("attempt", "scanner") == "scanner"


def test_dashboard_poll_window_stays_benign():
    now = 1_700_000_000.0
    paths = [
        "/api/active-connections",
        "/api/execution-context",
        "/api/io-open-files",
        "/api/io-pulse",
        "/api/kernel-data",
        "/api/syscalls-realtime",
    ]
    events = [
        HttpEvent(now + i * 0.7, "198.51.100.8", "GET", paths[i % 6], "", 200, "", "", "nginx")
        for i in range(73)
    ]
    wins = build_windows(events, label=True)
    assert wins and wins[0].label == "benign"
    assert wins[0].why == "quiet"
    assert named_attempt_class(wins[0].label, wins[0].cls) is None


def test_window_teacher_wordlist_vs_benign():
    attack = build_windows(wordlist_events(1_700_000_000.0), label=True)
    quiet = build_windows(benign_events(1_700_000_000.0), label=True)
    assert attack and attack[0].label == "attempt"
    assert quiet and quiet[0].label == "benign"
    assert set(attack[0].features) == set(HTTP_FEATURE_ORDER)
    assert features_of([])["count"] == 0.0


def test_http_model_separates_scanner_and_benign():
    result = run_http_wordlist()
    assert result["teacher_attempt"] is True
    assert result["model_attempt"][0] is True
    assert result["model_benign"][0] is False
    assert result["pass"] is True


def test_join_success_only_after_attempt_and_web_comm():
    result = run_http_rce()
    assert result["pass"] is True
    assert result["feature"] == "http_success:exec"
    extra = join_success(
        [{"ts": 10, "src_ip": "1.1.1.1", "cls": "scanner"}],
        [{"ts": 12, "source": "stage4_sequence", "meta": {"comm": "cron"}}],
    )
    assert extra == []


def test_gap_report_hole_and_noise():
    attempts = [{"ts": 100.0, "src_ip": "1.1.1.1", "label": "attempt"}]
    kernel = [
        {"ts": 500.0, "source": "stage2_isoforest", "feature": "ctxt_per_sec", "meta": {}},
    ]
    gap = report_gap(attempts, kernel, slack_sec=30)
    assert gap["attempt_without_kernel"] == 1
    assert gap["kernel_without_attempt"] == 1
    assert gap["attempt_with_kernel"] == 0


def test_http_tail_starts_at_end(tmp_path):
    log = tmp_path / "http.json"
    line = (
        '{"time_iso8601":"2026-08-15T12:00:00+00:00","remote_addr":"1.2.3.4",'
        '"request_method":"GET","request_uri":"/","status":200}\n'
    )
    log.write_text(line)
    follow = HttpLogTail(str(log))
    assert follow.read_new() == []
    replay = HttpLogTail(str(log), start="begin")
    assert len(replay.read_new()) == 1
    log.write_text(line + line)
    fresh = follow.read_new()
    assert len(fresh) == 1


def test_dna_mapper_keeps_http_classes_separate():
    rows = [
        {"feature": "http_attempt:scanner", "source": "stage9_http", "severity": "medium",
         "message": "HTTP attempt scanner", "position": 0.22, "score": 0.8,
         "meta": {"cls": "scanner", "src_ip": "203.0.113.9", "why": "scanner:14 x404"}},
        {"feature": "http_attempt:sqli", "source": "stage9_http", "severity": "high",
         "message": "HTTP attempt sqli", "position": 0.32, "score": 0.9,
         "meta": {"cls": "sqli", "src_ip": "203.0.113.10", "why": "pattern:sqli"}},
        {"feature": "http_attempt:scanner", "source": "stage9_http", "severity": "medium",
         "message": "older scanner", "position": 0.22, "score": 0.7, "meta": {}},
        {"feature": "ctxt_per_sec", "source": "stage2_isoforest", "severity": "medium",
         "message": "forest", "position": 0.18, "score": 0.2, "meta": {}},
        {"feature": "pgmajfault_per_sec", "source": "stage1_baseline", "severity": "high",
         "message": "major faults/s spike", "position": 0.68, "score": 12.0, "meta": {}},
    ]
    muts = _ml_anomalies_to_mutations(rows)
    types = [m["type"] for m in muts]
    assert types.count("http_attempt:scanner") == 1
    assert "http_attempt:sqli" in types
    assert "ctxt_per_sec" not in types
    assert "pgmajfault_per_sec" in types
    scanner = next(m for m in muts if m["type"] == "http_attempt:scanner")
    assert scanner["source"] == "ml"
    assert scanner["ml_source"] == "stage9_http"
    assert "113.9" in scanner["description"] or "why" in scanner
