import { describe, expect, test } from "bun:test";
import {
	buildSpeakerCaptionTracks,
	formatSpeakerName,
	speakerLetter,
} from "@/transcription/speaker-captions";

describe("speaker names", () => {
	test("letters run A to Z then wrap with a number", () => {
		expect(speakerLetter({ index: 0 })).toBe("A");
		expect(speakerLetter({ index: 25 })).toBe("Z");
		expect(speakerLetter({ index: 26 })).toBe("A2");
	});

	test("CJK labels have no space before the letter", () => {
		expect(formatSpeakerName({ label: "演說者", index: 1 })).toBe("演說者B");
		expect(formatSpeakerName({ label: "Speaker", index: 1 })).toBe("Speaker B");
	});
});

describe("buildSpeakerCaptionTracks", () => {
	test("builds one prefixed track per speaker, overlaps allowed across tracks", () => {
		const tracks = buildSpeakerCaptionTracks({
			label: "演說者",
			segments: [
				{ text: "大家好", start: 0, end: 2, speaker: 0 },
				{ text: "你好", start: 1, end: 2.5, speaker: 1 },
				{ text: "開始吧", start: 3, end: 4, speaker: 0 },
			],
		});
		expect(tracks.map((track) => track.name)).toEqual(["演說者A", "演說者B"]);
		expect(tracks[0].captions.map((c) => c.text)).toEqual([
			"演說者A：大家好",
			"演說者A：開始吧",
		]);
		expect(tracks[1].captions[0]).toEqual({
			text: "演說者B：你好",
			startTime: 1,
			duration: 1.5,
		});
	});

	test("cuts long lines and keeps captions of one speaker from overlapping", () => {
		const text = "一二三四五六七八九十一二三四五六七八九十";
		const [track] = buildSpeakerCaptionTracks({
			label: "演說者",
			segments: [{ text, start: 0, end: 4, speaker: 0 }],
		});
		expect(track.captions).toHaveLength(2);
		const [first, second] = track.captions;
		expect(second.startTime).toBeGreaterThanOrEqual(
			first.startTime + first.duration,
		);
	});
});
