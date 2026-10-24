import type { TranscriptionSegment } from "@/transcription/types";
import { splitTextByWeights } from "./text-units";
import type { SpeakerTurn } from "./types";

export interface SpeakerSegment extends TranscriptionSegment {
	speaker: number;
}

const SAMPLE_STEP_SECONDS = 0.1;
const MIN_RUN_SECONDS = 0.4;

interface SpeakerRun {
	speaker: number;
	start: number;
	end: number;
}

function overlapSeconds({
	turn,
	start,
	end,
}: {
	turn: SpeakerTurn;
	start: number;
	end: number;
}): number {
	return Math.max(0, Math.min(turn.end, end) - Math.max(turn.start, start));
}

function nearestSpeaker({
	turns,
	time,
}: {
	turns: SpeakerTurn[];
	time: number;
}): number | null {
	let best: number | null = null;
	let bestDistance = Infinity;
	for (const turn of turns) {
		const distance =
			time < turn.start
				? turn.start - time
				: time > turn.end
					? time - turn.end
					: 0;
		if (distance < bestDistance) {
			bestDistance = distance;
			best = turn.speaker;
		}
	}
	return best;
}

/** Who holds the floor along a segment, as runs of one speaker each. */
function speakerRunsForSegment({
	segment,
	turns,
	fallbackSpeaker,
}: {
	segment: TranscriptionSegment;
	turns: SpeakerTurn[];
	fallbackSpeaker: number;
}): SpeakerRun[] {
	const start = segment.start;
	const end = Math.max(segment.end, segment.start + 0.01);
	const candidates = turns.filter(
		(turn) => overlapSeconds({ turn, start, end }) > 0,
	);

	if (candidates.length === 0) {
		const speaker =
			nearestSpeaker({ turns, time: (start + end) / 2 }) ?? fallbackSpeaker;
		return [{ speaker, start, end }];
	}

	// When two people talk at once, the one who talks most in this segment
	// gets the words, since Whisper only writes one stream of text.
	const overlapBySpeaker = new Map<number, number>();
	for (const turn of candidates) {
		overlapBySpeaker.set(
			turn.speaker,
			(overlapBySpeaker.get(turn.speaker) ?? 0) +
				overlapSeconds({ turn, start, end }),
		);
	}

	const steps = Math.max(1, Math.ceil((end - start) / SAMPLE_STEP_SECONDS));
	const stepSeconds = (end - start) / steps;
	const samples: number[] = [];
	for (let step = 0; step < steps; step++) {
		const time = start + (step + 0.5) * stepSeconds;
		let speaker = -1;
		let weight = -1;
		for (const turn of candidates) {
			if (time < turn.start || time >= turn.end) continue;
			const candidateWeight = overlapBySpeaker.get(turn.speaker) ?? 0;
			if (candidateWeight > weight) {
				weight = candidateWeight;
				speaker = turn.speaker;
			}
		}
		samples.push(speaker);
	}

	// Silence inside a segment belongs to whoever spoke just before it.
	for (let i = 0; i < samples.length; i++) {
		if (samples[i] >= 0) continue;
		samples[i] = samples[i - 1] ?? -1;
	}
	for (let i = samples.length - 1; i >= 0; i--) {
		if (samples[i] >= 0) continue;
		samples[i] = samples[i + 1] ?? fallbackSpeaker;
	}

	const runs: SpeakerRun[] = [];
	samples.forEach((speaker, step) => {
		const runStart = start + step * stepSeconds;
		const last = runs.at(-1);
		if (last && last.speaker === speaker) {
			last.end = runStart + stepSeconds;
			return;
		}
		runs.push({ speaker, start: runStart, end: runStart + stepSeconds });
	});

	return absorbShortRuns({ runs });
}

function absorbShortRuns({ runs }: { runs: SpeakerRun[] }): SpeakerRun[] {
	const result = runs.map((run) => ({ ...run }));
	while (result.length > 1) {
		let shortest = -1;
		for (let i = 0; i < result.length; i++) {
			const length = result[i].end - result[i].start;
			if (length >= MIN_RUN_SECONDS) continue;
			if (
				shortest < 0 ||
				length < result[shortest].end - result[shortest].start
			) {
				shortest = i;
			}
		}
		if (shortest < 0) break;

		const previous = result[shortest - 1];
		const next = result[shortest + 1];
		const target =
			!next ||
			(previous && previous.end - previous.start >= next.end - next.start)
				? shortest - 1
				: shortest + 1;
		const run = result[shortest];
		result[target].start = Math.min(result[target].start, run.start);
		result[target].end = Math.max(result[target].end, run.end);
		result.splice(shortest, 1);

		for (let i = result.length - 1; i > 0; i--) {
			if (result[i].speaker === result[i - 1].speaker) {
				result[i - 1].end = result[i].end;
				result.splice(i, 1);
			}
		}
	}
	return result;
}

/**
 * Gives every transcribed segment a speaker. A segment that spans a change
 * of speaker is cut in two, with its text split in proportion to time.
 */
export function assignSpeakersToSegments({
	segments,
	turns,
}: {
	segments: TranscriptionSegment[];
	turns: SpeakerTurn[];
}): SpeakerSegment[] {
	const result: SpeakerSegment[] = [];
	let lastSpeaker = turns[0]?.speaker ?? 0;

	for (const segment of segments) {
		if (!segment.text.trim()) continue;
		const runs = speakerRunsForSegment({
			segment,
			turns,
			fallbackSpeaker: lastSpeaker,
		});

		const pieces = splitTextByWeights({
			text: segment.text,
			weights: runs.map((run) => run.end - run.start),
		});

		if (pieces.length !== runs.length) {
			const longest = runs.reduce((best, run) =>
				run.end - run.start > best.end - best.start ? run : best,
			);
			result.push({
				text: pieces.join(""),
				start: segment.start,
				end: segment.end,
				speaker: longest.speaker,
			});
			lastSpeaker = longest.speaker;
			continue;
		}

		runs.forEach((run, index) => {
			result.push({
				text: pieces[index],
				start: index === 0 ? segment.start : run.start,
				end: index === runs.length - 1 ? segment.end : run.end,
				speaker: run.speaker,
			});
		});
		lastSpeaker = runs.at(-1)?.speaker ?? lastSpeaker;
	}

	return result;
}
