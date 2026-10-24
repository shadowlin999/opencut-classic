export const DIARIZATION_SAMPLE_RATE = 16000;

export const SEGMENTATION_MODEL_ID = "onnx-community/pyannote-segmentation-3.0";
export const EMBEDDING_MODEL_ID =
	"onnx-community/wespeaker-voxceleb-resnet34-LM";

/** pyannote/segmentation-3.0 is trained on 10 s chunks. */
export const SEGMENTATION_WINDOW_SECONDS = 10;
export const SEGMENTATION_STEP_SECONDS = 5;

/**
 * Powerset classes of pyannote/segmentation-3.0, mapped to the local
 * speakers (max 3 per window) active in each class.
 */
export const POWERSET_CLASSES: readonly (readonly number[])[] = [
	[],
	[0],
	[1],
	[2],
	[0, 1],
	[0, 2],
	[1, 2],
];
export const LOCAL_SPEAKERS_PER_WINDOW = 3;

/** Less speech than this in a window gives an unreliable voice embedding. */
export const MIN_EMBEDDING_SECONDS = 0.5;

/** Average-linkage cosine similarity above which two voices are one speaker. */
export const DEFAULT_SPEAKER_SIMILARITY_THRESHOLD = 0.45;

export const TURN_MERGE_GAP_SECONDS = 0.3;
export const MIN_TURN_SECONDS = 0.2;

export const MAX_SPEAKERS = 6;
