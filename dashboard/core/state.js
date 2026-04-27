const _subOrder = { html: 0, css: 1, js: 2 };

export const state = {
  allRules:    [],
  sortKey:     'custom',
  sortDir:     'asc',
  customOrder: [],
  dragSortMode: false,
  _dragSrcId:  null,
  currentId:   null,
  selectMode:  false,
  selectedIds: new Set(),
  ghostRule:   null,
};

export function sortedRules() {
  if (state.sortKey === 'custom') {
    if (!state.customOrder.length) return [...state.allRules];
    return [...state.allRules].sort((a, b) => {
      const ai = state.customOrder.indexOf(a.id);
      const bi = state.customOrder.indexOf(b.id);
      return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
    });
  }
  const typeOrder = { rest: 0, graphql: 1, html: 2 };
  return [...state.allRules].sort((a, b) => {
    let va, vb;
    if (state.sortKey === 'name') {
      va = (a.name || '').toLowerCase();
      vb = (b.name || '').toLowerCase();
    } else {
      va = (typeOrder[a.resourceType] ?? 99) * 10 + (_subOrder[a.resourceSubtype] ?? 9);
      vb = (typeOrder[b.resourceType] ?? 99) * 10 + (_subOrder[b.resourceSubtype] ?? 9);
    }
    if (va < vb) return state.sortDir === 'asc' ? -1 :  1;
    if (va > vb) return state.sortDir === 'asc' ?  1 : -1;
    return 0;
  });
}
