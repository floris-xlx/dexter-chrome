(function () {
    const BUTTON_CLASS = "dexter-video-download-btn";
    const PROCESSED_ATTR = "data-dexter-processed";
    let currentSettings = { enabled: true, mode: 'all', whitelist: [] };
    let observer;

    function isWhitelisted(hostname) {
        if (!currentSettings.whitelist || currentSettings.whitelist.length === 0) return false;
        return currentSettings.whitelist.some(domain => hostname.includes(domain));
    }

    function shouldRunOnPage() {
        if (!currentSettings.enabled) return false;
        if (currentSettings.mode === 'all') return true;
        if (currentSettings.mode === 'whitelist') return isWhitelisted(window.location.hostname);
        return false;
    }

    function isValidSrc(src) {
        if (!src || typeof src !== "string") return false;
        try {
            const u = new URL(src, location.href);
            return ["http:", "https:"].includes(u.protocol);
        } catch (_) {
            return false;
        }
    }

    function parseSrcset(srcset) {
        if (!srcset || typeof srcset !== "string") return [];
        return srcset
            .split(",")
            .map(part => part.trim().split(/\s+/)[0])
            .filter(Boolean);
    }

    function collectImages() {
        const urls = new Set();

        const add = (u) => {
            if (!isValidSrc(u)) return;
            urls.add(new URL(u, location.href).toString());
        };

        const imgs = Array.from(document.images || []);
        for (const img of imgs) {
            if (img.currentSrc) add(img.currentSrc);
            if (img.src) add(img.src);
            for (const u of parseSrcset(img.srcset)) add(u);
        }

        const sources = document.querySelectorAll("picture source[srcset]");
        for (const s of sources) {
            for (const u of parseSrcset(s.getAttribute("srcset"))) add(u);
        }

        return Array.from(urls);
    }

    function createButton(url) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = BUTTON_CLASS;
        btn.setAttribute("aria-label", "Download video");
        btn.textContent = "Download";
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            chrome.runtime.sendMessage({ type: "dexter_download", url });
        });
        return btn;
    }

    function findPlayerParent(element) {
        let current = element;
        while (current.parentElement) {
            current = current.parentElement;
            if (current.className && typeof current.className === 'string' && current.className.includes('player')) {
                return current;
            }
        }
        return null;
    }

    function ensureContainer(videoEl) {
        let container = videoEl.parentElement;
        if (!container) return null;
        return container;
    }

    function injectForVideo(videoEl) {
        if (!videoEl) return;
        if (!shouldRunOnPage()) return;

        // Always attach listeners to catch late-loading src
        videoEl.addEventListener('play', () => injectForVideo(videoEl), { once: true });
        videoEl.addEventListener('loadstart', () => injectForVideo(videoEl), { once: true });

        if (videoEl.getAttribute(PROCESSED_ATTR) === "true") return;

        const directSrc = videoEl.getAttribute("src");
        if (!isValidSrc(directSrc)) {
            const srcEl = videoEl.querySelector("source[src]");
            if (srcEl && isValidSrc(srcEl.getAttribute("src"))) {
                injectButton(videoEl, srcEl.getAttribute("src"));
            }
            return;
        }
        injectButton(videoEl, directSrc);
    }

    function injectButton(videoEl, url) {
        const playerParent = findPlayerParent(videoEl);
        const container = playerParent || ensureContainer(videoEl);

        if (!container) return;

        // Check if a button is already associated with this video.
        if (videoEl.getAttribute(PROCESSED_ATTR) === "true") {
            // If a button already exists for this container, don't add another.
            if ((playerParent && playerParent.nextElementSibling?.classList.contains(BUTTON_CLASS)) ||
                (!playerParent && container.querySelector(`.${BUTTON_CLASS}`))) {
                return;
            }
        }

        const btn = createButton(url);
        videoEl.setAttribute(PROCESSED_ATTR, "true");

        if (playerParent) {
            // We'll use CSS to position it based on the parent
            btn.style.visibility = 'hidden';
            document.body.appendChild(btn); // Append to body to escape parent's overflow
            const btnWidth = btn.offsetWidth;
            const rect = playerParent.getBoundingClientRect();
            btn.style.position = 'absolute';
            btn.style.top = `${rect.bottom + window.scrollY}px`;
            btn.style.left = `${rect.right + window.scrollX - btnWidth}px`;
            btn.style.visibility = 'visible';
            btn.dataset.playerId = playerParent.id || (playerParent.id = `dexter-player-${Date.now()}`);
        } else {
            container.appendChild(btn);
        }
    }

    function removeAllButtons() {
        const buttons = document.querySelectorAll(`.${BUTTON_CLASS}`);
        buttons.forEach(btn => btn.remove());
        const videos = document.querySelectorAll(`video[${PROCESSED_ATTR}]`);
        videos.forEach(vid => vid.removeAttribute(PROCESSED_ATTR));
    }

    function scan() {
        if (!shouldRunOnPage()) {
            console.log("Dexter: Not running on this page due to settings.");
            removeAllButtons();
            return;
        }
        console.log("Dexter: Scanning for videos...");
        const videos = document.querySelectorAll("video");
        videos.forEach(injectForVideo);
    }

    function createObserver() {
        return new MutationObserver((mutations) => {
            if (!shouldRunOnPage()) return;
            for (const m of mutations) {
                if (m.type === "childList") {
                    m.addedNodes.forEach((n) => {
                        if (n.nodeType !== 1) return;
                        if (n.matches && n.matches("video")) injectForVideo(n);
                        const innerVideos = n.querySelectorAll ? n.querySelectorAll("video") : [];
                        innerVideos.forEach(injectForVideo);
                    });
                }
                if (m.type === "attributes" && m.target instanceof HTMLVideoElement) {
                    if (m.attributeName === "src") injectForVideo(m.target);
                }
            }
        });
    }

    function start() {
        if (observer) observer.disconnect();
        scan();
        observer = createObserver();
        observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["src"],
        });
    }

    function init() {
        chrome.storage.sync.get("dexterSettings", (data) => {
            currentSettings = data.dexterSettings || { enabled: true, mode: 'all', whitelist: [] };
            console.log("Dexter: Initialized with settings:", currentSettings);
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", start, { once: true });
            } else {
                start();
            }
        });
    }

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && changes.dexterSettings) {
            currentSettings = changes.dexterSettings.newValue;
            console.log("Dexter: Settings changed, re-evaluating.", currentSettings);
            if (!shouldRunOnPage()) {
                removeAllButtons();
                if (observer) observer.disconnect();
            } else {
                start();
            }
        }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'dexter_get_status') {
            sendResponse({ active: shouldRunOnPage() });
        } else if (message.type === 'dexter_get_videos') {
            const videoElements = document.querySelectorAll('video');
            const videoSources = new Set();

            videoElements.forEach(vid => {
                if (vid.src) videoSources.add(vid.src);
                const sources = vid.querySelectorAll('source');
                sources.forEach(s => {
                    if (s.src) videoSources.add(s.src);
                });
            });

            sendResponse({ videos: Array.from(videoSources) });
        } else if (message.type === 'dexter_get_images') {
            sendResponse({ images: collectImages() });
        }
    });

    init();
})();


