import type { EditorCore } from "@/core";
import {
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
	type Command,
} from "@/commands";
import { buildSubtitleTextElement } from "./build-subtitle-text-element";
import type { SubtitleCue, SubtitleStyleOverrides } from "./types";

export function insertCaptionChunksAsTextTrack({
	editor,
	captions,
}: {
	editor: EditorCore;
	captions: SubtitleCue[];
}): string | null {
	if (captions.length === 0) {
		return null;
	}

	const addTrackCommand = new AddTrackCommand({ type: "text", index: 0 });
	const trackId = addTrackCommand.getTrackId();
	const canvasSize = editor.project.getActive().settings.canvasSize;
	const insertCommands = captions.map(
		(caption, index) =>
			new InsertElementCommand({
				placement: { mode: "explicit", trackId },
				element: buildSubtitleTextElement({
					index,
					caption,
					canvasSize,
				}),
			}),
	);
	editor.command.execute({
		command: new BatchCommand([addTrackCommand, ...insertCommands]),
	});

	return trackId;
}

/** Distinct colours so each speaker is easy to tell apart on screen. */
const SPEAKER_COLORS = [
	"#ffffff",
	"#ffd84d",
	"#7fd6ff",
	"#ff9ecb",
	"#a6f08a",
	"#ffb36b",
];
const SPEAKER_BOTTOM_MARGIN_RATIO = 0.05;
/** One subtitle line (font size 5, line height 1.2 of a 90 unit canvas) plus a gap. */
const SPEAKER_ROW_STEP_RATIO = 0.085;

export function speakerCaptionStyle({
	row,
}: {
	row: number;
}): SubtitleStyleOverrides {
	return {
		color: SPEAKER_COLORS[row % SPEAKER_COLORS.length],
		placement: {
			verticalAlign: "bottom",
			marginVerticalRatio:
				SPEAKER_BOTTOM_MARGIN_RATIO + row * SPEAKER_ROW_STEP_RATIO,
		},
	};
}

/**
 * Inserts one text track per speaker in a single undoable step. Each speaker
 * gets its own colour and row, so lines spoken at the same time are shown
 * stacked instead of covering each other.
 */
export function insertSpeakerCaptionTracks({
	editor,
	speakers,
}: {
	editor: EditorCore;
	speakers: { captions: SubtitleCue[] }[];
}): string[] {
	const canvasSize = editor.project.getActive().settings.canvasSize;
	const commands: Command[] = [];
	const trackIds: string[] = [];

	speakers.forEach(({ captions }, row) => {
		if (captions.length === 0) return;
		const addTrackCommand = new AddTrackCommand({ type: "text", index: 0 });
		const trackId = addTrackCommand.getTrackId();
		trackIds.push(trackId);
		commands.push(addTrackCommand);

		const style = speakerCaptionStyle({ row });
		captions.forEach((caption, index) => {
			commands.push(
				new InsertElementCommand({
					placement: { mode: "explicit", trackId },
					element: buildSubtitleTextElement({
						index,
						caption: { ...caption, style: { ...style, ...caption.style } },
						canvasSize,
					}),
				}),
			);
		});
	});

	if (commands.length === 0) return [];
	editor.command.execute({ command: new BatchCommand(commands) });
	return trackIds;
}
