import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import type {
	AgentCoreConfig,
	CapabilityConfig,
	ClientConfig,
	ClientConfigState,
	ModelConfig,
	ModelProfileConfig,
} from "../../shared/types";
import type { AuditLogger } from "./auditLogger";

export class ConfigService {
	private readonly configPath = join(app.getPath("userData"), "config.json");

	constructor(private readonly auditLogger: AuditLogger) {}

	async getConfig(): Promise<ClientConfigState> {
		try {
			const raw = await readFile(this.configPath, "utf8");
			const parsed = JSON.parse(raw) as Partial<ClientConfig>;
			return {
				configPath: this.configPath,
				config: this.mergeWithDefaults(parsed),
			};
		} catch {
			const config = this.createDefaultConfig();
			await this.writeConfig(config, false);
			return { configPath: this.configPath, config };
		}
	}

	async saveAgentCoreConfig(agentCore: AgentCoreConfig): Promise<ClientConfigState> {
		const current = await this.getConfig();
		const nextConfig = this.mergeWithDefaults({
			...current.config,
			agentCore,
			updatedAt: new Date().toISOString(),
		});

		await this.writeConfig(nextConfig, true, "save-agent-core-config", "更新智能体内核与 RPC 配置。");
		return { configPath: this.configPath, config: nextConfig };
	}

	async saveModelConfig(model: ModelConfig): Promise<ClientConfigState> {
		const current = await this.getConfig();
		const nextConfig = this.mergeWithDefaults({
			...current.config,
			model,
			updatedAt: new Date().toISOString(),
		});

		await this.writeConfig(nextConfig, true, "save-model-config", "更新模型与 Provider 配置。");
		return { configPath: this.configPath, config: nextConfig };
	}

	async deleteModelConfig(id: string): Promise<ClientConfigState> {
		const current = await this.getConfig();
		const model = current.config.model.models.find((item) => item.id === id);
		const models = current.config.model.models.filter((item) => item.id !== id);
		const nextConfig = this.mergeWithDefaults({
			...current.config,
			model: {
				...current.config.model,
				defaultModelId:
					current.config.model.defaultModelId === id
						? (models.find((item) => item.enabled)?.id ?? models[0]?.id ?? null)
						: current.config.model.defaultModelId,
				models,
			},
			updatedAt: new Date().toISOString(),
		});

		await this.writeConfig(
			nextConfig,
			true,
			"delete-model-config",
			`删除模型配置：${model?.displayName || model?.modelId || id}。`,
		);
		return { configPath: this.configPath, config: nextConfig };
	}

	async saveCapabilityConfig(capability: CapabilityConfig): Promise<ClientConfigState> {
		const current = await this.getConfig();
		const normalizedCapability = this.normalizeCapabilities([capability], undefined, [])[0];
		const exists = current.config.capabilities.some((item) => item.id === normalizedCapability.id);
		const capabilities = exists
			? current.config.capabilities.map((item) =>
					item.id === normalizedCapability.id ? normalizedCapability : item,
				)
			: [...current.config.capabilities, normalizedCapability];
		const nextConfig = this.mergeWithDefaults({
			...current.config,
			capabilities,
			updatedAt: new Date().toISOString(),
		});

		await this.writeConfig(
			nextConfig,
			true,
			"save-capability-config",
			`保存业务能力：${normalizedCapability.name || normalizedCapability.id}。`,
		);
		return { configPath: this.configPath, config: nextConfig };
	}

	async deleteCapabilityConfig(id: string): Promise<ClientConfigState> {
		const current = await this.getConfig();
		const capability = current.config.capabilities.find((item) => item.id === id);
		const nextConfig = this.mergeWithDefaults({
			...current.config,
			capabilities: current.config.capabilities.filter((item) => item.id !== id),
			updatedAt: new Date().toISOString(),
		});

		await this.writeConfig(nextConfig, true, "delete-capability-config", `删除业务能力：${capability?.name ?? id}。`);
		return { configPath: this.configPath, config: nextConfig };
	}

