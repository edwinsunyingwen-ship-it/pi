import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import type {
	AgentProgressEvent,
	AgentProgressEventStatus,
	AgentTaskPlan,
	ConversationAttachmentMeta,
	ConversationStoreState,
	ConversationTranscriptItem,
	StoredAgentConversation,
	WorkspaceState,
} from "../../shared/types";

function compareConversationsByCreatedAtDescending(
	first: StoredAgentConversation,
	second: StoredAgentConversation,
): number {
	const createdAtOrder = second.createdAt.localeCompare(first.createdAt);
	if (createdAtOrder !== 0) {
		return createdAtOrder;
	}
	return second.updatedAt.localeCompare(first.updatedAt);
}

export class ConversationStoreService {
	private readonly storePath = join(app.getPath("userData"), "conversations.json");
	private operationQueue: Promise<void> = Promise.resolve();

	getStore(): Promise<ConversationStoreState> {
		return this.enqueueOperation(() => this.getStoreUnqueued());
	}

	private async getStoreUnqueued(): Promise<ConversationStoreState> {
		try {
			const raw = await readFile(this.storePath, "utf8");
			return this.normalizeStore(JSON.parse(raw) as Partial<ConversationStoreState>);
		} catch {
			const store = this.createEmptyStore();
			await this.writeStore(store);
			return store;
		}
	}

	saveStore(store: ConversationStoreState): Promise<ConversationStoreState> {
		return this.enqueueOperation(async () => {
			const normalizedStore = this.normalizeStore({
				...store,
				updatedAt: new Date().toISOString(),
			});
			await this.writeStore(normalizedStore);
			return normalizedStore;
		});
	}

	private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operationQueue.then(operation);
		this.operationQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private async writeStore(store: ConversationStoreState): Promise<void> {
		await mkdir(dirname(this.storePath), { recursive: true });
		await writeFile(this.storePath, JSON.stringify(store, null, 2), "utf8");
	}

	private createEmptyStore(): ConversationStoreState {
		return {
			conversationsByAgentId: {},
			activeConversationIdsByAgentId: {},
			updatedAt: new Date().toISOString(),
		};
	}

	private normalizeStore(store: Partial<ConversationStoreState>): ConversationStoreState {
		const conversationsByAgentId: Record<string, StoredAgentConversation[]> = {};
		const activeConversationIdsByAgentId: Record<string, string> = {};
		const sourceConversations = this.isRecord(store.conversationsByAgentId) ? store.conversationsByAgentId : {};
		const sourceActiveIds = this.isRecord(store.activeConversationIdsByAgentId)
			? store.activeConversationIdsByAgentId
			: {};

		for (const [agentId, conversations] of Object.entries(sourceConversations)) {
			if (!agentId || !Array.isArray(conversations)) {
				continue;
			}
			const normalizedConversations = conversations
				.map((conversation) => this.normalizeConversation(conversation))
				.filter((conversation): conversation is StoredAgentConversation => conversation !== null)
				.sort(compareConversationsByCreatedAtDescending);
			if (normalizedConversations.length === 0) {
				continue;
			}
			conversationsByAgentId[agentId] = normalizedConversations;

			const activeId = sourceActiveIds[agentId];
			activeConversationIdsByAgentId[agentId] =
				typeof activeId === "string" && normalizedConversations.some((conversation) => conversation.id === activeId)
					? activeId
					: normalizedConversations[0].id;
		}

		return {
			conversationsByAgentId,
			activeConversationIdsByAgentId,
			updatedAt: typeof store.updatedAt === "string" ? store.updatedAt : new Date().toISOString(),
		};
	}

	private normalizeConversation(value: unknown): StoredAgentConversation | null {
		if (!this.isRecord(value) || typeof value.id !== "string") {
			return null;
		}

		const now = new Date().toISOString();
		return {
			id: value.id,
			title: typeof value.title === "string" && value.title.trim() ? value.title : "新对话",
			createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
			updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
			archivedAt: typeof value.archivedAt === "string" ? value.archivedAt : null,
			transcript: Array.isArray(value.transcript)
				? value.transcript
						.map((item) => this.normalizeTranscriptItem(item, now))
						.filter((item): item is ConversationTranscriptItem => item !== null)
				: [],
			draftMessage: typeof value.draftMessage === "string" ? value.draftMessage : "",
			workspace: this.normalizeWorkspace(value.workspace),
		};
	}

	private normalizeTranscriptItem(value: unknown, now: string): ConversationTranscriptItem | null {
		if (!this.isRecord(value) || (value.role !== "user" && value.role !== "assistant")) {
			return null;
		}

		const item: ConversationTranscriptItem = {
			role: value.role,
			text: typeof value.text === "string" ? value.text : "",
			createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
		};
		if (Array.isArray(value.attachments)) {
			item.attachments = value.attachments
				.map((attachment) => this.normalizeAttachment(attachment))
				.filter((attachment): attachment is ConversationAttachmentMeta => attachment !== null);
		}
		if (Array.isArray(value.progressEvents)) {
			item.progressEvents = value.progressEvents
				.map((event) => this.normalizeProgressEvent(event))
				.filter((event): event is AgentProgressEvent => event !== null);
		}
		if (typeof value.processingStartedAt === "string") {
			item.processingStartedAt = value.processingStartedAt;
		}
		if (typeof value.processingEndedAt === "string") {
			item.processingEndedAt = value.processingEndedAt;
		}
		if (typeof value.processingDurationMs === "number" && Number.isFinite(value.processingDurationMs)) {
			item.processingDurationMs = value.processingDurationMs;
		}
		const processingStatus = this.normalizeProgressStatus(value.processingStatus);
		if (processingStatus) {
			item.processingStatus = processingStatus;
		}
		this.inferMissingProcessingFields(item);
		return item;
	}

