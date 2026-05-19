import type {
	AgentConfig,
	AgentCapabilityCallLog,
	AgentMessageResult,
	AgentSession,
	AgentToolInfo,
	AuditStatus,
	CapabilityConfig,
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
		const childAgents = configState.config.agents.filter((item) => agent.childAgentIds.includes(item.id));
		const effectiveWorkspacePath = workspacePath ?? workspace.path;
		const startedSession = await this.adapter.startSession({
			model,
			cwd: effectiveWorkspacePath,
			appendSystemPrompt: this.buildAgentAppendSystemPrompt(
				agent,
				model,
				enabledCapabilities,
				childAgents,
				effectiveWorkspacePath,
			),
		});
		const session: AgentSession = {
			...startedSession,
			agentId: agent.id,
			agentName: agent.name,
			modelId: model.id,
			workspacePath: effectiveWorkspacePath,
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
			await this.writeCapabilityCallAudits(sessionId, result.capabilityCalls ?? []);
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
			toolName: options.toolName ?? "agent-adapter",
			businessAction: options.businessAction,
			inputSummary: options.inputSummary,
			outputSummary: options.outputSummary,
			batch: false,
			status: options.status,
			errorMessage: options.errorMessage,
		});
	}

	private async writeCapabilityCallAudits(
		sessionId: string,
		calls: AgentCapabilityCallLog[],
	): Promise<void> {
		if (calls.length === 0) {
			return;
		}

		const session = await this.adapter.getSessionState(sessionId);
		const configState = await this.configService.getConfig();
		const activeAgent = configState.config.agents.find((agent) => agent.id === session?.agentId);
		const enabledCapabilities = configState.config.capabilities.filter(
			(capability) => capability.enabled && (!activeAgent || activeAgent.capabilityIds.includes(capability.id)),
		);

		for (const call of calls) {
			const matchedCapability = this.findMatchingCapability(call, enabledCapabilities);
			const displayName = this.getCapabilityDisplayName(call, matchedCapability);
			if (call.inputSummary) {
				await this.writeAudit({
					sessionId,
					toolName: call.toolName,
					businessAction: "capability-invoked",
					inputSummary: this.truncate(this.redactSensitive(call.inputSummary), 500),
					outputSummary: `调用能力：${displayName}`,
					status: "success",
				});
			}

			await this.writeAudit({
				sessionId,
				toolName: call.toolName,
				businessAction: "capability-result",
				inputSummary: call.inputSummary ? this.truncate(this.redactSensitive(call.inputSummary), 240) : undefined,
				outputSummary: this.truncate(
					this.redactSensitive(call.outputSummary || `能力 ${displayName} 已执行，但没有返回可展示内容。`),
					500,
				),
				status: call.status,
				errorMessage: call.status === "failure" ? this.truncate(this.redactSensitive(call.outputSummary ?? ""), 500) : undefined,
			});
		}
	}

	private getCapabilityDisplayName(call: AgentCapabilityCallLog, capability?: CapabilityConfig): string {
		const name = capability?.name || call.toolName || call.toolCallId || "未知能力";
		return call.toolCallId ? `${name}（${call.toolCallId}）` : name;
	}

	private findMatchingCapability(
		call: AgentCapabilityCallLog,
		capabilities: CapabilityConfig[],
	): CapabilityConfig | undefined {
		const haystack = [
			call.toolName,
			call.inputSummary,
			call.outputSummary,
		]
			.filter(Boolean)
			.join("\n")
			.toLowerCase();

		return capabilities.find((capability) => {
			const candidates = [
				capability.name,
				capability.category,
				capability.command,
				capability.endpoint,
				...capability.tags,
			]
				.filter(Boolean)
				.map((value) => value.toLowerCase());
			return candidates.some((value) => value && haystack.includes(value));
		});
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

	private buildAgentAppendSystemPrompt(
		agent: AgentConfig,
		model: ModelProfileConfig,
		capabilities: CapabilityConfig[],
		childAgents: AgentConfig[],
		workspacePath: string | null,
	): string {
		const lines = [
			"# Windows 客户端智能体配置",
			"",
			"以下内容来自 Windows 客户端的可视化配置，用于补充 Pi 内核默认 system prompt。",
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
			"- 如果用户要求读取或分析文件，优先基于当前工作区内的文件路径执行。",
			"- 不要声称已经读取未实际读取的文件；依据不足时说明需要用户选择文件或补充材料。",
			"",
			"## 已绑定业务能力",
		];

		if (capabilities.length === 0) {
			lines.push("- 未绑定已启用的 Tools / Skills。");
		} else {
			for (const capability of capabilities) {
				const target = capability.content || capability.endpoint || capability.command || capability.description || "未配置能力内容";
				lines.push(
					`- ${capability.name}：${capability.type} / ${capability.category || "未分类"}；说明：${capability.description || "未填写"}；内容：${target}`,
				);
				if (capability.advancedConfig.trim()) {
					lines.push(`  - 高级配置：${capability.advancedConfig}`);
				}
			}
		}

		lines.push(
			"",
			"注意：上面的业务能力是产品配置说明。只有当 Pi 工具列表中实际存在对应工具时才可以直接调用；否则请把它们作为业务背景和任务规划依据。",
			"",
			"## 可调度子智能体",
		);

		if (childAgents.length === 0) {
			lines.push("- 暂未配置子智能体。");
		} else {
			for (const childAgent of childAgents) {
				lines.push(`- ${childAgent.name}：${childAgent.description || "未填写描述"}`);
			}
		}

		lines.push(
			"",
			"## 常规任务模板",
		);

		const enabledTaskTemplates = agent.taskTemplates.filter((template) => template.enabled);
		if (enabledTaskTemplates.length === 0) {
			lines.push("- 暂未配置常规任务模板。");
		} else {
			for (const template of enabledTaskTemplates) {
				lines.push(
					`- ${template.name}：${template.description || "未填写说明"}；需要材料：${template.expectedInputs || "按用户输入判断"}；执行要求：${template.prompt || "未填写"}`,
				);
			}
		}

		lines.push(
			"",
			"## 工作方式补充",
			"- 使用中文与用户沟通，除非用户明确要求其他语言。",
			"- 回答时优先围绕当前智能体职责、当前工作区和用户明确选择的上下文。",
			"- 如果任务适合拆给子智能体，先说明拆分建议；当前版本还未实现真实子智能体自动调度时，不要假装已经完成调度。",
		);

		return lines.join("\n");
	}
}
