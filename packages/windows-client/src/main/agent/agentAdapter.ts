import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { app } from "electron";
import type {
	AgentCapabilityCallLog,
	AgentImageInput,
	AgentMessageResult,
	AgentModelContextPreview,
	AgentModelInteractionLog,
	AgentProgressEvent,
	AgentSession,
	AgentTaskPlan,
	AgentToolInfo,
	CapabilityConfig,
	ClientVariableConfig,
	ContextCompactionConfig,
	ModelProfileConfig,
	MtclawSubagentRole,
} from "../../shared/types";

export interface DelegatableSubagent {
	role: MtclawSubagentRole;
	name: string;
	description: string;
}

export interface AgentStartOptions {
	model: ModelProfileConfig | null;
	cwd: string | null;
	agentId?: string;
	agentName?: string;
	modelProfileId?: string;
	capabilities?: CapabilityConfig[];
	variables?: ClientVariableConfig[];
	contextCompaction?: ContextCompactionConfig;
	appendSystemPrompt?: string;
	subagentDelegation?: {
		callerAgentId: string;
		agents: DelegatableSubagent[];
	};
	isolated?: boolean;
}

type RpcResponse = {
	id?: string;
	type: "response";
	command: string;
	success: boolean;
	data?: unknown;
	error?: string;
};

type RpcEvent = {
	type: string;
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	input?: unknown;
	result?: unknown;
	partialResult?: unknown;
	isError?: boolean;
	toolResults?: Array<{
		role?: string;
		content?: unknown;
		toolCallId?: string;
		toolName?: string;
		stopReason?: string;
		errorMessage?: string;
	}>;
	messages?: Array<{
		role?: string;
		content?: unknown;
		toolCallId?: string;
		toolName?: string;
		stopReason?: string;
		errorMessage?: string;
	}>;
	message?: {
		role?: string;
		content?: unknown;
		toolCallId?: string;
		toolName?: string;
		stopReason?: string;
		errorMessage?: string;
	};
	model?: {
		provider?: string;
		modelId?: string;
		modelName?: string;
		api?: string;
	};
	context?: unknown;
	payload?: unknown;
	reasoning?: string;
	errorMessage?: string;
};

type RpcSessionStateData = {
	isStreaming?: boolean;
	contextPreview?: AgentModelContextPreview;
};

type JsonRecord = Record<string, unknown>;

interface ToolResultCapabilityMeta {
	capabilityId?: string;
	capabilityName?: string;
}

export interface AgentExecutionDiagnostics {
	capabilityCalls: AgentCapabilityCallLog[];
	modelInteractions: AgentModelInteractionLog[];
	progressEvents: AgentProgressEvent[];
}

export class AgentExecutionError extends Error {
	constructor(
		message: string,
		readonly diagnostics: AgentExecutionDiagnostics,
	) {
		super(message);
		this.name = "AgentExecutionError";
	}
}

export interface AgentAdapter {
	startSession(options?: AgentStartOptions): Promise<AgentSession>;
	sendUserMessage(
		sessionId: string,
		message: string,
		images?: AgentImageInput[],
		onProgress?: (event: AgentProgressEvent) => void,
	): Promise<AgentMessageResult>;
	stopSession(sessionId: string): Promise<AgentSession>;
	getSessionState(sessionId: string): Promise<AgentSession | null>;
	listAvailableTools(): Promise<AgentToolInfo[]>;
}

type BrowserBridgeProvider = () => Promise<{ url: string; token: string } | null>;
type SubagentBridgeProvider = () => Promise<{ url: string; token: string } | null>;
type CivilDocumentBridgeProvider = () => Promise<{
	generateUrl: string;
	extractUrl: string;
	token: string;
} | null>;

interface RpcProcessSession {
	process: ChildProcessWithoutNullStreams;
	session: AgentSession;
	requestId: number;
	stderr: string;
	pending: Map<
		string,
		{
			resolve: (response: RpcResponse) => void;
			reject: (error: Error) => void;
			timer: NodeJS.Timeout;
		}
	>;
	events: RpcEvent[];
	progressEvents: AgentProgressEvent[];
	progressHandler?: (event: AgentProgressEvent) => void;
	stopRequested: boolean;
}

export class RpcAgentAdapter implements AgentAdapter {
	private readonly sessions = new Map<string, RpcProcessSession>();

	constructor(
		private readonly browserBridgeProvider?: BrowserBridgeProvider,
		private readonly subagentBridgeProvider?: SubagentBridgeProvider,
		private readonly civilDocumentBridgeProvider?: CivilDocumentBridgeProvider,
	) {}

	async startSession(options: AgentStartOptions = { model: null, cwd: null }): Promise<AgentSession> {
		const session: AgentSession = {
			id: crypto.randomUUID(),
			startedAt: new Date().toISOString(),
			state: "idle",
			agentId: options.agentId,
			agentName: options.agentName,
			modelId: options.modelProfileId,
			workspacePath: options.cwd,
		};

		const rpcProcess = await this.startRpcProcess(options, session.id);
		const state: RpcProcessSession = {
			process: rpcProcess,
			session,
			requestId: 0,
			stderr: "",
			pending: new Map(),
			events: [],
			progressEvents: [],
			stopRequested: false,
		};

		this.attachJsonlReader(state);
		rpcProcess.stderr.on("data", (chunk: Buffer) => {
			state.stderr += chunk.toString("utf8");
		});
		rpcProcess.on("exit", () => {
			for (const pending of state.pending.values()) {
				clearTimeout(pending.timer);
				pending.reject(new Error(`石斧智能体运行时子进程已退出。${state.stderr}`));
			}
			state.pending.clear();
			state.session = { ...state.session, state: "stopped" };
		});

		this.sessions.set(session.id, state);

		await new Promise((resolve) => setTimeout(resolve, 200));
		if (rpcProcess.exitCode !== null) {
			this.sessions.delete(session.id);
			throw new Error(`石斧智能体运行时子进程启动失败，退出码 ${rpcProcess.exitCode}。${state.stderr}`);
		}

		await this.sendCommand(state, { type: "new_session" });
		if (options.model?.provider && options.model.modelId) {
			await this.sendCommand(state, {
				type: "set_model",
				provider: options.model.provider,
				modelId: options.model.modelId,
			});
			if (options.model.supportsReasoning && options.model.defaultThinkingLevel !== "off") {
				await this.sendCommand(state, {
					type: "set_thinking_level",
					level: options.model.defaultThinkingLevel,
				});
			}
		}

		return session;
	}

	async sendUserMessage(
		sessionId: string,
		message: string,
		images?: AgentImageInput[],
		onProgress?: (event: AgentProgressEvent) => void,
	): Promise<AgentMessageResult> {
		const state = this.sessions.get(sessionId);
		if (!state) {
			throw new Error(`Agent session not found: ${sessionId}`);
		}

		state.session = { ...state.session, state: "running" };
		state.stopRequested = false;

		state.events = [];
		state.progressEvents = [];
		state.progressHandler = onProgress;
		const startedAt = new Date().toISOString();
		this.emitProgress(state, {
			sessionId,
			timestamp: startedAt,
			title: "开始处理用户问题",
			detail: "正在准备上下文、模型和可用工具。",
			status: "running",
		});
		if (images?.length) {
			this.emitProgress(state, {
				sessionId,
				title: "正在准备图片附件",
				detail: `本次消息包含 ${images.length} 个视觉输入，正在交给运行时处理。`,
				status: "running",
			});
		}
		const waitForEnd = this.waitForAgentEnd(state);
		let events: RpcEvent[];
		try {
			await this.sendCommand(state, { type: "prompt", message, images });
			events = await waitForEnd;
		} catch (error) {
			if (state.session.state !== "stopped") {
				state.session = { ...state.session, state: "idle" };
			}
			throw this.createExecutionError(state, error);
		} finally {
			state.progressHandler = undefined;
		}
		const assistantError = this.extractAssistantError(events);
		if (assistantError) {
			state.session = { ...state.session, state: "idle" };
			throw this.createExecutionError(state, assistantError);
		}
		const responseText =
			this.extractAssistantText(events) ||
			(await this.getLastAssistantText(state)) ||
			"石斧智能体运行时已完成本轮处理，但没有返回可展示的文本内容。";
		if (!responseText.trim() || responseText.startsWith("石斧智能体运行时")) {
			state.session = { ...state.session, state: "idle" };
			throw this.createExecutionError(state, "石斧智能体运行时已完成本轮处理，但没有收到模型返回的文本内容。");
		}
		state.session = { ...state.session, state: "idle" };
		const endedAt = new Date().toISOString();
		const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
		this.emitProgress(state, {
			sessionId,
			timestamp: endedAt,
			title: "处理完成",
			detail: `已生成最终回复，共耗时 ${this.formatDuration(durationMs)}。`,
			status: "success",
			durationMs,
		});

		return {
			sessionId,
			responseText: responseText.trim(),
			createdAt: endedAt,
			startedAt,
			endedAt,
			durationMs,
			capabilityCalls: this.extractCapabilityCalls(events),
			modelInteractions: this.extractModelInteractions(events),
			progressEvents: [...state.progressEvents],
		};
	}

	async stopSession(sessionId: string): Promise<AgentSession> {
		const state = this.sessions.get(sessionId);
		if (!state) {
			throw new Error(`Agent session not found: ${sessionId}`);
		}

		if (state.process.exitCode === null) {
			state.stopRequested = true;
			state.process.kill("SIGTERM");
		}
		const stoppedSession: AgentSession = { ...state.session, state: "stopped" };
		state.session = stoppedSession;
		this.sessions.delete(sessionId);
		return stoppedSession;
	}

	async getSessionState(sessionId: string): Promise<AgentSession | null> {
		const state = this.sessions.get(sessionId);
		if (!state) {
			return null;
		}
		if (state.process.exitCode !== null) {
			return state.session;
		}

		try {
			const response = await this.sendCommand(state, { type: "get_state" });
			const rpcState = this.normalizeRpcSessionState(response.data);
			const nextSession: AgentSession = {
				...state.session,
				state: state.session.state === "stopped" ? "stopped" : rpcState.isStreaming ? "running" : "idle",
				contextPreview: rpcState.contextPreview,
			};
			state.session = nextSession;
			return nextSession;
		} catch {
			return state.session;
		}
	}

	async listAvailableTools(): Promise<AgentToolInfo[]> {
		return [
			{
				name: "workspace",
				businessAction: "工作区选择与文件权限边界管理",
				enabled: true,
			},
			{
				name: "audit-log",
				businessAction: "为本地操作写入 JSONL 审计记录",
				enabled: true,
			},
			{
				name: "pi-rpc-core",
				businessAction: "本地石斧智能体运行时子进程桥接",
				enabled: true,
			},
		];
	}

