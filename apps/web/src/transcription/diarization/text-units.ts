const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;
const BREAK_AFTER_PATTERN = /[，。！？、；：,.!?;:…]$/;

/** True when most letters are CJK, which are written without spaces. */
export function isCjkText({ text }: { text: string }): boolean {
	const compact = text.replace(/\s+/g, "");
	if (compact.length === 0) return false;
	const cjk = compact.match(CJK_PATTERN)?.length ?? 0;
	return cjk / compact.length >= 0.5;
}

export interface TextUnits {
	units: string[];
	joiner: string;
}

/** Characters for CJK text, words for everything else. */
export function splitTextUnits({ text }: { text: string }): TextUnits {
	const trimmed = text.trim();
	if (!trimmed) return { units: [], joiner: "" };
	if (isCjkText({ text: trimmed })) {
		return {
			units: Array.from(trimmed.replace(/\s+/g, "")),
			joiner: "",
		};
	}
	return { units: trimmed.split(/\s+/), joiner: " " };
}

/**
 * Moves a cut index to the closest unit boundary that follows punctuation,
 * within `reach` units, so a sentence is not split mid-phrase.
 */
export function snapCutToPunctuation({
	units,
	cut,
	min,
	max,
	reach = 3,
}: {
	units: string[];
	cut: number;
	min: number;
	max: number;
	reach?: number;
}): number {
	for (let distance = 0; distance <= reach; distance++) {
		for (const candidate of [cut - distance, cut + distance]) {
			if (candidate < min || candidate > max) continue;
			if (BREAK_AFTER_PATTERN.test(units[candidate - 1] ?? "")) {
				return candidate;
			}
		}
	}
	return Math.min(max, Math.max(min, cut));
}

/**
 * Splits text into consecutive pieces whose lengths follow `weights`.
 * Every piece gets at least one unit when there are enough units.
 */
export function splitTextByWeights({
	text,
	weights,
}: {
	text: string;
	weights: number[];
}): string[] {
	const { units, joiner } = splitTextUnits({ text });
	if (weights.length <= 1 || units.length < weights.length) {
		return [units.join(joiner)];
	}

	const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
	const pieces: string[] = [];
	let from = 0;
	let cumulative = 0;
	for (let i = 0; i < weights.length; i++) {
		const remainingPieces = weights.length - i - 1;
		if (remainingPieces === 0) {
			pieces.push(units.slice(from).join(joiner));
			break;
		}
		cumulative += weights[i];
		const ideal = Math.round((cumulative / total) * units.length);
		const cut = snapCutToPunctuation({
			units,
			cut: ideal,
			min: from + 1,
			max: units.length - remainingPieces,
		});
		pieces.push(units.slice(from, cut).join(joiner));
		from = cut;
	}
	return pieces;
}
