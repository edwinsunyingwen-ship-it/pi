import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { ConversationStoreState, StoredAgentConversation, WorkspaceState } from "../../shared/types";

export class ConversationStoreService {
	private readonly storePath = join(app.getPath("userData"), "conversations.json");

	async getStore(): Promise<ConversationStoreState> {
		try {
			const raw = await readFile(this.storePath, "utf8");
			return this.normalizeStore(JSON.parse(raw) as Partial<ConversationStoreState>);
		} catch {
			const store = this.createEmptyStore();
			await this.writeStore(store);
			return store;
		}
	}

	async saveStore(store: ConversationStoreState): Promise<ConversationStoreState> {
		const normalizedStore = this.normalizeStore({
			...store,
			updatedAt: new Date().toISOString(),
		});
		await this.writeStore(normalizedStore);
		return normalizedStore;
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
				.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
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
						.map((item) => {
							if (!this.isRecord(item) || (item.role !== "user" && item.role !== "assistant")) {
								return null;
							}
							return {
								role: item.role,
								text: typeof item.text === "string" ? item.text : "",
								createdAt: typeof item.createdAt === "string" ? item.createdAt : now,
							};
						})
						.filter((item): item is StoredAgentConversation["transcript"][number] => item !== null)
				: [],
			draftMessage: typeof value.draftMessage === "string" ? value.draftMessage : "",
			workspace: this.normalizeWorkspace(value.workspace),
		};
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