	private async startRpcProcess(
		options: AgentStartOptions,
		sessionId: string,
	): Promise<ChildProcessWithoutNullStreams> {
		const projectRoot = this.findProjectRoot();
		const sourceCli = join(projectRoot, "packages", "coding-agent", "src", "cli.ts");
		const builtCli = join(projectRoot, "packages", "coding-agent", "dist", "cli.js");
		const agentDir = this.getAgentDir(options, sessionId);
		const sessionDir = join(agentDir, "sessions");
		await this.writeModelsJson(options.model, agentDir);
		await this.writeSettingsJson(options.contextCompaction, agentDir);

		const args = ["--mode", "rpc", "--session-dir", sessionDir];
		const appendSystemPromptPath = await this.writeAppendSystemPrompt(options.appendSystemPrompt, agentDir);
		if (appendSystemPromptPath) {
			args.push("--append-system-prompt", appendSystemPromptPath);
		}
		const mcpExtensionPath = await this.writeMcpBridgeExtension(options.capabilities ?? [], agentDir);
		if (mcpExtensionPath) {
			args.push("--extension", mcpExtensionPath);
		}
		const httpExtensionPath = await this.writeHttpToolBridgeExtension(
			options.capabilities ?? [],
			options.variables ?? [],
			agentDir,
		);
		if (httpExtensionPath) {
			args.push("--extension", httpExtensionPath);
		}
		const browserExtensionPath = await this.writeBrowserBridgeExtension(options.capabilities ?? [], agentDir);
		if (browserExtensionPath) {
			args.push("--extension", browserExtensionPath);
		}
		const civilDocumentExtensionPath = await this.writeCivilDocumentBridgeExtension(
			options.capabilities ?? [],
			agentDir,
			options.cwd,
		);
		if (civilDocumentExtensionPath) {
			args.push("--extension", civilDocumentExtensionPath);
		}
		const subagentExtensionPath = await this.writeSubagentBridgeExtension(options, agentDir, sessionId);
		if (subagentExtensionPath) {
			args.push("--extension", subagentExtensionPath);
		}

		const isDevelopment = process.env.NODE_ENV === "development";
		const command = process.env.PI_WINDOWS_CLIENT_NODE_PATH || (isDevelopment ? "node" : process.execPath);
		const commandArgs = isDevelopment
			? [
					join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
					"--tsconfig",
					join(projectRoot, "tsconfig.json"),
					sourceCli,
					...args,
				]
			: [builtCli, ...args];

		return spawn(command, commandArgs, {
			cwd: options.cwd ?? projectRoot,
			env: {
				...process.env,
				...(isDevelopment ? {} : { ELECTRON_RUN_AS_NODE: "1" }),
				PI_CODING_AGENT_DIR: agentDir,
				PI_CODING_AGENT_SESSION_DIR: sessionDir,
			},
			stdio: "pipe",
			windowsHide: true,
		});
	}

	private findProjectRoot(): string {
		const candidates = [
			process.cwd(),
			app.getAppPath(),
			dirname(app.getAppPath()),
			join(process.resourcesPath, "pi-runtime"),
		];
		for (const candidate of candidates) {
			let current = resolve(candidate);
			while (true) {
				const hasPackageJson = existsSync(join(current, "package.json"));
				const hasSourceCli = existsSync(join(current, "packages", "coding-agent", "src", "cli.ts"));
				const hasBuiltCli = existsSync(join(current, "packages", "coding-agent", "dist", "cli.js"));
				if (hasPackageJson && (hasSourceCli || hasBuiltCli)) {
					return current;
				}
				const parent = dirname(current);
				if (parent === current) {
					break;
				}
				current = parent;
			}
		}
		return resolve(app.getAppPath(), "..", "..");
	}

	private getAgentDir(options: AgentStartOptions, sessionId: string): string {
		return options.isolated
			? join(app.getPath("userData"), "pi-runtime-tests", crypto.randomUUID())
			: join(app.getPath("userData"), "pi-runtime", sessionId);
	}

	private async writeModelsJson(model: ModelProfileConfig | null, agentDir: string): Promise<void> {
		await mkdir(agentDir, { recursive: true });

		const modelsJsonPath = join(agentDir, "models.json");
		if (!model?.provider || !model.modelId) {
			await writeFile(modelsJsonPath, JSON.stringify({ providers: {} }, null, 2), "utf8");
			return;
		}

		const compat = this.parseJsonObject(model.compat);
		const providerConfig = {
			baseUrl: model.baseUrl || undefined,
			api: model.api === "custom" ? "openai-completions" : model.api,
			apiKey: model.apiKeyValue || model.apiKeyEnv || undefined,
			compat: Object.keys(compat).length > 0 ? compat : undefined,
			models: [
				{
					id: model.modelId,
					name: model.displayName || model.modelId,
					reasoning: model.supportsReasoning,
					input: model.input,
					contextWindow: model.contextWindow || 128000,
					maxTokens: model.maxTokens || 16384,
					cost: {
						input: model.priceInputPerMTok,
						output: model.priceOutputPerMTok,
						cacheRead: model.priceCacheReadPerMTok,
						cacheWrite: model.priceCacheWritePerMTok,
					},
				},
			],
		};

		await writeFile(
			modelsJsonPath,
			JSON.stringify({ providers: { [model.provider]: providerConfig } }, null, 2),
			"utf8",
		);
	}

	private async writeSettingsJson(
		contextCompaction: ContextCompactionConfig | undefined,
		agentDir: string,
	): Promise<void> {
		if (!contextCompaction) {
			return;
		}

		await mkdir(agentDir, { recursive: true });
		const settingsJsonPath = join(agentDir, "settings.json");
		await writeFile(
			settingsJsonPath,
			JSON.stringify(
				{
					compaction: {
						enabled: contextCompaction.enabled,
						reserveTokens: contextCompaction.reserveTokens,
						keepRecentTokens: contextCompaction.keepRecentTokens,
					},
				},
				null,
				2,
			),
			"utf8",
		);
	}

	private async writeAppendSystemPrompt(value: string | undefined, agentDir: string): Promise<string | null> {
		if (!value?.trim()) {
			return null;
		}

		await mkdir(agentDir, { recursive: true });
		const appendPromptPath = join(agentDir, "windows-agent-context.md");
		await writeFile(appendPromptPath, value.trim(), "utf8");
		return appendPromptPath;
	}

	private async writeMcpBridgeExtension(capabilities: CapabilityConfig[], agentDir: string): Promise<string | null> {
		const mcpCapabilities = capabilities
			.filter((capability) => capability.enabled && capability.type === "mcp" && capability.mcpUrl.trim())
			.map((capability) => ({
				id: capability.id,
				name: capability.name,
				serverName: capability.mcpServerName || capability.name,
				url: capability.mcpUrl,
				authType: capability.mcpAuthType,
				apiKeyValue: capability.mcpApiKeyValue,
				headers: this.parseJsonObject(capability.mcpHeadersJson),
				content: capability.content,
				tools: capability.mcpTools.filter((tool) => tool.enabled && tool.name.trim()),
			}))
			.filter((capability) => capability.tools.length > 0);

		if (mcpCapabilities.length === 0) {
			return null;
		}

		const extensionDir = join(agentDir, "windows-mcp-bridge");
		await mkdir(extensionDir, { recursive: true });
		const extensionPath = join(extensionDir, "index.mjs");
		const source = `const mcpCapabilities = ${JSON.stringify(mcpCapabilities, null, 2)};

const Params = { type: "object", additionalProperties: true };

function redact(value) {
  return String(value ?? "").replace(/(bearer\\s+)[a-z0-9._-]+/gi, "$1***");
}

function normalizeToolName(value) {
  return String(value || "mcp_tool").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^([^a-zA-Z_])/, "_$1").slice(0, 64);
}

function summarizeMcpResult(result) {
  if (Array.isArray(result?.content)) {
    const text = result.content
      .map((item) => {
        if (typeof item?.text === "string") return item.text;
        if (item?.type) return JSON.stringify(item);
        return "";
      })
      .filter(Boolean)
      .join("\\n");
    if (text.trim()) return text;
  }
  return JSON.stringify(result, null, 2);
}

function parseSseOrJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
  const messages = [];
  for (const line of trimmed.split(/\\r?\\n/)) {
    const match = line.match(/^data:\\s*(.+)$/);
    if (!match || match[1] === "[DONE]") continue;
    try {
      messages.push(JSON.parse(match[1]));
    } catch {
      // Ignore non-JSON SSE lines.
    }
  }
  return messages.find((item) => item?.result || item?.error) ?? messages.at(-1) ?? {};
}

async function postMcp(server, payload, signal) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...server.headers,
  };
  if (server.authType === "bearer" && server.apiKeyValue) {
    headers.Authorization = \`Bearer \${server.apiKeyValue}\`;
  }
  if (server.sessionId) {
    headers["mcp-session-id"] = server.sessionId;
  }
  const response = await fetch(server.url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });
  const sessionId = response.headers.get("mcp-session-id");
  if (sessionId) {
    server.sessionId = sessionId;
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(\`MCP 服务请求失败：HTTP \${response.status} \${redact(text).slice(0, 800)}\`);
  }
  const data = parseSseOrJson(text);
  if (data?.error) {
    throw new Error(\`MCP 工具返回错误：\${redact(JSON.stringify(data.error))}\`);
  }
  return data?.result ?? data;
}

async function initializeMcp(server, signal) {
  if (server.initialized) return;
  await postMcp(
    server,
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
    signal,
  );
  try {
    await postMcp(
      server,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      signal,
    );
  } catch {
    // Some HTTP MCP servers do not require the initialized notification.
  }
  server.initialized = true;
}

export default function (pi) {
  for (const capability of mcpCapabilities) {
    for (const tool of capability.tools) {
      const toolName = normalizeToolName(tool.name);
      pi.registerTool({
        name: toolName,
        label: tool.name,
        description: tool.description || capability.content || capability.name,
        promptSnippet: \`\${toolName}: \${tool.description || capability.name}\`,
        promptGuidelines: [
          \`当用户问题适合“\${capability.name}”时，优先调用 \${toolName}，不要只凭模型记忆回答。\`,
        ],
        parameters: Params,
        async execute(_toolCallId, params, signal) {
          await initializeMcp(capability, signal);
          const id = Date.now();
          const result = await postMcp(
            capability,
            {
              jsonrpc: "2.0",
              id,
              method: "tools/call",
              params: {
                name: tool.name,
                arguments: params ?? {},
              },
            },
            signal,
          );
          return {
            content: [{ type: "text", text: summarizeMcpResult(result) }],
            details: {
              capabilityId: capability.id,
              capabilityName: capability.name,
              mcpServerName: capability.serverName,
              mcpToolName: tool.name,
            },
          };
        },
      });
    }
  }
}
`;
		await writeFile(extensionPath, source, "utf8");
		return extensionPath;
	}

