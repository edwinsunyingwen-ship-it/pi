import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

export const STAIX_APP_NAME = "Staix";
export const STAIX_APP_ID = "com.staix.desktop";
export const STAIX_UPDATE_BASE_URL = "https://aidocspro.com/staix-updates";
const MIGRATION_MARKER_FILE = ".staix-user-data-migration.json";

interface ClientConfigProfile {
	modelCount: number;
	usableModelCount: number;
	capabilityCount: number;
	agentModelLinkCount: number;
}

interface MigrationSummary {
	sourceDir: string;
	targetDir: string;
	filesCopied: string[];
	logFilesCopied: number;
	migratedAt: string;
}

export function configureStaixAppIdentity(): void {
	app.setName(STAIX_APP_NAME);
	const userDataDir = join(app.getPath("appData"), STAIX_APP_NAME);
	app.setPath("userData", userDataDir);
	migrateLegacyUserDataIfNeeded(userDataDir);
}

export function getStaixUpdateFeedUrl(): string {
	const baseUrl = (process.env.STAIX_UPDATE_BASE_URL || STAIX_UPDATE_BASE_URL).replace(/\/+$/, "");
	const platformPath = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform;
	return `${baseUrl}/${platformPath}`;
}

function migrateLegacyUserDataIfNeeded(targetDir: string): void {
	const sourceDir = findLegacyUserDataSource(targetDir);
	if (!sourceDir) {
		return;
	}

	const migratedAt = new Date().toISOString();
	const backupStamp = migratedAt.replace(/[:.]/g, "-");
	const filesCopied: string[] = [];
	mkdirSync(targetDir, { recursive: true });

	if (copyConfigIfBetter(sourceDir, targetDir, backupStamp)) {
		filesCopied.push("config.json");
	}
	if (mergeConversationsIfBetter(sourceDir, targetDir, backupStamp)) {
		filesCopied.push("conversations.json");
	}
	if (copyWorkspaceIfBetter(sourceDir, targetDir, backupStamp)) {
		filesCopied.push("workspace.json");
	}
	const logFilesCopied = copyDirectoryMissingFiles(join(sourceDir, "logs"), join(targetDir, "logs"));

	if (filesCopied.length === 0 && logFilesCopied === 0) {
		return;
	}

	const summary: MigrationSummary = {
		sourceDir,
		targetDir,
		filesCopied,
		logFilesCopied,
		migratedAt,
	};
	writeFileSync(join(targetDir, MIGRATION_MARKER_FILE), JSON.stringify(summary, null, 2), "utf8");
}

function findLegacyUserDataSource(targetDir: string): string | null {
	const appDataDir = app.getPath("appData");
	const candidates = [
		join(appDataDir, "@pi-agent", "windows-client"),
		join(appDataDir, "Pi Agent", "windows-client"),
		join(appDataDir, "pi-agent", "windows-client"),
	];
	for (const candidate of candidates) {
		if (candidate === targetDir || !existsSync(candidate)) {
			continue;
		}
		if (
			existsSync(join(candidate, "config.json")) ||
			existsSync(join(candidate, "conversations.json")) ||
			existsSync(join(candidate, "workspace.json"))
		) {
			return candidate;
		}
	}
	return null;
}

function copyConfigIfBetter(sourceDir: string, targetDir: string, backupStamp: string): boolean {
	const sourcePath = join(sourceDir, "config.json");
	const targetPath = join(targetDir, "config.json");
	if (!existsSync(sourcePath)) {
		return false;
	}
	if (!existsSync(targetPath)) {
		copyFileWithBackup(sourcePath, targetPath, backupStamp);
		return true;
	}

	const sourceProfile = readClientConfigProfile(sourcePath);
	const targetProfile = readClientConfigProfile(targetPath);
	if (!sourceProfile || !targetProfile) {
		return false;
	}
	const sourceHasUsableSetup = sourceProfile.usableModelCount > 0 || sourceProfile.agentModelLinkCount > 0;
	const targetHasUsableSetup = targetProfile.usableModelCount > 0 || targetProfile.agentModelLinkCount > 0;
	if (sourceHasUsableSetup && !targetHasUsableSetup) {
		copyFileWithBackup(sourcePath, targetPath, backupStamp);
		return true;
	}
	if (
		sourceHasUsableSetup &&
		sourceProfile.modelCount > targetProfile.modelCount &&
		sourceProfile.capabilityCount > targetProfile.capabilityCount
	) {
		copyFileWithBackup(sourcePath, targetPath, backupStamp);
		return true;
	}
	return false;
}

