import test from 'node:test';
import assert from 'node:assert/strict';
import { displayVersion, displayPatterns } from '../shared/rule-display.js';
import { resolveTheme, THEME_DEFS } from '../shared/themes.js';

test('legacy UI snapshots show complete versions and retain flat URL patterns', () => {
  assert.equal(displayVersion({}), '1.0.0');
  assert.equal(displayVersion({version:0}), '0');
  assert.equal(displayVersion({version:'2.4'}), '2.4');
  assert.equal(displayVersion({version:''}), '1.0.0');
  assert.deepEqual(displayPatterns({urlPattern:'/legacy'}), [{urlPattern:'/legacy'}]);
});

test('named presets ignore obsolete persisted theme snapshots', () => {
  const restored=resolveTheme({sfvi_theme:'default',sfvi_theme_vars:{'--bg':'#1c1c1e'}});
  assert.equal(restored['--bg'],THEME_DEFS.default.vars['--bg']);
  assert.ok(restored['--accent-action']);
  assert.ok(restored['--accent-link']);
});

test('custom preferences resolve without opening the dashboard', () => {
  const resolved=resolveTheme({sfvi_theme:'custom',sfvi_theme_custom:{bg:'#101020',accent:'#4a9eff',surface:'#202030'}});
  assert.equal(resolved['--bg'],'#101020');
  assert.equal(resolved['--surface'],'#202030');
  assert.equal(resolved['--accent'],'#4a9eff');
  assert.equal(resolved['--accent-text'],'#000');
});
