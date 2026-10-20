export function showAppVersion() {
  const version = chrome.runtime.getManifest().version;
  for (const element of document.querySelectorAll('[data-extension-version]')) {
    element.textContent = `v${version}`;
    element.title = `Extension version ${version}`;
  }
}