	private async writeHttpToolBridgeExtension(
		capabilities: CapabilityConfig[],
		variables: ClientVariableConfig[],
		agentDir: string,
	): Promise<string | null> {
		const httpCapabilities = capabilities
			.filter(
				(capability) =>
					capability.enabled &&
					(capability.type === "tool" || capability.type === "http") &&
					capability.executionMode === "http" &&
					capability.endpoint.trim(),
			)
			.map((capability) => ({
				id: capability.id,
				name: capability.name,
				toolName: this.normalizeToolName(capability.toolName || capability.name),
				description: capability.description,
				useWhen: capability.useWhen,
				avoidWhen: capability.avoidWhen,
				content: capability.content,
				endpoint: capability.endpoint,
				httpMethod: capability.httpMethod,
				httpBodyType: capability.httpBodyType,
				httpContentType: capability.httpContentType,
				httpQueryParams: this.parseJsonObject(capability.httpQueryParamsJson),
				httpAuthType: capability.httpAuthType,
				httpAuthHeaderName: capability.httpAuthHeaderName,
				httpAuthTokenEnv: capability.httpAuthTokenEnv,
				httpAuthTokenValue: capability.httpAuthTokenValue,
				headers: this.parseJsonObject(capability.headersJson),
				inputSchema: this.parseToolSchema(capability.inputSchemaJson),
				outputSchema: capability.outputSchemaJson,
				resultFormat: capability.resultFormat,
				resultMapping: capability.resultMapping,
				costPolicy: capability.costPolicy,
				requiresConfirmation: capability.requiresConfirmation,
				timeoutMs: capability.timeoutMs,
				retryCount: capability.retryCount,
			}));
		const variableMap = Object.fromEntries(
			variables
				.map((variable) => [variable.name.trim(), variable.value] as const)
				.filter(([name]) => /^[A-Z][A-Z0-9_]*$/.test(name)),
		);

		if (httpCapabilities.length === 0) {
			return null;
		}

		const extensionDir = join(agentDir, "windows-http-tools");
		await mkdir(extensionDir, { recursive: true });
		const extensionPath = join(extensionDir, "index.mjs");
		const source = `import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const httpCapabilities = ${JSON.stringify(httpCapabilities, null, 2)};
const variableMap = ${JSON.stringify(variableMap, null, 2)};

const DefaultParams = { type: "object", additionalProperties: true };

function redact(value) {
  return String(value ?? "")
    .replace(/("(?:api[_-]?key|token|authorization|password|secret)"\\s*:\\s*)"[^"]+"/gi, '$1"***"')
    .replace(/(bearer\\s+)[a-z0-9._-]+/gi, "$1***");
}

function resolveVariable(name) {
  if (Object.prototype.hasOwnProperty.call(variableMap, name)) {
    return variableMap[name] ?? "";
  }
  return process.env[name] || "";
}

function resolveTemplate(value) {
  return String(value ?? "").replace(/\\$\\{([A-Z][A-Z0-9_]*)\\}/g, (_match, variableName) => resolveVariable(variableName));
}

function getToken(capability) {
  if (capability.httpAuthTokenValue) return capability.httpAuthTokenValue;
  if (capability.httpAuthTokenEnv) {
    return resolveVariable(capability.httpAuthTokenEnv);
  }
  return "";
}

function buildDescription(capability) {
  const parts = [capability.description || capability.name];
  if (capability.useWhen) parts.push(\`Use when: \${capability.useWhen}\`);
  if (capability.avoidWhen) parts.push(\`Do not use when: \${capability.avoidWhen}\`);
  if (capability.costPolicy === "paid-fallback") {
    parts.push("Cost policy: paid fallback. Prefer local/free parsing first and call this tool only when that fails or cannot extract the needed structure.");
  } else if (capability.costPolicy === "paid") {
    parts.push("Cost policy: paid tool. Use only when necessary for the user request.");
  }
  if (capability.resultMapping) parts.push(\`Return normalization: \${capability.resultMapping}\`);
  return parts.filter(Boolean).join("\\n");
}

function appendQuery(url, queryParams) {
  const next = new URL(url);
  for (const [key, value] of Object.entries(queryParams || {})) {
    if (Array.isArray(value)) {
      for (const item of value) next.searchParams.append(key, String(item));
    } else if (value !== undefined && value !== null) {
      next.searchParams.set(key, String(value));
    }
  }
  return next.toString();
}

function buildHeaders(capability) {
  const headers = {};
  for (const [key, value] of Object.entries(capability.headers || {})) {
    headers[key] = resolveTemplate(value);
  }
  const contentType = capability.httpContentType || (capability.httpBodyType === "json" ? "application/json" : "");
  if (contentType && capability.httpBodyType !== "form-data") headers["Content-Type"] = contentType;
  const token = getToken(capability);
  if (capability.httpAuthType === "bearer" && token) {
    headers[capability.httpAuthHeaderName || "Authorization"] = \`Bearer \${token}\`;
  }
  if (capability.httpAuthType === "api-key" && token) {
    headers[capability.httpAuthHeaderName || "x-api-key"] = token;
  }
  return headers;
}

async function buildBody(capability, params) {
  if (capability.httpMethod === "GET" || capability.httpMethod === "DELETE") return undefined;
  if (capability.httpBodyType === "binary") {
    const filePath = params?.filePath || params?.path;
    if (!filePath) {
      throw new Error("Binary HTTP tools require params.filePath or params.path.");
    }
    return await readFile(resolve(String(filePath)));
  }
  if (capability.httpBodyType === "url-text") {
    return String(params?.url || params?.fileUrl || "");
  }
  if (capability.httpBodyType === "text") {
    return String(params?.text || params?.content || "");
  }
  if (capability.httpBodyType === "form-data") {
    const body = new FormData();
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null) body.append(key, String(value));
    }
    return body;
  }
  return JSON.stringify(params || {});
}

function summarizeResult(result, capability) {
  const normalizedResult = capability.toolName === "ocr_text_extract" ? normalizeTextInOcrResult(result) : result;
  if (typeof normalizedResult === "string") return normalizedResult;
  const text = JSON.stringify(normalizedResult, null, 2);
  return capability.resultFormat === "json" ? text : text;
}

function normalizeTextInOcrResult(result) {
  const pages = Array.isArray(result?.result?.pages) ? result.result.pages : null;
  if (!pages) return result;
  const pageTexts = pages.map((page, index) => {
    const lines = Array.isArray(page?.lines) ? page.lines : [];
    const text = lines
      .map((line) => (typeof line?.text === "string" ? line.text.trim() : ""))
      .filter(Boolean)
      .join("\\n");
    return \`[第\${index + 1}页]\\n\${text}\`;
  });
  const fullText = pageTexts.join("\\n\\n");
  const maxTextCharacters = 80000;
  return {
    version: typeof result?.version === "string" ? result.version : undefined,
    pageCount: pages.length,
    totalTextCharacters: fullText.length,
    truncated: fullText.length > maxTextCharacters,
    text:
      fullText.length > maxTextCharacters
        ? \`\${fullText.slice(0, maxTextCharacters)}\\n\\n[OCR正文超过\${maxTextCharacters}字符，后续内容已截断]\`
        : fullText,
  };
}

async function callHttpCapability(capability, params, signal) {
  const url = appendQuery(capability.endpoint, capability.httpQueryParams);
  const headers = buildHeaders(capability);
  const body = await buildBody(capability, params || {});
  const response = await fetch(url, {
    method: capability.httpMethod || "POST",
    headers,
    body,
    signal,
  });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!response.ok) {
    throw new Error(\`HTTP tool request failed: \${response.status} \${redact(text).slice(0, 1200)}\`);
  }
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export default function (pi) {
  for (const capability of httpCapabilities) {
    pi.registerTool({
      name: capability.toolName,
      label: capability.name,
      description: buildDescription(capability),
      promptSnippet: \`\${capability.toolName}: \${capability.description || capability.name}\`,
      promptGuidelines: [
        capability.useWhen ? \`Use this tool when: \${capability.useWhen}\` : "",
        capability.avoidWhen ? \`Do not use this tool when: \${capability.avoidWhen}\` : "",
        capability.costPolicy === "paid-fallback" ? "This is a paid fallback tool. Prefer local/free document parsing first." : "",
      ].filter(Boolean),
      parameters: capability.inputSchema && capability.inputSchema.type === "object" ? capability.inputSchema : DefaultParams,
      async execute(_toolCallId, params, signal) {
        const result = await callHttpCapability(capability, params || {}, signal);
        return {
          content: [{ type: "text", text: summarizeResult(result, capability) }],
          details: {
            capabilityId: capability.id,
            capabilityName: capability.name,
            resultFormat: capability.resultFormat,
            resultMapping: capability.resultMapping,
            outputSchema: capability.outputSchema,
          },
        };
      },
    });
  }
}
`;
		await writeFile(extensionPath, source, "utf8");
		return extensionPath;
	}

