import { initActivity }   from './sw/core/activity.js';
import { initNavigation } from './sw/handlers/navigation.js';
import { initMessaging, publishRulesChanged } from './sw/handlers/messaging.js';
import { initSourceSync } from './sw/core/sources.js';

initActivity();
initNavigation();
initMessaging();
initSourceSync(publishRulesChanged);

const reconcileRules = () => publishRulesChanged().catch(error => console.error('[SFV-I SW]', error.message));
chrome.runtime.onInstalled.addListener(reconcileRules);
chrome.runtime.onStartup.addListener(reconcileRules);
reconcileRules();
