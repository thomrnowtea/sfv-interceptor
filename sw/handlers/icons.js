const ICON_BLUE  = { 16:'icons/icon16.png',  48:'icons/icon48.png',  128:'icons/icon128.png'  };
const ICON_GREEN = { 16:'icons/icon16g.png', 48:'icons/icon48g.png', 128:'icons/icon128g.png' };

export function setIcon(tabId, green) {
  chrome.tabs.get(tabId, () => {
    if (chrome.runtime.lastError) return;
    chrome.action.setIcon({ tabId, path: green ? ICON_GREEN : ICON_BLUE }).catch(() => {});
  });
}