	private async writeSubagentBridgeExtension(
		options: AgentStartOptions,
		agentDir: string,
		parentSessionId: string,
	): Promise<string | null> {
		const delegation = options.subagentDelegation;
		if (!delegation || delegation.agents.length === 0 || !this.subagentBridgeProvider) {
			return null;
		}
		const bridge = await this.subagentBridgeProvider();
		if (!bridge) {
			return null;
		}

		const extensionDir = join(agentDir, "windows-subagent-bridge");
		await mkdir(extensionDir, { recursive: true });
		const extensionPath = join(extensionDir, "index.mjs");
		const source = `const bridge = ${JSON.stringify(bridge, null, 2)};
const parentSessionId = ${JSON.stringify(parentSessionId)};
const callerAgentId = ${JSON.stringify(delegation.callerAgentId)};
const delegatableAgents = ${JSON.stringify(delegation.agents, null, 2)};
let currentPlan = null;

const PlanParams = {
  type: "object",
  properties: {
    objective: { type: "string", minLength: 1, description: "The overall user objective." },
    revisionReason: {
      type: "string",
      description: "Why this plan was created or revised. State new evidence, scope changes, or blockers explicitly.",
    },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1, description: "Stable step id reused across plan revisions." },
          title: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["pending", "in_progress", "completed", "failed"] },
          subagentRole: { type: "string", enum: delegatableAgents.map((agent) => agent.role) },
          note: { type: "string" },
        },
        required: ["id", "title", "status"],
        additionalProperties: false,
      },
    },
  },
  required: ["objective", "steps"],
  additionalProperties: false,
};

const DelegationParams = {
  type: "object",
  properties: {
    role: {
      type: "string",
      enum: delegatableAgents.map((agent) => agent.role),
      description: "Stable Staix professional subagent role.",
    },
    planStepId: {
      type: "string",
      minLength: 1,
      description: "Existing step id from update_task_plan that this delegation executes.",
    },
    objective: {
      type: "string",
      minLength: 1,
      description: "The complete business objective delegated to the subagent.",
    },
    context: {
      type: "string",
      description: "Optional real facts, local paths, or user-provided URLs needed by the delegated task. Never invent task URLs.",
    },
  },
  required: ["role", "planStepId", "objective"],
  additionalProperties: false,
};

function buildDescription() {
  const roles = delegatableAgents
    .map((agent) => \`- \${agent.role}: \${agent.name}. \${agent.description || ""}\`)
    .join("\\n");
  return [
    "Delegate a complete professional task to a configured Staix subagent.",
    "This is a subagent task delegation boundary, not an atomic business data tool.",
    "The child pi-agent runtime dynamically loads the selected subagent's model, rules, knowledge, skills, and assigned capabilities.",
    "Repeated calls for the same role reuse one child session; they are not separate subagents.",
    roles,
  ].join("\\n");
}

export default function (pi) {
  pi.registerTool({
    name: "update_task_plan",
    label: "Create or revise global task plan",
    description: "Create the initial global plan before a multi-step task, or revise it when evidence, scope, blockers, or conclusions change.",
    promptSnippet: "update_task_plan: create and revise the visible global execution plan before delegating work.",
    promptGuidelines: [
      "Call this before the first delegate_to_subagent call.",
			"Keep stable step ids across revisions and explain every revision in revisionReason.",
			"Assign each delegated step to the best matching configured role; do not disguise unrelated work as one professional role.",
      "Use only configured subagent roles. Do not invent task URLs or persisted result references.",
    ],
    parameters: PlanParams,
    async execute(_toolCallId, params) {
      const seenStepIds = new Set();
      const steps = params.steps.map((step) => {
        const id = String(step.id || "").trim();
        const title = String(step.title || "").trim();
        if (!id || !title || seenStepIds.has(id)) {
          throw new Error("Task plan step ids and titles must be non-empty, and step ids must be unique.");
        }
        if (step.subagentRole && !delegatableAgents.some((agent) => agent.role === step.subagentRole)) {
          throw new Error(\`Task plan references an unavailable subagent role: \${String(step.subagentRole)}\`);
        }
        seenStepIds.add(id);
        return {
          id,
          title,
          status: step.status,
          subagentRole: step.subagentRole || undefined,
          subagentName: step.subagentRole
            ? delegatableAgents.find((agent) => agent.role === step.subagentRole)?.name
            : undefined,
          note: String(step.note || "").trim() || undefined,
        };
      });
      currentPlan = {
        version: (currentPlan?.version || 0) + 1,
        objective: String(params.objective).trim(),
        revisionReason: String(params.revisionReason || (currentPlan ? "计划已修订" : "初始计划")).trim(),
        updatedAt: new Date().toISOString(),
        steps,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(currentPlan, null, 2) }],
        details: { taskPlan: currentPlan },
      };
    },
  });

  pi.registerTool({
    name: "delegate_to_subagent",
    label: "Delegate to professional subagent",
    description: buildDescription(),
    promptSnippet: "delegate_to_subagent: execute one existing global-plan step in a configured pi-agent child runtime.",
    promptGuidelines: [
      "Create the global plan first and bind every delegation to its real planStepId.",
      "Use this only for a complete professional task that benefits from an isolated subagent.",
      "Do not use it as a replacement for an atomic HTTP, MCP, browser, file, or shell tool call.",
      "Pass only real facts, local paths, user-provided URLs, or prior tool results in context.",
    ],
    parameters: DelegationParams,
    async execute(_toolCallId, params, signal) {
      const allowed = delegatableAgents.some((agent) => agent.role === params.role);
      if (!allowed) {
        throw new Error(\`Subagent role is not available to the current agent: \${String(params.role)}\`);
      }
      if (!currentPlan) {
        throw new Error("Create the global task plan with update_task_plan before delegating a subagent.");
      }
      const planStep = currentPlan.steps.find((step) => step.id === params.planStepId);
      if (!planStep) {
        throw new Error(\`Task plan step does not exist: \${String(params.planStepId)}\`);
      }
      if (planStep.subagentRole && planStep.subagentRole !== params.role) {
        throw new Error(\`Task plan step \${planStep.id} is assigned to \${planStep.subagentRole}, not \${params.role}.\`);
      }
      planStep.status = "in_progress";
      planStep.subagentRole = params.role;
      planStep.subagentName = delegatableAgents.find((agent) => agent.role === params.role)?.name;
      planStep.note = "正在由独立子智能体会话执行。";
      currentPlan.updatedAt = new Date().toISOString();
      let response;
      try {
        response = await fetch(bridge.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: \`Bearer \${bridge.token}\`,
          },
          body: JSON.stringify({
            taskId: crypto.randomUUID(),
            parentSessionId,
            callerAgentId,
            role: params.role,
            planStepId: params.planStepId,
            objective: params.objective,
            context: params.context || "",
          }),
          signal,
        });
      } catch (error) {
        planStep.status = "failed";
        planStep.note = error instanceof Error ? error.message : String(error);
        currentPlan.updatedAt = new Date().toISOString();
        throw error;
      }
      const text = await response.text();
      if (!response.ok) {
        planStep.status = "failed";
        planStep.note = \`委托失败：HTTP \${response.status}\`;
        currentPlan.updatedAt = new Date().toISOString();
        throw new Error(\`Subagent delegation failed: HTTP \${response.status} \${text.slice(0, 1200)}\`);
      }
      const result = JSON.parse(text);
      planStep.status = "completed";
      planStep.note = \`已由\${result.agentName || planStep.subagentName || "子智能体"}完成；子会话 \${result.childSessionId || "未知"}。\`;
      currentPlan.updatedAt = new Date().toISOString();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: {
          taskId: result.taskId,
          childSessionId: result.childSessionId,
          subagentRole: result.role,
          subagentName: result.agentName,
          status: result.status,
          subagentProgressEvents: result.progressEvents || [],
          taskPlan: currentPlan,
        },
      };
    },
  });
}
`;
		await writeFile(extensionPath, source, "utf8");
		return extensionPath;
	}

	private async writeCivilDocumentBridgeExtension(
		capabilities: CapabilityConfig[],
		agentDir: string,
		workspacePath: string | null,
	): Promise<string | null> {
		const capability = capabilities.find(
			(item) =>
				item.enabled &&
				item.executionMode === "builtin" &&
				this.normalizeToolName(item.toolName) === "generate_civil_litigation_document",
		);
		if (!capability || !this.civilDocumentBridgeProvider) {
			return null;
		}
		const bridge = await this.civilDocumentBridgeProvider();
		if (!bridge) {
			return null;
		}

		const extensionDir = join(agentDir, "windows-civil-document-bridge");
		await mkdir(extensionDir, { recursive: true });
		const extensionPath = join(extensionDir, "index.mjs");
		const source = `const bridge = ${JSON.stringify(bridge, null, 2)};
const capability = ${JSON.stringify(
			{
				id: capability.id,
				name: capability.name,
				description: capability.description,
				useWhen: capability.useWhen,
				avoidWhen: capability.avoidWhen,
			},
			null,
			2,
		)};
const workspacePath = ${JSON.stringify(workspacePath)};

const ExtractParams = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Absolute local path to a DOCX, text-based PDF, TXT, or Markdown case material file.",
    },
  },
  required: ["path"],
  additionalProperties: false,
};

const GenerateParams = {
  type: "object",
  properties: {
	outputMode: {
	  type: "string",
	  enum: ["preview", "docx"],
	  description: "Use preview first. Use docx only after the user explicitly confirms the preview.",
	},
	confirmed: {
	  type: "boolean",
	  description: "Must be true for docx and only after explicit user confirmation. Use false for preview.",
	},
    template: {
      type: "string",
      enum: [
        "civil_complaint_natural_person",
        "civil_complaint_legal_entity",
        "civil_defense_natural_person",
        "civil_defense_legal_entity",
      ],
      description: "The selected official civil complaint or defense template and party type.",
    },
    partyLines: {
      type: "array",
      items: { type: "string" },
      description: "Complete plaintiff lines for complaints or respondent lines for defenses, including agents when applicable.",
    },
    opposingPartyLines: {
      type: "array",
      items: { type: "string" },
      description: "Complete defendant lines. Required for complaints.",
    },
    claims: { type: "array", items: { type: "string" }, description: "Complaint claims without numbering." },
    factsAndReasons: {
      type: "array",
      items: { type: "string" },
      description: "Complaint facts and reasons as separate paragraphs.",
    },
    caseReference: {
      type: "string",
      description: "For a defense: court, case number, parties, and cause of action that precede '一案的起诉'.",
    },
    defenseOpinions: {
      type: "array",
      items: { type: "string" },
      description: "Defense opinions as separate paragraphs.",
    },
    evidence: {
      type: "array",
      items: { type: "string" },
      description: "Evidence, sources, and witness names/addresses. Do not invent missing evidence.",
    },
    court: { type: "string", description: "Receiving people's court." },
    copies: { type: "string", description: "Number of document copies, without the unit 份." },
    signatureName: { type: "string", description: "Plaintiff or respondent name shown in the signature block." },
    date: { type: "string", description: "Signature date. Leave empty when unknown; do not invent it." },
    fileName: { type: "string", description: "Optional DOCX file name. The file is always written under generated-documents." },
  },
  required: ["outputMode", "confirmed", "template", "partyLines"],
  additionalProperties: false,
};

function buildDescription() {
  return [
    capability.description || "Generate a formatted Chinese civil litigation DOCX from a supported template.",
    capability.useWhen ? \`Use when: \${capability.useWhen}\` : "",
    capability.avoidWhen ? \`Do not use when: \${capability.avoidWhen}\` : "",
    "Never invent names, identity numbers, amounts, dates, case numbers, evidence, or courts. Leave unknown values empty so the tool marks them as pending.",
  ].filter(Boolean).join("\\n");
}

export default function (pi) {
  pi.registerTool({
    name: "extract_civil_case_material",
    label: "读取民事案件材料",
    description: "Read DOCX, text-based PDF, TXT, or Markdown civil case material with deterministic UTF-8 decoding. Returns needsOcr=true when a PDF has no usable text layer. Never infer file contents from its name.",
    promptSnippet: "extract_civil_case_material: deterministically read supported civil case material before drafting; do not use bash, pandoc, python, or pdftotext for supported files.",
    promptGuidelines: [
      "Call this tool first whenever the user supplies a DOCX, PDF, TXT, or Markdown case material path.",
      "Treat only the returned text as file evidence. Never reconstruct unreadable or missing content from the file name or prior knowledge.",
      "If needsOcr=true, call the configured OCR tool for the same path; otherwise do not call OCR.",
    ],
    parameters: ExtractParams,
    async execute(_toolCallId, params, signal) {
      const response = await fetch(bridge.extractUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: \`Bearer \${bridge.token}\`,
        },
        body: JSON.stringify(params),
        signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          \`Civil material extraction failed: HTTP \${response.status} \${text.slice(0, 1200)}\`,
        );
      }
      const result = JSON.parse(text);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: {
          capabilityId: capability.id,
          capabilityName: capability.name,
          path: result.path,
          fileType: result.fileType,
          usedOcr: result.usedOcr,
          needsOcr: result.needsOcr,
          pageCount: result.pageCount,
        },
      };
    },
  });

  pi.registerTool({
    name: "generate_civil_litigation_document",
    label: capability.name,
    description: buildDescription(),
    promptSnippet: "generate_civil_litigation_document: preview a verified civil complaint or defense, then create DOCX after confirmation.",
    promptGuidelines: [
      "Confirm document side and natural-person/legal-entity type before calling this tool.",
	  "Always call outputMode=preview with confirmed=false first and present the preview plus missing fields.",
	  "Call outputMode=docx with confirmed=true only after the user explicitly confirms the preview.",
    ],
    parameters: GenerateParams,
    async execute(_toolCallId, params, signal) {
      const response = await fetch(bridge.generateUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: \`Bearer \${bridge.token}\`,
        },
        body: JSON.stringify({ ...params, workspacePath }),
        signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(\`Civil document generation failed: HTTP \${response.status} \${text.slice(0, 1200)}\`);
      }
      const result = JSON.parse(text);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: {
          capabilityId: capability.id,
          capabilityName: capability.name,
          filePath: result.filePath,
          template: result.template,
          missingFields: result.missingFields || [],
        },
      };
    },
  });
}
`;
		await writeFile(extensionPath, source, "utf8");
		return extensionPath;
	}

