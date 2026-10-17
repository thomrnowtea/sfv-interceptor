// Palette adapter for the checked-in CodeMirror bundle. Its public export is
// an existing HighlightStyle instance rather than the HighlightStyle class.
// Map that vendor palette, preserving its tags and ordering; these literal
// colors are not semantic tag identifiers. Do not target generated CSS classes.
const VENDOR_PALETTE = {
  '#708': '--code-keyword',
  '#219': '--code-atom',
  '#164': '--code-number',
  '#a11': '--code-string',
  '#e40': '--code-escape',
  '#00f': '--code-definition',
  '#30a': '--code-definition',
  '#085': '--code-definition',
  '#167': '--code-definition',
  '#256': '--code-definition',
  '#00c': '--code-definition',
  '#940': '--code-comment',
  '#404740': '--code-comment',
  '#0066ee': '--code-atom',
  '#f00': '--code-invalid',
};
const styles = new WeakMap();

export function themedHighlightStyle(defaultStyle) {
  if (!Array.isArray(defaultStyle?.specs) || typeof defaultStyle.constructor.define !== 'function') {
    throw new Error('The CodeMirror bundle needs HighlightStyle.specs and HighlightStyle.define');
  }
  if (styles.has(defaultStyle)) return styles.get(defaultStyle);
  const specs = defaultStyle.specs.map(spec => {
    if (!spec.color) return { ...spec };
    const variable = VENDOR_PALETTE[spec.color] ?? '--cm-text';
    return { ...spec, color: `var(${variable})` };
  });
  const style = defaultStyle.constructor.define(specs);
  styles.set(defaultStyle, style);
  return style;
}
