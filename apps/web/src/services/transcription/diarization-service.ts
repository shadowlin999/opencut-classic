import type { SpeakerTurn } from "@/transcription/diarization";
import type { TranscriptionProgress } from "@/transcription/types";
import type {
	DiarizationWorkerMessage,
	DiarizationWorkerResponse,
} from "./diarization-worker";

type ProgressCallback = (progress: TranscriptionProgress) => void;

export interface DiarizationOutput {
	turns: SpeakerTurn[];
	speakerCount: number;
}

/**
 * Runs speaker diarization (who spoke when) in its own worker, so it can be
 * loaded and freed independently of Whisper.
 */
class DiarizationService {
	private worker: Worker | null = null;
	private ready: Promise<void> | null = null;

	async diarize({
		audioData,
		numSpeakers,
		onProgress,
	}: {
		audioData: Float32Array;
		/** Fixed number of speakers; leave empty to detect it. */
		numSpeakers?: number;
		onProgress?: ProgressCallback;
	}): Promise<DiarizationOutput> {
		await this.ensureWorker({ onProgress });
		const worker = this.worker;
		if (!worker) throw new Error("Speaker worker not initialized");

		return new Promise((resolve, reject) => {
			const handleMessage = (
				event: MessageEvent<DiarizationWorkerResponse>,
			) => {
				const response = event.data;
				switch (response.type) {
					case "diarize-progress":
						onProgress?.({
							status: "transcribing",
							progress: response.progress,
							message: `Identifying speakers ${response.progress}%`,
						});
						break;
					case "diarize-complete":
						worker.removeEventListener("message", handleMessage);
						resolve({
							turns: response.turns,
							speakerCount: response.speakerCount,
						});
						break;
					case "diarize-error":
						worker.removeEventListener("message", handleMessage);
						reject(new Error(response.error));
						break;
					case "cancelled":
						worker.removeEventListener("message", handleMessage);
						reject(new Error("Speaker detection cancelled"));
						break;
				}
			};

			worker.addEventListener("message", handleMessage);
			worker.postMessage({
				type: "diarize",
				audio: audioData,
				numSpeakers,
			} satisfies DiarizationWorkerMessage);
		});
	}

	cancel() {
		this.worker?.postMessage({
			type: "cancel",
		} satisfies DiarizationWorkerMessage);
	}

	private ensureWorker({
		onProgress,
	}: {
		onProgress?: ProgressCallback;
	}): Promise<void> {
		if (this.ready) return this.ready;

		const worker = new Worker(
			new URL("./diarization-worker.ts", import.meta.url),
			{ type: "module" },
		);
		this.worker = worker;

		this.ready = new Promise<void>((resolve, reject) => {
			const handleMessage = (
				event: MessageEvent<DiarizationWorkerResponse>,
			) => {
				const response = event.data;
				switch (response.type) {
					case "init-progress":
						onProgress?.({
							status: "loading-model",
							progress: response.progress,
							message: "Loading speaker models...",
						});
						break;
					case "init-complete":
						worker.removeEventListener("message", handleMessage);
						resolve();
						break;
					case "init-error":
						worker.removeEventListener("message", handleMessage);
						this.terminate();
						reject(new Error(response.error));
						break;
				}
			};
			worker.addEventListener("message", handleMessage);
			worker.postMessage({ type: "init" } satisfies DiarizationWorkerMessage);
		});

		return this.ready;
	}

	terminate() {
		this.worker?.terminate();
		this.worker = null;
		this.ready = null;
	}
}

export const diarizationService = new DiarizationService();
