import { MIN_TURN_SECONDS, TURN_MERGE_GAP_SECONDS } from "./constants";
import type {
	DiarizationWindow,
	LocalSpeakerActivity,
	SpeakerTurn,
} from "./types";

/**
 * Projects each window's local speaker activity onto the global speaker
 * labels and stitches the result into turns. Overlapping speech produces
 * overlapping turns of different speakers.
 */
export function buildSpeakerTurns({
	windows,
	activities,
	labels,
	sampleRate,
	windowSeconds,
	mergeGapSeconds = TURN_MERGE_GAP_SECONDS,
	minTurnSeconds = MIN_TURN_SECONDS,
}: {
	windows: DiarizationWindow[];
	activities: LocalSpeakerActivity[];
	/** Global speaker per entry of `activities`. */
	labels: number[];
	sampleRate: number;
	windowSeconds: number;
	mergeGapSeconds?: number;
	minTurnSeconds?: number;
}): SpeakerTurn[] {
	const raw: SpeakerTurn[] = [];

	activities.forEach((activity, index) => {
		const speaker = labels[index];
		const window = windows[activity.windowIndex];
		if (speaker === undefined || !window) return;

		const numFrames = activity.frames.length;
		const frameSeconds = windowSeconds / numFrames;
		const windowStart = window.startSample / sampleRate;

		let runStart = -1;
		for (let frame = 0; frame <= numFrames; frame++) {
			const frameStart = windowStart + frame * frameSeconds;
			const active =
				frame < numFrames &&
				activity.frames[frame] === 1 &&
				frameStart < window.keepEnd &&
				frameStart + frameSeconds > window.keepStart;
			if (active && runStart < 0) runStart = frame;
			if (!active && runStart >= 0) {
				raw.push({
					speaker,
					start: Math.max(
						window.keepStart,
						windowStart + runStart * frameSeconds,
					),
					end: Math.min(window.keepEnd, windowStart + frame * frameSeconds),
				});
				runStart = -1;
			}
		}
	});

	return mergeSpeakerTurns({ turns: raw, mergeGapSeconds, minTurnSeconds });
}

export function mergeSpeakerTurns({
	turns,
	mergeGapSeconds,
	minTurnSeconds,
}: {
	turns: SpeakerTurn[];
	mergeGapSeconds: number;
	minTurnSeconds: number;
}): SpeakerTurn[] {
	const bySpeaker = new Map<number, SpeakerTurn[]>();
	for (const turn of turns) {
		const list = bySpeaker.get(turn.speaker) ?? [];
		list.push({ ...turn });
		bySpeaker.set(turn.speaker, list);
	}

	const merged: SpeakerTurn[] = [];
	for (const list of bySpeaker.values()) {
		list.sort((a, b) => a.start - b.start);
		let current: SpeakerTurn | null = null;
		for (const turn of list) {
			if (current && turn.start - current.end <= mergeGapSeconds) {
				current.end = Math.max(current.end, turn.end);
				continue;
			}
			if (current) merged.push(current);
			current = turn;
		}
		if (current) merged.push(current);
	}

	return merged
		.filter((turn) => turn.end - turn.start >= minTurnSeconds)
		.sort((a, b) => a.start - b.start || a.speaker - b.speaker);
}
