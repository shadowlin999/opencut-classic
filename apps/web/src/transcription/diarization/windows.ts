import type { DiarizationWindow } from "./types";

/**
 * Overlapping windows over the audio. Each window keeps only its central part
 * (half a step of margin on both sides) so every second of audio is owned by
 * exactly one window, except the first and last windows which keep their edges.
 */
export function planDiarizationWindows({
	totalSamples,
	sampleRate,
	windowSeconds,
	stepSeconds,
}: {
	totalSamples: number;
	sampleRate: number;
	windowSeconds: number;
	stepSeconds: number;
}): DiarizationWindow[] {
	const totalSeconds = totalSamples / sampleRate;
	if (totalSeconds <= 0) return [];

	const starts: number[] = [];
	for (let start = 0; ; start += stepSeconds) {
		starts.push(start);
		if (start + windowSeconds >= totalSeconds) break;
	}

	const margin = (windowSeconds - stepSeconds) / 2;
	return starts.map((start, index) => {
		const isFirst = index === 0;
		const isLast = index === starts.length - 1;
		return {
			startSample: Math.round(start * sampleRate),
			keepStart: isFirst ? 0 : start + margin,
			keepEnd: isLast ? totalSeconds : start + windowSeconds - margin,
		};
	});
}

/** Copies one window out of the audio, zero padded to the full window length. */
export function sliceWindowSamples({
	audio,
	startSample,
	windowSamples,
}: {
	audio: Float32Array;
	startSample: number;
	windowSamples: number;
}): Float32Array {
	const out = new Float32Array(windowSamples);
	out.set(audio.subarray(startSample, startSample + windowSamples));
	return out;
}

/**
 * Collects the samples where a local speaker talks alone, falling back to all
 * of their frames when they talk alone for less than `minSamples`.
 */
export function collectSpeakerSamples({
	windowAudio,
	activity,
	speakerIndex,
	minSamples,
}: {
	windowAudio: Float32Array;
	activity: Uint8Array[];
	speakerIndex: number;
	minSamples: number;
}): Float32Array {
	const own = activity[speakerIndex];
	const numFrames = own.length;
	if (numFrames === 0) return new Float32Array(0);
	const samplesPerFrame = windowAudio.length / numFrames;

	const pick = ({ exclusive }: { exclusive: boolean }) => {
		const chunks: Float32Array[] = [];
		let total = 0;
		let runStart = -1;
		for (let frame = 0; frame <= numFrames; frame++) {
			let active = frame < numFrames && own[frame] === 1;
			if (active && exclusive) {
				active = activity.every(
					(other, index) => index === speakerIndex || other[frame] === 0,
				);
			}
			if (active && runStart < 0) runStart = frame;
			if (!active && runStart >= 0) {
				const chunk = windowAudio.subarray(
					Math.floor(runStart * samplesPerFrame),
					Math.floor(frame * samplesPerFrame),
				);
				chunks.push(chunk);
				total += chunk.length;
				runStart = -1;
			}
		}
		const out = new Float32Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			out.set(chunk, offset);
			offset += chunk.length;
		}
		return out;
	};

	const exclusive = pick({ exclusive: true });
	return exclusive.length >= minSamples
		? exclusive
		: pick({ exclusive: false });
}
