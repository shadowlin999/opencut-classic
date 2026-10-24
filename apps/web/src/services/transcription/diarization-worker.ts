import {
	AutoFeatureExtractor,
	AutoModel,
	AutoModelForAudioFrameClassification,
	AutoProcessor,
	type FeatureExtractor,
	type PreTrainedModel,
	type Processor,
	Tensor,
} from "@huggingface/transformers";
import {
	DEFAULT_SPEAKER_SIMILARITY_THRESHOLD,
	DIARIZATION_SAMPLE_RATE,
	EMBEDDING_MODEL_ID,
	MIN_EMBEDDING_SECONDS,
	SEGMENTATION_MODEL_ID,
	SEGMENTATION_STEP_SECONDS,
	SEGMENTATION_WINDOW_SECONDS,
	buildSpeakerTurns,
	clusterSpeakerEmbeddings,
	collectSpeakerSamples,
	decodePowersetLogits,
	planDiarizationWindows,
	sliceWindowSamples,
	type LocalSpeakerActivity,
	type SpeakerTurn,
} from "@/transcription/diarization";

export type DiarizationWorkerMessage =
	| { type: "init" }
	| { type: "diarize"; audio: Float32Array; numSpeakers?: number }
	| { type: "cancel" };

export type DiarizationWorkerResponse =
	| { type: "init-progress"; progress: number }
	| { type: "init-complete" }
	| { type: "init-error"; error: string }
	| { type: "diarize-progress"; progress: number }
	| { type: "diarize-complete"; turns: SpeakerTurn[]; speakerCount: number }
	| { type: "diarize-error"; error: string }
	| { type: "cancelled" };

interface DiarizationModels {
	segmentation: PreTrainedModel;
	segmentationProcessor: Processor;
	embedding: PreTrainedModel;
	embeddingExtractor: FeatureExtractor;
}

let models: DiarizationModels | null = null;
let cancelled = false;
const fileBytes = new Map<string, { loaded: number; total: number }>();
let lastReportedProgress = -1;

const post = (response: DiarizationWorkerResponse) =>
	self.postMessage(response);

self.onmessage = async (event: MessageEvent<DiarizationWorkerMessage>) => {
	const message = event.data;
	switch (message.type) {
		case "init":
			await handleInit();
			break;
		case "diarize":
			await handleDiarize({
				audio: message.audio,
				numSpeakers: message.numSpeakers,
			});
			break;
		case "cancel":
			cancelled = true;
			post({ type: "cancelled" });
			break;
	}
};

function reportDownload(progressInfo: {
	status?: string;
	file?: string;
	loaded?: number;
	total?: number;
}) {
	const file = progressInfo.file;
	if (!file) return;
	const key = `${file}`;
	if (progressInfo.status === "progress" && (progressInfo.total ?? 0) > 0) {
		fileBytes.set(key, {
			loaded: progressInfo.loaded ?? 0,
			total: progressInfo.total ?? 0,
		});
	} else if (progressInfo.status === "done") {
		const existing = fileBytes.get(key);
		if (existing)
			fileBytes.set(key, { loaded: existing.total, total: existing.total });
	}

	let loaded = 0;
	let total = 0;
	for (const entry of fileBytes.values()) {
		loaded += entry.loaded;
		total += entry.total;
	}
	if (total === 0) return;
	const progress = Math.floor((loaded / total) * 100);
	if (progress !== lastReportedProgress) {
		lastReportedProgress = progress;
		post({ type: "init-progress", progress });
	}
}

