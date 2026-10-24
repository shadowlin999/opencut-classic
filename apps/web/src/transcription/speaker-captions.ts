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

const SPEAKER_PREFIX_PATTERN = /^([^\n：:]{1,40}?)(：|: )/;

/** Reads the "演說者A：" / "Speaker A: " prefix off a caption, if any. */
export function readSpeakerPrefix({
	content,
}: {
	content: string;
}): { name: string; prefix: string } | null {
	const match = SPEAKER_PREFIX_PATTERN.exec(content);
	if (!match) return null;
	return { name: match[1], prefix: match[0] };
}

/**
 * Swaps the speaker name at the start of a caption. Returns null when the
 * caption does not start with `oldName`, so captions edited by hand are left
 * alone.
 */
export function renameSpeakerInContent({
	content,
	oldName,
	newName,
}: {
	content: string;
	oldName: string;
	newName: string;
}): string | null {
	const current = readSpeakerPrefix({ content });
	if (!current || current.name !== oldName) return null;
	const name = newName.trim();
	if (!name) return null;
	return `${name}${speakerSeparator({ name })}${content.slice(current.prefix.length)}`;
}

export interface SpeakerTrackInfo {
	trackId: string;
	name: string;
}

/**
 * Finds speaker caption tracks on the timeline: text tracks where most
 * captions start with the same speaker prefix. Reading this from the
 * timeline keeps renaming working after a reload or a manual edit.
 */
export function findSpeakerTracks({
	tracks,
}: {
	tracks: {
		id: string;
		type: string;
		elements: { params: Record<string, unknown> }[];
	}[];
}): SpeakerTrackInfo[] {
	const result: SpeakerTrackInfo[] = [];
	for (const track of tracks) {
		if (track.type !== "text" || track.elements.length === 0) continue;
		const counts = new Map<string, number>();
		for (const element of track.elements) {
			const content = element.params.content;
			if (typeof content !== "string") continue;
			const prefix = readSpeakerPrefix({ content });
			if (prefix) counts.set(prefix.name, (counts.get(prefix.name) ?? 0) + 1);
		}
		let best: [string, number] | null = null;
		for (const entry of counts) {
			if (!best || entry[1] > best[1]) best = entry;
		}
		if (best && best[1] * 2 > track.elements.length) {
			result.push({ trackId: track.id, name: best[0] });
		}
	}
	return result;
}
