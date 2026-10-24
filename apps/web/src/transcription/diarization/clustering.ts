function normalize({ vector }: { vector: ArrayLike<number> }): Float32Array {
	let norm = 0;
	for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
	norm = Math.sqrt(norm) || 1;
	const out = new Float32Array(vector.length);
	for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
	return out;
}

/**
 * Average-linkage agglomerative clustering on cosine similarity, the same
 * family of clustering pyannote uses for its speaker embeddings.
 *
 * With `numSpeakers`, merges until exactly that many clusters remain.
 * Otherwise merges while the closest pair is above `similarityThreshold`.
 * Labels are numbered by first appearance, so the first voice heard is 0.
 */
export function clusterSpeakerEmbeddings({
	embeddings,
	similarityThreshold,
	numSpeakers,
	minClusterSize = 2,
}: {
	embeddings: ArrayLike<number>[];
	similarityThreshold: number;
	numSpeakers?: number;
	/** Clusters smaller than this are folded into their closest neighbour. */
	minClusterSize?: number;
}): number[] {
	const n = embeddings.length;
	if (n === 0) return [];

	const vectors = embeddings.map((vector) => normalize({ vector }));
	const sim = new Float32Array(n * n);
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			let dot = 0;
			const a = vectors[i];
			const b = vectors[j];
			for (let k = 0; k < a.length; k++) dot += a[k] * b[k];
			sim[i * n + j] = dot;
			sim[j * n + i] = dot;
		}
	}

	const active = new Uint8Array(n).fill(1);
	const size = new Int32Array(n).fill(1);
	const owner = Int32Array.from({ length: n }, (_, i) => i);
	const bestIndex = new Int32Array(n).fill(-1);
	const bestSim = new Float32Array(n).fill(-Infinity);

	const refreshBest = ({ row }: { row: number }) => {
		bestIndex[row] = -1;
		bestSim[row] = -Infinity;
		for (let col = 0; col < n; col++) {
			if (col === row || !active[col]) continue;
			const value = sim[row * n + col];
			if (value > bestSim[row]) {
				bestSim[row] = value;
				bestIndex[row] = col;
			}
		}
	};
	for (let i = 0; i < n; i++) refreshBest({ row: i });

	const merge = ({ keep, drop }: { keep: number; drop: number }) => {
		const total = size[keep] + size[drop];
		for (let k = 0; k < n; k++) {
			if (!active[k] || k === keep || k === drop) continue;
			const value =
				(size[keep] * sim[keep * n + k] + size[drop] * sim[drop * n + k]) /
				total;
			sim[keep * n + k] = value;
			sim[k * n + keep] = value;
		}
		active[drop] = 0;
		size[keep] = total;
		for (let i = 0; i < n; i++) {
			if (owner[i] === drop) owner[i] = keep;
		}
		for (let k = 0; k < n; k++) {
			if (!active[k]) continue;
			if (k === keep || bestIndex[k] === keep || bestIndex[k] === drop) {
				refreshBest({ row: k });
			} else if (sim[k * n + keep] > bestSim[k]) {
				bestSim[k] = sim[k * n + keep];
				bestIndex[k] = keep;
			}
		}
	};

	const closestPair = (): [number, number] | null => {
		let row = -1;
		for (let i = 0; i < n; i++) {
			if (!active[i] || bestIndex[i] < 0) continue;
			if (row < 0 || bestSim[i] > bestSim[row]) row = i;
		}
		return row < 0 ? null : [row, bestIndex[row]];
	};

	let count = n;
	const target = numSpeakers ? Math.max(1, Math.min(numSpeakers, n)) : 1;
	while (count > target) {
		const pair = closestPair();
		if (!pair) break;
		const [i, j] = pair;
		if (!numSpeakers && bestSim[i] < similarityThreshold) break;
		merge({ keep: Math.min(i, j), drop: Math.max(i, j) });
		count--;
	}

	// Small clusters are only folded into an established one, never into each
	// other: two lone voices from one short window are two speakers.
	if (!numSpeakers) {
		while (count > 1) {
			let small = -1;
			let large = -1;
			let best = -Infinity;
			for (let i = 0; i < n; i++) {
				if (!active[i] || size[i] >= minClusterSize) continue;
				for (let j = 0; j < n; j++) {
					if (!active[j] || size[j] < minClusterSize) continue;
					if (sim[i * n + j] > best) {
						best = sim[i * n + j];
						small = i;
						large = j;
					}
				}
			}
			if (small < 0) break;
			merge({ keep: Math.min(small, large), drop: Math.max(small, large) });
			count--;
		}
	}

	const labels: number[] = [];
	const labelByOwner = new Map<number, number>();
	for (let i = 0; i < n; i++) {
		let label = labelByOwner.get(owner[i]);
		if (label === undefined) {
			label = labelByOwner.size;
			labelByOwner.set(owner[i], label);
		}
		labels.push(label);
	}
	return labels;
}
