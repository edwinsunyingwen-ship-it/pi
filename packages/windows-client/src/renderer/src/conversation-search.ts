export interface SearchableTranscriptItem {
	role: "user" | "assistant";
	text: string;
	createdAt: string;
}

export interface SearchableConversation {
	agentId: string;
	agentName: string;
	conversationId: string;
	conversationTitle: string;
	updatedAt: string;
	transcript: SearchableTranscriptItem[];
}

export interface ConversationSearchMatch {
	id: string;
	agentId: string;
	agentName: string;
	conversationId: string;
	conversationTitle: string;
	conversationUpdatedAt: string;
	messageIndex: number;
	role: SearchableTranscriptItem["role"];
	createdAt: string;
	text: string;
	snippet: string;
	score: number;
	matchedTerms: string[];
}

export interface HighlightSegment {
	text: string;
	matched: boolean;
}

interface ParsedSearchQuery {
	normalized: string;
	compact: string;
	looseTerms: string[];
	fuzzyTerms: string[];
	highlightTerms: string[];
}

interface SearchScore {
	score: number;
	matchedTerms: string[];
}

const WORD_REGEX = /[\p{L}\p{N}]+/gu;
const COMPACT_SEPARATOR_REGEX = /[\s\p{P}\p{S}_]+/gu;

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value: string): string {
	return normalizeWhitespace(value.normalize("NFKC").toLowerCase());
}

function compactSearchText(value: string): string {
	return normalizeSearchText(value).replace(COMPACT_SEPARATOR_REGEX, "");
}

function uniqueTerms(values: string[]): string[] {
	return Array.from(new Set(values.filter(Boolean)));
}

function containsCjk(value: string): boolean {
	return /[\u3400-\u9fff]/u.test(value);
}

function buildCharacterNGrams(value: string, size: number): string[] {
	if (value.length < size) {
		return [];
	}
	const terms: string[] = [];
	for (let index = 0; index <= value.length - size; index += 1) {
		terms.push(value.slice(index, index + size));
	}
	return uniqueTerms(terms);
}

function parseSearchQuery(query: string): ParsedSearchQuery | null {
	const normalized = normalizeSearchText(query);
	if (!normalized) {
		return null;
	}

	const looseTerms = uniqueTerms(normalized.match(WORD_REGEX) ?? [normalized]);
	const fuzzyTerms = uniqueTerms(
		looseTerms.flatMap((term) => (containsCjk(term) && term.length >= 4 ? buildCharacterNGrams(term, 2) : [])),
	);
	const compact = normalized.replace(COMPACT_SEPARATOR_REGEX, "");

	return {
		normalized,
		compact,
		looseTerms,
		fuzzyTerms,
		highlightTerms: uniqueTerms([normalized, ...looseTerms, ...fuzzyTerms]).sort(
			(left, right) => right.length - left.length,
		),
	};
}

function findTermPositions(terms: string[], text: string): number[] {
	return terms
		.map((term) => text.indexOf(term))
		.filter((index): index is number => index >= 0)
		.sort((left, right) => left - right);
}

function scoreTranscriptText(query: ParsedSearchQuery, text: string): SearchScore | null {
	const normalizedText = normalizeSearchText(text);
	if (!normalizedText) {
		return null;
	}

	const compactText = compactSearchText(text);
	const phraseIndex = normalizedText.indexOf(query.normalized);
	const compactPhraseIndex = query.compact ? compactText.indexOf(query.compact) : -1;
	const matchedLooseTerms = query.looseTerms.filter((term) => normalizedText.includes(term));
	const matchedFuzzyTerms = query.fuzzyTerms.filter((term) => normalizedText.includes(term));
	const looseCoverage = query.looseTerms.length > 0 ? matchedLooseTerms.length / query.looseTerms.length : 0;
	const fuzzyCoverage = query.fuzzyTerms.length > 0 ? matchedFuzzyTerms.length / query.fuzzyTerms.length : 0;

	if (phraseIndex < 0 && compactPhraseIndex < 0 && matchedLooseTerms.length === 0 && fuzzyCoverage < 0.45) {
		return null;
	}

	let score = 0;
	if (phraseIndex >= 0) {
		score += 210 + Math.max(0, 40 - Math.min(phraseIndex, 40));
	}
	if (compactPhraseIndex >= 0) {
		score += 135 + Math.max(0, 24 - Math.min(compactPhraseIndex, 24));
	}
	if (looseCoverage === 1 && query.looseTerms.length > 0) {
		score += 90;
	}
	score += matchedLooseTerms.length * 32;
	score += Math.round(fuzzyCoverage * 55);

	const loosePositions = findTermPositions(matchedLooseTerms, normalizedText);
	if (loosePositions.length > 1) {
		const span = loosePositions[loosePositions.length - 1] - loosePositions[0];
		score += Math.max(0, 40 - Math.min(span, 40));
	}
	if (phraseIndex === 0 || loosePositions[0] === 0) {
		score += 18;
	}
	if (normalizedText === query.normalized || compactText === query.compact) {
		score += 80;
	}
	if (text.length <= 240) {
		score += 8;
	}

	return {
		score,
		matchedTerms: uniqueTerms([...matchedLooseTerms, ...matchedFuzzyTerms]).sort(
			(left, right) => right.length - left.length,
		),
	};
}

