import { describe, expect, test } from "bun:test";
import {
	assignSpeakersToSegments,
	buildSpeakerTurns,
	clusterSpeakerEmbeddings,
	collectSpeakerSamples,
	decodePowersetLogits,
	planDiarizationWindows,
	splitTextByWeights,
	splitTextUnits,
} from "@/transcription/diarization";

describe("decodePowersetLogits", () => {
	test("maps each frame's best class to its local speakers", () => {
		// frame 0: silence, frame 1: speaker 0, frame 2: speakers 1 and 2
		const logits = [
			9, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9,
		];
		const activity = decodePowersetLogits({
			logits,
			numFrames: 3,
			numClasses: 7,
		});
		expect(Array.from(activity[0])).toEqual([0, 1, 0]);
		expect(Array.from(activity[1])).toEqual([0, 0, 1]);
		expect(Array.from(activity[2])).toEqual([0, 0, 1]);
	});

	test("rejects a model with another number of classes", () => {
		expect(() =>
			decodePowersetLogits({ logits: [0, 0], numFrames: 1, numClasses: 2 }),
		).toThrow();
	});
});

describe("planDiarizationWindows", () => {
	test("keeps the centre of each window so seconds are owned once", () => {
		const windows = planDiarizationWindows({
			totalSamples: 22 * 10,
			sampleRate: 10,
			windowSeconds: 10,
			stepSeconds: 5,
		});
		expect(windows.map((w) => w.startSample)).toEqual([0, 50, 100, 150]);
		expect(windows.map((w) => [w.keepStart, w.keepEnd])).toEqual([
			[0, 7.5],
			[7.5, 12.5],
			[12.5, 17.5],
			[17.5, 22],
		]);
	});

	test("uses one window for short audio", () => {
		const windows = planDiarizationWindows({
			totalSamples: 30,
			sampleRate: 10,
			windowSeconds: 10,
			stepSeconds: 5,
		});
		expect(windows).toEqual([{ startSample: 0, keepStart: 0, keepEnd: 3 }]);
	});
});

describe("collectSpeakerSamples", () => {
	test("prefers frames where the speaker talks alone", () => {
		const windowAudio = Float32Array.from([1, 2, 3, 4]);
		const activity = [
			Uint8Array.from([1, 1, 1, 0]),
			Uint8Array.from([0, 1, 0, 1]),
		];
		const samples = collectSpeakerSamples({
			windowAudio,
			activity,
			speakerIndex: 0,
			minSamples: 1,
		});
		expect(Array.from(samples)).toEqual([1, 3]);
	});

	test("falls back to all frames when solo speech is too short", () => {
		const windowAudio = Float32Array.from([1, 2, 3, 4]);
		const activity = [
			Uint8Array.from([1, 1, 1, 0]),
			Uint8Array.from([0, 1, 0, 1]),
		];
		const samples = collectSpeakerSamples({
			windowAudio,
			activity,
			speakerIndex: 0,
			minSamples: 3,
		});
		expect(Array.from(samples)).toEqual([1, 2, 3]);
	});
});

describe("clusterSpeakerEmbeddings", () => {
	const voiceA = [1, 0, 0];
	const voiceA2 = [0.95, 0.1, 0];
	const voiceB = [0, 1, 0];
	const voiceB2 = [0.1, 0.9, 0.1];

	test("groups similar voices and labels by first appearance", () => {
		const labels = clusterSpeakerEmbeddings({
			embeddings: [voiceB, voiceA, voiceB2, voiceA2],
			similarityThreshold: 0.5,
			minClusterSize: 1,
		});
		expect(labels).toEqual([0, 1, 0, 1]);
	});

	test("honours a fixed number of speakers", () => {
		const labels = clusterSpeakerEmbeddings({
			embeddings: [voiceA, voiceA2, voiceB, voiceB2],
			similarityThreshold: 0.99,
			numSpeakers: 2,
		});
		expect(labels).toEqual([0, 0, 1, 1]);
	});

	test("keeps two lone voices apart when nothing larger exists", () => {
		const labels = clusterSpeakerEmbeddings({
			embeddings: [voiceA, voiceB],
			similarityThreshold: 0.5,
		});
		expect(labels).toEqual([0, 1]);
	});

	test("folds tiny clusters into their nearest neighbour", () => {
		const labels = clusterSpeakerEmbeddings({
			embeddings: [voiceA, voiceA2, voiceB, voiceB2, [0.6, 0.6, 0.6]],
			similarityThreshold: 0.8,
			minClusterSize: 2,
		});
		expect(new Set(labels).size).toBe(2);
	});
});

describe("buildSpeakerTurns", () => {
	test("projects local activity to global speakers and merges windows", () => {
		const windows = planDiarizationWindows({
			totalSamples: 15,
			sampleRate: 1,
			windowSeconds: 10,
			stepSeconds: 5,
		});
		// 10 frames per window, 1 s each.
		const first = Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
		const second = Uint8Array.from([0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
		const turns = buildSpeakerTurns({
			windows,
			activities: [
				{ windowIndex: 0, localIndex: 0, frames: first },
				{ windowIndex: 1, localIndex: 2, frames: second },
			],
			labels: [0, 0],
			sampleRate: 1,
			windowSeconds: 10,
		});
		expect(turns).toEqual([{ speaker: 0, start: 0, end: 15 }]);
	});
});

describe("assignSpeakersToSegments", () => {
	const turns = [
		{ speaker: 0, start: 0, end: 2 },
		{ speaker: 1, start: 2, end: 4 },
	];

	test("gives a segment inside one turn to that speaker", () => {
		const result = assignSpeakersToSegments({
			segments: [{ text: "你好嗎", start: 0.2, end: 1.8 }],
			turns,
		});
		expect(result).toEqual([
			{ text: "你好嗎", start: 0.2, end: 1.8, speaker: 0 },
		]);
	});

	test("splits a segment that spans a change of speaker", () => {
		const result = assignSpeakersToSegments({
			segments: [{ text: "我很好，謝謝你呢", start: 0, end: 4 }],
			turns,
		});
		expect(result.map((s) => [s.speaker, s.text])).toEqual([
			[0, "我很好，"],
			[1, "謝謝你呢"],
		]);
		expect(result[0].end).toBeCloseTo(2);
		expect(result[1].start).toBeCloseTo(2);
	});

	test("uses the nearest speaker when no turn covers the segment", () => {
		const result = assignSpeakersToSegments({
			segments: [{ text: "hello there", start: 5, end: 6 }],
			turns,
		});
		expect(result[0].speaker).toBe(1);
	});
});

describe("text units", () => {
	test("splits CJK by character and other text by word", () => {
		expect(splitTextUnits({ text: "演說 者" }).units).toEqual([
			"演",
			"說",
			"者",
		]);
		expect(splitTextUnits({ text: "hello  world" })).toEqual({
			units: ["hello", "world"],
			joiner: " ",
		});
	});

	test("splits text in proportion to weights", () => {
		expect(
			splitTextByWeights({ text: "one two three four", weights: [1, 1] }),
		).toEqual(["one two", "three four"]);
	});
});
