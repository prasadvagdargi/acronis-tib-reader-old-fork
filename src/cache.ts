/**
 * Least-recently-used cache bounded by total size in bytes.
 *
 * getOrLoad() also shares in-flight loads, so concurrent reads of the same block only decompress it once.
 */
export class LRUCache<K, V> {
	private _map = new Map<K, { value: V; size: number }>();
	private _loading = new Map<K, Promise<V>>();
	private _total = 0;

	constructor(private _maxBytes: number, private _sizeOf: (value: V) => number) {}

	get(key: K): V | undefined {
		let e = this._map.get(key);
		if(!e) {
			return undefined;
		}

		// Move to the most recently used position
		this._map.delete(key);
		this._map.set(key, e);
		return e.value;
	}

	set(key: K, value: V) {
		let size = this._sizeOf(value);

		let old = this._map.get(key);
		if(old) {
			this._total -= old.size;
			this._map.delete(key);
		}

		if(size > this._maxBytes) {
			return;
		}

		this._map.set(key, { value, size });
		this._total += size;

		while(this._total > this._maxBytes) {
			let oldest = this._map.keys().next();
			if(oldest.done) {
				break;
			}

			let e = this._map.get(oldest.value)!;
			this._map.delete(oldest.value);
			this._total -= e.size;
		}
	}

	async getOrLoad(key: K, load: () => Promise<V>): Promise<V> {
		let cached = this.get(key);
		if(cached !== undefined) {
			return cached;
		}

		let pending = this._loading.get(key);
		if(pending) {
			return pending;
		}

		let p = (async () => {
			try {
				let value = await load();
				this.set(key, value);
				return value;
			}
			finally {
				this._loading.delete(key);
			}
		})();

		this._loading.set(key, p);
		return p;
	}

	get totalBytes() {
		return this._total;
	}

	clear() {
		this._map.clear();
		this._total = 0;
	}
}

/**
 * Default cache size for decompressed blocks (per archive)
 */
export const DEFAULT_BLOCK_CACHE_BYTES = 64 * 1024 * 1024;

export function createBlockCache<K>(maxBytes = DEFAULT_BLOCK_CACHE_BYTES) {
	return new LRUCache<K, Buffer>(maxBytes, (b) => b.length);
}
