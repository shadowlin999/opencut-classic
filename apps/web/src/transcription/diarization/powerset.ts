import { LOCAL_SPEAKERS_PER_WINDOW, POWERSET_CLASSES } from "./constants";

/**
 * Turns segmentation logits of one window ([numFrames, numClasses], row major)
 * into a per-frame activity mask for each local speaker.
 */
export function decodePowersetLogits({
	logits,
	numFrames,
	numClasses,
}: {
	logits: ArrayLike<number>;
	numFrames: number;
	numClasses: number;
}): Uint8Array[] {
	if (numClasses !== POWERSET_CLASSES.length) {
		throw new Error(
			`Expected ${POWERSET_CLASSES.length} powerset classes, got ${numClasses}`,
		);
	}

	const activity = Array.from(
		{ length: LOCAL_SPEAKERS_PER_WINDOW },
		() => new Uint8Array(numFrames),
	);

	for (let frame = 0; frame < numFrames; frame++) {
		const offset = frame * numClasses;
		let bestClass = 0;
		let bestScore = logits[offset];
		for (let cls = 1; cls < numClasses; cls++) {
			const score = logits[offset + cls];
			if (score > bestScore) {
				bestScore = score;
				bestClass = cls;
			}
		}
		for (const speaker of POWERSET_CLASSES[bestClass]) {
			activity[speaker][frame] = 1;
		}
	}

	return activity;
}