function resolveSnippetAnchor(text: string, query: ParsedSearchQuery, matchedTerms: string[]): number {
	const collapsedText = normalizeWhitespace(text);
	const lowerText = collapsedText.toLowerCase();
	const candidates = [query.normalized, ...matchedTerms].sort((left, right) => right.length - left.length);

	for (const candidate of candidates) {
		const index = lowerText.indexOf(candidate.toLowerCase());
		if (index >= 0) {
			return index;
		}
	}

	return 0;
}

function buildSnippet(text: string, query: ParsedSearchQuery, matchedTerms: string[]): string {
	const collapsedText = normalizeWhitespace(text);
	if (!collapsedText) {
		return "";
	}

	const anchor = resolveSnippetAnchor(collapsedText, query, matchedTerms);
	const start = Math.max(0, anchor - 36);
	const end = Math.min(collapsedText.length, start + 140);
	const prefix = start > 0 ? "..." : "";
	const suffix = end < collapsedText.length ? "..." : "";

	return `${prefix}${collapsedText.slice(start, end).trim()}${suffix}`;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
	if (ranges.length === 0) {
		return [];
	}

	const sortedRanges = [...ranges].sort((left, right) => left.start - right.start || right.end - left.end);
	const mergedRanges = [sortedRanges[0]];

	for (let index = 1; index < sortedRanges.length; index += 1) {
		const currentRange = sortedRanges[index];
		const previousRange = mergedRanges[mergedRanges.length - 1];
		if (currentRange.start <= previousRange.end) {
			previousRange.end = Math.max(previousRange.end, currentRange.end);
			continue;
		}
		mergedRanges.push({ ...currentRange });
	}

	return mergedRanges;
}

export function highlightSearchText(text: string, query: string): HighlightSegment[] {
	if (!text) {
		return [{ text: "", matched: false }];
	}

	const parsedQuery = parseSearchQuery(query);
	if (!parsedQuery) {
		return [{ text, matched: false }];
	}

	const ranges = parsedQuery.highlightTerms.flatMap((term) => {
		if (!term) {
			return [];
		}
		const regex = new RegExp(escapeRegExp(term), "giu");
		const matches: Array<{ start: number; end: number }> = [];
		let match = regex.exec(text);
		while (match) {
			const start = match.index;
			const end = match.index + match[0].length;
			if (end > start) {
				matches.push({ start, end });
			}
			match = regex.exec(text);
		}
		return matches;
	});

	const mergedRanges = mergeRanges(ranges);
	if (mergedRanges.length === 0) {
		return [{ text, matched: false }];
	}

	const segments: HighlightSegment[] = [];
	let cursor = 0;

	for (const range of mergedRanges) {
		if (range.start > cursor) {
			segments.push({ text: text.slice(cursor, range.start), matched: false });
		}
		segments.push({ text: text.slice(range.start, range.end), matched: true });
		cursor = range.end;
	}

	if (cursor < text.length) {
		segments.push({ text: text.slice(cursor), matched: false });
	}

	return segments;
}

export function searchConversations(query: string, conversations: SearchableConversation[]): ConversationSearchMatch[] {
	const parsedQuery = parseSearchQuery(query);
	if (!parsedQuery) {
		return [];
	}

	const matches = conversations.flatMap((conversation) =>
		conversation.transcript.flatMap((item, messageIndex) => {
			const scored = scoreTranscriptText(parsedQuery, item.text);
			if (!scored) {
				return [];
			}

			return [
				{
					id: `${conversation.agentId}:${conversation.conversationId}:${messageIndex}:${item.createdAt}`,
					agentId: conversation.agentId,
					agentName: conversation.agentName,
					conversationId: conversation.conversationId,
					conversationTitle: conversation.conversationTitle,
					conversationUpdatedAt: conversation.updatedAt,
					messageIndex,
					role: item.role,
					createdAt: item.createdAt,
					text: item.text,
					snippet: buildSnippet(item.text, parsedQuery, scored.matchedTerms),
					score: scored.score,
					matchedTerms: scored.matchedTerms,
				} satisfies ConversationSearchMatch,
			];
		}),
	);

	return matches
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			if (right.createdAt !== left.createdAt) {
				return right.createdAt.localeCompare(left.createdAt);
			}
			return right.conversationUpdatedAt.localeCompare(left.conversationUpdatedAt);
		})
		.slice(0, 80);
}
