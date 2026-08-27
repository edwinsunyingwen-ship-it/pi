import type {
	AgentCapabilityCallLog,
	AgentConfig,
	AgentImageInput,
	AgentMessageResult,
	AgentModelInteractionLog,
	AgentProgressEvent,
	AgentSession,
	AgentToolInfo,
	AuditStatus,
	CapabilityConfig,
	McpToolDiscoveryResult,
	ModelConnectionTestResult,
	ModelProfileConfig,
	MtclawRouterConfig,
	MtclawRouterConnectionTestResult,
} from "../../shared/types";
import { type AgentAdapter, AgentExecutionError } from "../agent/agentAdapter";
import type { AuditLogger } from "./auditLogger";
import type { ConfigService } from "./configService";
import type { SubagentDelegationRequest, SubagentDelegationResult } from "./subagentBridgeService";
import type { WorkspaceService } from "./workspaceService";

export class AgentService {
	private readonly liveProgressHandlers = new Map<string, (event: AgentProgressEvent) => void>();
	private readonly delegatedChildSessions = new Map<string, AgentSession>();

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
			configState.config.model.models.find((profile) => profile.id === agent.defaultModelId && profile.enabled) ??
			configState.config.model.models.find((profile) => agent.modelIds.includes(profile.id) && profile.enabled) ??
			null;
		if (!model) {
			throw new Error(`智能体“${agent.name}”没有可用模型，请先为它关联并启用一个已测试通过的大模型。`);
		}
		if (!model.provider || !model.modelId) {
			throw new Error("当前启用的大模型缺少供应商或模型 ID，请回到模型配置补齐。");
		}

