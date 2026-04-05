// Shared safety/debug utilities for frontend modules.
(function initSafeUtils() {
    if (window.__safeUtilsReady) return;
    window.__safeUtilsReady = true;

    const DEBUG_UI = window.DEBUG_UI === true;
    window.DEBUG_UI = DEBUG_UI;
    window.debugLog = function debugLog(...args) {
        if (window.DEBUG_UI) {
            console.log(...args);
        }
    };

    const ALLOWED_TAGS = new Set(['BR', 'STRONG', 'EM', 'B', 'I', 'HR', 'CODE', 'SPAN', 'DIV']);
    const ALLOWED_ATTRS = new Set(['style', 'class']);

    function sanitizeNode(node) {
        if (!node || !node.childNodes) return;
        const children = Array.from(node.childNodes);
        children.forEach((child) => {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toUpperCase();
                if (!ALLOWED_TAGS.has(tag)) {
                    const text = document.createTextNode(child.textContent || '');
                    child.replaceWith(text);
                    return;
                }
                const attrs = Array.from(child.attributes || []);
                attrs.forEach((attr) => {
                    const name = attr.name.toLowerCase();
                    if (!ALLOWED_ATTRS.has(name)) {
                        child.removeAttribute(attr.name);
                    }
                });
                sanitizeNode(child);
            }
        });
    }

    window.sanitizeHtml = function sanitizeHtml(value) {
        const raw = value === null || value === undefined ? '' : String(value);
        const template = document.createElement('template');
        template.innerHTML = raw;
        sanitizeNode(template.content);
        return template.innerHTML;
    };

    window.setSafeHtml = function setSafeHtml(node, html) {
        if (!node) return;
        node.innerHTML = window.sanitizeHtml(html);
    };

    const UX_TOAST_CONTAINER_ID = 'ux-toast-container';
    const UX_DEFAULT_TIMEOUT_MS = 8000;
    const uxToastCooldown = new Map();

    function ensureToastContainer() {
        let container = document.getElementById(UX_TOAST_CONTAINER_ID);
        if (container) return container;
        container = document.createElement('div');
        container.id = UX_TOAST_CONTAINER_ID;
        container.style.cssText = [
            'position: fixed',
            'top: 14px',
            'right: 14px',
            'display: flex',
            'flex-direction: column',
            'gap: 8px',
            'z-index: 12000',
            'pointer-events: none'
        ].join(';');
        document.body.appendChild(container);
        return container;
    }

    window.showToast = function showToast(message, type = 'info', opts = {}) {
        const text = String(message || '').trim();
        if (!text) return;
        const dedupeKey = String(opts.dedupeKey || `${type}:${text}`);
        const now = Date.now();
        const cooldownMs = Number(opts.cooldownMs || 3000);
        const until = uxToastCooldown.get(dedupeKey) || 0;
        if (until > now) return;
        uxToastCooldown.set(dedupeKey, now + cooldownMs);

        const container = ensureToastContainer();
        const toast = document.createElement('div');
        const isError = type === 'error';
        const isWarn = type === 'warn' || type === 'warning';
        const bg = isError
            ? 'rgba(47, 17, 17, 0.96)'
            : (isWarn ? 'rgba(44, 32, 12, 0.96)' : 'rgba(12, 18, 28, 0.95)');
        const border = isError
            ? 'rgba(235, 126, 126, 0.7)'
            : (isWarn ? 'rgba(244, 201, 119, 0.7)' : 'rgba(145, 180, 220, 0.45)');
        const color = isError
            ? '#ffd9d9'
            : (isWarn ? '#ffebc2' : '#d7e7fb');

        toast.style.cssText = [
            'max-width: 360px',
            'padding: 9px 11px',
            'border-radius: 6px',
            `background: ${bg}`,
            `border: 1px solid ${border}`,
            `color: ${color}`,
            'font-family: "Share Tech Mono", monospace',
            'font-size: 11px',
            'line-height: 1.4',
            'pointer-events: auto',
            'opacity: 0',
            'transform: translateY(-4px)',
            'transition: opacity 140ms ease, transform 140ms ease'
        ].join(';');
        toast.textContent = text;
        container.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        const ttl = Math.max(1200, Number(opts.ttlMs || 3200));
        window.setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-4px)';
            window.setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 160);
        }, ttl);
    };

    window.fetchJson = async function fetchJson(url, fetchOptions = {}, requestOptions = {}) {
        const timeoutMs = Math.max(500, Number(requestOptions.timeoutMs || UX_DEFAULT_TIMEOUT_MS));
        const retries = Math.max(0, Number(requestOptions.retries || 0));
        const retryDelayMs = Math.max(0, Number(requestOptions.retryDelayMs || 220));
        const suppressToast = Boolean(requestOptions.suppressToast);
        const context = String(requestOptions.context || 'request');
        const toastMessage = String(requestOptions.toastMessage || 'Backend request failed');

        let attempt = 0;
        let lastError = null;
        while (attempt <= retries) {
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
            try {
                const options = {
                    ...fetchOptions,
                    signal: controller.signal
                };
                const response = await fetch(url, options);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const data = await response.json();
                return data;
            } catch (error) {
                lastError = error;
                const isAbort = error && error.name === 'AbortError';
                const description = isAbort ? 'timeout' : (error && error.message ? error.message : 'unknown error');
                if (window.frontendLogger && typeof window.frontendLogger.warn === 'function') {
                    window.frontendLogger.warn('frontend request failed', {
                        context,
                        url: String(url || ''),
                        attempt,
                        retries,
                        timeoutMs,
                        error: description
                    });
                }
                if (attempt < retries) {
                    await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
                } else if (!suppressToast && typeof window.showToast === 'function') {
                    window.showToast(`${toastMessage} (${description})`, 'warn', {
                        dedupeKey: `req:${context}:${String(url || '')}`
                    });
                }
            } finally {
                window.clearTimeout(timeoutId);
            }
            attempt += 1;
        }
        throw lastError || new Error('Request failed');
    };

    // Sanitize all d3 html() calls automatically.
    if (window.d3 && window.d3.selection && window.d3.selection.prototype && !window.__d3HtmlSanitizedPatch) {
        window.__d3HtmlSanitizedPatch = true;
        const originalHtml = window.d3.selection.prototype.html;
        window.d3.selection.prototype.html = function patchedHtml(value) {
            if (typeof value === 'string') {
                return originalHtml.call(this, window.sanitizeHtml(value));
            }
            if (typeof value === 'function') {
                return originalHtml.call(this, function d3HtmlWrapper(...args) {
                    const result = value.apply(this, args);
                    return typeof result === 'string' ? window.sanitizeHtml(result) : result;
                });
            }
            return originalHtml.call(this, value);
        };
    }
})();
