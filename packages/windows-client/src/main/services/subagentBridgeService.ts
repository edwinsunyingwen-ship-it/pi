import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentProgressEvent, MtclawSubagentRole } from "../../shared/types";

export interface SubagentDelegationRequest {
	taskId: string;
	parentSessionId: string;
	callerAgentId: string;
	role: MtclawSubagentRole;
	objective: string;
	context?: string;
}

export interface SubagentDelegationResult {
	taskId: string;
	parentSessionId: string;
	childSessionId: string;
	role: MtclawSubagentRole;
	agentId: string;
	agentName: string;
	status: "success" | "failed";
	summary: string;
	toolCalls: Array<{
		toolName: string;
		capabilityId?: string;
		capabilityName?: string;
		status: "success" | "failure";
	}>;
	progressEvents: AgentProgressEvent[];
	limitations: string[];
	errors: string[];
	startedAt: string;
	endedAt: string;
	durationMs: number;
}

type SubagentDelegationHandler = (request: SubagentDelegationRequest) => Promise<SubagentDelegationResult>;

export class SubagentBridgeService {
	private readonly token = randomUUID();
	private server: Server | null = null;
	private bridgeUrl: string | null = null;
	private handler: SubagentDelegationHandler | null = null;

	setHandler(handler: SubagentDelegationHandler): void {
		this.handler = handler;
	}

	async getBridgeConfig(): Promise<{ url: string; token: string }> {
		if (this.bridgeUrl) {
			return { url: this.bridgeUrl, token: this.token };
		}

		this.server = createHttpServer((request, response) => {
			void this.handleRequest(request, response);
		});
		await new Promise<void>((resolvePromise, rejectPromise) => {
			this.server?.once("error", rejectPromise);
			this.server?.listen(0, "127.0.0.1", () => resolvePromise());
		});
		const address = this.server.address() as AddressInfo;
		this.bridgeUrl = `http://127.0.0.1:${address.port}/subagent/delegate`;
		return { url: this.bridgeUrl, token: this.token };
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			if (request.method !== "POST" || request.url !== "/subagent/delegate") {
				this.sendJson(response, 404, { error: "Subagent bridge endpoint not found." });
				return;
			}
			if (request.headers.authorization !== `Bearer ${this.token}`) {
				this.sendJson(response, 401, { error: "Subagent bridge authorization failed." });
				return;
			}
			if (!this.handler) {
				this.sendJson(response, 503, { error: "Subagent bridge handler is not ready." });
				return;
			}

			const body = this.parseRequest(await this.readBody(request));
			const result = await this.handler(body);
			this.sendJson(response, 200, result);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.sendJson(response, 500, { error: message });
		}
	}

	private parseRequest(value: unknown): SubagentDelegationRequest {
		if (!value || typeof value !== "object") {
			throw new Error("Subagent delegation request must be a JSON object.");
		}
		const request = value as Record<string, unknown>;
		const role = request.role;
		if (
			role !== "enterprise_due_diligence" &&
			role !== "legal_research" &&
			role !== "contract_counterparty_risk_review"
		) {
			throw new Error("Subagent delegation role is invalid.");
		}
		const objective = typeof request.objective === "string" ? request.objective.trim() : "";
		if (!objective) {
			throw new Error("Subagent delegation objective is required.");
		}

		return {
			taskId: typeof request.taskId === "string" && request.taskId ? request.taskId : randomUUID(),
			parentSessionId: typeof request.parentSessionId === "string" ? request.parentSessionId : "",
			callerAgentId: typeof request.callerAgentId === "string" ? request.callerAgentId : "",
			role,
			objective,
			context: typeof request.context === "string" ? request.context.trim() : undefined,
		};
	}

	private readBody(request: IncomingMessage): Promise<unknown> {
		return new Promise((resolvePromise, rejectPromise) => {
			let body = "";
			request.setEncoding("utf8");
			request.on("data", (chunk: string) => {
				body += chunk;
				if (body.length > 1024 * 1024) {
					rejectPromise(new Error("Subagent bridge request is too large."));
				}
			});
			request.on("end", () => {
				try {
					resolvePromise(body ? JSON.parse(body) : {});
				} catch {
					rejectPromise(new Error("Subagent bridge request is not valid JSON."));
				}
			});
			request.on("error", rejectPromise);
		});
	}

	private sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
		response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
		response.end(JSON.stringify(data));
	}
}
