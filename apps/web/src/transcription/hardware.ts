import type { TranscriptionModelId } from "./types";

export type TranscriptionDevice = "wasm" | "webgpu";

export type TranscriptionHardwareId = "cpu" | "gpu-2gb" | "gpu-16gb";

export type TranscriptionDtype = "fp32" | "fp16" | "q8" | "q4";

export type WhisperDtypeConfig = {
	encoder_model: TranscriptionDtype;
	decoder_model_merged: TranscriptionDtype;
};

export interface TranscriptionHardwareProfile {
	id: TranscriptionHardwareId;
	name: string;
	description: string;
	device: TranscriptionDevice;
	modelId: TranscriptionModelId;
	dtype: WhisperDtypeConfig;
}

/**
 * Whisper size and precision per hardware tier. Diarization models are small
 * (a few MB) and always run on the CPU, so only Whisper changes between tiers.
 */
export const TRANSCRIPTION_HARDWARE_PROFILES: TranscriptionHardwareProfile[] = [
	{
		id: "cpu",
		name: "CPU",
		description: "No GPU needed. Whisper Small, slowest.",
		device: "wasm",
		modelId: "whisper-small",
		dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
	},
	{
		id: "gpu-2gb",
		name: "GPU (2 GB VRAM)",
		description: "WebGPU. Whisper Medium with a 4-bit decoder.",
		device: "webgpu",
		modelId: "whisper-medium",
		dtype: { encoder_model: "fp16", decoder_model_merged: "q4" },
	},
	{
		id: "gpu-16gb",
		name: "GPU (16 GB VRAM)",
		description: "WebGPU. Whisper Large v3 Turbo, best accuracy.",
		device: "webgpu",
		modelId: "whisper-large-v3-turbo",
		dtype: { encoder_model: "fp32", decoder_model_merged: "fp16" },
	},
];

export function getHardwareProfile({
	id,
}: {
	id: TranscriptionHardwareId;
}): TranscriptionHardwareProfile {
	const profile = TRANSCRIPTION_HARDWARE_PROFILES.find(
		(candidate) => candidate.id === id,
	);
	if (!profile) {
		throw new Error(`Unknown hardware profile: ${id}`);
	}
	return profile;
}

interface WebGpuAdapterLike {
	features: { has: (feature: string) => boolean };
}

interface WebGpuLike {
	requestAdapter: () => Promise<WebGpuAdapterLike | null>;
}

/** `navigator.gpu`, typed locally since the WebGPU types are not installed. */
export function getWebGpu(): WebGpuLike | undefined {
	return (navigator as Navigator & { gpu?: WebGpuLike }).gpu;
}

/**
 * Browsers do not expose VRAM size, so auto detection only tells CPU from GPU
 * and picks the conservative GPU tier. Users with a large GPU pick 16 GB.
 */
export async function detectHardwareProfileId(): Promise<TranscriptionHardwareId> {
	const gpu = getWebGpu();
	if (!gpu) return "cpu";
	try {
		const adapter = await gpu.requestAdapter();
		return adapter ? "gpu-2gb" : "cpu";
	} catch {
		return "cpu";
	}
}
