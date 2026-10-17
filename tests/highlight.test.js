import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themedHighlightStyle } from '../dashboard/editor/highlight.js';

test('the vendored palette adapter preserves tag identity, order, and noncolor styles without mutating defaults', () => {
  class HighlightStyle {
    constructor(specs) { this.specs = specs; }
    static define(specs) { return new HighlightStyle(specs); }
  }
  const tag = {};
  const defaults = new HighlightStyle([{ tag, color: '#a11', fontStyle: 'italic' }, { tag, textDecoration: 'underline' }]);
  const converted = themedHighlightStyle(defaults);
  assert.notEqual(converted, defaults);
  assert.equal(converted.specs[0].tag, tag);
  assert.equal(converted.specs[0].color, 'var(--code-string)');
  assert.equal(converted.specs[0].fontStyle, 'italic');
  assert.equal(converted.specs[1].textDecoration, 'underline');
  assert.equal(defaults.specs[0].color, '#a11');
  assert.equal(themedHighlightStyle(defaults), converted);
});

test('an incompatible bundle fails explicitly rather than using the inaccessible default dark palette', () => {
  assert.throws(() => themedHighlightStyle({ specs: [] }), /CodeMirror bundle/);
});
