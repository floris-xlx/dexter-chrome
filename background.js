
async function isVideoEnabled(url) {
    const defaultExtensions = {
        "html": true,
        "htm": true,
        "mp4": true,
        "pdf": true,
        "jpg": true,
        "png": true,
    };
    const { enabledExtensions } = await new Promise(resolve => 
        chrome.storage.sync.get({ enabledExtensions: defaultExtensions }, resolve)
    );
    
    const extension = new URL(url).pathname.split('.').pop().toLowerCase();
    
    if (!enabledExtensions[extension]) {
        return false;
    }
    
    try {
        const response = await fetch(url, { method: 'HEAD' });
        if (response.ok) {
            const size = parseInt(response.headers.get('content-length'), 10) || 0;
            return size > 0;
        }
    } catch (e) {
        console.error("Failed to fetch video size:", e);
    }
    
    return false;
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "dexter_download" && message?.url) {
        try {
            const url = message.url;
            const suggestedFilename = message.filename || new URL(url).pathname.split("/").pop() || "video.mp4";
            chrome.downloads.download({
                url,
                filename: suggestedFilename,
                saveAs: false
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                    sendResponse({ ok: true, downloadId });
                }
            });
            return true;
        } catch (e) {
            sendResponse({ ok: false, error: String(e) });
            return false;
        }
    } else if (message?.type === "dexter_get_video_size" && message?.url) {
        isVideoEnabled(message.url).then(isEnabled => {
            if(isEnabled){
                 fetch(message.url, { method: 'HEAD' })
                    .then(response => {
                        if (response.ok) {
                            const size = response.headers.get('content-length');
                            sendResponse({ ok: true, size: parseInt(size, 10) || 0 });
                        } else {
                            sendResponse({ ok: false, error: `HTTP error! status: ${response.status}` });
                        }
                    })
                    .catch(e => {
                        sendResponse({ ok: false, error: String(e) });
                    });
            } else {
                sendResponse({ ok: false, error: 'Video is not enabled' });
            }
        });
        return true; // Indicates async response
    }
});


