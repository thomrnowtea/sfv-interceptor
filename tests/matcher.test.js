import test from 'node:test';
import assert from 'node:assert/strict';
import { pairToRegexFilter, urlMatchesPair } from '../sw/core/matcher.js';

test('literal operators escape asterisks and regex punctuation before creating file blockers', () => {
  for (const urlOperator of ['Contains','Equals']) {
    const pair={urlPattern:'*asset.v2[1]+?.js',urlOperator};
    const expression=new RegExp(pairToRegexFilter(pair));
    assert.equal(expression.test(pair.urlPattern),true);
    assert.equal(expression.test('assetXv211.js'),false);
  }
});

test('wildcard file blockers and runtime matching agree on full URLs and literal punctuation', () => {
  const pair={urlPattern:'https://example.com/assets/*.js?build=1',urlOperator:'Wildcard'};
  const expression=new RegExp(pairToRegexFilter(pair),'i');
  for (const [url,expected] of [
    ['https://example.com/assets/checkout.bundle.js.js?build=1',true],
    ['https://exampleXcom/assets/checkout.bundle.js.js?build=1',false],
    ['https://example.com/assets/checkout.bundle.js.js?build=10',false],
    ['https://other.test/https://example.com/assets/file.js?build=1',false],
  ]) {
    assert.equal(expression.test(url),expected,url);
    assert.equal(urlMatchesPair(url,pair),expected,url);
  }
});
