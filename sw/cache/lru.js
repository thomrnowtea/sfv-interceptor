export class LRUMap {
  constructor(max) { this._max = max; this._map = new Map(); }
  has(k) { return this._map.has(k); }
  get(k) {
    if (!this._map.has(k)) return undefined;
    const v = this._map.get(k); this._map.delete(k); this._map.set(k, v); return v;
  }
  set(k, v) {
    if (this._map.has(k)) this._map.delete(k);
    else if (this._map.size >= this._max) this._map.delete(this._map.keys().next().value);
    this._map.set(k, v);
  }
  delete(k) { return this._map.delete(k); }
  clear()   { this._map.clear(); }
}