	async resetConfig(): Promise<ClientConfigState> {
		const config = this.createDefaultConfig();
		await this.writeConfig(config, true, "reset-client-config");
		return { configPath: this.configPath, config };
	}

	private async writeConfig(
		config: ClientConfig,
		audited: boolean,
		businessAction = "save-client-config",
		inputSummary = "更新客户端本地配置。",
	): Promise<void> {
		await mkdir(dirname(this.configPath), { recursive: true });
		await writeFile(this.configPath, JSON.stringify(config, null, 2), "utf8");

		if (audited) {
			await this.auditLogger.write({
				timestamp: new Date().toISOString(),
				toolName: "config-service",
				businessAction,
				inputSummary,
				outputSummary: this.configPath,
				filesEdited: [this.configPath],
				batch: false,
				status: "success",
			});
		}
	}

	private createDefaultConfig(): ClientConfig {
		return {
			agentCore: {
				mode: "embedded-rpc",
				rpcEndpoint: "local-subprocess",
			},
			model: {
				defaultModelId: "openai-default",
				models: [
					{
						id: "openai-default",
						displayName: "OpenAI 默认模型",
						provider: "openai",
						providerLabel: "OpenAI",
						setupMode: "official-api-key",
						modelId: "",
						api: "openai-responses",
						baseUrl: "",
						apiKeyEnv: "OPENAI_API_KEY",
						apiKeyValue: "",
						authType: "env",
						defaultThinkingLevel: "off",
						transport: "auto",
						timeoutMs: 600000,
						maxRetries: 3,
						compat: "",
						input: ["text"],
						contextWindow: 0,
						maxTokens: 0,
						supportsReasoning: false,
						enabled: false,
						connectionStatus: "untested",
						lastTestedAt: null,
						priceInputPerMTok: 0,
						priceOutputPerMTok: 0,
						priceCacheReadPerMTok: 0,
						priceCacheWritePerMTok: 0,
						usedByAgentIds: [],
						notes: "",
					},
				],
			},
			capabilities: [
				{
					id: "ocr-verify",
					name: "OCR 验证",
					type: "tool",
					category: "OCR",
					description: "用于调用 OCR 验证服务或脚本。",
					triggerMode: "agent",
					executionMode: "http",
					endpoint: "",
					httpMethod: "POST",
					command: "",
					workingDirectory: "",
					tokenEnv: "OCR_API_TOKEN",
					headersJson: "",
					inputSchemaJson: "",
					outputSchemaJson: "",
					timeoutMs: 600000,
					retryCount: 1,
					enabled: false,
					connectionStatus: "untested",
					lastTestedAt: null,
					usedByAgentIds: [],
					tags: ["OCR"],
					notes: "",
				},
			],
			updatedAt: new Date().toISOString(),
		};
	}

	private mergeWithDefaults(config: Partial<ClientConfig>): ClientConfig {
		const defaultConfig = this.createDefaultConfig();
		const legacyConfig = config as Partial<ClientConfig> & {
			agentCoreMode?: AgentCoreConfig["mode"];
			rpcEndpoint?: string;
			modelProvider?: string;
			enterpriseApiBaseUrl?: string;
		};
		const legacyEnterpriseApiBaseUrl = legacyConfig.enterpriseApiBaseUrl;

		return {
			agentCore: this.normalizeAgentCore(
				config.agentCore,
				legacyConfig.agentCoreMode,
				legacyConfig.rpcEndpoint,
				defaultConfig.agentCore,
			),
			model: this.normalizeModel(config.model, legacyConfig.modelProvider, defaultConfig.model),
			capabilities: this.normalizeCapabilities(
				config.capabilities,
				legacyEnterpriseApiBaseUrl,
				defaultConfig.capabilities,
			),
			updatedAt: config.updatedAt ?? defaultConfig.updatedAt,
		};
	}

