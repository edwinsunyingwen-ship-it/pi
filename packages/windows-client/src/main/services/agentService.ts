import type {
	AgentMessageResult,
	AgentSession,
	AgentToolInfo,
	AuditStatus,
	ModelConnectionTestResult,
	ModelProfileConfig,
} from "../../shared/types";
import type { AgentAdapter } from "../agent/agentAdapter";
import type { AuditLogger } from "./auditLogger";
import type { ConfigService } from "./configService";
import type { WorkspaceService } from "./workspaceService";

export class AgentService {
	constructor(
		private readonly adapter: AgentAdapter,
		private readonly auditLogger: AuditLogger,
		private readonly workspaceService: WorkspaceService,
		private readonly configService: ConfigService,
	) {}

	async startSession(agentId?: string, workspacePath?: string | null): Promise<AgentSession> {
		const [workspace, configState] = await Promise.all([
			this.workspaceService.getWorkspace(),
			this.configService.getConfig(),
		]);
		const agent =
			configState.config.agents.find((item) => item.id === agentId && item.enabled) ??
			configState.config.agents.find((item) => item.id === configState.config.defaultAgentId && item.enabled) ??
			configState.config.agents.find((item) => item.enabled && item.type === "primary") ??
			null;
		if (!agent) {
			throw new Error("请先在配置中心创建并启用一个主智能体。");
		}
		const model =
			configState.config.model.models.find(
				(profile) => profile.id === agent.defaultModelId && profile.enabled,
			) ??
			configState.config.model.models.find((profile) => agent.modelIds.includes(profile.id) && profile.enabled) ??
			null;
		if (!model) {
			throw new Error(`智能体“${agent.name}”没有可用模型，请先为它关联并启用一个已测试通过的大模型。`);
		}
		if (!model.provider || !model.modelId) {
			throw new Error("当前启用的大模型缺少供应商或模型 ID，请回到模型配置补齐。");
		}

		const startedSession = await this.adapter.startSession({
			model,
			cwd: workspacePath ?? workspace.path,
		});
		const session: AgentSession = {
			...startedSession,
			agentId: agent.id,
			agentName: agent.name,
			modelId: model.id,
			workspacePath: workspacePath ?? workspace.path,
		};
		await this.writeAudit({
			sessionId: session.id,
			businessAction: "start-agent-session",
			outputSummary: `会话 ${session.id} 已启动。智能体：${agent.name}；模型：${model.provider}/${model.modelId || model.displayName}；能力：${agent.capabilityIds.length} 个。`,
			status: "success",
		});
		return session;
	}