async function handleInit() {
	lastReportedProgress = -1;
	fileBytes.clear();
	try {
		// Both models are a few MB and need ops WebGPU lacks (LSTM), so they
		// run on the CPU on every hardware tier.
		const options = {
			device: "wasm" as const,
			dtype: "fp32" as const,
			progress_callback: reportDownload,
		};
		const [segmentation, segmentationProcessor, embedding, embeddingExtractor] =
			await Promise.all([
				AutoModelForAudioFrameClassification.from_pretrained(
					SEGMENTATION_MODEL_ID,
					options,
				),
				AutoProcessor.from_pretrained(SEGMENTATION_MODEL_ID, {}),
				AutoModel.from_pretrained(EMBEDDING_MODEL_ID, options),
				AutoFeatureExtractor.from_pretrained(EMBEDDING_MODEL_ID, {}),
			]);
		models = {
			segmentation,
			segmentationProcessor,
			embedding,
			embeddingExtractor,
		};
		post({ type: "init-complete" });
	} catch (error) {
		post({
			type: "init-error",
			error:
				error instanceof Error
					? error.message
					: "Failed to load speaker models",
		});
	}
}

function float32Data({ tensor }: { tensor: Tensor }): Float32Array {
	if (!(tensor.data instanceof Float32Array)) {
		throw new Error(`Expected float32 model output, got ${tensor.type}`);
	}
	return tensor.data;
}

function firstTensor({ output }: { output: Record<string, unknown> }): Tensor {
	const tensor = Object.values(output).find(
		(value): value is Tensor => value instanceof Tensor,
	);
	if (!tensor) throw new Error("Model returned no output");
	return tensor;
}

async function handleDiarize({
	audio,
	numSpeakers,
}: {
	audio: Float32Array;
	numSpeakers?: number;
}) {
	if (!models) {
		post({ type: "diarize-error", error: "Speaker models not initialized" });
		return;
	}
	cancelled = false;

	try {
		const sampleRate = DIARIZATION_SAMPLE_RATE;
		const windowSamples = SEGMENTATION_WINDOW_SECONDS * sampleRate;
		const minSamples = MIN_EMBEDDING_SECONDS * sampleRate;
		const windows = planDiarizationWindows({
			totalSamples: audio.length,
			sampleRate,
			windowSeconds: SEGMENTATION_WINDOW_SECONDS,
			stepSeconds: SEGMENTATION_STEP_SECONDS,
		});

		const activities: LocalSpeakerActivity[] = [];
		const embeddings: Float32Array[] = [];

		for (let windowIndex = 0; windowIndex < windows.length; windowIndex++) {
			if (cancelled) return;
			const windowAudio = sliceWindowSamples({
				audio,
				startSample: windows[windowIndex].startSample,
				windowSamples,
			});

			const inputs = await models.segmentationProcessor(windowAudio);
			const logits = firstTensor({ output: await models.segmentation(inputs) });
			const [, numFrames, numClasses] = logits.dims;
			const activity = decodePowersetLogits({
				logits: float32Data({ tensor: logits }),
				numFrames,
				numClasses,
			});

			for (let localIndex = 0; localIndex < activity.length; localIndex++) {
				const samples = collectSpeakerSamples({
					windowAudio,
					activity,
					speakerIndex: localIndex,
					minSamples,
				});
				if (samples.length < minSamples) continue;

				const features = await models.embeddingExtractor(samples);
				const vector = firstTensor({
					output: await models.embedding(features),
				});
				activities.push({
					windowIndex,
					localIndex,
					frames: activity[localIndex],
				});
				embeddings.push(new Float32Array(float32Data({ tensor: vector })));
			}

			post({
				type: "diarize-progress",
				progress: Math.floor(((windowIndex + 1) / windows.length) * 100),
			});
		}

		const labels = clusterSpeakerEmbeddings({
			embeddings,
			similarityThreshold: DEFAULT_SPEAKER_SIMILARITY_THRESHOLD,
			numSpeakers,
		});
		const turns = buildSpeakerTurns({
			windows,
			activities,
			labels,
			sampleRate,
			windowSeconds: SEGMENTATION_WINDOW_SECONDS,
		});

		if (cancelled) return;
		post({
			type: "diarize-complete",
			turns,
			speakerCount: new Set(labels).size,
		});
	} catch (error) {
		if (cancelled) return;
		post({
			type: "diarize-error",
			error:
				error instanceof Error ? error.message : "Speaker detection failed",
		});
	}
}
