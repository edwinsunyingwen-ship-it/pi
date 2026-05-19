import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { app } from "electron";
import type {
	AgentCapabilityCallLog,
	AgentMessageResult,
	AgentSession,
	AgentToolInfo,
	ModelProfileConfig,
} from "../../shared/types";

export interface AgentStartOptions {
	model: ModelProfileConfig | null;
	cwd: string | null;
	appendSystemPrompt?: string;
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
};

export interface AgentAdapter {
	startSession(options?: AgentStartOptions): Promise<AgentSession>;
	sendUserMessage(sessionId: string, message: string): Promise<AgentMessageResult>;
	stopSession(sessionId: string): Promise<AgentSession>;
	getSessionState(sessionId: string): Promise<AgentSession | null>;
	listAvailableTools(): Promise<AgentToolInfo[]>;
}

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
}

export class RpcAgentAdapter implements AgentAdapter {
	private readonly sessions = new Map<string, RpcProcessSession>();

	async startSession(options: AgentStartOptions = { model: null, cwd: null }): Promise<AgentSession> {
		const session: AgentSession = {
			id: crypto.randomUUID(),
			startedAt: new Date().toISOString(),
			state: "idle",
		};

		const rpcProcess = await this.startRpcProcess(options, session.id);
		const state: RpcProcessSession = {
			process: rpcProcess,
			session,
			requestId: 0,
			stderr: "",
			pending: new Map(),
			events: [],
		};

		this.attachJsonlReader(state);
		rpcProcess.stderr.on("data", (chunk: Buffer) => {
			state.stderr += chunk.toString("utf8");
		});
		rpcProcess.on("exit", () => {
			for (const pending of state.pending.values()) {
				clearTimeout(pending.timer);
				pending.reject(new Error(`Pi RPC 子进程已退出。${state.stderr}`));
			}
			state.pending.clear();
			state.session = { ...state.session, state: "stopped" };
		});

		this.sessions.set(session.id, state);

		await new Promise((resolve) => setTimeout(resolve, 200));
		if (rpcProcess.exitCode !== null) {
			this.sessions.delete(session.id);
			throw new Error(`Pi RPC 子进程启动失败，退出码 ${rpcProcess.exitCode}。${state.stderr}`);
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

	async sendUserMessage(sessionId: string, message: string): Promise<AgentMessageResult> {
		const state = this.sessions.get(sessionId);
		if (!state) {
			throw new Error(`Agent session not found: ${sessionId}`);
		}

		state.session = { ...state.session, state: "running" };

		state.events = [];
		const waitForEnd = this.waitForAgentEnd(state);
		await this.sendCommand(state, { type: "prompt", message });
		const events = await waitForEnd;
		const assistantError = this.extractAssistantError(events);
		if (assistantError) {
			state.session = { ...state.session, state: "idle" };
			throw new Error(assistantError);
		}
		const responseText =
			this.extractAssistantText(events) ||
			(await this.getLastAssistantText(state)) ||
			"Pi RPC 已完成本轮处理，但没有返回可展示的文本内容。";
		if (!responseText.trim() || responseText.startsWith("Pi RPC")) {
			state.session = { ...state.session, state: "idle" };
			throw new Error("Pi RPC 已完成本轮处理，但没有收到模型返回的文本内容。");
		}
		state.session = { ...state.session, state: "idle" };

		return {
			sessionId,
			responseText: responseText.trim(),
			createdAt: new Date().toISOString(),
			capabilityCalls: this.extractCapabilityCalls(events),
		};
	}

	async stopSession(sessionId: string): Promise<AgentSession> {
		const state = this.sessions.get(sessionId);
		if (!state) {
			throw new Error(`Agent session not found: ${sessionId}`);
		}

		if (state.process.exitCode === null) {
			state.process.kill("SIGTERM");
		}
		const stoppedSession: AgentSession = { ...state.session, state: "stopped" };
		state.session = stoppedSession;
		this.sessions.delete(sessionId);
		return stoppedSession;
	}

	async getSessionState(sessionId: string): Promise<AgentSession | null> {
		return this.sessions.get(sessionId)?.session ?? null;
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
				businessAction: "本地 Pi RPC 子进程桥接",
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
		await this.writeModelsJson(options.model, agentDir);

		const args = ["--mode", "rpc", "--no-session"];
		const appendSystemPromptPath = await this.writeAppendSystemPrompt(options.appendSystemPrompt, agentDir);
		if (appendSystemPromptPath) {
			args.push("--append-system-prompt", appendSystemPromptPath);
		}

		const command = process.env.PI_WINDOWS_CLIENT_NODE_PATH || "node";
		const commandArgs =
			process.env.NODE_ENV === "development"
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
				PI_CODING_AGENT_DIR: agentDir,
				PI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions"),
			},
			stdio: "pipe",
			windowsHide: true,
		});
	}

	private findProjectRoot(): string {
		const candidates = [process.cwd(), app.getAppPath(), dirname(app.getAppPath())];
		for (const candidate of candidates) {
			let current = resolve(candidate);
			while (true) {
				if (
					existsSync(join(current, "package.json")) &&
					existsSync(join(current, "packages", "coding-agent", "src", "cli.ts"))
				) {
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

	private async writeAppendSystemPrompt(value: string | undefined, agentDir: string): Promise<string | null> {
		if (!value?.trim()) {
			return null;
		}

		await mkdir(agentDir, { recursive: true });
		const appendPromptPath = join(agentDir, "windows-agent-context.md");
		await writeFile(appendPromptPath, value.trim(), "utf8");
		return appendPromptPath;
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
			state.events.push(data as RpcEvent);
		} catch {
			state.stderr += `${line}\n`;
		}
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
				rejectPromise(new Error(`等待 Pi RPC 响应超时：${String(command.type)}。${state.stderr}`));
			}, timeoutMs);

			state.pending.set(id, {
				resolve: (response) => {
					if (!response.success) {
						rejectPromise(new Error(response.error ?? `Pi RPC 命令失败：${response.command}`));
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

	private waitForAgentEnd(state: RpcProcessSession, timeoutMs = 180000): Promise<RpcEvent[]> {
		return new Promise((resolvePromise, rejectPromise) => {
			const startedAt = state.events.length;
			const timer = setTimeout(() => {
				clearInterval(interval);
				rejectPromise(new Error(`等待 Pi 智能体回复超时。${state.stderr}`));
			}, timeoutMs);

			const interval = setInterval(() => {
				const events = state.events.slice(startedAt);
				if (events.some((event) => event.type === "agent_end")) {
					clearTimeout(timer);
					clearInterval(interval);
					resolvePromise(events);
				}
			}, 100);
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
				continue;
			}

			if (event.type === "tool_execution_update" && event.toolCallId && event.toolName) {
				const call = ensureCall(event.toolCallId, event.toolName);
				call.outputSummary = call.outputSummary ?? this.summarizeUnknown(event.partialResult);
				continue;
			}

			if (event.type === "tool_execution_end" && event.toolCallId && event.toolName) {
				const call = ensureCall(event.toolCallId, event.toolName);
				call.endedAt = new Date().toISOString();
				call.status = event.isError ? "failure" : "success";
				call.outputSummary = this.summarizeUnknown(event.result);
				continue;
			}

			if (event.type === "agent_end") {
				this.extractToolCallsFromMessages(event.messages ?? [], ensureCall);
			}
		}

		return orderedIds.map((id) => calls.get(id)).filter((call): call is AgentCapabilityCallLog => Boolean(call));
	}

	private extractToolCallsFromMessages(
		messages: NonNullable<RpcEvent["messages"]>,
		ensureCall: (id: string, toolName: string) => AgentCapabilityCallLog,
	): void {
		for (const message of messages) {
			if (message.role === "assistant" && Array.isArray(message.content)) {
				for (const item of message.content) {
					if (!this.isRecord(item) || item.type !== "toolCall") {
						continue;
					}
					const id = this.asString(item.id ?? item.toolCallId);
					const name = this.asString(item.name ?? item.toolName);
					if (!id || !name) {
						continue;
					}
					const call = ensureCall(id, name);
					call.inputSummary = call.inputSummary ?? this.summarizeUnknown(item.arguments ?? item.args ?? item.input);
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
				call.status = "success";
			}
		}
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
			return assistant.errorMessage || "模型调用失败，但 Pi RPC 未返回具体错误。";
		}
		return null;
	}
}