	private async writeBrowserBridgeExtension(
		capabilities: CapabilityConfig[],
		agentDir: string,
	): Promise<string | null> {
		const browserCapabilities = capabilities
			.filter((capability) => capability.enabled && capability.type === "browser")
			.map((capability) => ({
				id: capability.id,
				name: capability.name,
				description: capability.description,
				browserMode: capability.browserMode ?? "builtin",
				browserAllowedDomains: capability.browserAllowedDomains ?? [],
				browserBlockedDomains: capability.browserBlockedDomains ?? [],
				browserAllowScreenshots: capability.browserAllowScreenshots ?? true,
				browserAllowDownloads: capability.browserAllowDownloads ?? false,
				browserRequireConfirmation: capability.browserRequireConfirmation ?? true,
				browserMaxSteps: capability.browserMaxSteps ?? 20,
				browserTimeoutMs: capability.browserTimeoutMs ?? 120000,
			}));
		if (browserCapabilities.length === 0 || !this.browserBridgeProvider) {
			return null;
		}

		const bridge = await this.browserBridgeProvider();
		if (!bridge) {
			return null;
		}

		const extensionDir = join(agentDir, "windows-browser-bridge");
		await mkdir(extensionDir, { recursive: true });
		const extensionPath = join(extensionDir, "index.mjs");
		const source = `const browserBridge = ${JSON.stringify(bridge, null, 2)};
const browserCapabilities = ${JSON.stringify(browserCapabilities, null, 2)};

const OpenParams = {
  type: "object",
  properties: {
    url: { type: "string", description: "HTTP or HTTPS URL to open." },
  },
  required: ["url"],
  additionalProperties: false,
};

const ExtractParams = {
  type: "object",
  properties: {
    url: { type: "string", description: "Optional HTTP or HTTPS URL to open before extracting visible text." },
  },
  additionalProperties: false,
};

const ClickParams = {
  type: "object",
  properties: {
    ref: { type: "number", description: "Element reference number from Interactive elements." },
    text: { type: "string", description: "Visible text, aria-label, title, or value of the button/link/input to click." },
    selector: { type: "string", description: "Optional CSS selector for the target element." },
    exact: { type: "boolean", description: "Whether text matching must be exact. Defaults to false." },
    url: { type: "string", description: "Optional HTTP or HTTPS URL to open before clicking." },
  },
  additionalProperties: false,
};

const TypeParams = {
  type: "object",
  properties: {
    value: { type: "string", description: "Text to type into the input." },
    ref: { type: "number", description: "Input reference number from Interactive elements." },
    text: { type: "string", description: "Visible label, placeholder, aria-label, title, or value of the input." },
    selector: { type: "string", description: "Optional CSS selector for the input element." },
    exact: { type: "boolean", description: "Whether text matching must be exact. Defaults to false." },
    submit: { type: "boolean", description: "Whether to press Enter or submit the form after typing." },
    url: { type: "string", description: "Optional HTTP or HTTPS URL to open before typing." },
  },
  required: ["value"],
  additionalProperties: false,
};

const ScrollParams = {
  type: "object",
  properties: {
    direction: { type: "string", enum: ["up", "down", "left", "right"], description: "Scroll direction." },
    amount: { type: "number", description: "Scroll pixels. Defaults to 700." },
  },
  additionalProperties: false,
};

const PressParams = {
  type: "object",
  properties: {
    key: { type: "string", description: "Key to press, for example Enter, Escape, Tab, ArrowDown." },
  },
  required: ["key"],
  additionalProperties: false,
};

const WaitParams = {
  type: "object",
  properties: {
    text: { type: "string", description: "Optional visible text to wait for." },
    timeoutMs: { type: "number", description: "Maximum wait time in milliseconds." },
  },
  additionalProperties: false,
};

const EmptyParams = { type: "object", properties: {}, additionalProperties: false };

const SelectParams = {
  type: "object",
  properties: {
    value: { type: "string", description: "Option value or visible option text to select." },
    ref: { type: "number", description: "Select element reference number from Interactive elements." },
    text: { type: "string", description: "Visible label or text near the select element." },
    selector: { type: "string", description: "Optional CSS selector for the select element." },
    exact: { type: "boolean", description: "Whether text matching must be exact. Defaults to false." },
  },
  required: ["value"],
  additionalProperties: false,
};

function getCapability() {
  return browserCapabilities[0];
}

function summarizeSnapshot(snapshot) {
  const lines = [
    \`Title: \${snapshot.title || ""}\`,
    \`URL: \${snapshot.url || ""}\`,
    "Visible text:",
    snapshot.visibleText || "",
  ];
  if (Array.isArray(snapshot.interactiveElements) && snapshot.interactiveElements.length > 0) {
    lines.push("", "Interactive elements:");
    for (const element of snapshot.interactiveElements) {
      const href = element.href ? \` href=\${element.href}\` : "";
      lines.push(\`[\${element.ref}] \${element.role}: \${element.text} selector=\${element.selector}\${href}\`);
    }
  }
  return lines.join("\\n");
}

function buildToolResult(snapshot) {
  const capability = getCapability();
  return {
    content: [{ type: "text", text: summarizeSnapshot(snapshot) }],
    details: {
      capabilityId: capability?.id,
      capabilityName: capability?.name,
    },
  };
}

async function callBrowserBridge(action, params, signal) {
  const response = await fetch(browserBridge.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: \`Bearer \${browserBridge.token}\`,
    },
    body: JSON.stringify({
      action,
      url: typeof params?.url === "string" ? params.url : undefined,
      ref: typeof params?.ref === "number" ? params.ref : undefined,
      selector: typeof params?.selector === "string" ? params.selector : undefined,
      text: typeof params?.text === "string" ? params.text : undefined,
      value: typeof params?.value === "string" ? params.value : undefined,
      exact: typeof params?.exact === "boolean" ? params.exact : undefined,
      submit: typeof params?.submit === "boolean" ? params.submit : undefined,
      direction: typeof params?.direction === "string" ? params.direction : undefined,
      amount: typeof params?.amount === "number" ? params.amount : undefined,
      key: typeof params?.key === "string" ? params.key : undefined,
      timeoutMs: typeof params?.timeoutMs === "number" ? params.timeoutMs : undefined,
      capability: getCapability(),
    }),
    signal,
  });
  const result = await response.json();
  if (!response.ok || result?.error) {
    throw new Error(result?.error || \`Browser bridge failed with HTTP \${response.status}\`);
  }
  return result;
}

export default function (pi) {
  pi.registerTool({
    name: "browser_open",
    label: "Browser open",
    description: "Open a web page with the Windows client's controlled browser and return the page title plus visible text.",
    promptSnippet: "browser_open: open a URL in the controlled browser and read the page title, visible text, and clickable elements.",
    promptGuidelines: [
      "When the user asks to use a browser, call browser_open, browser_extract, browser_click, or browser_type instead of bash, curl, read, or command-line tools.",
    ],
    parameters: OpenParams,
    async execute(_toolCallId, params, signal) {
      const snapshot = await callBrowserBridge("open", params, signal);
      return buildToolResult(snapshot);
    },
  });

  pi.registerTool({
    name: "browser_extract",
    label: "Browser extract",
    description: "Extract the current controlled browser page title, URL, and visible text. Optionally open a URL first.",
    promptSnippet: "browser_extract: extract title, URL, visible text, and clickable elements from the controlled browser page.",
    promptGuidelines: [
      "Use browser_extract to inspect page contents and available buttons or links before clicking.",
    ],
    parameters: ExtractParams,
    async execute(_toolCallId, params, signal) {
      const snapshot = await callBrowserBridge("extract", params, signal);
      return buildToolResult(snapshot);
    },
  });

  pi.registerTool({
    name: "browser_click",
    label: "Browser click",
    description: "Click a visible link, button, or input in the controlled browser by text or CSS selector, then return the updated page.",
    promptSnippet: "browser_click: click a visible page element by text or selector and return the updated page state.",
    promptGuidelines: [
      "Before clicking, use browser_extract when you need to inspect available interactive elements.",
      "Prefer text matching for user-facing links and buttons; use selector only when the returned interactive element includes one.",
    ],
    parameters: ClickParams,
    async execute(_toolCallId, params, signal) {
      const snapshot = await callBrowserBridge("click", params, signal);
      return buildToolResult(snapshot);
    },
  });

  pi.registerTool({
    name: "browser_type",
    label: "Browser type",
    description: "Type text into a visible input, textarea, contenteditable field, or search box, then optionally submit.",
    promptSnippet: "browser_type: type text into a visible input by ref, text, or selector; optionally submit with Enter.",
    promptGuidelines: [
      "Use browser_type for search boxes and forms. Use the ref or selector returned by browser_extract when available.",
      "Set submit=true when the user asks to search and the page expects Enter/form submission.",
    ],
    parameters: TypeParams,
    async execute(_toolCallId, params, signal) {
      const snapshot = await callBrowserBridge("type", params, signal);
      return buildToolResult(snapshot);
    },
  });

  pi.registerTool({
    name: "browser_scroll",
    label: "Browser scroll",
    description: "Scroll the controlled browser viewport.",
    promptSnippet: "browser_scroll: scroll the page up, down, left, or right to reveal more content.",
    promptGuidelines: ["Use browser_scroll when an expected element is not visible yet."],
    parameters: ScrollParams,
    async execute(_toolCallId, params, signal) {
      const snapshot = await callBrowserBridge("scroll", params, signal);
      return buildToolResult(snapshot);
    },
  });

  pi.registerTool({
    name: "browser_press",
    label: "Browser press",
    description: "Press a keyboard key in the controlled browser.",
    promptSnippet: "browser_press: press Enter, Escape, Tab, ArrowDown, or another key in the page.",
    promptGuidelines: ["Use browser_press for keyboard-driven widgets or after focusing an input."],
    parameters: PressParams,
    async execute(_toolCallId, params, signal) {
      const snapshot = await callBrowserBridge("press", params, signal);
      return buildToolResult(snapshot);
    },
  });

  pi.registerTool({
    name: "browser_wait",
    label: "Browser wait",
    description: "Wait for time to pass or for visible text to appear in the controlled browser.",
    promptSnippet: "browser_wait: wait for dynamic page updates or specific visible text.",
    promptGuidelines: ["Use browser_wait after clicks, typing, or navigation that triggers dynamic loading."],
    parameters: WaitParams,
    async execute(_toolCallId, params, signal) {
      const snapshot = await callBrowserBridge("wait", params, signal);
      return buildToolResult(snapshot);
    },
  });

  pi.registerTool({
    name: "browser_back",
    label: "Browser back",
    description: "Navigate back in the controlled browser history.",
    promptSnippet: "browser_back: go back to the previous page.",
    parameters: EmptyParams,
    async execute(_toolCallId, params, signal) {
      const snapshot = await callBrowserBridge("back", params, signal);
      return buildToolResult(snapshot);
    },
  });

  pi.registerTool({
    name: "browser_reload",
    label: "Browser reload",
    description: "Reload the current controlled browser page.",
    promptSnippet: "browser_reload: refresh the current page.",
    parameters: EmptyParams,
    async execute(_toolCallId, params, signal) {
      const snapshot = await callBrowserBridge("reload", params, signal);
      return buildToolResult(snapshot);
    },
  });

  pi.registerTool({
    name: "browser_select",
    label: "Browser select",
    description: "Select an option in a visible HTML select dropdown.",
    promptSnippet: "browser_select: choose an option in a select dropdown by ref, text, selector, and option value.",
    promptGuidelines: ["Use browser_select for native dropdowns. Use browser_click for custom dropdown menus."],
    parameters: SelectParams,
    async execute(_toolCallId, params, signal) {
      const snapshot = await callBrowserBridge("select", params, signal);
      return buildToolResult(snapshot);
    },
  });
}
`;
		await writeFile(extensionPath, source, "utf8");
		return extensionPath;
	}