	private inferMissingProcessingFields(item: ConversationTranscriptItem): void {
		const events = item.progressEvents ?? [];
		if (events.length === 0) {
			return;
		}
		item.processingStartedAt = item.processingStartedAt ?? events[0]?.timestamp;
		item.processingStatus = item.processingStatus ?? events.at(-1)?.status;
		if (!item.processingEndedAt) {
			const finalEvent = [...events]
				.reverse()
				.find((event) => event.status === "success" || event.status === "failure");
			item.processingEndedAt = finalEvent?.timestamp;
		}
	}

	private normalizeProgressEvent(value: unknown): AgentProgressEvent | null {
		if (!this.isRecord(value)) {
			return null;
		}

		const status = this.normalizeProgressStatus(value.status);
		if (
			typeof value.id !== "string" ||
			typeof value.sessionId !== "string" ||
			typeof value.timestamp !== "string" ||
			typeof value.title !== "string" ||
			!status
		) {
			return null;
		}

		const source = value.source === "main" || value.source === "subagent" ? value.source : undefined;
		return {
			id: value.id,
			sessionId: value.sessionId,
			timestamp: value.timestamp,
			title: value.title,
			detail: typeof value.detail === "string" ? value.detail : undefined,
			status,
			durationMs:
				typeof value.durationMs === "number" && Number.isFinite(value.durationMs) ? value.durationMs : undefined,
			source,
			taskId: typeof value.taskId === "string" ? value.taskId : undefined,
			childSessionId: typeof value.childSessionId === "string" ? value.childSessionId : undefined,
			subagentRole: typeof value.subagentRole === "string" ? value.subagentRole : undefined,
			subagentName: typeof value.subagentName === "string" ? value.subagentName : undefined,
			taskPlan: this.normalizeTaskPlan(value.taskPlan),
		};
	}

	private normalizeTaskPlan(value: unknown): AgentTaskPlan | undefined {
		if (!this.isRecord(value) || !Array.isArray(value.steps)) {
			return undefined;
		}
		const steps: AgentTaskPlan["steps"] = value.steps.flatMap((step): AgentTaskPlan["steps"] => {
			if (!this.isRecord(step) || typeof step.id !== "string" || typeof step.title !== "string") {
				return [];
			}
			const status = step.status;
			if (status !== "pending" && status !== "in_progress" && status !== "completed" && status !== "failed") {
				return [];
			}
			return [
				{
					id: step.id,
					title: step.title,
					status,
					subagentRole: typeof step.subagentRole === "string" ? step.subagentRole : undefined,
					subagentName: typeof step.subagentName === "string" ? step.subagentName : undefined,
					note: typeof step.note === "string" ? step.note : undefined,
				},
			];
		});
		if (steps.length === 0 || typeof value.objective !== "string" || typeof value.updatedAt !== "string") {
			return undefined;
		}
		return {
			version: typeof value.version === "number" ? value.version : 1,
			objective: value.objective,
			revisionReason: typeof value.revisionReason === "string" ? value.revisionReason : "",
			updatedAt: value.updatedAt,
			steps,
		};
	}

	private normalizeProgressStatus(value: unknown): AgentProgressEventStatus | null {
		if (value === "running" || value === "success" || value === "failure" || value === "info") {
			return value;
		}
		return null;
	}

	private normalizeAttachment(value: unknown): ConversationAttachmentMeta | null {
		if (!this.isRecord(value)) {
			return null;
		}

		const kind = this.normalizeAttachmentKind(value.kind);
		if (!kind) {
			return null;
		}

		return {
			id: typeof value.id === "string" && value.id.trim() ? value.id : crypto.randomUUID(),
			name: typeof value.name === "string" && value.name.trim() ? value.name : "attachment",
			mimeType: typeof value.mimeType === "string" ? value.mimeType : "application/octet-stream",
			size: typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0 ? value.size : 0,
			kind,
			sourcePath: typeof value.sourcePath === "string" && value.sourcePath.trim() ? value.sourcePath : undefined,
			readable: typeof value.readable === "boolean" ? value.readable : false,
			truncated: typeof value.truncated === "boolean" ? value.truncated : false,
			previewDataUrl:
				typeof value.previewDataUrl === "string" && value.previewDataUrl.trim() ? value.previewDataUrl : undefined,
		};
	}

	private normalizeAttachmentKind(value: unknown): ConversationAttachmentMeta["kind"] | null {
		if (value === "image" || value === "text" || value === "document" || value === "file") {
			return value;
		}
		return null;
	}

	private normalizeWorkspace(value: unknown): WorkspaceState {
		if (!this.isRecord(value)) {
			return { path: null, selectedAt: null };
		}
		return {
			path: typeof value.path === "string" ? value.path : null,
			selectedAt: typeof value.selectedAt === "string" ? value.selectedAt : null,
		};
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return Boolean(value) && typeof value === "object" && !Array.isArray(value);
	}
}
