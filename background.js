import { initIcons }      from './sw/handlers/icons.js';
import { rebuildDNR }     from './sw/handlers/dnr.js';
import { initNavigation } from './sw/handlers/navigation.js';
import { initMessaging }  from './sw/handlers/messaging.js';

initIcons();
initNavigation();
initMessaging();

chrome.runtime.onInstalled.addListener(() => rebuildDNR());
chrome.runtime.onStartup.addListener(()   => rebuildDNR());