	async sendUserMessage(sessionId: string, message: string): Promise<AgentMessageResult> {
		await this.writeAudit({
			sessionId,
			businessAction: "agent-user-question",
			inputSummary: this.truncate(message),
			status: "success",
		});

		try {
			const result = await this.adapter.sendUserMessage(sessionId, message);
			await this.writeAudit({
				sessionId,
				businessAction: "agent-assistant-reply",
				outputSummary: this.truncate(result.responseText),
				status: "success",
			});
			return result;
		} catch (error) {
			await this.writeAudit({
				sessionId,
				businessAction: "agent-assistant-reply",
				status: "failure",
				errorMessage: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	async stopSession(sessionId: string): Promise<AgentSession> {
		try {
			const session = await this.adapter.stopSession(sessionId);
			await this.writeAudit({
				sessionId,
				businessAction: "stop-agent-session",
				outputSummary: `会话 ${sessionId} 已停止。`,
				status: "success",
			});
			return session;
		} catch (error) {
			await this.writeAudit({
				sessionId,
				businessAction: "stop-agent-session",
				status: "failure",
				errorMessage: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	async testModelConnection(model: ModelProfileConfig): Promise<ModelConnectionTestResult> {
		const testedAt = new Date().toISOString();
		const modelName = `${model.provider || "unknown"}/${model.modelId || model.displayName || model.id}`;

		if (!model.provider.trim() || !model.modelId.trim()) {
			const message = "供应商和模型 ID 都不能为空。";
			await this.writeAudit({
				businessAction: "test-model-connection",
				inputSummary: modelName,
				outputSummary: message,
				status: "failure",
			});
			return { status: "failure", message, testedAt };
		}
		if (model.baseUrl.trim() && !this.isValidHttpUrl(model.baseUrl)) {
			const message = "Base URL 格式不正确，必须是 http:// 或 https:// 开头的完整地址。";
			await this.writeAudit({
				businessAction: "test-model-connection",
				inputSummary: modelName,
				outputSummary: message,
				status: "failure",
			});
			return { status: "failure", message, testedAt };
		}

		const workspace = await this.workspaceService.getWorkspace();
		let session: AgentSession | null = null;
		try {
			session = await this.adapter.startSession({
				model,
				cwd: workspace.path,
				isolated: true,
			});
			const result = await this.adapter.sendUserMessage(session.id, "请只回复 OK 两个字母，用于测试模型联通性。");
			if (!/\bOK\b/i.test(result.responseText)) {
				throw new Error(
					`模型已返回内容，但未按测试要求回复 OK。实际返回：${this.truncate(result.responseText, 300)}`,
				);
			}
			const message = `真实联通测试成功：${modelName}。`;
			await this.writeAudit({
				sessionId: session.id,
				businessAction: "test-model-connection",
				inputSummary: modelName,
				outputSummary: this.truncate(result.responseText),
				status: "success",
			});
			return {
				status: "success",
				message,
				responseText: this.truncate(result.responseText),
				testedAt,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.writeAudit({
				sessionId: session?.id,
				businessAction: "test-model-connection",
				inputSummary: modelName,
				status: "failure",
				errorMessage: message,
			});
			return {
				status: "failure",
				message: `真实联通测试失败：${this.truncate(message, 500)}`,
				testedAt,
			};
		} finally {
			if (session) {
				try {
					await this.adapter.stopSession(session.id);
				} catch {
					// The test process may already have exited after a failed provider call.
				}
			}
		}
	}

	getSessionState(sessionId: string): Promise<AgentSession | null> {
		return this.adapter.getSessionState(sessionId);
	}

	async listAvailableTools(): Promise<AgentToolInfo[]> {
		const [builtInTools, configState] = await Promise.all([
			this.adapter.listAvailableTools(),
			this.configService.getConfig(),
		]);
		const configuredTools: AgentToolInfo[] = configState.config.capabilities.map((capability) => ({
			name: capability.name || capability.id,
			businessAction: `${capability.type === "skill" ? "Skill" : "Tool"} / ${capability.executionMode}：${
				capability.endpoint || capability.command || capability.description || "待配置执行目标"
			}`,
			enabled: capability.enabled,
		}));
		const tools = [...builtInTools, ...configuredTools];
		await this.writeAudit({
			businessAction: "list-available-tools",
			outputSummary: `返回 ${tools.length} 个业务能力。`,
			status: "success",
		});
		return tools;
	}

	private async writeAudit(options: {
		sessionId?: string;
		businessAction: string;
		inputSummary?: string;
		outputSummary?: string;
		status: AuditStatus;
		errorMessage?: string;
	}): Promise<void> {
		const workspace = await this.workspaceService.getWorkspace();
		await this.auditLogger.write({
			timestamp: new Date().toISOString(),
			sessionId: options.sessionId,
			workspacePath: workspace.path ?? undefined,
			toolName: "agent-adapter",
			businessAction: options.businessAction,
			inputSummary: options.inputSummary,
			outputSummary: options.outputSummary,
			batch: false,
			status: options.status,
			errorMessage: options.errorMessage,
		});
	}

	private truncate(value: string, maxLength = 240): string {
		return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
	}

	private isValidHttpUrl(value: string): boolean {
		try {
			const url = new URL(value);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch {
			return false;
		}
	}
}