		const enabledCapabilities = configState.config.capabilities.filter(
			(capability) => capability.enabled && agent.capabilityIds.includes(capability.id),
		);
		const childAgents = configState.config.agents.filter(
			(item) =>
				item.id !== agent.id && (agent.childAgentIds.includes(item.id) || item.parentAgentIds.includes(agent.id)),
		);
		const enabledRoleIds = new Set(
			configState.config.subagentRoles.filter((role) => role.enabled).map((role) => role.id),
		);
		const delegatableChildAgents = childAgents.filter(
			(item) =>
				item.enabled &&
				item.type === "sub" &&
				item.mtclawRole !== null &&
				enabledRoleIds.has(item.mtclawRole) &&
				(!configState.config.mtclawRouter.enabled || item.mtclawRoutingEnabled),
		);
		const delegatableSubagents = delegatableChildAgents
			.filter((item) => item.mtclawRole !== null)
			.map((item) => ({
				role: item.mtclawRole as NonNullable<typeof item.mtclawRole>,
				name: item.name,
				description: item.description,
			}));
		const effectiveWorkspacePath = workspacePath ?? workspace.path;
		const runtimeModel = this.getRuntimeModel(model, configState.config.mtclawRouter);
		const startedSession = await this.adapter.startSession({
			model: runtimeModel,
			cwd: effectiveWorkspacePath,
			agentId: agent.id,
			agentName: agent.name,
			modelProfileId: model.id,
			capabilities: enabledCapabilities,
			variables: configState.config.variables,
			contextCompaction: configState.config.contextCompaction,
			appendSystemPrompt: this.buildAgentAppendSystemPrompt(
				agent,
				model,
				enabledCapabilities,
				delegatableChildAgents,
				effectiveWorkspacePath,
			),
			subagentDelegation:
				delegatableSubagents.length > 0 ? { callerAgentId: agent.id, agents: delegatableSubagents } : undefined,
		});
		const runtimeSession = await this.adapter.getSessionState(startedSession.id);
		const session: AgentSession = {
			...startedSession,
			...(runtimeSession ?? {}),
			agentId: agent.id,
			agentName: agent.name,
			modelId: model.id,
			workspacePath: effectiveWorkspacePath,
		};
		await this.writeAudit({
			sessionId: session.id,
			businessAction: "start-agent-session",
			outputSummary: `会话 ${session.id} 已启动。智能体：${agent.name}；模型：${model.provider}/${model.modelId || model.displayName}；路由：${configState.config.mtclawRouter.enabled ? "MTClaw" : "直连"}；能力：${agent.capabilityIds.length} 个；可委托子智能体：${delegatableSubagents.length} 个。`,
			status: "success",
		});
		return session;
	}

	private getRuntimeModel(model: ModelProfileConfig, router: MtclawRouterConfig): ModelProfileConfig {
		if (!router.enabled) {
			return model;
		}
		if (!this.isValidHttpUrl(router.baseUrl)) {
			throw new Error("MTClaw Router 已启用，但 Base URL 无效。");
		}

		const compat = this.parseModelCompat(model.compat);
		return {
			...model,
			api: "openai-completions",
			baseUrl: router.baseUrl.replace(/\/$/, ""),
			apiKeyEnv: router.apiKeyEnv,
			apiKeyValue: router.apiKeyValue || "mtclaw-local",
			authType: router.apiKeyEnv || router.apiKeyValue ? "env" : "none",
			compat: JSON.stringify({ ...compat, sendSessionAffinityHeaders: true }),
		};
	}

	private parseModelCompat(value: string): Record<string, unknown> {
		if (!value.trim()) {
			return {};
		}
		try {
			const parsed = JSON.parse(value) as unknown;
			return this.isRecord(parsed) ? parsed : {};
		} catch {
			return {};
		}
	}

	async sendUserMessage(
		sessionId: string,
		message: string,
		images?: AgentImageInput[],
		onProgress?: (event: AgentProgressEvent) => void,
	): Promise<AgentMessageResult> {
		await this.writeAudit({
			sessionId,
			businessAction: "agent-user-question",
			inputSummary: this.truncate(message),
			fullInput: message,
			status: "success",
		});
		const seenProgressEventIds = new Set<string>();
		let progressAuditChain = Promise.resolve();
		const captureProgress = (event: AgentProgressEvent): void => {
			if (seenProgressEventIds.has(event.id)) {
				return;
			}
			seenProgressEventIds.add(event.id);
			progressAuditChain = progressAuditChain.then(async () => {
				try {
					await this.writeProgressEventAudit(event);
				} catch (error) {
					console.error("Failed to persist agent progress audit entry.", error);
				}
				onProgress?.(event);
			});
		};
		this.liveProgressHandlers.set(sessionId, captureProgress);
		const routerRequestStartedAt = new Date().toISOString();

		try {
			const result = await this.adapter.sendUserMessage(sessionId, message, images, captureProgress);
			await progressAuditChain;
			await this.writeModelInteractionAudits(sessionId, result.modelInteractions ?? []);
			result.capabilityCalls = await this.writeCapabilityCallAudits(sessionId, result.capabilityCalls ?? []);
			const configState = await this.configService.getConfig();
			if (configState.config.mtclawRouter.enabled) {
				const routerEvent = await this.captureMtclawRouterTrace(
					sessionId,
					message,
					routerRequestStartedAt,
					configState.config.mtclawRouter,
				);
				captureProgress(routerEvent);
				await progressAuditChain;
				result.progressEvents = [...(result.progressEvents ?? []), routerEvent];
			}
			await this.writeAudit({
				sessionId,
				businessAction: "agent-assistant-reply",
				outputSummary: this.truncate(result.responseText),
				fullOutput: result.responseText,
				status: "success",
			});
			return result;
		} catch (error) {
			await progressAuditChain;
			if (error instanceof AgentExecutionError) {
				await this.writeModelInteractionAudits(sessionId, error.diagnostics.modelInteractions);
				await this.writeCapabilityCallAudits(sessionId, error.diagnostics.capabilityCalls);
			}
			await this.writeAudit({
				sessionId,
				businessAction: "agent-assistant-reply",
				status: "failure",
				errorMessage: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			if (this.liveProgressHandlers.get(sessionId) === captureProgress) {
				this.liveProgressHandlers.delete(sessionId);
			}
		}
	}

	async delegateSubagent(request: SubagentDelegationRequest): Promise<SubagentDelegationResult> {
		const startedAt = new Date().toISOString();
		const [workspace, configState] = await Promise.all([
			this.workspaceService.getWorkspace(),
			this.configService.getConfig(),
		]);
		const caller = configState.config.agents.find((item) => item.id === request.callerAgentId && item.enabled);
		if (!caller) {
			throw new Error("Subagent delegation caller is not an enabled Staix agent.");
		}
		const enabledRoleIds = new Set(
			configState.config.subagentRoles.filter((role) => role.enabled).map((role) => role.id),
		);
		const subagent = configState.config.agents.find(
			(item) =>
				item.enabled &&
				item.type === "sub" &&
				enabledRoleIds.has(request.role) &&
				(!configState.config.mtclawRouter.enabled || item.mtclawRoutingEnabled) &&
				item.mtclawRole === request.role &&
				(caller.childAgentIds.includes(item.id) || item.parentAgentIds.includes(caller.id)),
		);
		if (!subagent) {
			throw new Error(`当前智能体没有可委托的专业子智能体：${request.role}。`);
		}

		const model =
			configState.config.model.models.find((profile) => profile.id === subagent.defaultModelId && profile.enabled) ??
			configState.config.model.models.find((profile) => subagent.modelIds.includes(profile.id) && profile.enabled) ??
			null;
		if (!model?.provider || !model.modelId) {
			throw new Error(`专业子智能体“${subagent.name}”没有可用的回答模型。`);
		}
		const enabledCapabilities = configState.config.capabilities.filter(
			(capability) => capability.enabled && subagent.capabilityIds.includes(capability.id),
		);
		const childAgents = configState.config.agents.filter(
			(item) =>
				item.id !== subagent.id &&
				(subagent.childAgentIds.includes(item.id) || item.parentAgentIds.includes(subagent.id)),
		);
		const objective = request.context
			? `${request.objective}\n\n## 委托上下文\n${request.context}`
			: request.objective;
		const delegatedSessionKey = this.getDelegatedChildSessionKey(request.parentSessionId, subagent.id);
		let childSession = delegatedSessionKey ? (this.delegatedChildSessions.get(delegatedSessionKey) ?? null) : null;
		if (childSession) {
			const currentState = await this.adapter.getSessionState(childSession.id);
			if (!currentState || currentState.state === "stopped") {
				this.delegatedChildSessions.delete(delegatedSessionKey);
				childSession = null;
			} else {
				childSession = { ...childSession, ...currentState };
			}
		}

		await this.writeAudit({
			sessionId: request.parentSessionId,
			businessAction: "delegate-subagent-start",
			inputSummary: `${request.role} / ${request.planStepId}：${this.truncate(request.objective)}`,
			fullInput: request.objective,
			outputSummary: `准备由 pi-agent 子智能体“${subagent.name}”执行任务 ${request.taskId}。`,
			status: "success",
		});

		try {
			if (!childSession) {
				childSession = await this.adapter.startSession({
					model,
					cwd: workspace.path,
					agentId: subagent.id,
					agentName: subagent.name,
					modelProfileId: model.id,
					capabilities: enabledCapabilities,
					variables: configState.config.variables,
					contextCompaction: configState.config.contextCompaction,
					appendSystemPrompt: [
						this.buildAgentAppendSystemPrompt(subagent, model, enabledCapabilities, childAgents, workspace.path),
						"",
						"# 专业子任务委托合同",
						`- 初始任务 ID：${request.taskId}`,
						`- 稳定角色：${request.role}`,
						"- 同一主会话中的后续委托会继续使用当前子会话，以保留已经核验的材料和预览。",
						"- 这是由主智能体委托并由 pi-agent 隔离 Runtime 执行的专业子任务。",
						"- 根据任务需要自主选择已绑定工具；不要把一次工具调用冒充为完整子智能体执行。",
						"- 输出可复核的事实、来源、判断、限制和错误；不得编造未查询到的数据。",
						"- 同一主会话中的历史委托结果保存在当前子会话上下文中；直接引用已有内容，不要编造 internal.staix.cn/task 或其他不存在的任务链接。",
						"- 只有工具真实返回的 URL、本地路径或用户提供的地址才可以作为可访问引用。",
					].join("\n"),
					isolated: true,
				});
				if (delegatedSessionKey) {
					this.delegatedChildSessions.set(delegatedSessionKey, childSession);
				}
			}
			const parentProgressHandler = this.liveProgressHandlers.get(request.parentSessionId);
			const result = await this.adapter.sendUserMessage(
				childSession.id,
				objective,
				undefined,
				parentProgressHandler
					? (event) => {
							parentProgressHandler(this.toParentSubagentProgressEvent(request, subagent, event));
						}
					: undefined,
			);
			await this.writeModelInteractionAudits(childSession.id, result.modelInteractions ?? []);
			result.capabilityCalls = await this.writeCapabilityCallAudits(childSession.id, result.capabilityCalls ?? []);
			const endedAt = new Date().toISOString();
			const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
			const delegationResult: SubagentDelegationResult = {
				taskId: request.taskId,
				parentSessionId: request.parentSessionId,
				childSessionId: childSession.id,
				role: request.role,
				agentId: subagent.id,
				agentName: subagent.name,
				status: "success",
				summary: result.responseText,
				toolCalls: (result.capabilityCalls ?? []).map((call) => ({
					toolName: call.toolName,
					capabilityId: call.capabilityId,
					capabilityName: call.capabilityName,
					status: call.status,
				})),
				progressEvents: (result.progressEvents ?? []).map((event) => ({
					...event,
					id: this.getParentSubagentProgressEventId(request.taskId, event.id),
				})),
				limitations: [],
				errors: [],
				startedAt,
				endedAt,
				durationMs,
			};
			await this.writeAudit({
				sessionId: request.parentSessionId,
				businessAction: "delegate-subagent-result",
				inputSummary: `${request.role} / ${request.taskId}`,
				outputSummary: this.truncate(result.responseText, 500),
				fullOutput: result.responseText,
				status: "success",
			});
			return delegationResult;
		} catch (error) {
			await this.writeAudit({
				sessionId: request.parentSessionId,
				businessAction: "delegate-subagent-result",
				inputSummary: `${request.role} / ${request.taskId}`,
				status: "failure",
				errorMessage: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			if (childSession && !delegatedSessionKey) {
				try {
					await this.adapter.stopSession(childSession.id);
				} catch {
					// The child runtime may already have exited after a provider or tool failure.
				}
			}
		}
	}

	private getDelegatedChildSessionKey(parentSessionId: string, subagentId: string): string {
		return parentSessionId ? `${parentSessionId}:${subagentId}` : "";
	}

	private async stopDelegatedChildSessions(parentSessionId: string): Promise<void> {
		const keyPrefix = `${parentSessionId}:`;
		const sessions = Array.from(this.delegatedChildSessions.entries()).filter(([key]) => key.startsWith(keyPrefix));
		for (const [key, session] of sessions) {
			this.delegatedChildSessions.delete(key);
			try {
				await this.adapter.stopSession(session.id);
			} catch {
				// A child runtime may already have exited independently.
			}
		}
	}

	private toParentSubagentProgressEvent(
		request: SubagentDelegationRequest,
		subagent: AgentConfig,
		event: AgentProgressEvent,
	): AgentProgressEvent {
		return {
			...event,
			id: this.getParentSubagentProgressEventId(request.taskId, event.id),
			sessionId: request.parentSessionId,
			title: `子智能体 · ${subagent.name} · ${event.title}`,
			source: "subagent",
			taskId: request.taskId,
			childSessionId: event.sessionId,
			subagentRole: request.role,
			subagentName: subagent.name,
		};
	}

	private getParentSubagentProgressEventId(taskId: string, childEventId: string): string {
		return `subagent-${taskId}-${childEventId}`;
	}

	async testMtclawRouterConnection(router: MtclawRouterConfig): Promise<MtclawRouterConnectionTestResult> {
		const testedAt = new Date().toISOString();
		if (!this.isValidHttpUrl(router.baseUrl)) {
			const message = "MTClaw Router Base URL 无效，必须是 http:// 或 https:// 开头的完整地址。";
			await this.writeAudit({
				businessAction: "test-mtclaw-router-connection",
				inputSummary: router.baseUrl,
				outputSummary: message,
				status: "failure",
			});
			return { status: "failure", message, testedAt };
		}

		try {
			const [health, ready, tools] = await Promise.all([
				this.fetchMtclawRouterJson(router, "/health"),
				this.fetchMtclawRouterJson(router, "/ready"),
				this.fetchMtclawRouterJson(router, "/v1/tools"),
			]);
			const healthStatus = this.getStringProperty(health, "status") || "unknown";
			const readyStatus = this.getStringProperty(ready, "status") || "unknown";
			const toolsLoaded = this.getMtclawToolCount(tools);
			if (healthStatus !== "ok" || readyStatus !== "ok") {
				throw new Error(`Router 状态异常：health=${healthStatus}，ready=${readyStatus}`);
			}
			const message = `MTClaw Function Router 已就绪，加载 ${toolsLoaded} 个专业工具。`;
			await this.writeAudit({
				toolName: "mtclaw-function-router",
				businessAction: "test-mtclaw-router-connection",
				inputSummary: router.baseUrl,
				outputSummary: message,
				status: "success",
			});
			return { status: "success", message, testedAt, healthStatus, readyStatus, toolsLoaded };
		} catch (error) {
			const errorMessage = this.truncate(
				this.redactSensitive(error instanceof Error ? error.message : String(error)),
				500,
			);
			const message = `MTClaw Function Router 联通失败：${errorMessage}`;
			await this.writeAudit({
				toolName: "mtclaw-function-router",
				businessAction: "test-mtclaw-router-connection",
				inputSummary: router.baseUrl,
				status: "failure",
				errorMessage: message,
			});
			return { status: "failure", message, testedAt };
		}
	}

	async stopSession(sessionId: string): Promise<AgentSession> {
		try {
			const session = await this.adapter.stopSession(sessionId);
			await this.stopDelegatedChildSessions(sessionId);
			await this.writeAudit({
				sessionId,
				businessAction: "stop-agent-session",
				outputSummary: `会话 ${sessionId} 已停止。`,
				status: "success",
			});
			return session;
		} catch (error) {
			await this.stopDelegatedChildSessions(sessionId);
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

	async discoverMcpTools(capability: CapabilityConfig): Promise<McpToolDiscoveryResult> {
		const testedAt = new Date().toISOString();
		const capabilityName = capability.name || capability.mcpServerName || "MCP";

		if (capability.type !== "mcp") {
			return {
				status: "failure",
				message: "只有 MCP 类型的能力可以发现工具。",
				tools: [],
				testedAt,
			};
		}
		if (!capability.mcpUrl.trim() || !this.isValidHttpUrl(capability.mcpUrl)) {
			const message = "MCP 服务地址不正确，请填写 http:// 或 https:// 开头的完整地址。";
			await this.writeAudit({
				businessAction: "discover-mcp-tools",
				inputSummary: capabilityName,
				outputSummary: message,
				status: "failure",
			});
			return { status: "failure", message, tools: [], testedAt };
		}
		if (capability.mcpAuthType === "bearer" && !capability.mcpApiKeyValue.trim()) {
			const message = "当前 MCP 服务选择了 Bearer Token，请先填写 API Key / Token。";
			await this.writeAudit({
				businessAction: "discover-mcp-tools",
				inputSummary: capabilityName,
				outputSummary: message,
				status: "failure",
			});
			return { status: "failure", message, tools: [], testedAt };
		}

		try {
			const headers = this.parseHeaderJson(capability.mcpHeadersJson);
			const session: { id?: string } = {};
			await this.postMcp(
				capability,
				session,
				{
					jsonrpc: "2.0",
					id: "initialize",
					method: "initialize",
					params: {
						protocolVersion: "2024-11-05",
						capabilities: {},
						clientInfo: { name: "pi-windows-client", version: "0.1.0" },
					},
				},
				headers,
			);
			try {
				await this.postMcp(capability, session, { jsonrpc: "2.0", method: "notifications/initialized" }, headers);
			} catch {
				// Some MCP HTTP services do not require this notification.
			}
			const result = await this.postMcp(
				capability,
				session,
				{ jsonrpc: "2.0", id: "tools-list", method: "tools/list", params: {} },
				headers,
			);
			const tools = this.normalizeDiscoveredMcpTools(result);
			const message =
				tools.length > 0 ? `发现 ${tools.length} 个 MCP 工具。` : "MCP 服务已连接，但没有返回可用工具。";
			await this.writeAudit({
				businessAction: "discover-mcp-tools",
				inputSummary: capabilityName,
				outputSummary: message,
				status: tools.length > 0 ? "success" : "failure",
			});
			return {
				status: tools.length > 0 ? "success" : "failure",
				message,
				tools,
				testedAt,
			};
		} catch (error) {
			const message = `发现 MCP 工具失败：${this.truncate(
				this.redactSensitive(error instanceof Error ? error.message : String(error)),
				500,
			)}`;
			await this.writeAudit({
				businessAction: "discover-mcp-tools",
				inputSummary: capabilityName,
				status: "failure",
				errorMessage: message,
			});
			return { status: "failure", message, tools: [], testedAt };
		}
	}

	async listAvailableTools(): Promise<AgentToolInfo[]> {
		const [builtInTools, configState] = await Promise.all([
			this.adapter.listAvailableTools(),
			this.configService.getConfig(),
		]);
		const configuredTools: AgentToolInfo[] = configState.config.capabilities.map((capability) => ({
			name: capability.name || capability.id,
			businessAction: `${capability.type} / ${capability.category || "未分类"}；${
				capability.description || capability.content || "待补充能力说明"
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
		toolName?: string;
		businessAction: string;
		operationStartedAt?: string;
		operationEndedAt?: string;
		inputSummary?: string;
		outputSummary?: string;
		fullInput?: string;
		fullOutput?: string;
		status: AuditStatus;
		errorMessage?: string;
	}): Promise<void> {
		const workspace = await this.workspaceService.getWorkspace();
		await this.auditLogger.write({
			timestamp: new Date().toISOString(),
			operationStartedAt: options.operationStartedAt,
			operationEndedAt: options.operationEndedAt,
			sessionId: options.sessionId,
			workspacePath: workspace.path ?? undefined,
			toolName: options.toolName ?? "agent-adapter",
			businessAction: options.businessAction,
			inputSummary: options.inputSummary,
			outputSummary: options.outputSummary,
			fullInput: options.fullInput,
			fullOutput: options.fullOutput,
			batch: false,
			status: options.status,
			errorMessage: options.errorMessage,
		});
	}

	private async writeProgressEventAudit(event: AgentProgressEvent): Promise<void> {
		const toolMatch = event.title.match(/^(?:调用工具|工具进展|工具完成)：(.+)$/);
		const outputSummary = event.detail ? `${event.title}：${event.detail}` : event.title;
		await this.writeAudit({
			sessionId: event.sessionId,
			toolName: toolMatch?.[1] ?? (event.source === "subagent" ? "subagent-runtime" : "agent-runtime"),
			businessAction: event.source === "subagent" ? "subagent-progress" : "agent-progress",
			operationStartedAt: event.timestamp,
			inputSummary: event.title,
			outputSummary: this.truncate(outputSummary, 500),
			fullOutput: this.redactSensitive(JSON.stringify(event, null, 2)),
			status: event.status,
		});
	}

	private async writeCapabilityCallAudits(
		sessionId: string,
		calls: AgentCapabilityCallLog[],
	): Promise<AgentCapabilityCallLog[]> {
		if (calls.length === 0) {
			return [];
		}

		const session = await this.adapter.getSessionState(sessionId);
		const configState = await this.configService.getConfig();
		const activeAgent = configState.config.agents.find((agent) => agent.id === session?.agentId);
		const enabledCapabilities = activeAgent
			? configState.config.capabilities.filter(
					(capability) => capability.enabled && activeAgent.capabilityIds.includes(capability.id),
				)
			: [];
		const resolvedCalls: AgentCapabilityCallLog[] = [];

		for (const call of calls) {
			const matchedCapability = this.findMatchingCapability(call, enabledCapabilities);
			const resolvedCall: AgentCapabilityCallLog = matchedCapability
				? {
						...call,
						capabilityId: matchedCapability.id,
						capabilityName: matchedCapability.name,
					}
				: {
						...call,
						capabilityId: undefined,
						capabilityName: undefined,
					};
			resolvedCalls.push(resolvedCall);
			const capabilityMeta = this.getCapabilityMeta(resolvedCall, matchedCapability);
			const callSummary = capabilityMeta.join("；");
			if (resolvedCall.inputSummary) {
				const input = this.redactSensitive(resolvedCall.inputSummary);
				await this.writeAudit({
					sessionId,
					toolName: resolvedCall.toolName,
					businessAction: "capability-invoked",
					operationStartedAt: resolvedCall.startedAt,
					inputSummary: this.truncate(input, 500),
					outputSummary: callSummary,
					fullInput: resolvedCall.fullInput ? this.redactSensitive(resolvedCall.fullInput) : input,
					fullOutput: callSummary,
					status: "success",
				});
			}

			const resultSummary = this.redactSensitive(
				resolvedCall.outputSummary ||
					`能力 ${capabilityMeta[0]?.replace(/^能力：/, "") || "未知能力"} 已执行，但没有返回可展示内容。`,
			);
			const resultOutput = `${callSummary}；返回：${resultSummary}`;
			await this.writeAudit({
				sessionId,
				toolName: resolvedCall.toolName,
				businessAction: "capability-result",
				operationStartedAt: resolvedCall.startedAt,
				operationEndedAt: resolvedCall.endedAt,
				inputSummary: resolvedCall.inputSummary
					? this.truncate(this.redactSensitive(resolvedCall.inputSummary), 240)
					: undefined,
				outputSummary: this.truncate(resultOutput, 500),
				fullInput: resolvedCall.fullInput
					? this.redactSensitive(resolvedCall.fullInput)
					: resolvedCall.inputSummary
						? this.redactSensitive(resolvedCall.inputSummary)
						: undefined,
				fullOutput: resolvedCall.fullOutput
					? `${callSummary}；返回：${this.redactSensitive(resolvedCall.fullOutput)}`
					: resultOutput,
				status: resolvedCall.status,
				errorMessage:
					resolvedCall.status === "failure"
						? this.truncate(this.redactSensitive(resolvedCall.outputSummary ?? ""), 500)
						: undefined,
			});
		}

		return resolvedCalls;
	}

	private async writeModelInteractionAudits(
		sessionId: string,
		interactions: AgentModelInteractionLog[],
	): Promise<void> {
		for (const interaction of interactions) {
			const modelLabel = [interaction.modelProvider, interaction.modelId].filter(Boolean).join("/");
			const action =
				interaction.kind === "context"
					? "model-request-context"
					: interaction.kind === "payload"
						? "model-request-payload"
						: "model-response";
			const modelSummary = modelLabel
				? `${modelLabel}${interaction.modelApi ? ` (${interaction.modelApi})` : ""}`
				: "unknown model";

			await this.writeAudit({
				sessionId,
				toolName: "llm-provider",
				businessAction: action,
				operationStartedAt: interaction.startedAt,
				operationEndedAt: interaction.endedAt,
				inputSummary: interaction.inputSummary
					? this.truncate(`${modelSummary}: ${interaction.inputSummary}`, 500)
					: modelSummary,
				outputSummary: interaction.outputSummary
					? this.truncate(`${modelSummary}: ${interaction.outputSummary}`, 500)
					: undefined,
				fullInput: interaction.fullInput,
				fullOutput: interaction.fullOutput,
				status: interaction.status,
				errorMessage: interaction.errorMessage
					? this.truncate(this.redactSensitive(interaction.errorMessage), 500)
					: undefined,
			});
		}
	}

	private getCapabilityDisplayName(call: AgentCapabilityCallLog, capability?: CapabilityConfig): string {
		return capability?.name || call.toolName || call.toolCallId || "未知能力";
	}

	private getCapabilityMeta(call: AgentCapabilityCallLog, capability?: CapabilityConfig): string[] {
		const type = capability ? this.getCapabilityTypeLabel(capability) : this.getBuiltinToolType(call.toolName);
		const execution = capability ? this.getCapabilityExecutionLabel(capability) : "石斧智能体内置工具";
		const parts = [
			`能力：${this.getCapabilityDisplayName(call, capability)}`,
			`工具：${call.toolName || "未知工具"}`,
			`类型：${type}`,
			`执行方式：${execution}`,
		];
		if (call.toolCallId) {
			parts.push(`调用ID：${call.toolCallId}`);
		}
		if (capability?.mcpServerName) {
			parts.push(`MCP：${capability.mcpServerName}`);
		}
		return parts;
	}

	private getBuiltinToolType(toolName: string): string {
		return ["read", "bash", "edit", "write"].includes(toolName) ? "内置工具" : "工具";
	}

	private getCapabilityTypeLabel(capability: CapabilityConfig): string {
		const labels: Record<CapabilityConfig["type"], string> = {
			tool: "Tool",
			skill: "Skill",
			mcp: "MCP",
			browser: "浏览器能力",
			http: "HTTP 接口",
			command: "本地命令",
			other: "其他能力",
		};
		return labels[capability.type] ?? capability.type;
	}

	private getCapabilityExecutionLabel(capability: CapabilityConfig): string {
		const labels: Record<CapabilityConfig["executionMode"], string> = {
			http: "HTTP API",
			command: "本地命令",
			builtin: "内置能力",
			mcp: "MCP 工具",
			manual: "手动/占位",
		};
		return labels[capability.executionMode] ?? capability.executionMode;
	}

	private findMatchingCapability(
		call: AgentCapabilityCallLog,
		capabilities: CapabilityConfig[],
	): CapabilityConfig | undefined {
		if (call.capabilityId) {
			const capabilityById = capabilities.find((capability) => capability.id === call.capabilityId);
			if (capabilityById) {
				return capabilityById;
			}
		}

		if (call.capabilityName) {
			const capabilityByName = capabilities.find((capability) => capability.name === call.capabilityName);
			if (capabilityByName) {
				return capabilityByName;
			}
		}

		const capabilityByToolName = capabilities.filter((capability) => {
			const configuredNames = [
				capability.toolName,
				capability.toolName ? this.normalizePromptToolName(capability.toolName) : "",
				...capability.mcpTools.filter((tool) => tool.enabled).map((tool) => tool.name),
			].filter(Boolean);
			return configuredNames.includes(call.toolName);
		});
		if (capabilityByToolName.length === 1) {
			return capabilityByToolName[0];
		}

		if (call.toolName === "bash") {
			return this.findMatchingCommandCapability(call, capabilities);
		}

		return undefined;
	}

	private findMatchingCommandCapability(
		call: AgentCapabilityCallLog,
		capabilities: CapabilityConfig[],
	): CapabilityConfig | undefined {
		const command = this.extractCommandInput(call.fullInput) || this.extractCommandInput(call.inputSummary);
		const executable = command ? this.extractCommandExecutable(command) : "";
		if (!executable) {
			return undefined;
		}

		const commandCapabilities = capabilities.filter(
			(capability) => capability.type === "command" || capability.executionMode === "command",
		);
		const matches = commandCapabilities
			.map((capability) => ({
				capability,
				score:
					(this.containsCommandExecutable(capability.command, executable) ? 2 : 0) +
					(this.containsCommandExecutable(capability.content, executable) ? 1 : 0),
			}))
			.filter((match) => match.score > 0);
		const highestScore = Math.max(0, ...matches.map((match) => match.score));
		const bestMatches = matches.filter((match) => match.score === highestScore);
		return bestMatches.length === 1 ? bestMatches[0].capability : undefined;
	}

	private extractCommandInput(value: string | undefined): string {
		if (!value?.trim()) {
			return "";
		}
		try {
			const parsed = JSON.parse(value) as unknown;
			if (this.isRecord(parsed) && typeof parsed.command === "string") {
				return parsed.command;
			}
		} catch {
			// Input summaries may be plain command strings rather than JSON.
		}
		return value;
	}

	private extractCommandExecutable(command: string): string {
		const firstSegment = command.split(/(?:\r?\n|&&|\|\||[;|])/)[0]?.trim() ?? "";
		const tokens =
			firstSegment.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? [];
		let index = 0;
		while (index < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]) || tokens[index] === "env")) {
			index++;
		}
		if (tokens[index] === "sudo") {
			index++;
		}
		const executable = tokens[index] ?? "";
		return executable.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
	}

	private containsCommandExecutable(source: string, executable: string): boolean {
		if (!source.trim() || !executable) {
			return false;
		}
		const escaped = executable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(`(^|[^a-zA-Z0-9_.-])${escaped}(?=$|[\\s'"])`, "im").test(source);
	}

	private truncate(value: string, maxLength = 240): string {
		return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
	}

	private redactSensitive(value: string): string {
		return value
			.replace(/("(?:api[_-]?key|token|authorization|password|secret)"\s*:\s*)"[^"]+"/gi, '$1"***"')
			.replace(/(bearer\s+)[a-z0-9._-]+/gi, "$1***");
	}

	private isValidHttpUrl(value: string): boolean {
		try {
			const url = new URL(value);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch {
			return false;
		}
	}

	private getMtclawRouterRoot(baseUrl: string): string {
		return baseUrl.trim().replace(/\/$/, "").replace(/\/v1$/, "");
	}

	private getMtclawRouterHeaders(router: MtclawRouterConfig): Record<string, string> {
		const environmentValue = router.apiKeyEnv ? process.env[router.apiKeyEnv] : undefined;
		const apiKey = environmentValue?.trim() || router.apiKeyValue.trim();
		return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
	}

	private async fetchMtclawRouterJson(router: MtclawRouterConfig, path: string): Promise<unknown> {
		const response = await fetch(`${this.getMtclawRouterRoot(router.baseUrl)}${path}`, {
			headers: this.getMtclawRouterHeaders(router),
			signal: AbortSignal.timeout(10000),
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}：${this.redactSensitive(text).slice(0, 500)}`);
		}
		return text.trim() ? (JSON.parse(text) as unknown) : {};
	}

	private getStringProperty(value: unknown, key: string): string {
		return this.isRecord(value) && typeof value[key] === "string" ? value[key] : "";
	}

	private normalizeMtclawTraceMessage(value: string): string {
		return value.replace(/\s+/g, " ").trim();
	}

	private mtclawTraceMessagesMatch(left: string, right: string): boolean {
		const normalizedLeft = this.normalizeMtclawTraceMessage(left);
		const normalizedRight = this.normalizeMtclawTraceMessage(right);
		if (normalizedLeft === normalizedRight) {
			return true;
		}
		const shorterLength = Math.min(normalizedLeft.length, normalizedRight.length);
		if (shorterLength < 24) {
			return false;
		}
		const stablePrefixLength = Math.min(shorterLength, 160);
		return normalizedLeft.slice(0, stablePrefixLength) === normalizedRight.slice(0, stablePrefixLength);
	}

	private getMtclawToolCount(value: unknown): number {
		if (Array.isArray(value)) {
			return value.length;
		}
		return this.isRecord(value) && Array.isArray(value.tools) ? value.tools.length : 0;
	}

	private async captureMtclawRouterTrace(
		sessionId: string,
		userMessage: string,
		requestStartedAt: string,
		router: MtclawRouterConfig,
	): Promise<AgentProgressEvent> {
		const timestamp = new Date().toISOString();
		try {
			const requestStartedAtMs = Date.parse(requestStartedAt);
			let entry: unknown;
			const tracePollAttempts = 12;
			const tracePollIntervalMs = 500;
			for (let attempt = 0; attempt < tracePollAttempts && !entry; attempt++) {
				if (attempt > 0) {
					await new Promise((resolvePromise) => setTimeout(resolvePromise, tracePollIntervalMs));
				}
				const history = await this.fetchMtclawRouterJson(router, "/v1/tool_history?limit=100");
				const entries = this.isRecord(history) && Array.isArray(history.entries) ? history.entries : [];
				const exactSessionEntry = entries.find(
					(item) =>
						this.isRecord(item) &&
						this.getStringProperty(item, "session_key") === sessionId &&
						Date.parse(this.getStringProperty(item, "timestamp")) >= requestStartedAtMs,
				);
				const matchingRequestEntries = entries
					.filter(
						(item) =>
							this.isRecord(item) &&
							this.mtclawTraceMessagesMatch(this.getStringProperty(item, "user_message"), userMessage) &&
							Date.parse(this.getStringProperty(item, "timestamp")) >= requestStartedAtMs,
					)
					.sort(
						(left, right) =>
							Date.parse(this.getStringProperty(right, "timestamp")) -
							Date.parse(this.getStringProperty(left, "timestamp")),
					);
				entry = exactSessionEntry ?? matchingRequestEntries[0];
			}
			if (!entry || !this.isRecord(entry)) {
				const detail = "请求已由 pi-agent 发送到 MTClaw，但 Router 尚未返回对应会话的追踪记录。";
				await this.writeAudit({
					sessionId,
					toolName: "mtclaw-function-router",
					businessAction: "mtclaw-router-trace",
					outputSummary: detail,
					status: "success",
				});
				return {
					id: `mtclaw-router-${sessionId}-${Date.now()}`,
					sessionId,
					timestamp,
					title: "MTClaw 路由已完成",
					detail,
					status: "info",
				};
			}

			const toolCalls = Array.isArray(entry.tool_calls) ? entry.tool_calls : [];
			const toolNames = Array.from(
				new Set(
					toolCalls
						.map((call) => (this.isRecord(call) ? this.getStringProperty(call, "name") : ""))
						.filter(Boolean),
				),
			);
			const llmCalls = Array.isArray(entry.llm_calls) ? entry.llm_calls : [];
			const modelNames = llmCalls
				.map((call) => (this.isRecord(call) ? this.getStringProperty(call, "model") : ""))
				.filter(Boolean);
			const detail = [
				"pi-agent 会话保持不变",
				`Router 专业工具：${toolNames.length > 0 ? toolNames.join("、") : "未调用"}`,
				`Router/回答模型调用：${modelNames.length > 0 ? modelNames.join(" -> ") : "已记录"}`,
			].join("；");
			await this.writeAudit({
				sessionId,
				toolName: "mtclaw-function-router",
				businessAction: "mtclaw-router-trace",
				inputSummary: `Router session_key=${sessionId}`,
				outputSummary: detail,
				fullOutput: this.redactSensitive(JSON.stringify(entry, null, 2)),
				status: "success",
			});
			return {
				id: `mtclaw-router-${sessionId}-${Date.now()}`,
				sessionId,
				timestamp,
				title: "MTClaw 路由追踪",
				detail,
				status: "success",
			};
		} catch (error) {
			const detail = `回答已完成，但读取 MTClaw 路由追踪失败：${this.truncate(
				this.redactSensitive(error instanceof Error ? error.message : String(error)),
				300,
			)}`;
			await this.writeAudit({
				sessionId,
				toolName: "mtclaw-function-router",
				businessAction: "mtclaw-router-trace",
				status: "failure",
				errorMessage: detail,
			});
			return {
				id: `mtclaw-router-${sessionId}-${Date.now()}`,
				sessionId,
				timestamp,
				title: "MTClaw 路由追踪不可用",
				detail,
				status: "info",
			};
		}
	}

	private parseHeaderJson(value: string): Record<string, string> {
		if (!value.trim()) {
			return {};
		}
		try {
			const parsed = JSON.parse(value) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("请求头必须是 JSON 对象。");
			}
			return Object.fromEntries(
				Object.entries(parsed as Record<string, unknown>)
					.filter(([, headerValue]) => headerValue !== undefined && headerValue !== null)
					.map(([key, headerValue]) => [key, String(headerValue)]),
			);
		} catch (error) {
			throw new Error(`请求头 JSON 格式不正确：${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async postMcp(
		capability: CapabilityConfig,
		session: { id?: string },
		payload: Record<string, unknown>,
		extraHeaders: Record<string, string>,
	): Promise<unknown> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			...extraHeaders,
		};
		if (capability.mcpAuthType === "bearer" && capability.mcpApiKeyValue.trim()) {
			headers.Authorization = `Bearer ${capability.mcpApiKeyValue.trim()}`;
		}
		if (session.id) {
			headers["mcp-session-id"] = session.id;
		}

		const response = await fetch(capability.mcpUrl, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});
		const sessionId = response.headers.get("mcp-session-id");
		if (sessionId) {
			session.id = sessionId;
		}
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}：${this.redactSensitive(text).slice(0, 800)}`);
		}
		const data = this.parseMcpResponseText(text);
		if (this.isRecord(data) && data.error) {
			throw new Error(this.redactSensitive(JSON.stringify(data.error)));
		}
		return this.isRecord(data) && "result" in data ? data.result : data;
	}

	private parseMcpResponseText(text: string): unknown {
		const trimmed = text.trim();
		if (!trimmed) {
			return {};
		}
		if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
			return JSON.parse(trimmed) as unknown;
		}
		const messages: unknown[] = [];
		for (const line of trimmed.split(/\r?\n/)) {
			const match = line.match(/^data:\s*(.+)$/);
			if (!match || match[1] === "[DONE]") {
				continue;
			}
			try {
				messages.push(JSON.parse(match[1]) as unknown);
			} catch {
				// Ignore non-JSON SSE lines.
			}
		}
		return (
			messages.find((item) => this.isRecord(item) && ("result" in item || "error" in item)) ?? messages.at(-1) ?? {}
		);
	}

	private normalizeDiscoveredMcpTools(result: unknown): McpToolDiscoveryResult["tools"] {
		const sourceTools = this.isRecord(result) && Array.isArray(result.tools) ? result.tools : [];
		return sourceTools
			.map((tool) => {
				const record = this.isRecord(tool) ? tool : {};
				const name = typeof record.name === "string" ? record.name.trim() : "";
				const description = typeof record.description === "string" ? record.description.trim() : "";
				const inputSchema = this.isRecord(record.inputSchema) ? record.inputSchema : {};
				return {
					name,
					description,
					inputSchemaJson: Object.keys(inputSchema).length > 0 ? JSON.stringify(inputSchema, null, 2) : "",
					enabled: true,
				};
			})
			.filter((tool) => tool.name.length > 0);
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return Boolean(value) && typeof value === "object" && !Array.isArray(value);
	}

	private buildAgentAppendSystemPrompt(
		agent: AgentConfig,
		model: ModelProfileConfig,
		capabilities: CapabilityConfig[],
		childAgents: AgentConfig[],
		workspacePath: string | null,
	): string {
		return this.buildStructuredAgentAppendSystemPrompt(agent, model, capabilities, childAgents, workspacePath);
	}

	private buildStructuredAgentAppendSystemPrompt(
		agent: AgentConfig,
		model: ModelProfileConfig,
		capabilities: CapabilityConfig[],
		childAgents: AgentConfig[],
		workspacePath: string | null,
	): string {
		return [
			"# Windows 客户端智能体配置",
			"",
			"以下内容来自 Windows 客户端的可视化配置，用于补充石斧智能体运行时默认 system prompt。",
			"",
			"## 当前智能体",
			`- 名称：${agent.name}`,
			`- 类型：${agent.type === "primary" ? "主智能体" : "子智能体"}`,
			`- 描述：${agent.description || "未填写"}`,
			`- 备注：${agent.notes || "无"}`,
			`- 最大子任务层级：${agent.maxDelegationDepth}`,
			"",
			"## 智能体规则",
			`- 角色定位：${agent.rules.role || "未填写"}`,
			`- 工作目标：${agent.rules.goals || "未填写"}`,
			`- 处理流程：${agent.rules.process || "未填写"}`,
			`- 输出格式：${agent.rules.outputFormat || "未填写"}`,
			`- 注意事项：${agent.rules.constraints || "未填写"}`,
			`- 业务术语/偏好：${agent.rules.terminology || "未填写"}`,
			"",
			"## 当前模型",
			`- Provider：${model.providerLabel || model.provider}`,
			`- 模型 ID：${model.modelId}`,
			`- 显示名称：${model.displayName || model.modelId}`,
			`- 输入能力：${model.input.includes("image") ? "文本 + 视觉" : "文本"}`,
			`- Thinking：${model.supportsReasoning ? model.defaultThinkingLevel : "不支持"}`,
			"",
			"## 当前工作区",
			`- 路径：${workspacePath || "未选择"}`,
			"- 工作区只是默认工作目录；未选择工作区不代表不能处理用户提供的附件或绝对路径文件。",
			"- 如果用户消息、附件清单或上下文中提供了绝对路径或可访问路径，优先使用现有石斧智能体工具读取该路径，不要要求用户先选择工作区。",
			"- 只有在需要创建/写入文件且无法从用户要求、附件路径或上下文推断输出目录时，才要求用户选择工作区或指定输出位置。",
			"- 不要声称已经读取未实际读取的文件；依据不足时说明需要用户选择文件或补充材料。",
			"",
			...this.formatCapabilitiesForPrompt(capabilities),
			...this.formatKnowledgeForPrompt(agent),
			...this.formatChildAgentsForPrompt(childAgents),
			...this.formatTaskTemplatesForPrompt(agent),
			"",
			"## 工作方式补充",
			"- 使用中文与用户沟通，除非用户明确要求其他语言。",
			"- 回答时优先围绕当前智能体职责、当前工作区和用户明确选择的上下文。",
			"- 对多步骤任务或需要子智能体的任务，必须先调用 update_task_plan 创建全局计划；范围、证据或结论发生变化时再次调用它修订计划。",
			"- 调用 delegate_to_subagent 时必须绑定真实的 planStepId；只有收到结构化结果后，才可以声称已经完成该子任务调度。",
			"- 计划中的每个步骤应分配给职责最匹配的已配置角色；不要仅因某个角色可用，就把解析、比对、撰写和复核全部伪装成同一种专业分工。",
			"- 同一角色的后续委托会复用同一个子智能体会话；不要把多次委托描述成多个不同子智能体协作。",
			"- 只能引用真实存在的本地路径、用户提供的 URL 或工具实际返回的地址；不得编造 internal.staix.cn/task 等任务链接。",
		].join("\n");
	}

	private formatCapabilitiesForPrompt(capabilities: CapabilityConfig[]): string[] {
		const lines = [
			"## 已绑定业务能力",
			"",
			"这些能力来自用户配置，可能是工具、技能、命令、MCP、浏览器或业务说明。只有在石斧智能体工具列表中实际存在对应工具时才可以直接调用；否则把它们作为业务背景、命令线索或任务规划依据。",
		];
		if (capabilities.length === 0) {
			lines.push("", "未绑定已启用的业务能力。");
			return lines;
		}
		for (const [index, capability] of capabilities.entries()) {
			this.appendCapabilityPromptSection(lines, capability, index);
		}
		return lines;
	}

	private appendCapabilityPromptSection(lines: string[], capability: CapabilityConfig, index: number): void {
		const target =
			capability.content || capability.endpoint || capability.command || capability.description || "未配置能力内容";
		lines.push("", `### ${index + 1}. ${capability.name || capability.id}`, "");
		lines.push(
			`- 类型：${capability.type}`,
			`- 分类：${capability.category || "未分类"}`,
			`- 执行方式：${capability.executionMode}`,
			`- 直接工具名：${capability.toolName || this.getCapabilityCallableName(capability) || "未配置"}`,
			`- 调用状态：${this.getCapabilityPromptStatus(capability)}`,
			`- 说明：${capability.description || "未填写"}`,
		);
		if (capability.useWhen.trim()) {
			lines.push("", "#### Use When", capability.useWhen);
		}
		if (capability.avoidWhen.trim()) {
			lines.push("", "#### Do Not Use When", capability.avoidWhen);
		}
		lines.push("", "#### Content", target);
		if (capability.advancedConfig.trim()) {
			lines.push("", "#### Advanced Config", capability.advancedConfig);
		}
		if (capability.command.trim()) {
			lines.push("", "#### Command", "```bash", capability.command, "```");
		}
		if (capability.type === "browser") {
			lines.push(
				"",
				"#### Browser Config",
				`- 模式：${capability.browserMode || "builtin"}`,
				`- 允许域名：${capability.browserAllowedDomains?.join(", ") || "不限制"}`,
				`- 禁止域名：${capability.browserBlockedDomains?.join(", ") || "无"}`,
				`- 允许截图：${capability.browserAllowScreenshots ?? false}`,
				`- 允许下载：${capability.browserAllowDownloads ?? false}`,
				`- 敏感操作需确认：${capability.browserRequireConfirmation ?? true}`,
				`- 最大步骤：${capability.browserMaxSteps ?? "未配置"}`,
				`- 超时：${capability.browserTimeoutMs ?? "未配置"}ms`,
			);
		}
	}

	private formatKnowledgeForPrompt(agent: AgentConfig): string[] {
		const lines = ["", "## 知识"];
		if (agent.knowledgeItems.length === 0) {
			lines.push("- 暂未配置知识。");
			return lines;
		}
		for (const item of agent.knowledgeItems) {
			if (item.type === "document") {
				lines.push(`- ${item.title}：文档；路径：${item.filePath || "未选择"}；概述：${item.overview || "未填写"}`);
			} else {
				lines.push(`- ${item.title}：纯文本`, item.content || "未填写");
			}
		}
		return lines;
	}

	private formatChildAgentsForPrompt(childAgents: AgentConfig[]): string[] {
		const lines = ["", "## 可调度子智能体"];
		if (childAgents.length === 0) {
			lines.push("- 暂未配置子智能体。");
			return lines;
		}
		for (const childAgent of childAgents) {
			lines.push(
				`- ${childAgent.name}（角色：${childAgent.mtclawRole || "未配置"}）：${childAgent.description || "未填写描述"}`,
			);
		}
		return lines;
	}

	private formatTaskTemplatesForPrompt(agent: AgentConfig): string[] {
		const lines = ["", "## 常规任务模板"];
		const enabledTaskTemplates = agent.taskTemplates.filter((template) => template.enabled);
		if (enabledTaskTemplates.length === 0) {
			lines.push("- 暂未配置常规任务模板。");
			return lines;
		}
		for (const [index, template] of enabledTaskTemplates.entries()) {
			lines.push(
				"",
				`### ${index + 1}. ${template.name}`,
				`- 说明：${template.description || "未填写说明"}`,
				`- 需要材料：${template.expectedInputs || "按用户输入判断"}`,
				"#### 执行要求",
				template.prompt || "未填写",
			);
		}
		return lines;
	}

	private getCapabilityCallableName(capability: CapabilityConfig): string {
		if (capability.executionMode === "http" && (capability.type === "tool" || capability.type === "http")) {
			return this.normalizePromptToolName(capability.toolName || capability.name || "http_tool");
		}
		if (capability.type === "mcp" && capability.mcpTools.some((tool) => tool.enabled && tool.name.trim())) {
			return "MCP bridge tools";
		}
		if (capability.type === "browser") {
			return "browser_*";
		}
		return "";
	}

	private getCapabilityPromptStatus(capability: CapabilityConfig): string {
		if (this.getCapabilityCallableName(capability)) {
			return "存在可映射的石斧智能体工具时可直接调用；否则按业务背景或命令线索处理。";
		}
		if (capability.command.trim()) {
			return "这是命令型能力；需要通过 shell/命令工具执行，并先确认本地已安装和已配置。";
		}
		return "未映射为直接工具；作为业务背景和任务规划依据。";
	}

	private normalizePromptToolName(value: string): string {
		return (value || "http_tool")
			.replace(/[^a-zA-Z0-9_-]/g, "_")
			.replace(/^([^a-zA-Z_])/, "_$1")
			.slice(0, 64);
	}
}