	private parseJsonObject(value: string): Record<string, unknown> {
		if (!value.trim()) {
			return {};
		}

		try {
			const parsed = JSON.parse(value) as unknown;
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	}

	private parseToolSchema(value: string): Record<string, unknown> {
		const parsed = this.parseJsonObject(value);
		return parsed.type === "object" ? parsed : { type: "object", additionalProperties: true };
	}

	private normalizeToolName(value: string): string {
		return (value || "http_tool")
			.replace(/[^a-zA-Z0-9_-]/g, "_")
			.replace(/^([^a-zA-Z_])/, "_$1")
			.slice(0, 64);
	}

	private attachJsonlReader(state: RpcProcessSession): void {
		const decoder = new StringDecoder("utf8");
		let buffer = "";

		state.process.stdout.on("data", (chunk: Buffer) => {
			buffer += decoder.write(chunk);
			while (true) {
				const newlineIndex = buffer.indexOf("\n");
				if (newlineIndex === -1) {
					break;
				}
				const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
				buffer = buffer.slice(newlineIndex + 1);
				this.handleRpcLine(state, line);
			}
		});
	}

	private handleRpcLine(state: RpcProcessSession, line: string): void {
		if (!line.trim()) {
			return;
		}

		try {
			const data = JSON.parse(line) as RpcResponse | RpcEvent;
			if (this.isRpcResponse(data) && data.id && state.pending.has(data.id)) {
				const pending = state.pending.get(data.id);
				if (!pending) {
					return;
				}
				clearTimeout(pending.timer);
				state.pending.delete(data.id);
				pending.resolve(data);
				return;
			}
			const event = data as RpcEvent;
			state.events.push(event);
			this.emitRpcProgress(state, event);
		} catch {
			state.stderr += `${line}\n`;
		}
	}

	private emitRpcProgress(state: RpcProcessSession, event: RpcEvent): void {
		if (event.type === "agent_start") {
			this.emitProgress(state, {
				sessionId: state.session.id,
				title: "智能体开始工作",
				status: "running",
			});
			return;
		}
		if (event.type === "model_request") {
			const modelName = [event.model?.provider, event.model?.modelId].filter(Boolean).join("/");
			this.emitProgress(state, {
				sessionId: state.session.id,
				title: "准备模型请求",
				detail: modelName || "正在整理消息、工具和系统提示词。",
				status: "running",
			});
			return;
		}
		if (event.type === "model_response") {
			const errorMessage = event.errorMessage ?? this.getAssistantMessageError(event.message);
			this.emitProgress(state, {
				sessionId: state.session.id,
				title: errorMessage ? "模型响应失败" : "收到模型响应",
				detail: errorMessage ?? this.summarizeAssistantMessage(event.message),
				status: errorMessage ? "failure" : "success",
			});
			return;
		}
		if (event.type === "tool_execution_start") {
			this.emitProgress(state, {
				sessionId: state.session.id,
				title: `调用工具：${event.toolName ?? "unknown-tool"}`,
				detail: this.summarizeUnknown(event.args ?? event.input),
				status: "running",
			});
			return;
		}
		if (event.type === "tool_execution_update") {
			this.emitProgress(state, {
				sessionId: state.session.id,
				title: `工具进展：${event.toolName ?? "unknown-tool"}`,
				detail: this.summarizeUnknown(event.partialResult, 240),
				status: "running",
			});
			return;
		}
		if (event.type === "tool_execution_end") {
			this.emitTaskPlanProgress(state, event);
			const delegatedSummary = this.emitDelegatedSubagentProgress(state, event);
			this.emitProgress(state, {
				sessionId: state.session.id,
				title: `工具完成：${event.toolName ?? "unknown-tool"}`,
				detail: delegatedSummary ?? this.summarizeUnknown(event.result, 240),
				status: event.isError ? "failure" : "success",
			});
			return;
		}
		if (event.type === "message_start" && event.message?.role === "assistant") {
			this.emitProgress(state, {
				sessionId: state.session.id,
				title: "开始生成回复",
				status: "running",
			});
			return;
		}
		if (event.type === "turn_end") {
			this.emitProgress(state, {
				sessionId: state.session.id,
				title: "完成一轮推理",
				detail: event.toolResults?.length ? `返回 ${event.toolResults.length} 个工具结果。` : undefined,
				status: "success",
			});
			return;
		}
		if (event.type === "agent_end") {
			this.emitProgress(state, {
				sessionId: state.session.id,
				title: "智能体执行结束",
				status: "success",
			});
		}
	}

	private emitDelegatedSubagentProgress(state: RpcProcessSession, event: RpcEvent): string | undefined {
		if (event.toolName !== "delegate_to_subagent" || !this.isRecord(event.result)) {
			return undefined;
		}
		const details = event.result.details;
		if (!this.isRecord(details) || !Array.isArray(details.subagentProgressEvents)) {
			return undefined;
		}
		const taskId = typeof details.taskId === "string" ? details.taskId : undefined;
		const childSessionId = typeof details.childSessionId === "string" ? details.childSessionId : undefined;
		const subagentRole = this.normalizeSubagentRole(details.subagentRole);
		const subagentName = typeof details.subagentName === "string" ? details.subagentName : undefined;
		const prefix = subagentName || subagentRole || "专业子智能体";
		let emittedCount = 0;

		for (const value of details.subagentProgressEvents) {
			const progressEvent = this.normalizeDelegatedProgressEvent(value);
			if (!progressEvent) {
				continue;
			}
			this.emitProgress(state, {
				id: progressEvent.id,
				sessionId: state.session.id,
				timestamp: progressEvent.timestamp,
				title: `子智能体 · ${prefix} · ${progressEvent.title}`,
				detail: progressEvent.detail,
				status: progressEvent.status,
				durationMs: progressEvent.durationMs,
				source: "subagent",
				taskId,
				childSessionId,
				subagentRole,
				subagentName,
			});
			emittedCount++;
		}

		return [
			`子智能体“${prefix}”已返回 ${emittedCount} 个执行步骤。`,
			taskId ? `任务 ID：${taskId}。` : "",
			childSessionId ? `子会话 ID：${childSessionId}。` : "",
		]
			.filter(Boolean)
			.join(" ");
	}

	private emitTaskPlanProgress(state: RpcProcessSession, event: RpcEvent): void {
		if (!this.isRecord(event.result)) {
			return;
		}
		const details = event.result.details;
		if (!this.isRecord(details)) {
			return;
		}
		const taskPlan = this.normalizeTaskPlan(details.taskPlan);
		if (!taskPlan) {
			return;
		}
		const completedCount = taskPlan.steps.filter((step) => step.status === "completed").length;
		this.emitProgress(state, {
			id: `${event.toolCallId ?? crypto.randomUUID()}-plan-${taskPlan.version}-${completedCount}`,
			sessionId: state.session.id,
			title: event.toolName === "update_task_plan" ? "全局任务计划已更新" : "计划步骤执行状态已更新",
			detail: `计划 v${taskPlan.version}；已完成 ${completedCount}/${taskPlan.steps.length}；${taskPlan.revisionReason}`,
			status: taskPlan.steps.some((step) => step.status === "failed") ? "failure" : "info",
			taskPlan,
		});
	}

	private normalizeDelegatedProgressEvent(value: unknown): AgentProgressEvent | null {
		if (!this.isRecord(value)) {
			return null;
		}
		const status = value.status;
		if (status !== "running" && status !== "success" && status !== "failure" && status !== "info") {
			return null;
		}
		if (typeof value.title !== "string" || typeof value.timestamp !== "string") {
			return null;
		}
		return {
			id: typeof value.id === "string" ? value.id : crypto.randomUUID(),
			sessionId: typeof value.sessionId === "string" ? value.sessionId : "",
			timestamp: value.timestamp,
			title: value.title,
			detail: typeof value.detail === "string" ? value.detail : undefined,
			status,
			durationMs: typeof value.durationMs === "number" ? value.durationMs : undefined,
		};
	}

	private normalizeTaskPlan(value: unknown): AgentTaskPlan | null {
		if (!this.isRecord(value) || !Array.isArray(value.steps)) {
			return null;
		}
		const steps: AgentTaskPlan["steps"] = value.steps.flatMap((step): AgentTaskPlan["steps"] => {
			if (!this.isRecord(step)) {
				return [];
			}
			const status = step.status;
			if (
				typeof step.id !== "string" ||
				typeof step.title !== "string" ||
				(status !== "pending" && status !== "in_progress" && status !== "completed" && status !== "failed")
			) {
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
			return null;
		}
		return {
			version: typeof value.version === "number" ? value.version : 1,
			objective: value.objective,
			revisionReason: typeof value.revisionReason === "string" ? value.revisionReason : "",
			updatedAt: value.updatedAt,
			steps,
		};
	}

	private normalizeSubagentRole(value: unknown): MtclawSubagentRole | undefined {
		return typeof value === "string" && /^[a-z][a-z0-9_-]{1,63}$/.test(value) ? value : undefined;
	}

	private emitProgress(
		state: RpcProcessSession,
		event: Omit<AgentProgressEvent, "id" | "timestamp"> & { id?: string; timestamp?: string },
	): void {
		const { id, timestamp, ...eventDetails } = event;
		const progressEvent: AgentProgressEvent = {
			id: id ?? crypto.randomUUID(),
			timestamp: timestamp ?? new Date().toISOString(),
			...eventDetails,
		};
		state.progressEvents.push(progressEvent);
		state.progressHandler?.(progressEvent);
	}

	private createExecutionError(state: RpcProcessSession, error: unknown): AgentExecutionError {
		const message = error instanceof Error ? error.message : String(error);
		return new AgentExecutionError(message, {
			capabilityCalls: this.extractCapabilityCalls(state.events),
			modelInteractions: this.extractModelInteractions(state.events),
			progressEvents: [...state.progressEvents],
		});
	}

	private formatDuration(ms: number): string {
		const totalSeconds = Math.max(0, Math.round(ms / 1000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		if (minutes === 0) {
			return `${seconds} 秒`;
		}
		return `${minutes} 分 ${seconds.toString().padStart(2, "0")} 秒`;
	}

	private isRpcResponse(data: RpcResponse | RpcEvent): data is RpcResponse {
		return data.type === "response" && "command" in data && "success" in data;
	}

	private sendCommand(
		state: RpcProcessSession,
		command: Record<string, unknown>,
		timeoutMs = 30000,
	): Promise<RpcResponse> {
		const id = `windows-client-${++state.requestId}`;
		const payload = `${JSON.stringify({ ...command, id })}\n`;

		return new Promise((resolvePromise, rejectPromise) => {
			const timer = setTimeout(() => {
				state.pending.delete(id);
				rejectPromise(new Error(`等待石斧智能体运行时响应超时：${String(command.type)}。${state.stderr}`));
			}, timeoutMs);

			state.pending.set(id, {
				resolve: (response) => {
					if (!response.success) {
						rejectPromise(new Error(response.error ?? `石斧智能体运行时命令失败：${response.command}`));
						return;
					}
					resolvePromise(response);
				},
				reject: rejectPromise,
				timer,
			});

			state.process.stdin.write(payload, "utf8");
		});
	}

	private normalizeRpcSessionState(value: unknown): RpcSessionStateData {
		if (!this.isRecord(value)) {
			return {};
		}

		const contextPreview = this.normalizeModelContextPreview(value.contextPreview);
		return {
			isStreaming: typeof value.isStreaming === "boolean" ? value.isStreaming : undefined,
			contextPreview,
		};
	}

	private normalizeModelContextPreview(value: unknown): AgentModelContextPreview | undefined {
		if (!this.isRecord(value)) {
			return undefined;
		}

		const systemPrompt = typeof value.systemPrompt === "string" ? value.systemPrompt : "";
		const messageCount = typeof value.messageCount === "number" ? value.messageCount : 0;
		const tools = Array.isArray(value.tools)
			? value.tools
					.filter((tool): tool is Record<string, unknown> => this.isRecord(tool))
					.map((tool) => ({
						name: typeof tool.name === "string" ? tool.name : "",
						description: typeof tool.description === "string" ? tool.description : "",
						source: typeof tool.source === "string" ? tool.source : "",
					}))
					.filter((tool) => tool.name.length > 0)
			: [];

		return { systemPrompt, tools, messageCount };
	}

	private waitForAgentEnd(state: RpcProcessSession): Promise<RpcEvent[]> {
		return new Promise((resolvePromise, rejectPromise) => {
			const startedAt = state.events.length;
			const cleanup = (): void => {
				clearInterval(interval);
				state.process.off("exit", handleExit);
			};
			const handleExit = (code: number | null, signal: NodeJS.Signals | null): void => {
				cleanup();
				if (state.stopRequested) {
					rejectPromise(new Error("智能体任务已由用户停止。"));
					return;
				}
				const exitReason = signal ? `信号 ${signal}` : `退出码 ${code ?? "未知"}`;
				rejectPromise(new Error(`石斧智能体运行时在完成回复前退出（${exitReason}）。${state.stderr}`));
			};

			const interval = setInterval(() => {
				const events = state.events.slice(startedAt);
				if (events.some((event) => event.type === "agent_end")) {
					cleanup();
					resolvePromise(events);
				}
			}, 100);
			state.process.once("exit", handleExit);
			if (state.process.exitCode !== null) {
				handleExit(state.process.exitCode, state.process.signalCode);
			}
		});
	}

	private async getLastAssistantText(state: RpcProcessSession): Promise<string | null> {
		const response = await this.sendCommand(state, { type: "get_last_assistant_text" });
		const data = response.data as { text?: string | null } | undefined;
		return data?.text ?? null;
	}

	private extractAssistantText(events: RpcEvent[]): string {
		const agentEnd = [...events].reverse().find((event) => event.type === "agent_end");
		const assistant = [...(agentEnd?.messages ?? [])].reverse().find((message) => message.role === "assistant");
		const content = assistant?.content;
		if (typeof content === "string") {
			return content.trim();
		}
		if (Array.isArray(content)) {
			return content
				.filter(
					(item): item is { type: "text"; text: string } =>
						this.isRecord(item) && item.type === "text" && typeof item.text === "string",
				)
				.map((item) => item.text)
				.join("\n")
				.trim();
		}
		return "";
	}

	private extractCapabilityCalls(events: RpcEvent[]): AgentCapabilityCallLog[] {
		const calls = new Map<string, AgentCapabilityCallLog>();
		const orderedIds: string[] = [];

		const ensureCall = (id: string, toolName: string): AgentCapabilityCallLog => {
			const existing = calls.get(id);
			if (existing) {
				if (!existing.toolName && toolName) {
					existing.toolName = toolName;
				}
				return existing;
			}
			const next: AgentCapabilityCallLog = {
				toolCallId: id,
				toolName: toolName || "unknown-tool",
				status: "success",
			};
			calls.set(id, next);
			orderedIds.push(id);
			return next;
		};

		for (const event of events) {
			if (event.type === "tool_execution_start" && event.toolCallId && event.toolName) {
				const call = ensureCall(event.toolCallId, event.toolName);
				call.startedAt = call.startedAt ?? new Date().toISOString();
				call.inputSummary = this.summarizeUnknown(event.args ?? event.input);
				call.fullInput = this.redactSensitive(this.stringifyUnknown(event.args ?? event.input));
				continue;
			}

			if (event.type === "tool_execution_update" && event.toolCallId && event.toolName) {
				const call = ensureCall(event.toolCallId, event.toolName);
				call.outputSummary = call.outputSummary ?? this.summarizeUnknown(event.partialResult);
				call.fullOutput = call.fullOutput ?? this.redactSensitive(this.stringifyUnknown(event.partialResult));
				continue;
			}

			if (event.type === "tool_execution_end" && event.toolCallId && event.toolName) {
				const call = ensureCall(event.toolCallId, event.toolName);
				call.endedAt = new Date().toISOString();
				call.status = event.isError ? "failure" : "success";
				call.outputSummary = this.summarizeUnknown(event.result);
				call.fullOutput = this.redactSensitive(this.stringifyUnknown(event.result));
				const capabilityMeta = this.extractToolResultCapabilityMeta(event.result);
				call.capabilityId = call.capabilityId ?? capabilityMeta.capabilityId;
				call.capabilityName = call.capabilityName ?? capabilityMeta.capabilityName;
				continue;
			}

			if (event.type === "agent_end") {
				this.extractToolCallsFromMessages(event.messages ?? [], ensureCall);
				continue;
			}

			if (event.type === "turn_end") {
				this.extractToolCallsFromMessages(
					[event.message, ...(event.toolResults ?? [])].filter(
						(message): message is NonNullable<RpcEvent["message"]> => Boolean(message),
					),
					ensureCall,
				);
			}
		}

		return orderedIds.map((id) => calls.get(id)).filter((call): call is AgentCapabilityCallLog => Boolean(call));
	}

	private extractModelInteractions(events: RpcEvent[]): AgentModelInteractionLog[] {
		const interactions: AgentModelInteractionLog[] = [];
		let callIndex = 0;
		let currentCallId = "";
		const toolLabelsByName = new Map<string, string>();

		for (const event of events) {
			if (event.type === "model_request") {
				callIndex++;
				currentCallId = `model-call-${callIndex}`;
				this.collectToolLabels(event.context, toolLabelsByName);
				const request = {
					model: event.model,
					reasoning: event.reasoning,
					context: this.annotateLoggedContext(event.context, toolLabelsByName),
				};
				const fullInput = this.redactSensitive(this.stringifyUnknown(request));
				interactions.push({
					callId: currentCallId,
					kind: "context",
					modelProvider: event.model?.provider,
					modelId: event.model?.modelId,
					modelName: event.model?.modelName,
					modelApi: event.model?.api,
					inputSummary: this.summarizeModelInput(event.context),
					fullInput,
					status: "success",
					startedAt: new Date().toISOString(),
				});
				continue;
			}

			if (event.type === "model_request_payload") {
				const callId = currentCallId || `model-call-${callIndex + 1}`;
				const fullInput = this.redactSensitive(
					this.stringifyUnknown(this.annotateLoggedPayload(event.payload, toolLabelsByName)),
				);
				interactions.push({
					callId,
					kind: "payload",
					modelProvider: event.model?.provider,
					modelId: event.model?.modelId,
					modelName: event.model?.modelName,
					modelApi: event.model?.api,
					inputSummary: "Provider payload",
					fullInput,
					status: "success",
					startedAt: new Date().toISOString(),
				});
				continue;
			}

			if (event.type === "model_response") {
				const callId = currentCallId || `model-call-${callIndex || 1}`;
				const messageError = this.getAssistantMessageError(event.message);
				const errorMessage = event.errorMessage ?? messageError;
				const fullOutput = this.redactSensitive(this.stringifyUnknown(event.message ?? { error: errorMessage }));
				interactions.push({
					callId,
					kind: "response",
					modelProvider: event.model?.provider,
					modelId: event.model?.modelId,
					modelName: event.model?.modelName,
					modelApi: event.model?.api,
					outputSummary: errorMessage ?? this.summarizeAssistantMessage(event.message),
					fullOutput,
					status: errorMessage ? "failure" : "success",
					endedAt: new Date().toISOString(),
					errorMessage,
				});
			}
		}

		return interactions;
	}

	private extractToolCallsFromMessages(
		messages: NonNullable<RpcEvent["messages"]>,
		ensureCall: (id: string, toolName: string) => AgentCapabilityCallLog,
	): void {
		for (const message of messages) {
			if (message.role === "assistant" && Array.isArray(message.content)) {
				for (const item of message.content) {
					if (!this.isRecord(item) || (item.type !== "toolCall" && item.type !== "tool_call")) {
						continue;
					}
					const id = this.asString(item.id ?? item.toolCallId);
					const name = this.asString(item.name ?? item.toolName);
					if (!id || !name) {
						continue;
					}
					const call = ensureCall(id, name);
					call.inputSummary =
						call.inputSummary ?? this.summarizeUnknown(item.arguments ?? item.args ?? item.input);
					call.fullInput =
						call.fullInput ??
						this.redactSensitive(this.stringifyUnknown(item.arguments ?? item.args ?? item.input));
				}
			}

			if (message.role === "toolResult") {
				const id = this.asString(message.toolCallId);
				const name = this.asString(message.toolName) || "tool-result";
				if (!id) {
					continue;
				}
				const call = ensureCall(id, name);
				call.outputSummary = call.outputSummary ?? this.summarizeUnknown(message.content);
				call.fullOutput = call.fullOutput ?? this.redactSensitive(this.stringifyUnknown(message.content));
				call.status = "success";
				const capabilityMeta = this.extractToolResultCapabilityMeta(message.content);
				call.capabilityId = call.capabilityId ?? capabilityMeta.capabilityId;
				call.capabilityName = call.capabilityName ?? capabilityMeta.capabilityName;
			}

			if (message.role === "assistant" && this.isRecord(message.content)) {
				const id = this.asString(message.content.id ?? message.content.toolCallId);
				const name = this.asString(message.content.name ?? message.content.toolName);
				if (id && name) {
					const call = ensureCall(id, name);
					call.inputSummary =
						call.inputSummary ??
						this.summarizeUnknown(message.content.arguments ?? message.content.args ?? message.content.input);
					call.fullInput =
						call.fullInput ??
						this.redactSensitive(
							this.stringifyUnknown(message.content.arguments ?? message.content.args ?? message.content.input),
						);
				}
			}
		}
	}

	private extractToolResultCapabilityMeta(value: unknown): ToolResultCapabilityMeta {
		if (!this.isRecord(value)) {
			return {};
		}
		const details = this.isRecord(value.details) ? value.details : undefined;
		if (!details) {
			return {};
		}
		return {
			capabilityId: this.asString(details.capabilityId),
			capabilityName: this.asString(details.capabilityName),
		};
	}

	private collectToolLabels(context: unknown, labelsByName: Map<string, string>): void {
		if (!this.isRecord(context) || !Array.isArray(context.tools)) {
			return;
		}
		for (const tool of context.tools) {
			if (!this.isRecord(tool)) {
				continue;
			}
			const name = this.asString(tool.name);
			const label = this.asString(tool.label);
			if (name && label && label !== name) {
				labelsByName.set(name, label);
			}
		}
	}

	private annotateLoggedContext(context: unknown, labelsByName: Map<string, string>): unknown {
		if (!this.isRecord(context) || !Array.isArray(context.tools)) {
			return context;
		}
		return {
			...context,
			tools: context.tools.map((tool) => this.annotateLoggedTool(tool, labelsByName)),
		};
	}

	private annotateLoggedPayload(payload: unknown, labelsByName: Map<string, string>): unknown {
		return this.annotatePayloadValue(payload, labelsByName);
	}

	private annotatePayloadValue(value: unknown, labelsByName: Map<string, string>): unknown {
		if (Array.isArray(value)) {
			return value.map((item) => this.annotatePayloadValue(item, labelsByName));
		}
		if (!this.isRecord(value)) {
			return value;
		}

		const annotated = this.annotateLoggedTool(value, labelsByName);
		const result: JsonRecord = {};
		for (const [key, child] of Object.entries(annotated)) {
			result[key] = this.annotatePayloadValue(child, labelsByName);
		}
		return result;
	}

	private annotateLoggedTool(value: JsonRecord, labelsByName: Map<string, string>): JsonRecord;
	private annotateLoggedTool(value: unknown, labelsByName: Map<string, string>): JsonRecord | unknown;
	private annotateLoggedTool(value: unknown, labelsByName: Map<string, string>): JsonRecord | unknown {
		if (!this.isRecord(value)) {
			return value;
		}
		const directName = this.asString(value.name);
		const functionValue = this.isRecord(value.function) ? value.function : undefined;
		const functionName = this.asString(functionValue?.name);
		const name = directName ?? functionName;
		if (!name) {
			return value;
		}
		const label = labelsByName.get(name);
		if (!label) {
			return value;
		}
		if (directName && !this.asString(value.label)) {
			return { ...value, label };
		}
		if (functionValue && !this.asString(functionValue.label)) {
			return { ...value, function: { ...functionValue, label } };
		}
		return value;
	}

	private summarizeUnknown(value: unknown, maxLength = 500): string | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}

		let text: string;
		if (typeof value === "string") {
			text = value;
		} else {
			try {
				text = JSON.stringify(value);
			} catch {
				text = String(value);
			}
		}

		const redacted = text
			.replace(/("(?:api[_-]?key|token|authorization|password|secret)"\s*:\s*)"[^"]+"/gi, '$1"***"')
			.replace(/(bearer\s+)[a-z0-9._-]+/gi, "$1***");
		return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 3)}...`;
	}

	private redactSensitive(value: string): string {
		return value
			.replace(/("(?:api[_-]?key|token|authorization|password|secret)"\s*:\s*)"[^"]+"/gi, '$1"***"')
			.replace(/(bearer\s+)[a-z0-9._-]+/gi, "$1***");
	}

	private stringifyUnknown(value: unknown): string {
		try {
			return JSON.stringify(value, (_key, item) => (typeof item === "function" ? "[function]" : item), 2);
		} catch {
			return String(value);
		}
	}

	private summarizeModelInput(context: unknown): string {
		if (!this.isRecord(context)) {
			return "Model request context";
		}
		const messages = Array.isArray(context.messages) ? context.messages.length : 0;
		const tools = Array.isArray(context.tools) ? context.tools.length : 0;
		const systemPrompt = typeof context.systemPrompt === "string" ? context.systemPrompt : "";
		const promptPreview = systemPrompt.trim()
			? `system: ${this.summarizeUnknown(systemPrompt, 120)}`
			: "no system prompt";
		return `LLM context: ${messages} messages, ${tools} tools, ${promptPreview}`;
	}

	private summarizeAssistantMessage(message: unknown): string {
		if (!this.isRecord(message)) {
			return "Model response";
		}
		const content = message.content;
		if (Array.isArray(content)) {
			const text = content
				.filter(
					(item): item is { type: "text"; text: string } =>
						this.isRecord(item) && item.type === "text" && typeof item.text === "string",
				)
				.map((item) => item.text)
				.join("\n")
				.trim();
			if (text) {
				return this.summarizeUnknown(text, 240) ?? "Model response";
			}
		}
		if (typeof content === "string" && content.trim()) {
			return this.summarizeUnknown(content, 240) ?? "Model response";
		}
		const stopReason = typeof message.stopReason === "string" ? message.stopReason : "unknown";
		return `Model response: ${stopReason}`;
	}

	private getAssistantMessageError(message: unknown): string | undefined {
		if (!this.isRecord(message)) {
			return undefined;
		}
		const stopReason = typeof message.stopReason === "string" ? message.stopReason : "";
		if (stopReason !== "error" && stopReason !== "aborted") {
			return undefined;
		}
		return typeof message.errorMessage === "string" && message.errorMessage.trim()
			? message.errorMessage.trim()
			: `Model response ended with ${stopReason}`;
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return Boolean(value && typeof value === "object" && !Array.isArray(value));
	}

	private asString(value: unknown): string | undefined {
		return typeof value === "string" && value.trim() ? value.trim() : undefined;
	}

	private extractAssistantError(events: RpcEvent[]): string | null {
		const messages = events.flatMap((event) => {
			const batch = event.messages ?? [];
			return event.message ? [...batch, event.message] : batch;
		});
		const assistant = [...messages].reverse().find((message) => message.role === "assistant");
		if (assistant?.stopReason === "error") {
			return assistant.errorMessage || "模型调用失败，但石斧智能体运行时未返回具体错误。";
		}
		return null;
	}
}
