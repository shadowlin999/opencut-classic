import { MIN_CAPTION_DURATION_SECONDS } from "@/transcription/caption-defaults";
import {
	isCjkText,
	splitTextByWeights,
	splitTextUnits,
	type SpeakerSegment,
} from "@/transcription/diarization";
import type { CaptionChunk } from "@/transcription/types";

export const DEFAULT_SPEAKER_LABEL = "Speaker";
export const CJK_SPEAKER_LABEL = "演說者";

/** Longest caption before it is cut, in characters (CJK) or words. */
const MAX_CJK_UNITS_PER_CAPTION = 18;
const MAX_WORDS_PER_CAPTION = 7;

export interface SpeakerCaptionTrack {
	speaker: number;
	name: string;
	captions: CaptionChunk[];
}

/** A, B, ... Z, then A2, B2, ... */
export function speakerLetter({ index }: { index: number }): string {
	const letter = String.fromCharCode(65 + (index % 26));
	const round = Math.floor(index / 26);
	return round === 0 ? letter : `${letter}${round + 1}`;
}

export function formatSpeakerName({
	label,
	index,
}: {
	label: string;
	index: number;
}): string {
	const trimmed = label.trim();
	const letter = speakerLetter({ index });
	if (!trimmed) return letter;
	return isCjkText({ text: trimmed })
		? `${trimmed}${letter}`
		: `${trimmed} ${letter}`;
}

function speakerSeparator({ name }: { name: string }): string {
	return isCjkText({ text: name }) ? "：" : ": ";
}

/**
 * One caption track per speaker. Every caption starts with the speaker's
 * name ("演說者A：…"), so overlapping speech shows both lines at once.
 */
export function buildSpeakerCaptionTracks({
	segments,
	label,
	minDuration = MIN_CAPTION_DURATION_SECONDS,
}: {
	segments: SpeakerSegment[];
	label: string;
	minDuration?: number;
}): SpeakerCaptionTrack[] {
	const tracks = new Map<number, SpeakerCaptionTrack>();
	const sorted = [...segments].sort((a, b) => a.start - b.start);

	for (const segment of sorted) {
		let track = tracks.get(segment.speaker);
		if (!track) {
			track = {
				speaker: segment.speaker,
				name: formatSpeakerName({ label, index: segment.speaker }),
				captions: [],
			};
			tracks.set(segment.speaker, track);
		}

		const { units } = splitTextUnits({ text: segment.text });
		if (units.length === 0) continue;
		const maxUnits = isCjkText({ text: segment.text })
			? MAX_CJK_UNITS_PER_CAPTION
			: MAX_WORDS_PER_CAPTION;
		const pieceCount = Math.ceil(units.length / maxUnits);
		const pieces = splitTextByWeights({
			text: segment.text,
			weights: Array.from({ length: pieceCount }, () => 1),
		});

		const segmentDuration = Math.max(segment.end - segment.start, minDuration);
		const pieceDuration = segmentDuration / pieces.length;
		const separator = speakerSeparator({ name: track.name });

		pieces.forEach((piece, index) => {
			const previous = track.captions.at(-1);
			const previousEnd = previous ? previous.startTime + previous.duration : 0;
			const startTime = Math.max(
				segment.start + index * pieceDuration,
				previousEnd,
			);
			track.captions.push({
				text: `${track.name}${separator}${piece}`,
				startTime,
				duration: Math.max(minDuration, pieceDuration),
			});
		});
	}

	return [...tracks.values()].sort((a, b) => a.speaker - b.speaker);
}
