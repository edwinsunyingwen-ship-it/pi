export type AuditStatus = "success" | "failure";

export interface AuditLogEntry {
	timestamp: string;
	sessionId?: string;
	workflowId?: string;
	workspacePath?: string;
	toolName: string;
	businessAction: string;
	inputSummary?: string;
	outputSummary?: string;
	filesRead?: string[];
	filesCreated?: string[];
	filesEdited?: string[];
	networkTargets?: string[];
	batch: boolean;
	status: AuditStatus;
	errorMessage?: string;
	iteration?: number;
}

export interface WorkspaceState {
	path: string | null;
	selectedAt: string | null;
}

export interface AppEnvironment {
	appVersion: string;
	platform: NodeJS.Platform;
	arch: string;
	nodeVersion: string;
	electronVersion: string;
}

export interface AgentSession {
	id: string;
	startedAt: string;
	state: "idle" | "running" | "stopped";
	agentId?: string;
	agentName?: string;
	modelId?: string;
	workspacePath?: string | null;
}

export interface AgentToolInfo {
	name: string;
	businessAction: string;
	enabled: boolean;
}

export interface AgentMessageResult {
	sessionId: string;
	responseText: string;
	createdAt: string;
}

export interface ModelConnectionTestResult {
	status: ModelConnectionStatus;
	message: string;
	responseText?: string;
	testedAt: string;
}

export interface AuditLogQuery {
	startTime?: string;
	endTime?: string;
	limit?: number;
	offset?: number;
	businessAction?: string;
	status?: AuditStatus | "";
	keyword?: string;
}

export interface AuditLogListResult {
	logFilePath: string | null;
	entries: AuditLogEntry[];
	total: number;
	hasMore: boolean;
}

export interface WorkspaceFileInfo {
	name: string;
	relativePath: string;
	absolutePath: string;
	kind: "file" | "directory";
	size: number;
	updatedAt: string;
}

export interface WorkspaceFileListResult {
	workspacePath: string | null;
	files: WorkspaceFileInfo[];
}

export interface WorkspaceFileReadResult {
	file: WorkspaceFileInfo;
	content: string;
}

export type AgentCoreMode = "embedded-rpc" | "external-rpc";

export type ModelAuthType = "env" | "oauth" | "none";
export type ModelSetupMode =
	| "official-api-key"
	| "subscription-oauth"
	| "cloud-provider"
	| "custom-models-json"
	| "local-openai-compatible"
	| "custom-extension";
export type ModelApiType =
	| "openai-responses"
	| "openai-completions"
	| "anthropic-messages"
	| "google-generative-ai"
	| "mistral-conversations"
	| "custom";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type TransportMode = "auto" | "sse" | "websocket";
export type ModelInputCapability = "text" | "image";
export type ModelConnectionStatus = "unknown" | "untested" | "success" | "failure";

export interface AgentCoreConfig {
	mode: AgentCoreMode;
	rpcEndpoint: string;
}

export interface ModelProfileConfig {
	id: string;
	displayName: string;
	provider: string;
	providerLabel: string;
	setupMode: ModelSetupMode;
	modelId: string;
	api: ModelApiType;
	baseUrl: string;
	apiKeyEnv: string;
	apiKeyValue: string;
	authType: ModelAuthType;
	defaultThinkingLevel: ThinkingLevel;
	transport: TransportMode;
	timeoutMs: number;
	maxRetries: number;
	compat: string;
	input: ModelInputCapability[];
	contextWindow: number;
	maxTokens: number;
	supportsReasoning: boolean;
	enabled: boolean;
	connectionStatus: ModelConnectionStatus;
	lastTestedAt: string | null;
	priceInputPerMTok: number;
	priceOutputPerMTok: number;
	priceCacheReadPerMTok: number;
	priceCacheWritePerMTok: number;
	usedByAgentIds: string[];
	notes: string;
}

export interface ModelConfig {
	defaultModelId: string | null;
	models: ModelProfileConfig[];
}

export type CapabilityType = "tool" | "skill";
export type CapabilityExecutionMode = "http" | "command" | "builtin" | "mcp" | "manual";
export type CapabilityTriggerMode = "agent" | "manual" | "workflow" | "agent-and-workflow";
export type CapabilityConnectionStatus = "unknown" | "untested" | "success" | "failure";

export interface CapabilityConfig {
	id: string;
	name: string;
	type: CapabilityType;
	category: string;
	description: string;
	triggerMode: CapabilityTriggerMode;
	executionMode: CapabilityExecutionMode;
	endpoint: string;
	httpMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	command: string;
	workingDirectory: string;
	tokenEnv: string;
	headersJson: string;
	inputSchemaJson: string;
	outputSchemaJson: string;
	timeoutMs: number;
	retryCount: number;
	enabled: boolean;
	connectionStatus: CapabilityConnectionStatus;
	lastTestedAt: string | null;
	usedByAgentIds: string[];
	tags: string[];
	notes: string;
}

export type AgentNodeType = "primary" | "sub";

export interface AgentConfig {
	id: string;
	name: string;
	description: string;
	type: AgentNodeType;
	parentAgentIds: string[];
	childAgentIds: string[];
	modelIds: string[];
	defaultModelId: string | null;
	capabilityIds: string[];
	maxDelegationDepth: number;
	enabled: boolean;
	notes: string;
}

export interface ClientConfig {
	agentCore: AgentCoreConfig;
	model: ModelConfig;
	capabilities: CapabilityConfig[];
	agents: AgentConfig[];
	defaultAgentId: string | null;
	updatedAt: string;
}

export interface ClientConfigState {
	configPath: string;
	config: ClientConfig;
}

export interface WindowsClientApi {
	getEnvironment: () => Promise<AppEnvironment>;
	getClientConfig: () => Promise<ClientConfigState>;
	saveAgentCoreConfig: (agentCore: AgentCoreConfig) => Promise<ClientConfigState>;
	saveModelConfig: (model: ModelConfig) => Promise<ClientConfigState>;
	deleteModelConfig: (id: string) => Promise<ClientConfigState>;
	testModelConfig: (model: ModelProfileConfig) => Promise<ModelConnectionTestResult>;
	saveCapabilityConfig: (capability: CapabilityConfig) => Promise<ClientConfigState>;
	deleteCapabilityConfig: (id: string) => Promise<ClientConfigState>;
	saveAgentConfig: (agent: AgentConfig) => Promise<ClientConfigState>;
	deleteAgentConfig: (id: string) => Promise<ClientConfigState>;
	resetClientConfig: () => Promise<ClientConfigState>;
	getWorkspace: () => Promise<WorkspaceState>;
	chooseWorkspace: () => Promise<WorkspaceState>;
	listAuditLogs: (query?: AuditLogQuery) => Promise<AuditLogListResult>;
	listWorkspaceFiles: (workspacePath?: string | null) => Promise<WorkspaceFileListResult>;
	readWorkspaceFile: (relativePath: string, workspacePath?: string | null) => Promise<WorkspaceFileReadResult>;
	startAgentSession: (agentId?: string, workspacePath?: string | null) => Promise<AgentSession>;
	stopAgentSession: (sessionId: string) => Promise<AgentSession>;
	getAgentSessionState: (sessionId: string) => Promise<AgentSession | null>;
	sendAgentUserMessage: (sessionId: string, message: string) => Promise<AgentMessageResult>;
	listAvailableTools: () => Promise<AgentToolInfo[]>;
}
