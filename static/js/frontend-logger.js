// Frontend logger for shipping browser-side events to backend/Elastic.
(function () {
    const API_ENDPOINT = window.__FRONTEND_LOG_ENDPOINT__ || "/api/frontend-logs";
    const MAX_QUEUE = 200;
    const BATCH_SIZE = 20;
    const FLUSH_INTERVAL_MS = 3000;

    const queue = [];
    let flushTimer = null;
    let isFlushing = false;

    function getSessionId() {
        const key = "kernelAiSessionId";
        let existing = null;
        try {
            existing = window.sessionStorage.getItem(key);
            if (existing) return existing;
            const generated = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            window.sessionStorage.setItem(key, generated);
            return generated;
        } catch (_) {
            return `no-storage-${Date.now()}`;
        }
    }

    const sessionId = getSessionId();

    function trim(value, maxLen) {
        if (value === null || value === undefined) return "";
        const text = String(value);
        if (text.length <= maxLen) return text;
        return `${text.slice(0, maxLen)}...[truncated]`;
    }

    function buildEvent(level, message, meta) {
        return {
            level: trim(level || "info", 16).toLowerCase(),
            message: trim(message || "", 2048),
            module: "frontend",
            path: window.location.pathname,
            url: window.location.href,
            userAgent: navigator.userAgent,
            sessionId,
            meta: meta || {}
        };
    }

    function enqueue(event) {
        if (queue.length >= MAX_QUEUE) {
            queue.shift();
        }
        queue.push(event);
    }

    async function flush() {
        if (isFlushing || queue.length === 0) return;
        isFlushing = true;
        const batch = queue.splice(0, BATCH_SIZE);
        try {
            await fetch(API_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ events: batch }),
                keepalive: true
            });
        } catch (_) {
            // Requeue failed batch to avoid losing events during temporary outages.
            while (batch.length > 0) {
                queue.unshift(batch.pop());
                if (queue.length > MAX_QUEUE) {
                    queue.pop();
                }
            }
        } finally {
            isFlushing = false;
        }
    }

    function startFlushLoop() {
        if (flushTimer) return;
        flushTimer = window.setInterval(flush, FLUSH_INTERVAL_MS);
    }

    function log(level, message, meta) {
        enqueue(buildEvent(level, message, meta));
    }

    window.frontendLogger = {
        debug: (message, meta) => log("debug", message, meta),
        info: (message, meta) => log("info", message, meta),
        warn: (message, meta) => log("warn", message, meta),
        error: (message, meta) => log("error", message, meta),
        flush
    };

    window.addEventListener("error", (event) => {
        log("error", event.message || "window.error", {
            source: "window.error",
            filename: event.filename || "",
            lineno: event.lineno || 0,
            colno: event.colno || 0,
            stack: trim(event.error && event.error.stack ? event.error.stack : "", 12000)
        });
    });

    window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        log("error", "Unhandled promise rejection", {
            source: "window.unhandledrejection",
            reason: trim(
                reason && reason.message ? reason.message : (typeof reason === "string" ? reason : JSON.stringify(reason || {})),
                2048
            ),
            stack: trim(reason && reason.stack ? reason.stack : "", 12000)
        });
    });

    window.addEventListener("beforeunload", () => {
        if (queue.length === 0) return;
        const payload = JSON.stringify({ events: queue.slice(0, BATCH_SIZE) });
        if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: "application/json" });
            navigator.sendBeacon(API_ENDPOINT, blob);
        } else {
            flush();
        }
    });

    startFlushLoop();
    log("info", "frontend-logger initialized", { endpoint: API_ENDPOINT });
})();
