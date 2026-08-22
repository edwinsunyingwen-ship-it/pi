import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ClientConfig, ModelProfileConfig, MtclawSubagentRole } from "../../shared/types";
import type { AuditLogger } from "./auditLogger";

const execFileAsync = promisify(execFile);

const ROLE_DESCRIPTIONS: Record<MtclawSubagentRole, string> = {
	enterprise_due_diligence: "Enterprise identity verification and risk due diligence.",
	legal_research: "Legal regulation and comparable-case research.",
	civil_litigation_document_generation: "Civil complaint and defense document generation.",
};

export class MtclawRuntimeConfigService {
	constructor(private readonly auditLogger: AuditLogger) {}

	async synchronize(config: ClientConfig): Promise<void> {
		if (!config.mtclawRouter.managedRuntime) {
			return;
		}
		if (process.platform !== "linux") {
			throw new Error("Staix 托管 Router 当前仅支持 Linux/AIOS；Windows 开发环境请继续使用外部 Router。");
		}

		const routingModel = this.requireModel(config, config.mtclawRouter.routingModelId, "路由模型");
		const upstreamModel = this.requireModel(config, config.mtclawRouter.upstreamModelId, "回答模型");
		const roles = config.agents
			.filter((agent) => agent.enabled && agent.mtclawRoutingEnabled && agent.mtclawRole)
			.map((agent) => agent.mtclawRole)
			.filter((role): role is MtclawSubagentRole => Boolean(role));
		const uniqueRoles = Array.from(new Set(roles));
		if (uniqueRoles.length === 0) {
			throw new Error("至少需要启用一个接受 MTClaw 自动路由的专业子智能体。");
		}

		const rootDir = join(homedir(), ".function-router");
		const scriptsDir = join(rootDir, "scripts");
		const logsDir = join(rootDir, "logs");
		const configPath = join(rootDir, "config.json");
		const functionsPath = join(rootDir, "functions.jsonl");
		await mkdir(scriptsDir, { recursive: true, mode: 0o700 });
		await mkdir(logsDir, { recursive: true, mode: 0o700 });
		await chmod(rootDir, 0o700);

		const routerConfig = {
			listen_host: "127.0.0.1",
			listen_port: config.mtclawRouter.listenPort,
			tools_base_dir: scriptsDir,
			fr_completion_check: { enabled: true, mode: "permissive", always_true: false },
			fr_context_history: { enabled: true },
			fr_context_preserve: { enabled: false },
			delegate_tools_to_openclaw: { enabled: true, tools: ["delegate_to_subagent"] },
			routing: this.toRouterModel(config, routingModel),
			upstream: { ...this.toRouterModel(config, upstreamModel), use_request_model: false },
			functions_file: "functions.jsonl",
			scripts_dir: "scripts",
			max_tool_rounds: 6,
			tool_exec_timeout_s: 600,
			routing_timeout_s: Math.max(10, Math.ceil(routingModel.timeoutMs / 1000)),
			debug_logging: { enabled: false },
		};
		const functionDefinition = {
			type: "function",
			function: {
				name: "delegate_to_subagent",
				description: "Delegate a complete professional objective to a configured Staix pi-agent Subagent.",
				parameters: {
					type: "object",
					properties: {
						role: {
							type: "string",
							enum: uniqueRoles,
							description: uniqueRoles.map((role) => `${role}: ${ROLE_DESCRIPTIONS[role]}`).join(" "),
						},
						objective: {
							type: "string",
							minLength: 1,
							description: "Complete professional objective for the isolated Subagent.",
						},
						context: {
							type: "string",
							description: "Relevant facts, constraints, and document references from the parent conversation.",
						},
					},
					required: ["role", "objective"],
					additionalProperties: false,
				},
			},
		};

		await writeFile(configPath, `${JSON.stringify(routerConfig, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		await writeFile(functionsPath, `${JSON.stringify(functionDefinition)}\n`, { encoding: "utf8", mode: 0o600 });
		await chmod(configPath, 0o600);
		await chmod(functionsPath, 0o600);
		await this.startUserServiceIfAvailable();

		await this.auditLogger.write({
			timestamp: new Date().toISOString(),
			toolName: "mtclaw-runtime-config",
			businessAction: "synchronize-mtclaw-runtime",
			inputSummary: `同步 ${uniqueRoles.length} 个专业角色；路由模型：${routingModel.displayName}；回答模型：${upstreamModel.displayName}。`,
			outputSummary: "MTClaw Router 私有配置已由 Staix 同步。",
			filesEdited: [configPath, functionsPath],
			batch: true,
			status: "success",
		});
	}

	private requireModel(config: ClientConfig, id: string, label: string): ModelProfileConfig {
		const model = config.model.models.find((item) => item.id === id && item.enabled);
		if (!model) {
			throw new Error(`${label}未选择，或所选模型未启用。`);
		}
		if (model.api !== "openai-completions") {
			throw new Error(`${label}必须使用 OpenAI Chat Completions 兼容接口：${model.displayName}。`);
		}
		if (!model.baseUrl.trim() || !model.modelId.trim()) {
			throw new Error(`${label}缺少 Base URL 或模型 ID：${model.displayName}。`);
		}
		return model;
	}

	private toRouterModel(
		config: ClientConfig,
		model: ModelProfileConfig,
	): {
		base_url: string;
		model: string;
		api_key: string;
	} {
		const apiKey = this.resolveApiKey(config, model);
		if (!apiKey) {
			throw new Error(`无法解析模型 API Key：${model.displayName}。`);
		}
		return {
			base_url: model.baseUrl.replace(/\/+$/, ""),
			model: model.modelId,
			api_key: apiKey,
		};
	}

	private resolveApiKey(config: ClientConfig, model: ModelProfileConfig): string {
		if (model.apiKeyValue.trim()) {
			return model.apiKeyValue.trim();
		}
		if (!model.apiKeyEnv.trim()) {
			return model.authType === "none" ? "any" : "";
		}
		const variableName = model.apiKeyEnv.trim();
		return (
			config.variables.find((variable) => variable.name === variableName)?.value.trim() ||
			process.env[variableName]?.trim() ||
			""
		);
	}

	private async startUserServiceIfAvailable(): Promise<void> {
		try {
			await execFileAsync("systemctl", ["--user", "daemon-reload"]);
			await execFileAsync("systemctl", ["--user", "enable", "--now", "staix-mtclaw-router.service"]);
		} catch {
			// The installer may not have created the systemd user unit yet. The generated files remain valid.
		}
	}
}
