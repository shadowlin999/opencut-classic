export interface SpeakerTurn {
	speaker: number;
	start: number;
	end: number;
}

export interface DiarizationWindow {
	startSample: number;
	/** Seconds of this window whose frames are trusted when building turns. */
	keepStart: number;
	keepEnd: number;
}

/** One local speaker slot (0-2) of the segmentation model inside one window. */
export interface LocalSpeakerActivity {
	windowIndex: number;
	localIndex: number;
	/** 1 when the speaker is active on that frame. */
	frames: Uint8Array;
}

export interface DiarizationResult {
	turns: SpeakerTurn[];
	speakerCount: number;
}