	private normalizeAgentCore(
		agentCore: AgentCoreConfig | undefined,
		legacyMode: AgentCoreConfig["mode"] | undefined,
		legacyRpcEndpoint: string | undefined,
		defaultAgentCore: AgentCoreConfig,
	): AgentCoreConfig {
		return {
			mode: agentCore?.mode ?? legacyMode ?? defaultAgentCore.mode,
			rpcEndpoint: agentCore?.rpcEndpoint ?? legacyRpcEndpoint ?? defaultAgentCore.rpcEndpoint,
		};
	}

	private normalizeModel(
		model: ModelConfig | undefined,
		legacyModelProvider: string | undefined,
		defaultModel: ModelConfig,
	): ModelConfig {
		if (model?.models) {
			const models = model.models.map((profile) => this.normalizeModelProfile(profile));
			return {
				defaultModelId:
					model.defaultModelId && models.some((profile) => profile.id === model.defaultModelId)
						? model.defaultModelId
						: (models[0]?.id ?? null),
				models,
			};
		}

		const legacyModel = model as
			| (Partial<ModelProfileConfig> & {
					model?: string;
			  })
			| undefined;
		if (legacyModel || legacyModelProvider) {
			const profile = this.normalizeModelProfile({
				id: "legacy-default-model",
				displayName: legacyModel?.displayName ?? "默认模型",
				provider: legacyModel?.provider ?? legacyModelProvider ?? "",
				providerLabel: legacyModel?.providerLabel ?? legacyModel?.provider ?? legacyModelProvider ?? "",
				setupMode: legacyModel?.setupMode ?? "official-api-key",
				modelId: legacyModel?.modelId ?? legacyModel?.model ?? "",
				api: legacyModel?.api ?? defaultModel.models[0]?.api ?? "openai-responses",
				baseUrl: legacyModel?.baseUrl ?? "",
				apiKeyEnv: legacyModel?.apiKeyEnv ?? "",
				apiKeyValue: legacyModel?.apiKeyValue ?? "",
				authType: legacyModel?.authType ?? "env",
				defaultThinkingLevel: legacyModel?.defaultThinkingLevel ?? "off",
				transport: legacyModel?.transport ?? "auto",
				timeoutMs: legacyModel?.timeoutMs ?? 600000,
				maxRetries: legacyModel?.maxRetries ?? 3,
				compat: legacyModel?.compat ?? "",
				input: legacyModel?.input ?? ["text"],
				contextWindow: legacyModel?.contextWindow ?? 0,
				maxTokens: legacyModel?.maxTokens ?? 0,
				supportsReasoning: Boolean(legacyModel?.supportsReasoning),
				enabled: Boolean(legacyModel?.enabled),
				connectionStatus: legacyModel?.connectionStatus ?? "untested",
				lastTestedAt: legacyModel?.lastTestedAt ?? null,
				priceInputPerMTok: legacyModel?.priceInputPerMTok ?? 0,
				priceOutputPerMTok: legacyModel?.priceOutputPerMTok ?? 0,
				priceCacheReadPerMTok: legacyModel?.priceCacheReadPerMTok ?? 0,
				priceCacheWritePerMTok: legacyModel?.priceCacheWritePerMTok ?? 0,
				usedByAgentIds: legacyModel?.usedByAgentIds ?? [],
				notes: legacyModel?.notes ?? "",
			});

			return {
				defaultModelId: profile.id,
				models: [profile],
			};
		}

		return defaultModel;
	}

