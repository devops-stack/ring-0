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
