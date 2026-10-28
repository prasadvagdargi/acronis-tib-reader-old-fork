
function primitiveComparator(it: any, v: any) {
	if(it < v) {
		return -1;
	}
	else if(it > v) {
		return 1;
	}

	return 0;
}


/**
 * Binary search on a sorted array. Returns the index of an item that compares equal to 'val', or -1.
 *
 * 'cmp(item, val)' must return < 0 if item sorts before val, > 0 if after, and 0 if it matches.
 *
 * NOTE: If there are duplicates, any one of them may be returned
 *
 * @param approximate if true and there is no exact match, returns the index where 'val' would be
 *   inserted, clamped to a valid index (or -1 for an empty array)
 */
export default function search<T, V>(
	arr: ReadonlyArray<T>,
	val: V,
	cmp?: ((item: T, v: V) => number)|null,
	approximate?: boolean
) : number {

	if(!cmp) {
		cmp = primitiveComparator;
	}

	let lo = 0;
	let hi = arr.length;

	while(lo < hi) {
		let mid = (lo + hi) >>> 1;
		let c = cmp(arr[mid], val);

		if(c === 0) {
			return mid;
		}
		else if(c < 0) {
			lo = mid + 1;
		}
		else {
			hi = mid;
		}
	}

	if(approximate && arr.length > 0) {
		return Math.min(lo, arr.length - 1);
	}

	return -1;
}
