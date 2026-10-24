import type { EditorCore } from "@/core";
import { renameSpeakerInContent } from "@/transcription/speaker-captions";

/**
 * Renames a speaker on every caption of their track in one undoable step.
 * Returns how many captions changed.
 */
export function renameSpeakerOnTrack({
	editor,
	trackId,
	oldName,
	newName,
}: {
	editor: EditorCore;
	trackId: string;
	oldName: string;
	newName: string;
}): number {
	const track = editor.scenes
		.getActiveScene()
		.tracks.overlay.find((candidate) => candidate.id === trackId);
	if (!track || track.type !== "text") return 0;

	const updates = track.elements.flatMap((element) => {
		const content = element.params.content;
		if (typeof content !== "string") return [];
		const next = renameSpeakerInContent({ content, oldName, newName });
		if (next === null || next === content) return [];
		return [
			{
				trackId,
				elementId: element.id,
				patch: { params: { ...element.params, content: next } },
			},
		];
	});

	editor.timeline.updateElements({ updates });
	return updates.length;
}
