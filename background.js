import { initActivity }   from './sw/core/activity.js';
import { initNavigation } from './sw/handlers/navigation.js';
import { initMessaging, publishRulesChanged } from './sw/handlers/messaging.js';
import { initSourceSync } from './sw/core/sources.js';

initActivity();
initNavigation();
initMessaging();
initSourceSync(publishRulesChanged);

// Reapplying stored rules during startup must not erase originals that a
// concurrent navigation has just prepared. Mutations and source updates keep
// the default cache invalidation path.
const reconcileRules = () => publishRulesChanged({ preserveAssetCache: true }).catch(error => console.error('[SFV-I SW]', error.message));
chrome.runtime.onInstalled.addListener(reconcileRules);
chrome.runtime.onStartup.addListener(reconcileRules);
reconcileRules();