function mergeConversationsIfBetter(sourceDir: string, targetDir: string, backupStamp: string): boolean {
	const sourcePath = join(sourceDir, "conversations.json");
	const targetPath = join(targetDir, "conversations.json");
	if (!existsSync(sourcePath)) {
		return false;
	}
	if (!existsSync(targetPath)) {
		copyFileWithBackup(sourcePath, targetPath, backupStamp);
		return true;
	}
	const sourceStore = readJsonRecord(sourcePath);
	const targetStore = readJsonRecord(targetPath);
	if (!sourceStore || !targetStore) {
		return false;
	}
	const mergedStore = mergeConversationStores(sourceStore, targetStore);
	if (
		countStoredConversationsInStore(mergedStore) > countStoredConversationsInStore(targetStore) ||
		countStoredMessagesInStore(mergedStore) > countStoredMessagesInStore(targetStore)
	) {
		writeJsonWithBackup(mergedStore, targetPath, backupStamp);
		return true;
	}
	return false;
}

function copyWorkspaceIfBetter(sourceDir: string, targetDir: string, backupStamp: string): boolean {
	const sourcePath = join(sourceDir, "workspace.json");
	const targetPath = join(targetDir, "workspace.json");
	if (!existsSync(sourcePath)) {
		return false;
	}
	if (!existsSync(targetPath)) {
		copyFileWithBackup(sourcePath, targetPath, backupStamp);
		return true;
	}
	const sourceWorkspace = readJsonRecord(sourcePath);
	const targetWorkspace = readJsonRecord(targetPath);
	if (asString(sourceWorkspace?.path) && !asString(targetWorkspace?.path)) {
		copyFileWithBackup(sourcePath, targetPath, backupStamp);
		return true;
	}
	return false;
}

function copyFileWithBackup(sourcePath: string, targetPath: string, backupStamp: string): void {
	mkdirSync(dirname(targetPath), { recursive: true });
	if (existsSync(targetPath)) {
		copyFileSync(targetPath, `${targetPath}.bak-${backupStamp}`);
	}
	copyFileSync(sourcePath, targetPath);
}

function writeJsonWithBackup(value: Record<string, unknown>, targetPath: string, backupStamp: string): void {
	mkdirSync(dirname(targetPath), { recursive: true });
	if (existsSync(targetPath)) {
		copyFileSync(targetPath, `${targetPath}.bak-${backupStamp}`);
	}
	writeFileSync(targetPath, JSON.stringify(value, null, 2), "utf8");
}

function copyDirectoryMissingFiles(sourceDir: string, targetDir: string): number {
	if (!existsSync(sourceDir) || !safeStat(sourceDir)?.isDirectory()) {
		return 0;
	}
	mkdirSync(targetDir, { recursive: true });
	let copied = 0;
	for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = join(sourceDir, entry.name);
		const targetPath = join(targetDir, entry.name);
		if (entry.isDirectory()) {
			copied += copyDirectoryMissingFiles(sourcePath, targetPath);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		if (!existsSync(targetPath)) {
			copyFileSync(sourcePath, targetPath);
			copied += 1;
			continue;
		}
		if (mergeJsonlFilesIfDifferent(sourcePath, targetPath)) {
			copied += 1;
		}
	}
	return copied;
}

function readClientConfigProfile(path: string): ClientConfigProfile | null {
	const config = readJsonRecord(path);
	if (!config) {
		return null;
	}
	const modelConfig = isRecord(config.model) ? config.model : {};
	const models = readRecordArray(modelConfig.models);
	const capabilities = readRecordArray(config.capabilities);
	const agents = readRecordArray(config.agents);
	return {
		modelCount: models.length,
		usableModelCount: models.filter(
			(model) => Boolean(model.enabled) && Boolean(asString(model.provider)) && Boolean(asString(model.modelId)),
		).length,
		capabilityCount: capabilities.length,
		agentModelLinkCount: agents.reduce((count, agent) => count + readStringArray(agent.modelIds).length, 0),
	};
}

function countStoredConversationsInStore(store: Record<string, unknown>): number {
	const conversationsByAgentId = isRecord(store?.conversationsByAgentId) ? store.conversationsByAgentId : {};
	return Object.values(conversationsByAgentId).reduce<number>((count, conversations) => {
		return count + (Array.isArray(conversations) ? conversations.length : 0);
	}, 0);
}

function countStoredMessagesInStore(store: Record<string, unknown>): number {
	const conversationsByAgentId = isRecord(store.conversationsByAgentId) ? store.conversationsByAgentId : {};
	return Object.values(conversationsByAgentId).reduce<number>((count, conversations) => {
		if (!Array.isArray(conversations)) {
			return count;
		}
		return (
			count +
			conversations.reduce<number>((messageCount, conversation) => {
				if (!isRecord(conversation) || !Array.isArray(conversation.transcript)) {
					return messageCount;
				}
				return messageCount + conversation.transcript.length;
			}, 0)
		);
	}, 0);
}

