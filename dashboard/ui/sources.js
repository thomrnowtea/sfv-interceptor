import { state } from '../core/state.js';
import { esc, msg, showToast } from '../core/utils.js';
import { icon } from '../../shared/icons.js';
import { validateSourceUrl } from '../../shared/rule-document.js';
import { bindDialog } from '../../shared/dialogs.js';

let callbacks = {};
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function formatDate(value) {
  return value ? dateFormat.format(value) : 'Never';
}

function sourceHTML(source) {
  const id = esc(source.id);
  return `<section class="source-item" data-source-id="${id}">
    <div class="source-item-header">
      <h2 class="source-title">${esc(source.name)}</h2>
      <span class="readonly-badge">${icon('lock')} Read-only content</span>
    </div>
    <a class="source-url" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.url)}</a>
    <div class="source-meta">
      <span>${source.ruleCount} rule${source.ruleCount === 1 ? '' : 's'}</span>
      <span>Every ${source.intervalMinutes} min</span>
      <span class="${source.lastError ? '' : 'source-sync-ok'}">Last synced: ${esc(formatDate(source.lastSyncedAt))}</span>
      <span>Last checked: ${esc(formatDate(source.lastCheckedAt))}</span>
    </div>
    ${source.lastError ? `<p class="source-sync-error" role="status">${esc(source.lastError)}${source.lastSyncedAt ? ' Showing the last valid snapshot.' : ' No rules downloaded yet.'}</p>` : ''}
    ${source.scheduleError ? `<p class="source-sync-error" role="status">${esc(source.scheduleError)}. Save settings to retry, or use Sync now.</p>` : ''}
    <form class="source-sync-actions" data-edit-source="${id}">
      <div class="field source-name-field">
        <label for="source-name-${id}">Source name</label>
        <input type="text" id="source-name-${id}" name="name" value="${esc(source.name)}" maxlength="160" required>
      </div>
      <div class="field">
        <label for="source-interval-${id}">Interval in minutes</label>
        <input type="number" id="source-interval-${id}" name="intervalMinutes" value="${source.intervalMinutes}" min="1" max="10080" step="1" required>
      </div>
      <button type="submit" data-action="save">Save settings</button>
      <button type="button" data-action="sync">${icon('refresh')} Sync now</button>
      <button type="button" class="btn-danger" data-action="remove">Unsubscribe</button>
    </form>
  </section>`;
}

export function renderSources() {
  const list = state.sources.map(sourceHTML).join('');
  document.getElementById('main').innerHTML = `
    <header class="main-header">
      <div class="main-title-wrap"><h1 class="page-title">Remote sources</h1><p class="main-subtitle">Subscriptions to published rule collections</p></div>
      <div class="main-actions"><button type="button" class="btn-save" id="btn-add-source">${icon('plus')} Add source</button></div>
    </header>
    <div class="sources-body">
      <p class="sources-intro">Follow any HTTPS URL that responds with rule JSON. Content and versions follow the source; you choose which rules run.</p>
      <div class="sources-list">${list || `
        <div class="source-empty">
          <h2>No subscriptions yet</h2>
          <p>Add a URL to follow a team's rules automatically. You choose how often to check for changes.</p>
          <button type="button" class="btn-close" id="btn-add-source-empty">${icon('link')} Subscribe to a URL</button>
        </div>`}
      </div>
    </div>`;
  document.getElementById('btn-add-source').addEventListener('click', openSourceModal);
  document.getElementById('btn-add-source-empty')?.addEventListener('click', openSourceModal);
  document.querySelectorAll('[data-edit-source]').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      runSourceAction(form, 'save');
    });
    form.querySelector('[data-action="sync"]').addEventListener('click', () => runSourceAction(form, 'sync'));
    form.querySelector('[data-action="remove"]').addEventListener('click', () => runSourceAction(form, 'remove'));
  });
}

function sourceMessage(form, action) {
  const id = form.dataset.editSource;
  if (action === 'sync') return { type: 'SYNC_SOURCE', id };
  if (action === 'remove') return { type: 'DELETE_SOURCE', id };
  return { type: 'UPDATE_SOURCE', source: {
    id,
    name: form.elements.name.value.trim(),
    intervalMinutes: Number(form.elements.intervalMinutes.value),
  } };
}

async function runSourceAction(form, action) {
  if (action === 'remove' && !confirm('Unsubscribe from this source? Its remote rules will be removed. Local rules are kept.')) return;
  const message = sourceMessage(form, action);
  const button = form.querySelector(`[data-action="${action}"]`);
  const label = button.innerHTML;
  state.sourceActionPending = true;
  form.querySelectorAll('button, input').forEach(element => { element.disabled = true; });
  button.textContent = action === 'sync' ? 'Syncing…' : 'Saving…';
  try {
    const result = await msg(message);
    await callbacks.refresh();
    if (state.view === 'sources') {
      renderSources();
      const sourceElement = [...document.querySelectorAll('[data-edit-source]')].find(element => element.dataset.editSource === message.id || element.dataset.editSource === message.source?.id);
      const focusTarget = sourceElement?.querySelector(`[data-action="${action}"]`) ?? document.querySelector('[data-action="sync"]') ?? document.getElementById('btn-add-source');
      focusTarget.focus();
    }
    const error = result.source?.lastError || result.source?.scheduleError;
    const success = { sync: 'Source synced', save: 'Source settings saved', remove: 'Unsubscribed. Local rules kept.' }[action];
    showToast(error || success, Boolean(error));
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.sourceActionPending = false;
    form.querySelectorAll('button, input').forEach(element => { element.disabled = false; });
    button.innerHTML = label;
  }
}

export function openSourceModal() {
  const form = document.getElementById('source-form');
  form.reset();
  document.getElementById('source-error').hidden = true;
  document.getElementById('source-modal').showModal();
  document.getElementById('source-url').focus();
}

async function subscribe(event) {
  event.preventDefault();
  const source = {
    name: document.getElementById('source-name').value.trim(),
    url: document.getElementById('source-url').value.trim(),
    intervalMinutes: Number(document.getElementById('source-interval').value),
  };
  const errorElement = document.getElementById('source-error');
  const button = document.getElementById('source-submit');
  errorElement.hidden = true;
  button.disabled = true;
  button.textContent = 'Connecting…';
  try {
    validateSourceUrl(source.url);
    const result = await msg({ type: 'ADD_SOURCE', source });
    document.getElementById('source-modal').close();
    await callbacks.refresh();
    callbacks.showSources();
    document.getElementById('btn-add-source').focus();
    const error = result.source?.lastError || result.source?.scheduleError;
    showToast(error ? 'Subscribed. Download failed; use Sync now to retry.' : 'Subscribed. Remote rules are up to date.', Boolean(error));
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Subscribe';
  }
}

export function initSources(options) {
  callbacks = options;
  const dialog = document.getElementById('source-modal');
  bindDialog(dialog);
  document.getElementById('source-modal-close').addEventListener('click', () => dialog.close());
  document.getElementById('source-modal-cancel').addEventListener('click', () => dialog.close());
  document.getElementById('source-form').addEventListener('submit', subscribe);
}