	private normalizeModelProfile(model: Partial<ModelProfileConfig>): ModelProfileConfig {
		return {
			id: model.id || crypto.randomUUID(),
			displayName: model.displayName || model.modelId || "未命名模型",
			provider: model.provider || "",
			providerLabel: model.providerLabel || model.provider || "",
			setupMode: model.setupMode ?? "official-api-key",
			modelId: model.modelId || "",
			api: model.api ?? "openai-responses",
			baseUrl: model.baseUrl ?? "",
			apiKeyEnv: model.apiKeyEnv ?? "",
			apiKeyValue: model.apiKeyValue ?? "",
			authType: model.authType ?? "env",
			defaultThinkingLevel: model.defaultThinkingLevel ?? "off",
			transport: model.transport ?? "auto",
			timeoutMs: Number(model.timeoutMs ?? 600000),
			maxRetries: Number(model.maxRetries ?? 3),
			compat: model.compat ?? "",
			input: model.input?.length ? model.input : ["text"],
			contextWindow: Number(model.contextWindow ?? 0),
			maxTokens: Number(model.maxTokens ?? 0),
			supportsReasoning: Boolean(model.supportsReasoning),
			enabled: Boolean(model.enabled),
			connectionStatus: model.connectionStatus ?? "untested",
			lastTestedAt: model.lastTestedAt ?? null,
			priceInputPerMTok: Number(model.priceInputPerMTok ?? 0),
			priceOutputPerMTok: Number(model.priceOutputPerMTok ?? 0),
			priceCacheReadPerMTok: Number(model.priceCacheReadPerMTok ?? 0),
			priceCacheWritePerMTok: Number(model.priceCacheWritePerMTok ?? 0),
			usedByAgentIds: model.usedByAgentIds ?? [],
			notes: model.notes ?? "",
		};
	}

	private normalizeCapabilities(
		capabilities: CapabilityConfig[] | undefined,
		legacyEnterpriseApiBaseUrl: string | undefined,
		defaultCapabilities: CapabilityConfig[],
	): CapabilityConfig[] {
		if (capabilities !== undefined) {
			return capabilities.map((capability) => ({
				id: capability.id || crypto.randomUUID(),
				name: capability.name || "未命名能力",
				type: capability.type ?? "tool",
				category: capability.category ?? "",
				description: capability.description ?? "",
				triggerMode: capability.triggerMode ?? "agent",
				executionMode:
					capability.executionMode ?? (capability.endpoint ? "http" : capability.command ? "command" : "manual"),
				endpoint: capability.endpoint ?? "",
				httpMethod: capability.httpMethod ?? "POST",
				command: capability.command ?? "",
				workingDirectory: capability.workingDirectory ?? "",
				tokenEnv: capability.tokenEnv ?? "",
				headersJson: capability.headersJson ?? "",
				inputSchemaJson: capability.inputSchemaJson ?? "",
				outputSchemaJson: capability.outputSchemaJson ?? "",
				timeoutMs: Number(capability.timeoutMs ?? 600000),
				retryCount: Number(capability.retryCount ?? 1),
				enabled: Boolean(capability.enabled),
				connectionStatus: capability.connectionStatus ?? "untested",
				lastTestedAt: capability.lastTestedAt ?? null,
				usedByAgentIds: capability.usedByAgentIds ?? [],
				tags: capability.tags ?? [],
				notes: capability.notes ?? "",
			}));
		}

		if (legacyEnterpriseApiBaseUrl) {
			return [
				{
					id: "legacy-enterprise-api",
					name: "企业接口能力",
					type: "tool",
					category: "企业接口",
					description: "由旧版企业 API 地址迁移而来。",
					triggerMode: "agent",
					executionMode: "http",
					endpoint: legacyEnterpriseApiBaseUrl,
					httpMethod: "POST",
					command: "",
					workingDirectory: "",
					tokenEnv: "",
					headersJson: "",
					inputSchemaJson: "",
					outputSchemaJson: "",
					timeoutMs: 600000,
					retryCount: 1,
					enabled: true,
					connectionStatus: "untested",
					lastTestedAt: null,
					usedByAgentIds: [],
					tags: ["迁移"],
					notes: "",
				},
			];
		}

		return defaultCapabilities;
	}
}