function mergeConversationStores(
	sourceStore: Record<string, unknown>,
	targetStore: Record<string, unknown>,
): Record<string, unknown> {
	const sourceConversations = isRecord(sourceStore.conversationsByAgentId) ? sourceStore.conversationsByAgentId : {};
	const targetConversations = isRecord(targetStore.conversationsByAgentId) ? targetStore.conversationsByAgentId : {};
	const conversationsByAgentId: Record<string, unknown[]> = {};
	const agentIds = new Set([...Object.keys(sourceConversations), ...Object.keys(targetConversations)]);
	for (const agentId of agentIds) {
		const byId = new Map<string, Record<string, unknown>>();
		for (const conversation of readRecordArray(sourceConversations[agentId])) {
			const id = asString(conversation.id);
			if (id) {
				byId.set(id, conversation);
			}
		}
		for (const conversation of readRecordArray(targetConversations[agentId])) {
			const id = asString(conversation.id);
			if (!id) {
				continue;
			}
			const existing = byId.get(id);
			byId.set(id, chooseRicherConversation(existing, conversation));
		}
		const conversations = Array.from(byId.values()).sort(compareConversationRecords);
		if (conversations.length > 0) {
			conversationsByAgentId[agentId] = conversations;
		}
	}

	return {
		...targetStore,
		conversationsByAgentId,
		activeConversationIdsByAgentId: {
			...(isRecord(sourceStore.activeConversationIdsByAgentId) ? sourceStore.activeConversationIdsByAgentId : {}),
			...(isRecord(targetStore.activeConversationIdsByAgentId) ? targetStore.activeConversationIdsByAgentId : {}),
		},
		updatedAt:
			maxIsoString(asString(sourceStore.updatedAt), asString(targetStore.updatedAt)) ?? new Date().toISOString(),
	};
}

function chooseRicherConversation(
	first: Record<string, unknown> | undefined,
	second: Record<string, unknown>,
): Record<string, unknown> {
	if (!first) {
		return second;
	}
	const firstTranscriptLength = Array.isArray(first.transcript) ? first.transcript.length : 0;
	const secondTranscriptLength = Array.isArray(second.transcript) ? second.transcript.length : 0;
	if (secondTranscriptLength > firstTranscriptLength) {
		return second;
	}
	const firstUpdatedAt = asString(first.updatedAt) ?? "";
	const secondUpdatedAt = asString(second.updatedAt) ?? "";
	if (secondTranscriptLength === firstTranscriptLength && secondUpdatedAt > firstUpdatedAt) {
		return second;
	}
	return first;
}

function compareConversationRecords(first: Record<string, unknown>, second: Record<string, unknown>): number {
	const firstUpdatedAt = asString(first.updatedAt) ?? "";
	const secondUpdatedAt = asString(second.updatedAt) ?? "";
	return secondUpdatedAt.localeCompare(firstUpdatedAt);
}

function maxIsoString(first: string | null, second: string | null): string | null {
	if (!first) {
		return second;
	}
	if (!second) {
		return first;
	}
	return first > second ? first : second;
}

function mergeJsonlFilesIfDifferent(sourcePath: string, targetPath: string): boolean {
	const sourceText = readFileSync(sourcePath, "utf8").trimEnd();
	const targetText = readFileSync(targetPath, "utf8").trimEnd();
	if (!sourceText || sourceText === targetText) {
		return false;
	}
	const sourceLines = sourceText.split(/\r?\n/).filter(Boolean);
	const targetLines = targetText ? targetText.split(/\r?\n/).filter(Boolean) : [];
	const seen = new Set(sourceLines);
	const mergedLines = [...sourceLines];
	for (const line of targetLines) {
		if (seen.has(line)) {
			continue;
		}
		seen.add(line);
		mergedLines.push(line);
	}
	if (mergedLines.length === targetLines.length && mergedLines.every((line, index) => line === targetLines[index])) {
		return false;
	}
	copyFileSync(targetPath, `${targetPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`);
	writeFileSync(targetPath, `${mergedLines.join("\n")}\n`, "utf8");
	return true;
}

function readJsonRecord(path: string): Record<string, unknown> | null {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return isRecord(value) ? value : null;
	} catch {
		return null;
	}
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isRecord(item)) : [];
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeStat(path: string): ReturnType<typeof statSync> | null {
	try {
		return statSync(path);
	} catch {
		return null;
	}
}
