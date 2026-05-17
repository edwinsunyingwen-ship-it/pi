import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bot,
  CheckCircle2,
  FileText,
  FolderOpen,
  Laptop,
  ListChecks,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react';
import type {
  AgentConfig,
  AgentSession,
  AgentToolInfo,
  AppEnvironment,
  AuditLogEntry,
  AuditLogQuery,
  CapabilityConfig,
  CapabilityExecutionMode,
  ClientConfig,
  ClientConfigState,
  ModelInputCapability,
  ModelProfileConfig,
  ModelSetupMode,
  WorkspaceFileInfo,
  WorkspaceState,
} from '../../shared/types';
import './styles.css';

interface TranscriptItem {
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

interface LocalNotice {
  tone: 'info' | 'success' | 'error';
  text: string;
}

interface AgentConversationState {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  session: AgentSession | null;
  transcript: TranscriptItem[];
  draftMessage: string;
  workspace: WorkspaceState;
}

const auditPageSize = 100;

const auditActionLabels: Record<string, string> = {
  'select-workspace': '选择工作区',
  'list-available-tools': '列出业务能力',
  'start-agent-session': '启动智能体会话',
  'send-user-message': '发送用户消息',
  'stop-agent-session': '停止智能体会话',
  'list-workspace-files': '列出工作区文件',
  'read-workspace-file': '读取工作区文件',
  'save-client-config': '保存客户端配置',
  'save-agent-core-config': '保存内核配置',
  'save-model-config': '保存模型配置',
  'delete-model-config': '删除模型配置',
  'save-capability-config': '保存业务能力',
  'delete-capability-config': '删除业务能力',
  'reset-client-config': '恢复默认配置',
  'agent-user-question': '用户提问',
  'agent-assistant-reply': 'Agent 回复',
  'test-model-connection': '模型联通测试',
  'save-agent-config': '保存智能体配置',
  'delete-agent-config': '删除智能体配置',
};

interface ProviderPreset {
  provider: string;
  label: string;
  setupMode: ModelSetupMode;
  api: ModelProfileConfig['api'];
  apiKeyEnv: string;
  baseUrl: string;
  note: string;
  models: string[];
  needsBaseUrl: boolean;
  needsApiKey: boolean;
}

const providerPresets: ProviderPreset[] = [
  {
    provider: 'openai',
    label: 'OpenAI',
    setupMode: 'official-api-key',
    api: 'openai-responses',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: '',
    note: '官方内置 Provider，适合 GPT 系列和 Responses API。',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    setupMode: 'official-api-key',
    api: 'anthropic-messages',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    baseUrl: '',
    note: '官方内置 Provider，适合 Claude 系列。',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    provider: 'google',
    label: 'Google Gemini',
    setupMode: 'official-api-key',
    api: 'google-generative-ai',
    apiKeyEnv: 'GEMINI_API_KEY',
    baseUrl: '',
    note: '官方内置 Provider，适合 Gemini API。',
    models: ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    setupMode: 'official-api-key',
    api: 'openai-completions',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    note: 'OpenAI 兼容聚合平台，可路由多个模型厂商。',
    models: ['openai/gpt-5.5', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro'],
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    setupMode: 'official-api-key',
    api: 'openai-completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: '',
    note: 'OpenAI 兼容 Provider，适合 DeepSeek 官方 API。',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    provider: 'moonshotai',
    label: 'Moonshot / Kimi',
    setupMode: 'official-api-key',
    api: 'openai-completions',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    baseUrl: '',
    note: 'Pi 内置 Provider，适合 Moonshot / Kimi 官方 API。',
    models: ['kimi-k2', 'kimi-latest', 'kimi-thinking-preview'],
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    provider: 'minimax-cn',
    label: 'MiniMax 中国区',
    setupMode: 'official-api-key',
    api: 'openai-completions',
    apiKeyEnv: 'MINIMAX_CN_API_KEY',
    baseUrl: '',
    note: 'Pi 内置 Provider，适合 MiniMax 中国区 API。',
    models: ['MiniMax-M2', 'MiniMax-Text-01'],
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    provider: 'zai',
    label: '智谱 / Z.ai',
    setupMode: 'official-api-key',
    api: 'openai-completions',
    apiKeyEnv: 'ZAI_API_KEY',
    baseUrl: '',
    note: 'Pi 内置 OpenAI 兼容 Provider。',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    provider: 'kimi-coding',
    label: 'Kimi For Coding',
    setupMode: 'official-api-key',
    api: 'openai-completions',
    apiKeyEnv: 'KIMI_API_KEY',
    baseUrl: '',
    note: 'Pi 内置 Provider，偏代码场景。',
    models: ['kimi-for-coding'],
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    provider: 'qwen',
    label: '通义千问 / DashScope',
    setupMode: 'custom-models-json',
    api: 'openai-completions',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    note: '国内常用 OpenAI 兼容入口，通常通过自定义模型配置接入。',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-vl-max'],
    needsBaseUrl: true,
    needsApiKey: true,
  },
  {
    provider: 'volcengine',
    label: '火山引擎 / 豆包',
    setupMode: 'custom-models-json',
    api: 'openai-completions',
    apiKeyEnv: 'ARK_API_KEY',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    note: '可按 OpenAI 兼容方式注册自定义模型。',
    models: ['doubao-seed-1-6', 'doubao-seed-1-6-thinking', 'doubao-vision-pro'],
    needsBaseUrl: true,
    needsApiKey: true,
  },
  {
    provider: 'ollama',
    label: 'Ollama 本地模型',
    setupMode: 'local-openai-compatible',
    api: 'openai-completions',
    apiKeyEnv: '',
    baseUrl: 'http://localhost:11434/v1',
    note: '本地 OpenAI 兼容服务，通常无需真实 API Key。',
    models: ['llama3.1', 'qwen2.5', 'deepseek-r1', 'gpt-oss'],
    needsBaseUrl: true,
    needsApiKey: false,
  },
  {
    provider: 'lm-studio',
    label: 'LM Studio 本地模型',
    setupMode: 'local-openai-compatible',
    api: 'openai-completions',
    apiKeyEnv: '',
    baseUrl: 'http://localhost:1234/v1',
    note: '本地 OpenAI 兼容服务，适合桌面本地模型。',
    models: ['local-model'],
    needsBaseUrl: true,
    needsApiKey: false,
  },
];

const setupModeLabels: Record<ModelSetupMode, string> = {
  'official-api-key': '官方 Provider + API Key',
  'subscription-oauth': '订阅 / OAuth（预留）',
  'cloud-provider': '云厂商认证',
  'custom-models-json': '自定义模型 / models.json',
  'local-openai-compatible': '本地 OpenAI 兼容',
  'custom-extension': '扩展注册 Provider',
};

const capabilityTypeLabels: Record<CapabilityConfig['type'], string> = {
  tool: 'Tool',
  skill: 'Skill',
};

const capabilityExecutionLabels: Record<CapabilityExecutionMode, string> = {
  http: 'HTTP API',
  command: '本地命令',
  builtin: '内置能力',
  mcp: 'MCP 工具',
  manual: '手动/占位',
};

const capabilityTriggerLabels: Record<CapabilityConfig['triggerMode'], string> = {
  agent: '智能体调用',
  manual: '手动触发',
  workflow: '工作流触发',
  'agent-and-workflow': '智能体 + 工作流',
};

const agentTypeLabels: Record<AgentConfig['type'], string> = {
  primary: '主智能体',
  sub: '子智能体',
};

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function createCapabilityId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `capability-${Date.now()}`;
}

function createCapabilityConfig(): CapabilityConfig {
  return {
    id: createCapabilityId(),
    name: '未命名能力',
    type: 'tool',
    category: '',
    description: '',
    triggerMode: 'agent',
    executionMode: 'http',
    endpoint: '',
    httpMethod: 'POST',
    command: '',
    workingDirectory: '',
    tokenEnv: '',
    headersJson: '',
    inputSchemaJson: '',
    outputSchemaJson: '',
    timeoutMs: 600000,
    retryCount: 1,
    enabled: true,
    connectionStatus: 'untested',
    lastTestedAt: null,
    usedByAgentIds: [],
    tags: [],
    notes: '',
  };
}

function createAgentConfig(): AgentConfig {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    type: 'primary',
    parentAgentIds: [],
    childAgentIds: [],
    modelIds: [],
    defaultModelId: null,
    capabilityIds: [],
    maxDelegationDepth: 3,
    enabled: true,
    notes: '',
  };
}

function createModelId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `model-${Date.now()}`;
}

function createModelProfile(preset?: ProviderPreset): ModelProfileConfig {
  return {
    id: createModelId(),
    displayName: '',
    provider: preset?.provider ?? '',
    providerLabel: preset?.label ?? '',
    setupMode: preset?.setupMode ?? 'official-api-key',
    modelId: '',
    api: preset?.api ?? 'openai-responses',
    baseUrl: preset?.baseUrl ?? '',
    apiKeyEnv: preset?.apiKeyEnv ?? '',
    apiKeyValue: '',
    authType: preset?.setupMode === 'local-openai-compatible' ? 'none' : 'env',
    defaultThinkingLevel: 'off',
    transport: 'auto',
    timeoutMs: 600000,
    maxRetries: 3,
    compat: '',
    input: ['text'],
    contextWindow: 128000,
    maxTokens: 16384,
    supportsReasoning: false,
    enabled: false,
    connectionStatus: 'untested',
    lastTestedAt: null,
    priceInputPerMTok: 0,
    priceOutputPerMTok: 0,
    priceCacheReadPerMTok: 0,
    priceCacheWritePerMTok: 0,
    usedByAgentIds: [],
    notes: preset?.note ?? '',
  };
}

function findProviderPreset(provider: string): ProviderPreset | undefined {
  return providerPresets.find((preset) => preset.provider === provider);
}

function isCustomProviderSelection(provider: string): boolean {
  return Boolean(provider) && (provider === '__custom__' || !findProviderPreset(provider));
}

function getProviderRequirements(model: ModelProfileConfig): { needsBaseUrl: boolean; needsApiKey: boolean } {
  const preset = findProviderPreset(model.provider);
  if (preset) {
    return {
      needsBaseUrl: preset.needsBaseUrl || model.setupMode === 'custom-models-json' || model.setupMode === 'local-openai-compatible',
      needsApiKey: preset.needsApiKey && model.authType !== 'none',
    };
  }
  return {
    needsBaseUrl: model.setupMode !== 'official-api-key',
    needsApiKey: model.authType !== 'none' && model.setupMode !== 'local-openai-compatible',
  };
}

function requiredLabel(label: string): string {
  return `${label} *`;
}

function maskSecret(value: string): string {
  if (!value) {
    return '未填写';
  }
  if (value.length <= 8) {
    return '已填写';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatModelName(model: ModelProfileConfig | undefined | null): string {
  if (!model) {
    return '未设置';
  }
  const provider = model.providerLabel || model.provider || '未知 Provider';
  const modelId = model.modelId || model.displayName || model.id;
  return `${provider} / ${modelId}`;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateTimeInput(date: Date): string {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hour = padDatePart(date.getHours());
  const minute = padDatePart(date.getMinutes());
  const second = padDatePart(date.getSeconds());
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function createDefaultAuditQuery(): AuditLogQuery {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  start.setHours(0, 0, 0, 0);
  return {
    startTime: formatDateTimeInput(start),
    endTime: formatDateTimeInput(end),
    businessAction: '',
    status: '',
    keyword: '',
    limit: auditPageSize,
    offset: 0,
  };
}

function createAgentConversation(agent: AgentConfig | null | undefined): AgentConversationState {
  const createdAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: agent ? `${agent.name} 会话` : '新的会话',
    createdAt,
    updatedAt: createdAt,
    session: null,
    transcript: [],
    draftMessage: '',
    workspace: { path: null, selectedAt: null },
  };
}

function App(): ReactElement {
  const [environment, setEnvironment] = useState<AppEnvironment | null>(null);
  const [configState, setConfigState] = useState<ClientConfigState | null>(null);
  const [draftConfig, setDraftConfig] = useState<ClientConfig | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceState>({ path: null, selectedAt: null });
  const [tools, setTools] = useState<AgentToolInfo[]>([]);
  const [files, setFiles] = useState<WorkspaceFileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileInfo | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditPath, setAuditPath] = useState<string | null>(null);
  const [auditRefreshedAt, setAuditRefreshedAt] = useState<string | null>(null);
  const [auditQuery, setAuditQuery] = useState<AuditLogQuery>(() => createDefaultAuditQuery());
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditTimeRangeLocked, setAuditTimeRangeLocked] = useState(false);
  const [statusText, setStatusText] = useState('就绪');
  const [agentNotice, setAgentNotice] = useState<LocalNotice | null>(null);
  const [configNotice, setConfigNotice] = useState<LocalNotice | null>(null);
  const [modelEditorNotice, setModelEditorNotice] = useState<LocalNotice | null>(null);
  const [activeSection, setActiveSection] = useState<'workbench' | 'workspace' | 'agent' | 'config' | 'logs'>(
    'workbench',
  );
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [conversationRevision, setConversationRevision] = useState(0);
  const [startingConversationId, setStartingConversationId] = useState<string | null>(null);
  const agentConversationsRef = useRef<Record<string, AgentConversationState[]>>({});
  const activeConversationIdsRef = useRef<Record<string, string>>({});
  const manualStoppedConversationIdsRef = useRef<Set<string>>(new Set());
  const [activeConfigTab, setActiveConfigTab] = useState<'agents' | 'models' | 'core' | 'capabilities'>(
    'models',
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const selectedAgentIdRef = useRef<string | null>(null);
  const [modelFilters, setModelFilters] = useState({
    provider: '',
    setupMode: '',
    status: '',
    input: '',
    reasoning: '',
  });
  const [modelEditor, setModelEditor] = useState<ModelProfileConfig | null>(null);
  const [capabilityFilters, setCapabilityFilters] = useState({
    type: '',
    executionMode: '',
    status: '',
    triggerMode: '',
  });
  const [capabilityEditor, setCapabilityEditor] = useState<CapabilityConfig | null>(null);
  const [agentEditor, setAgentEditor] = useState<AgentConfig | null>(null);

  useEffect(() => {
    void refreshInitialState();
  }, []);

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  const environmentLine = useMemo(() => {
    if (!environment) {
      return '正在读取本地环境';
    }
    return `${environment.platform} ${environment.arch} - Electron ${environment.electronVersion} - Node ${environment.nodeVersion}`;
  }, [environment]);

  const filteredModels = useMemo(() => {
    const models = draftConfig?.model.models ?? [];
    return models.filter((model) => {
      const providerMatches = modelFilters.provider ? model.provider === modelFilters.provider : true;
      const setupMatches = modelFilters.setupMode ? model.setupMode === modelFilters.setupMode : true;
      const statusMatches = modelFilters.status
        ? modelFilters.status === 'enabled'
          ? model.enabled
          : !model.enabled
        : true;
      const inputMatches = modelFilters.input
        ? model.input.includes(modelFilters.input as ModelInputCapability)
        : true;
      const reasoningMatches = modelFilters.reasoning
        ? modelFilters.reasoning === 'yes'
          ? model.supportsReasoning
          : !model.supportsReasoning
        : true;
      return providerMatches && setupMatches && statusMatches && inputMatches && reasoningMatches;
    });
  }, [draftConfig?.model.models, modelFilters]);

  const filteredCapabilities = useMemo(() => {
    const capabilities = draftConfig?.capabilities ?? [];
    return capabilities.filter((capability) => {
      const typeMatches = capabilityFilters.type ? capability.type === capabilityFilters.type : true;
      const executionMatches = capabilityFilters.executionMode
        ? capability.executionMode === capabilityFilters.executionMode
        : true;
      const statusMatches = capabilityFilters.status
        ? capabilityFilters.status === 'enabled'
          ? capability.enabled
          : !capability.enabled
        : true;
      const triggerMatches = capabilityFilters.triggerMode
        ? capability.triggerMode === capabilityFilters.triggerMode
        : true;
      return typeMatches && executionMatches && statusMatches && triggerMatches;
    });
  }, [draftConfig?.capabilities, capabilityFilters]);

  const defaultModelDisplayName = useMemo(() => {
    const models = draftConfig?.model.models ?? [];
    const defaultModel = models.find((model) => model.id === draftConfig?.model.defaultModelId);
    return formatModelName(defaultModel);
  }, [draftConfig?.model.defaultModelId, draftConfig?.model.models]);

  const primaryAgents = useMemo(
    () => (draftConfig?.agents ?? []).filter((agent) => agent.type === 'primary' && agent.enabled),
    [draftConfig?.agents],
  );

  const selectedAgent = useMemo(() => {
    const agents = draftConfig?.agents ?? [];
    return (
      agents.find((agent) => agent.id === selectedAgentId) ??
      agents.find((agent) => agent.id === draftConfig?.defaultAgentId) ??
      agents.find((agent) => agent.type === 'primary' && agent.enabled) ??
      agents[0] ??
      null
    );
  }, [draftConfig?.agents, draftConfig?.defaultAgentId, selectedAgentId]);

  const selectedConversation = useMemo(
    () => {
      if (!selectedAgent) {
        return createAgentConversation(null);
      }
      const conversations = agentConversationsRef.current[selectedAgent.id] ?? [];
      const activeConversationId = activeConversationIdsRef.current[selectedAgent.id];
      return (
        conversations.find((conversation) => conversation.id === activeConversationId) ??
        conversations[0] ??
        createAgentConversation(selectedAgent)
      );
    },
    [selectedAgent, conversationRevision],
  );
  const session = selectedConversation.session;
  const transcript = selectedConversation.transcript;
  const draftMessage = selectedConversation.draftMessage;
  const sessionTitle = selectedConversation.title;
  const activeWorkspace = selectedConversation.workspace;
  const sessionReady = Boolean(session && session.state !== 'stopped');
  const sessionStarting = startingConversationId === selectedConversation.id;
  const selectedAgentConversations = selectedAgent
    ? agentConversationsRef.current[selectedAgent.id] ?? [selectedConversation]
    : [];

  useEffect(() => {
    setSelectedFile(null);
    setFileContent('');
    if (!activeWorkspace.path) {
      setFiles([]);
      return;
    }
    void refreshWorkspaceFiles(activeWorkspace.path);
  }, [selectedConversation.id, activeWorkspace.path]);

  useEffect(() => {
    if (
      !selectedAgent ||
      sessionReady ||
      sessionStarting ||
      manualStoppedConversationIdsRef.current.has(selectedConversation.id)
    ) {
      return;
    }

    void startSession({ silent: true });
  }, [selectedAgent?.id, selectedConversation.id, sessionReady, sessionStarting]);

  function commitAgentConversation(agentId: string, conversation: AgentConversationState): void {
    const nextConversation = {
      ...conversation,
      transcript: [...conversation.transcript],
      updatedAt: new Date().toISOString(),
    };
    const existingConversations = agentConversationsRef.current[agentId] ?? [];
    const nextConversations = existingConversations.some((item) => item.id === nextConversation.id)
      ? existingConversations.map((item) => (item.id === nextConversation.id ? nextConversation : item))
      : [nextConversation, ...existingConversations];
    agentConversationsRef.current = {
      ...agentConversationsRef.current,
      [agentId]: nextConversations,
    };
    activeConversationIdsRef.current = {
      ...activeConversationIdsRef.current,
      [agentId]: nextConversation.id,
    };
    setConversationRevision((revision) => revision + 1);
  }

  function saveCurrentConversation(patch: Partial<AgentConversationState> = {}): void {
    if (!selectedAgent) {
      return;
    }
    const existing =
      agentConversationsRef.current[selectedAgent.id]?.find((item) => item.id === selectedConversation.id) ??
      selectedConversation;
    commitAgentConversation(selectedAgent.id, {
      ...existing,
      title: sessionTitle,
      session,
      transcript: [...transcript],
      draftMessage,
      workspace: activeWorkspace,
      ...patch,
    });
  }

  function switchWorkbenchAgent(agent: AgentConfig): void {
    if (!agentConversationsRef.current[agent.id]?.length) {
      commitAgentConversation(agent.id, createAgentConversation(agent));
    }
    selectedAgentIdRef.current = agent.id;
    setSelectedAgentId(agent.id);
  }

  function createNewConversation(): void {
    if (!selectedAgent) {
      return;
    }
    const nextConversation = {
      ...createAgentConversation(selectedAgent),
      workspace: activeWorkspace,
    };
    manualStoppedConversationIdsRef.current.delete(nextConversation.id);
    commitAgentConversation(selectedAgent.id, nextConversation);
  }

  function selectConversation(conversationId: string): void {
    if (!selectedAgent) {
      return;
    }
    activeConversationIdsRef.current = {
      ...activeConversationIdsRef.current,
      [selectedAgent.id]: conversationId,
    };
    setAgentNotice(null);
    setConversationRevision((revision) => revision + 1);
  }

  async function refreshInitialState(): Promise<void> {
    const initialAuditQuery = createDefaultAuditQuery();
    const [nextEnvironment, nextConfig, nextWorkspace, nextTools, nextAudit] = await Promise.all([
      window.windowsClient.getEnvironment(),
      window.windowsClient.getClientConfig(),
      window.windowsClient.getWorkspace(),
      window.windowsClient.listAvailableTools(),
      window.windowsClient.listAuditLogs(initialAuditQuery),
    ]);

    setEnvironment(nextEnvironment);
    setConfigState(nextConfig);
    setDraftConfig(nextConfig.config);
    setSelectedAgentId((current) => {
      const nextAgentId =
        current && nextConfig.config.agents.some((agent) => agent.id === current)
          ? current
          : nextConfig.config.defaultAgentId;
      selectedAgentIdRef.current = nextAgentId;
      return nextAgentId;
    });
    setWorkspace(nextWorkspace);
    setTools(nextTools);
    setAuditQuery(initialAuditQuery);
    setAuditEntries(sortAuditEntries(nextAudit.entries));
    setAuditPath(nextAudit.logFilePath);
    setAuditRefreshedAt(new Date().toISOString());
    setAuditTotal(nextAudit.total);
    setAuditHasMore(nextAudit.hasMore);

    if (nextWorkspace.path) {
      await refreshWorkspaceFiles();
    }
  }

  async function loadAuditLogs(query: AuditLogQuery, append = false): Promise<void> {
    const nextQuery: AuditLogQuery = {
      ...query,
      limit: auditPageSize,
      offset: query.offset ?? 0,
    };
    const result = await window.windowsClient.listAuditLogs(nextQuery);
    setAuditQuery(nextQuery);
    setAuditEntries((current) =>
      append ? sortAuditEntries([...current, ...result.entries]) : sortAuditEntries(result.entries),
    );
    setAuditPath(result.logFilePath);
    setAuditRefreshedAt(new Date().toISOString());
    setAuditTotal(result.total);
    setAuditHasMore(result.hasMore);
  }

  async function refreshAuditLogs(): Promise<void> {
    const movingQuery = auditTimeRangeLocked
      ? auditQuery
      : {
          ...auditQuery,
          startTime: createDefaultAuditQuery().startTime,
          endTime: createDefaultAuditQuery().endTime,
        };
    await loadAuditLogs({ ...movingQuery, offset: 0 });
  }

  async function applyAuditFilters(): Promise<void> {
    await loadAuditLogs({ ...auditQuery, offset: 0 });
  }

  async function resetAuditFilters(): Promise<void> {
    setAuditTimeRangeLocked(false);
    await loadAuditLogs(createDefaultAuditQuery());
  }

  async function loadMoreAuditLogs(): Promise<void> {
    await loadAuditLogs({ ...auditQuery, offset: auditEntries.length }, true);
  }

  async function saveAgentCoreConfig(): Promise<void> {
    if (!draftConfig) {
      return;
    }

    setStatusText('正在保存智能体内核配置');
    const nextConfig = await window.windowsClient.saveAgentCoreConfig(draftConfig.agentCore);
    setConfigState(nextConfig);
    setDraftConfig(nextConfig.config);
    setConfigNotice({ tone: 'success', text: '智能体内核配置已保存。' });
    setStatusText('智能体内核配置已保存');
    await refreshAuditLogs();
  }

  async function saveAgentConfig(agent: AgentConfig): Promise<void> {
    if (!agent.name.trim()) {
      setConfigNotice({ tone: 'error', text: '智能体名称不能为空。' });
      setStatusText('智能体名称不能为空');
      return;
    }
    if (agent.type === 'sub' && agent.parentAgentIds.length === 0) {
      setConfigNotice({ tone: 'error', text: '子智能体至少需要选择一个上级智能体。' });
      setStatusText('子智能体至少需要选择一个上级智能体');
      return;
    }
    if (agent.modelIds.length === 0) {
      setConfigNotice({ tone: 'error', text: '智能体至少需要关联一个可用模型。' });
      setStatusText('智能体至少需要关联一个可用模型');
      return;
    }

    const normalizedAgent = {
      ...agent,
      name: agent.name.trim(),
      defaultModelId:
        agent.defaultModelId && agent.modelIds.includes(agent.defaultModelId)
          ? agent.defaultModelId
          : agent.modelIds[0],
      parentAgentIds: agent.type === 'sub' ? agent.parentAgentIds : [],
      childAgentIds: agent.childAgentIds.filter((id) => id !== agent.id),
    };
    setStatusText(`正在保存智能体：${normalizedAgent.name}`);
    const nextConfig = await window.windowsClient.saveAgentConfig(normalizedAgent);
    setConfigState(nextConfig);
    setDraftConfig(nextConfig.config);
    setAgentEditor(null);
    setSelectedAgentId((current) => current ?? normalizedAgent.id);
    setConfigNotice({ tone: 'success', text: `智能体已保存：${normalizedAgent.name}` });
    setStatusText(`智能体已保存：${normalizedAgent.name}`);
    await refreshAuditLogs();
  }

  async function deleteAgentConfig(id: string): Promise<void> {
    const agent = draftConfig?.agents.find((item) => item.id === id);
    if (!agent) {
      return;
    }
    if (draftConfig?.agents.some((item) => item.parentAgentIds.includes(id))) {
      setConfigNotice({ tone: 'error', text: '该智能体仍有下级引用，请先调整子智能体关系。' });
      setStatusText('该智能体仍有下级引用，暂不能删除');
      return;
    }
    if (!window.confirm(`确认删除智能体“${agent.name}”吗？`)) {
      return;
    }
    const nextConfig = await window.windowsClient.deleteAgentConfig(id);
    setConfigState(nextConfig);
    setDraftConfig(nextConfig.config);
    setAgentEditor(null);
    setSelectedAgentId(nextConfig.config.defaultAgentId);
    setConfigNotice({ tone: 'success', text: `智能体已删除：${agent.name}` });
    setStatusText(`智能体已删除：${agent.name}`);
    await refreshAuditLogs();
  }

  async function saveModelProfile(profile: ModelProfileConfig): Promise<void> {
    if (!draftConfig) {
      return;
    }
    const requirements = getProviderRequirements(profile);
    if (!profile.provider.trim() || !profile.modelId.trim()) {
      setModelEditorNotice({ tone: 'error', text: '供应商和模型 ID 都不能为空。' });
      setStatusText('供应商和模型 ID 都不能为空');
      return;
    }
    if (requirements.needsBaseUrl && !profile.baseUrl.trim()) {
      setModelEditorNotice({ tone: 'error', text: '当前供应商需要填写 Base URL。' });
      setStatusText('当前供应商需要填写 Base URL');
      return;
    }
    if (profile.baseUrl.trim() && !isValidHttpUrl(profile.baseUrl)) {
      setModelEditorNotice({
        tone: 'error',
        text: 'Base URL 格式不正确，必须是 http:// 或 https:// 开头的完整地址。',
      });
      setStatusText('Base URL 格式不正确');
      return;
    }
    if (requirements.needsApiKey && !profile.apiKeyValue.trim()) {
      setModelEditorNotice({ tone: 'error', text: '当前供应商需要填写 API Key。' });
      setStatusText('当前供应商需要填写 API Key');
      return;
    }
    if (profile.enabled && profile.usedByAgentIds.length > 0 && !profile.modelId.trim()) {
      setModelEditorNotice({ tone: 'error', text: '已有智能体引用的模型不能保存为空模型 ID。' });
      setStatusText('已有智能体引用的模型不能保存为空模型 ID');
      return;
    }

    const shouldForceDisabled = profile.enabled && profile.connectionStatus !== 'success';
    const normalizedProfile = {
      ...profile,
      displayName: profile.displayName.trim() || profile.modelId.trim(),
      enabled: profile.enabled && !shouldForceDisabled,
    };
    if (shouldForceDisabled) {
      setModelEditorNotice({
        tone: 'error',
        text: '模型需要先测试联通成功，才能启用。当前已保存为未启用状态。',
      });
    }
    const exists = draftConfig.model.models.some((model) => model.id === normalizedProfile.id);
    const models = exists
      ? draftConfig.model.models.map((model) => (model.id === normalizedProfile.id ? normalizedProfile : model))
      : [...draftConfig.model.models, normalizedProfile];
    const nextModelConfig = {
      ...draftConfig.model,
      defaultModelId: draftConfig.model.defaultModelId ?? normalizedProfile.id,
      models,
    };

    setStatusText(`正在保存模型：${normalizedProfile.displayName}`);
    const nextConfig = await window.windowsClient.saveModelConfig(nextModelConfig);
    setConfigState(nextConfig);
    setDraftConfig(nextConfig.config);
    setModelEditor(null);
    const saveMessage = shouldForceDisabled
      ? `模型已保存但未启用：${normalizedProfile.displayName}。请先测试联通成功后再启用。`
      : `模型已保存：${normalizedProfile.displayName}`;
    setConfigNotice({ tone: shouldForceDisabled ? 'error' : 'success', text: saveMessage });
    setStatusText(saveMessage);
    await refreshAuditLogs();
  }

  async function updateModelEnabled(profile: ModelProfileConfig, enabled: boolean): Promise<void> {
    if (!enabled && profile.usedByAgentIds.length > 0) {
      setStatusText('该模型已有智能体使用，暂不能停用');
      return;
    }
    if (enabled && profile.connectionStatus !== 'success') {
      setConfigNotice({
        tone: 'error',
        text: `模型“${profile.displayName || profile.modelId}”需要先测试联通成功，才能启用。`,
      });
      setStatusText('模型需要先测试联通成功，才能启用');
      return;
    }
    await saveModelProfile({ ...profile, enabled });
  }

  async function testModelConnection(profile: ModelProfileConfig): Promise<void> {
    if (!draftConfig) {
      return;
    }
    const requirements = getProviderRequirements(profile);
    const hasTarget =
      profile.provider.trim() &&
      profile.modelId.trim() &&
      (!requirements.needsBaseUrl || profile.baseUrl.trim()) &&
      (!requirements.needsApiKey || profile.apiKeyValue.trim());
    if (!hasTarget) {
      const testedProfile: ModelProfileConfig = {
        ...profile,
        connectionStatus: 'failure',
        lastTestedAt: new Date().toISOString(),
      };
      setModelEditor((current) => (current?.id === testedProfile.id ? testedProfile : current));
      setModelEditorNotice({
        tone: 'error',
        text: '模型配置检查失败：请补齐供应商、模型 ID、Base URL 或 API Key。',
      });
      setStatusText('模型配置检查失败：请补齐供应商、模型 ID、Base URL 或 API Key。');
      return;
    }
    if (profile.baseUrl.trim() && !isValidHttpUrl(profile.baseUrl)) {
      const testedProfile: ModelProfileConfig = {
        ...profile,
        connectionStatus: 'failure',
        lastTestedAt: new Date().toISOString(),
      };
      setModelEditor((current) => (current?.id === testedProfile.id ? testedProfile : current));
      setModelEditorNotice({
        tone: 'error',
        text: 'Base URL 格式不正确，必须是 http:// 或 https:// 开头的完整地址。',
      });
      setStatusText('Base URL 格式不正确');
      return;
    }

    setModelEditorNotice({ tone: 'info', text: '正在进行真实联通测试，会向模型发送一条短测试消息...' });
    setStatusText(`正在测试模型联通：${profile.displayName || profile.modelId}`);
    const testResult = await window.windowsClient.testModelConfig(profile);
    const testedProfile: ModelProfileConfig = {
      ...profile,
      connectionStatus: testResult.status,
      lastTestedAt: testResult.testedAt,
    };
    const exists = draftConfig.model.models.some((model) => model.id === testedProfile.id);
    const models = exists
      ? draftConfig.model.models.map((model) => (model.id === testedProfile.id ? testedProfile : model))
      : [...draftConfig.model.models, testedProfile];
    const nextModelConfig = {
      ...draftConfig.model,
      defaultModelId: draftConfig.model.defaultModelId ?? testedProfile.id,
      models,
    };
    const nextConfig = await window.windowsClient.saveModelConfig(nextModelConfig);
    setConfigState(nextConfig);
    setDraftConfig(nextConfig.config);
    setModelEditor((current) => (current?.id === testedProfile.id ? testedProfile : current));
    setModelEditorNotice({
      tone: testResult.status === 'success' ? 'success' : 'error',
      text:
        testResult.status === 'success'
          ? `${testResult.message}${testResult.responseText ? ` 返回：${testResult.responseText}` : ''}`
          : testResult.message,
    });
    setStatusText(
      testResult.status === 'success'
        ? `模型真实联通成功：${profile.displayName || profile.modelId}`
        : `模型真实联通失败：${profile.displayName || profile.modelId}`,
    );
    await refreshAuditLogs();
  }

  async function deleteModelProfile(id: string): Promise<void> {
    if (!draftConfig) {
      return;
    }
    const profile = draftConfig.model.models.find((model) => model.id === id);
    if (!profile) {
      return;
    }
    if (profile.usedByAgentIds.length > 0) {
      setStatusText('该模型已有智能体使用，暂不能删除');
      return;
    }
    const confirmed = window.confirm(
      `确认删除模型“${profile.displayName || profile.modelId || profile.id}”吗？删除后不能从客户端直接恢复。`,
    );
    if (!confirmed) {
      return;
    }

    setStatusText(`正在删除模型：${profile.displayName}`);
    const nextConfig = await window.windowsClient.deleteModelConfig(id);
    setConfigState(nextConfig);
    setDraftConfig(nextConfig.config);
    setConfigNotice({ tone: 'success', text: `模型已删除：${profile.displayName}` });
    setStatusText(`模型已删除：${profile.displayName}`);
    await refreshAuditLogs();
  }

  async function saveCapabilityConfig(capability: CapabilityConfig): Promise<void> {
    if (!capability.name.trim()) {
      setStatusText('业务能力名称不能为空');
      return;
    }
    if (capability.executionMode === 'http' && !capability.endpoint.trim()) {
      setStatusText('HTTP 能力需要填写接口地址');
      return;
    }
    if (capability.executionMode === 'command' && !capability.command.trim()) {
      setStatusText('本地命令能力需要填写命令');
      return;
    }

    setStatusText(`正在保存业务能力：${capability.name}`);
    const nextConfig = await window.windowsClient.saveCapabilityConfig(capability);
    const nextTools = await window.windowsClient.listAvailableTools();
    setConfigState(nextConfig);
    setDraftConfig(nextConfig.config);
    setTools(nextTools);
    setCapabilityEditor(null);
    setConfigNotice({ tone: 'success', text: `业务能力已保存：${capability.name}` });
    setStatusText(`业务能力已保存：${capability.name}`);
    await refreshAuditLogs();
  }

  async function deleteCapabilityConfig(id: string): Promise<void> {
    setStatusText('正在删除业务能力');
    const nextConfig = await window.windowsClient.deleteCapabilityConfig(id);
    const nextTools = await window.windowsClient.listAvailableTools();
    setConfigState(nextConfig);
    setDraftConfig(nextConfig.config);
    setTools(nextTools);
    setConfigNotice({ tone: 'success', text: '业务能力已删除。' });
    setStatusText('业务能力已删除');
    await refreshAuditLogs();
  }

  async function updateCapabilityEnabled(capability: CapabilityConfig, enabled: boolean): Promise<void> {
    if (!enabled && capability.usedByAgentIds.length > 0) {
      setStatusText('该能力已有智能体使用，暂不能停用');
      return;
    }
    await saveCapabilityConfig({ ...capability, enabled });
  }

  async function testCapabilityConnection(capability: CapabilityConfig): Promise<void> {
    const hasTarget =
      capability.executionMode === 'http'
        ? Boolean(capability.endpoint.trim())
        : capability.executionMode === 'command'
          ? Boolean(capability.command.trim())
          : true;
    const testedCapability: CapabilityConfig = {
      ...capability,
      connectionStatus: hasTarget ? 'success' : 'failure',
      lastTestedAt: new Date().toISOString(),
    };
    await saveCapabilityConfig(testedCapability);
    setStatusText(hasTarget ? `能力联通测试通过：${capability.name}` : '能力联通测试失败：缺少执行目标');
  }

  function updateAgentCore<K extends keyof ClientConfig['agentCore']>(
    key: K,
    value: ClientConfig['agentCore'][K],
  ): void {
    setDraftConfig((config) =>
      config ? { ...config, agentCore: { ...config.agentCore, [key]: value } } : config,
    );
  }

  function updateModelEditor<K extends keyof ModelProfileConfig>(
    key: K,
    value: ModelProfileConfig[K],
  ): void {
    setModelEditor((model) => (model ? { ...model, [key]: value } : model));
  }

  function updateModelId(value: string): void {
    setModelEditor((model) => {
      if (!model) {
        return model;
      }
      const shouldSyncDisplayName = !model.displayName.trim() || model.displayName === model.modelId;
      return {
        ...model,
        modelId: value,
        displayName: shouldSyncDisplayName ? value : model.displayName,
      };
    });
  }

  function applyProviderPreset(provider: string): void {
    setModelEditorNotice(null);
    const preset = providerPresets.find((item) => item.provider === provider);
    if (!preset) {
      setModelEditor((model) =>
        model
          ? {
              ...model,
              provider: provider === '__custom__' ? '' : provider,
              providerLabel: provider === '__custom__' ? '' : model.providerLabel,
              setupMode:
                provider === '__custom__' ? 'custom-models-json' : model.setupMode,
              api: provider === '__custom__' ? 'openai-completions' : model.api,
              authType: provider === '__custom__' ? 'env' : model.authType,
            }
          : model,
      );
      return;
    }
    setModelEditor((model) =>
      model
        ? {
            ...model,
            provider: preset.provider,
            providerLabel: preset.label,
            setupMode: preset.setupMode,
            displayName: model.displayName || model.modelId,
            api: preset.api,
            baseUrl: preset.baseUrl,
            apiKeyEnv: preset.apiKeyEnv,
            authType: preset.setupMode === 'local-openai-compatible' ? 'none' : 'env',
            notes: model.notes || preset.note,
          }
        : model,
    );
  }

  function toggleModelInput(input: ModelInputCapability, checked: boolean): void {
    setModelEditor((model) => {
      if (!model) {
        return model;
      }
      const nextInput = checked
        ? Array.from(new Set([...model.input, input]))
        : model.input.filter((item) => item !== input);
      return {
        ...model,
        input: nextInput.length ? nextInput : ['text'],
      };
    });
  }

  function updateCapabilityEditor<K extends keyof CapabilityConfig>(
    key: K,
    value: CapabilityConfig[K],
  ): void {
    setCapabilityEditor((capability) => (capability ? { ...capability, [key]: value } : capability));
  }

  function updateAgentEditor<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]): void {
    setAgentEditor((agent) => (agent ? { ...agent, [key]: value } : agent));
  }

  function toggleAgentModel(modelId: string, checked: boolean): void {
    setAgentEditor((agent) => {
      if (!agent) {
        return agent;
      }
      const modelIds = checked
        ? Array.from(new Set([...agent.modelIds, modelId]))
        : agent.modelIds.filter((id) => id !== modelId);
      return {
        ...agent,
        modelIds,
        defaultModelId:
          agent.defaultModelId && modelIds.includes(agent.defaultModelId)
            ? agent.defaultModelId
            : (modelIds[0] ?? null),
      };
    });
  }

  function toggleAgentCapability(capabilityId: string, checked: boolean): void {
    setAgentEditor((agent) =>
      agent
        ? {
            ...agent,
            capabilityIds: checked
              ? Array.from(new Set([...agent.capabilityIds, capabilityId]))
              : agent.capabilityIds.filter((id) => id !== capabilityId),
          }
        : agent,
    );
  }

  function toggleAgentParent(parentId: string, checked: boolean): void {
    setAgentEditor((agent) =>
      agent
        ? {
            ...agent,
            parentAgentIds: checked
              ? Array.from(new Set([...agent.parentAgentIds, parentId]))
              : agent.parentAgentIds.filter((id) => id !== parentId),
          }
        : agent,
    );
  }

  function toggleAgentChild(childId: string, checked: boolean): void {
    setAgentEditor((agent) =>
      agent
        ? {
            ...agent,
            childAgentIds: checked
              ? Array.from(new Set([...agent.childAgentIds, childId]))
              : agent.childAgentIds.filter((id) => id !== childId),
          }
        : agent,
    );
  }

  function removeCapability(id: string): void {
    setDraftConfig((config) =>
      config
        ? {
            ...config,
            capabilities: config.capabilities.filter((capability) => capability.id !== id),
          }
        : config,
    );
  }

  async function refreshWorkspaceFiles(workspacePath = activeWorkspace.path): Promise<void> {
    if (!workspacePath) {
      setFiles([]);
      setSelectedFile(null);
      setFileContent('');
      await refreshAuditLogs();
      return;
    }

    const result = await window.windowsClient.listWorkspaceFiles(workspacePath);
    setFiles(result.files);
    await refreshAuditLogs();
  }

  async function chooseWorkspace(): Promise<void> {
    setStatusText('正在选择工作区');
    const previousWorkspace = workspace;
    const selectedWorkspace = await window.windowsClient.chooseWorkspace();
    const selectionCancelled =
      selectedWorkspace.path === previousWorkspace.path &&
      selectedWorkspace.selectedAt === previousWorkspace.selectedAt;

    if (selectionCancelled) {
      setStatusText('工作区未变更');
      await refreshAuditLogs();
      return;
    }

    const previousSession = session;
    setWorkspace(selectedWorkspace);
    manualStoppedConversationIdsRef.current.delete(selectedConversation.id);
    saveCurrentConversation({ workspace: selectedWorkspace, session: null });
    setSelectedFile(null);
    setFileContent('');
    setStatusText(selectedWorkspace.path ? '工作区已保存并写入操作日志' : '工作区未变更');
    if (previousSession && previousSession.state !== 'stopped') {
      await window.windowsClient.stopAgentSession(previousSession.id);
    }
    if (selectedWorkspace.path) {
      await refreshWorkspaceFiles(selectedWorkspace.path);
    }
    await refreshAuditLogs();
  }

  async function readFile(file: WorkspaceFileInfo): Promise<void> {
    if (file.kind !== 'file') {
      return;
    }

    setStatusText(`正在读取文件：${file.relativePath}`);
    const result = await window.windowsClient.readWorkspaceFile(file.relativePath, activeWorkspace.path);
    setSelectedFile(result.file);
    setFileContent(result.content);
    setStatusText('文件预览已更新');
    await refreshAuditLogs();
  }

  async function startSession(options: { silent?: boolean; force?: boolean } = {}): Promise<AgentSession | null> {
    const startingConversationId = selectedConversation.id;
    try {
      if (!selectedAgent) {
        setAgentNotice({ tone: 'error', text: '请先选择一个主智能体。' });
        setStatusText('请先选择一个主智能体');
        return null;
      }
      const startingAgent = selectedAgent;
      const startingConversation = selectedConversation;
      const startingWorkspace = activeWorkspace;
      if (!options.force && startingConversation.session && startingConversation.session.state !== 'stopped') {
        return startingConversation.session;
      }

      setStartingConversationId(startingConversation.id);
      manualStoppedConversationIdsRef.current.delete(startingConversation.id);
      if (!options.silent) {
        setAgentNotice({ tone: 'info', text: '正在准备智能体会话...' });
      }
      setStatusText('正在准备智能体会话');
      const nextSession = await window.windowsClient.startAgentSession(startingAgent.id, startingWorkspace.path);
      commitAgentConversation(startingAgent.id, {
        ...startingConversation,
        session: nextSession,
        transcript: [...startingConversation.transcript],
        draftMessage: startingConversation.draftMessage,
        workspace: startingWorkspace,
      });
      setAgentNotice({ tone: 'success', text: `智能体“${startingAgent.name}”会话已就绪，可以发送消息。` });
      setStatusText(`智能体“${startingAgent.name}”会话已就绪`);
      return nextSession;
    } catch (error) {
      const message = error instanceof Error ? `启动会话失败：${error.message}` : '启动会话失败';
      setAgentNotice({ tone: 'error', text: message });
      setStatusText(message);
      return null;
    } finally {
      setStartingConversationId((current) => (current === startingConversationId ? null : current));
      await refreshAuditLogs();
    }
  }

  async function stopSession(): Promise<void> {
    if (!session) {
      return;
    }
    setStatusText('正在停止智能体会话');
    const stoppedSession = await window.windowsClient.stopAgentSession(session.id);
    manualStoppedConversationIdsRef.current.add(selectedConversation.id);
    saveCurrentConversation({ session: stoppedSession });
    setAgentNotice({ tone: 'success', text: '智能体会话已停止。' });
    setStatusText('智能体会话已停止');
    await refreshAuditLogs();
  }

  async function sendMessage(): Promise<void> {
    const message = draftMessage.trim();
    const messageAgent = selectedAgent;
    if (!message || !messageAgent) {
      return;
    }
    let messageSession = session;
    const messageConversation = selectedConversation;
    if (!messageSession || messageSession.state === 'stopped') {
      messageSession = await startSession({ silent: true });
      if (!messageSession) {
        return;
      }
    }

    const userItem: TranscriptItem = { role: 'user', text: message, createdAt: new Date().toISOString() };
    const userTranscript = [...transcript, userItem];
    commitAgentConversation(messageAgent.id, {
      ...messageConversation,
      draftMessage: '',
      transcript: userTranscript,
    });
    setStatusText('正在通过适配器发送消息');

    const result = await window.windowsClient.sendAgentUserMessage(messageSession.id, message);
    const assistantTranscript = [
      ...userTranscript,
      { role: 'assistant' as const, text: result.responseText, createdAt: result.createdAt },
    ];
    const currentSession = await window.windowsClient.getAgentSessionState(messageSession.id);
    const nextSession = currentSession
      ? {
          ...currentSession,
          agentId: messageSession.agentId,
          agentName: messageSession.agentName,
          modelId: messageSession.modelId,
        }
      : currentSession;
    commitAgentConversation(messageAgent.id, {
      ...messageConversation,
      session: nextSession,
      transcript: assistantTranscript,
      draftMessage: '',
    });
    setStatusText('已收到适配器响应');
    await refreshAuditLogs();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void sendMessage();
  }

  const canSend = Boolean(draftMessage.trim() && selectedAgent && !sessionStarting);
  const selectedAgentModel = draftConfig?.model.models.find((model) => model.id === selectedAgent?.defaultModelId);
  const selectedAgentCapabilities = draftConfig?.capabilities.filter((capability) =>
    selectedAgent?.capabilityIds.includes(capability.id),
  ) ?? [];
  const modelEditorPreset = modelEditor ? findProviderPreset(modelEditor.provider) : undefined;
  const modelEditorRequirements = modelEditor
    ? getProviderRequirements(modelEditor)
    : { needsBaseUrl: false, needsApiKey: false };
  const modelProviderSelectValue = modelEditor
    ? modelEditorPreset
      ? modelEditorPreset.provider
      : modelEditor.provider
        ? '__custom__'
        : ''
    : '';
  const modelSuggestions = modelEditorPreset?.models ?? [];

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Windows 客户端</p>
          <h1>Pi 智能体工作台</h1>
        </div>
        <div className="status-pill">
          <CheckCircle2 size={16} />
          <span>{statusText}</span>
        </div>
      </header>

      <nav className="domain-nav" aria-label="功能域导航">
        <button
          type="button"
          className={activeSection === 'workbench' ? 'active' : ''}
          onClick={() => setActiveSection('workbench')}
        >
          工作台
        </button>
        <button
          type="button"
          className={activeSection === 'config' ? 'active' : ''}
          onClick={() => setActiveSection('config')}
        >
          配置中心
        </button>
        <button
          type="button"
          className={activeSection === 'logs' ? 'active' : ''}
          onClick={() => setActiveSection('logs')}
        >
          操作日志
        </button>
      </nav>

      <section className="dashboard-grid">
        {activeSection === 'workbench' && (
          <article className={`panel wide-panel workbench-shell ${contextPanelOpen ? 'context-open' : ''}`}>
            <div className="agent-tabs">
              <div className="agent-tab-list" role="tablist" aria-label="主智能体">
                {primaryAgents.length === 0 ? (
                  <span className="empty-state">暂无可用主智能体，请先到配置中心创建或启用。</span>
                ) : (
                  primaryAgents.map((agent) => (
                    <button
                      type="button"
                      className={selectedAgent?.id === agent.id ? 'active' : ''}
                      key={agent.id}
                      onClick={() => switchWorkbenchAgent(agent)}
                    >
                      {agent.name}
                    </button>
                  ))
                )}
              </div>
              <button
                type="button"
                className="quiet-button compact-button"
                onClick={() => {
                  if (selectedAgent) {
                    setAgentEditor(selectedAgent);
                    setActiveConfigTab('agents');
                  }
                }}
                disabled={!selectedAgent}
              >
                <Settings size={16} />
                <span>设置</span>
              </button>
            </div>

            <div className="workbench-grid">
              <aside className="session-sidebar">
                <div className="section-title-row compact-title">
                  <div>
                    <strong>会话</strong>
                    <span>按当前智能体展示</span>
                  </div>
                  <button
                    type="button"
                    className="quiet-button compact-button"
                    onClick={createNewConversation}
                    disabled={!selectedAgent}
                  >
                    <Plus size={16} />
                    <span>新建</span>
                  </button>
                </div>
                <div className="session-card-list">
                  {selectedAgentConversations.map((conversation) => {
                    const isActiveConversation = conversation.id === selectedConversation.id;
                    return (
                      <div
                        className={`session-card ${isActiveConversation ? 'active' : ''}`}
                        key={conversation.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectConversation(conversation.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectConversation(conversation.id);
                          }
                        }}
                      >
                        {isActiveConversation ? (
                          <input
                            value={conversation.title}
                            onChange={(event) => {
                              saveCurrentConversation({ title: event.target.value });
                            }}
                            onClick={(event) => event.stopPropagation()}
                            aria-label="会话名称"
                          />
                        ) : (
                          <strong>{conversation.title}</strong>
                        )}
                        <small className="session-state">
                          <span
                            className={`status-dot ${
                              conversation.session && conversation.session.state !== 'stopped' ? 'online' : 'offline'
                            }`}
                          />
                          {conversation.id === startingConversationId
                            ? '准备中'
                            : conversation.session && conversation.session.state !== 'stopped'
                              ? '已就绪'
                              : '未就绪'}
                        </small>
                      </div>
                    );
                  })}
                </div>
              </aside>

              <section className="chat-workspace">
                <div className="chat-header">
                  <div>
                    <strong>{selectedAgent?.name ?? '请选择主智能体'}</strong>
                    <span>
                      {activeWorkspace.path ? `工作区：${activeWorkspace.path}` : '尚未选择工作区'}
                    </span>
                  </div>
                </div>

                {agentNotice && <div className={`inline-notice ${agentNotice.tone}`}>{agentNotice.text}</div>}

                <div className="conversation-list focused-conversation">
                  {transcript.length === 0 ? (
                    <p className="empty-state">选择智能体后即可开始对话，系统会自动准备会话。</p>
                  ) : (
                    transcript.map((item) => (
                      <div className={`message-bubble ${item.role}`} key={`${item.createdAt}-${item.role}`}>
                        <strong>{item.role === 'user' ? '用户' : 'Pi 智能体'}</strong>
                        <span>{item.text}</span>
                      </div>
                    ))
                  )}
                </div>

                <div className="workbench-actions">
                  <div className={`agent-runtime-state ${sessionReady ? 'online' : 'offline'}`}>
                    <span className={`status-dot ${sessionReady ? 'online' : 'offline'}`} />
                    <strong>{sessionStarting ? '正在准备' : sessionReady ? '智能体已就绪' : '智能体未就绪'}</strong>
                  </div>
                  {!sessionReady && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => startSession({ force: true })}
                      disabled={!selectedAgent || sessionStarting}
                    >
                      <Bot size={18} />
                      <span>{sessionStarting ? '准备中' : '重试启动'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={!sessionReady}
                    onClick={stopSession}
                  >
                    <Square size={16} />
                    <span>停止</span>
                  </button>
                </div>

                <div className="composer workbench-composer">
                  <div className="composer-tools">
                    <button type="button" className="quiet-button compact-button" onClick={chooseWorkspace}>
                      <FolderOpen size={16} />
                      <span>工作区</span>
                    </button>
                    <button
                      type="button"
                      className="quiet-button compact-button"
                      onClick={() => setContextPanelOpen(true)}
                    >
                      <FileText size={16} />
                      <span>文件</span>
                    </button>
                  </div>
                  <textarea
                    value={draftMessage}
                    onChange={(event) => {
                      saveCurrentConversation({ draftMessage: event.target.value });
                    }}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="向当前智能体发送消息"
                    rows={3}
                  />
                  <button type="button" disabled={!canSend} onClick={sendMessage}>
                    <Send size={18} />
                    <span>发送</span>
                  </button>
                </div>
              </section>

              {contextPanelOpen && (
                <aside className="context-panel">
                  <div className="section-title-row compact-title">
                    <div>
                      <strong>上下文</strong>
                      <span>工作区、文件、模型和能力</span>
                    </div>
                    <button type="button" className="quiet-button compact-button" onClick={() => setContextPanelOpen(false)}>
                      收起
                    </button>
                  </div>
                  <div className="context-summary">
                    <small>默认模型</small>
                    <strong>{formatModelName(selectedAgentModel)}</strong>
                  </div>
                  <div className="context-summary">
                    <small>可用能力</small>
                    <strong>{selectedAgentCapabilities.length} 个</strong>
                    <span>
                      {selectedAgentCapabilities.length === 0
                        ? '暂未绑定 Tools / Skills'
                        : selectedAgentCapabilities.map((capability) => capability.name).join('、')}
                    </span>
                  </div>
                  <div className="file-panel-actions">
                    <button type="button" className="quiet-button compact-button" onClick={() => refreshWorkspaceFiles()}>
                      刷新文件
                    </button>
                  </div>
                  <div className="compact-file-list">
                    {files.length === 0 ? (
                      <p className="empty-state">选择工作区后显示文件。</p>
                    ) : (
                      files.map((file) => (
                        <button
                          type="button"
                          className={`file-row ${file.kind} ${selectedFile?.relativePath === file.relativePath ? 'selected' : ''}`}
                          key={file.relativePath}
                          disabled={file.kind === 'directory'}
                          title={file.relativePath}
                          onClick={() => readFile(file)}
                        >
                          <span className="file-kind">{file.kind === 'directory' ? '目录' : '文件'}</span>
                          <strong>{file.relativePath}</strong>
                          <small>{file.kind === 'directory' ? '不可预览' : formatBytes(file.size)}</small>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="file-preview compact-preview">
                    <strong>{selectedFile ? selectedFile.relativePath : '文件预览'}</strong>
                    <pre>{fileContent || '请选择一个工作区内的文本文件。'}</pre>
                  </div>
                </aside>
              )}
            </div>
          </article>
        )}

        {activeSection === 'workspace' && (
          <>
            <article className="panel wide-panel">
              <div className="panel-heading with-action">
                <div>
                  <FolderOpen size={20} />
                  <h3>工作区</h3>
                </div>
                <button type="button" onClick={chooseWorkspace}>
                  <FolderOpen size={18} />
                  <span>选择工作区</span>
                </button>
              </div>
              <div className="workspace-copy">
                <FolderOpen size={28} />
                <div>
                  <p className="label">当前工作区</p>
                  <h2>{workspace.path ?? '尚未选择工作区'}</h2>
                  <p>
                    {workspace.selectedAt
                      ? `选择时间：${new Date(workspace.selectedAt).toLocaleString('zh-CN')}`
                      : '请选择一个项目文件夹，作为本地文件权限边界。'}
                  </p>
                </div>
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <Laptop size={20} />
                <h3>本地环境</h3>
              </div>
              <p>{environmentLine}</p>
              <dl>
                <div>
                  <dt>应用版本</dt>
                  <dd>{environment?.appVersion ?? '读取中'}</dd>
                </div>
                <div>
                  <dt>本地存储</dt>
                  <dd>本地配置 + JSONL 操作日志</dd>
                </div>
              </dl>
            </article>

            <article className="panel wide-panel">
              <div className="panel-heading with-action">
                <div>
                  <FileText size={20} />
                  <h3>工作区文件</h3>
                </div>
                <button type="button" className="icon-button" onClick={() => refreshWorkspaceFiles()}>
                  <RefreshCw size={16} />
                  <span>刷新</span>
                </button>
              </div>
              <div className="file-browser">
                <div className="file-list">
                  {files.length === 0 ? (
                    <p className="empty-state">选择工作区后，这里会显示可访问的文件列表。</p>
                  ) : (
                    files.map((file) => (
                      <button
                        type="button"
                        className={`file-row ${file.kind} ${selectedFile?.relativePath === file.relativePath ? 'selected' : ''}`}
                        key={file.relativePath}
                        disabled={file.kind === 'directory'}
                        title={file.relativePath}
                        onClick={() => readFile(file)}
                      >
                        <span className="file-kind">{file.kind === 'directory' ? '目录' : '文件'}</span>
                        <strong>{file.relativePath}</strong>
                        <small>{file.kind === 'directory' ? '不可预览' : formatBytes(file.size)}</small>
                      </button>
                    ))
                  )}
                </div>
                <div className="file-preview">
                  <strong>{selectedFile ? selectedFile.relativePath : '文件预览'}</strong>
                  <pre>{fileContent || '请选择一个工作区内的文本文件。'}</pre>
                </div>
              </div>
            </article>

          </>
        )}

        {activeSection === 'agent' && (
          <>
            <article className="panel">
              <div className="panel-heading">
                <Bot size={20} />
                <h3>当前智能体</h3>
              </div>
              <p>选择一个主智能体和工作区后启动会话。会话会读取该智能体关联的默认模型、业务能力和工作区上下文。</p>
              <label>
                <span>主智能体</span>
                <select
                  value={selectedAgent?.id ?? ''}
                  onChange={(event) => setSelectedAgentId(event.target.value)}
                >
                  {primaryAgents.length === 0 ? (
                    <option value="">暂无可用主智能体</option>
                  ) : (
                    primaryAgents.map((agent) => (
                      <option value={agent.id} key={agent.id}>
                        {agent.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <dl>
                <div>
                  <dt>工作区</dt>
                  <dd>{activeWorkspace.path ?? '未选择'}</dd>
                </div>
                <div>
                  <dt>模型</dt>
                  <dd>
                    {formatModelName(
                      draftConfig?.model.models.find((model) => model.id === selectedAgent?.defaultModelId),
                    )}
                  </dd>
                </div>
              </dl>
              {agentNotice && <div className={`inline-notice ${agentNotice.tone}`}>{agentNotice.text}</div>}
              <div className="button-row">
                <button type="button" className="secondary-button" onClick={() => startSession({ force: true })}>
                  <Bot size={18} />
                  <span>{session ? '重启会话' : '启动会话'}</span>
                </button>
                <button
                  type="button"
                  className="quiet-button"
                  disabled={!session || session.state === 'stopped'}
                  onClick={stopSession}
                >
                  <Square size={16} />
                  <span>停止</span>
                </button>
              </div>
              {session && <p className="mono">会话 {session.id}</p>}
            </article>

            <article className="panel wide-panel">
              <div className="panel-heading">
                <Bot size={20} />
                <h3>智能体对话</h3>
              </div>
              <div className="conversation-list">
                {transcript.length === 0 ? (
                  <p className="empty-state">启动会话后发送一条消息，用于验证本地 Pi RPC 回复。</p>
                ) : (
                  transcript.map((item) => (
                    <div className={`message-bubble ${item.role}`} key={`${item.createdAt}-${item.role}`}>
                      <strong>{item.role === 'user' ? '用户' : 'Pi 智能体'}</strong>
                      <span>{item.text}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="composer">
                <textarea
                  value={draftMessage}
                  onChange={(event) => {
                    saveCurrentConversation({ draftMessage: event.target.value });
                  }}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="向 Pi 智能体发送一条测试消息"
                  rows={3}
                />
                <button type="button" disabled={!canSend} onClick={sendMessage}>
                  <Send size={18} />
                  <span>发送</span>
                </button>
              </div>
            </article>
          </>
        )}

        {activeSection === 'config' && (
          <>
        <article className="panel wide-panel">
          <div className="panel-heading with-action">
            <div>
              <Settings size={20} />
              <h3>配置中心</h3>
            </div>
          </div>
          <p className="subtle-text">
            {configState ? `配置文件：${configState.configPath}` : '正在读取客户端配置。'}
          </p>
          {configNotice && <div className={`inline-notice ${configNotice.tone}`}>{configNotice.text}</div>}
          {draftConfig && (
              <div className="settings-stack">
              <nav className="config-tabs" aria-label="配置中心子菜单">
                <button
                  type="button"
                  className={activeConfigTab === 'models' ? 'active' : ''}
                  onClick={() => setActiveConfigTab('models')}
                >
                  模型配置
                </button>
                <button
                  type="button"
                  className={activeConfigTab === 'capabilities' ? 'active' : ''}
                  onClick={() => setActiveConfigTab('capabilities')}
                >
                  Tools / Skills
                </button>
                <button
                  type="button"
                  className={activeConfigTab === 'agents' ? 'active' : ''}
                  onClick={() => setActiveConfigTab('agents')}
                >
                  智能体配置
                </button>
                <button
                  type="button"
                  className={activeConfigTab === 'core' ? 'active' : ''}
                  onClick={() => setActiveConfigTab('core')}
                >
                  内核 / RPC
                </button>
              </nav>

              {activeConfigTab === 'agents' && (
              <section className="config-block">
                <div className="section-title-row">
                  <div>
                    <strong>智能体配置</strong>
                    <span>维护主智能体、子智能体、可用模型和 Tools / Skills 关联关系。</span>
                  </div>
                  <button type="button" onClick={() => setAgentEditor(createAgentConfig())}>
                    <Plus size={16} />
                    <span>新增智能体</span>
                  </button>
                </div>
                <div className="capability-table">
                  {draftConfig.agents.length === 0 ? (
                    <p className="empty-state">暂无智能体。系统会默认创建一个主智能体。</p>
                  ) : (
                    draftConfig.agents.map((agent) => {
                      const defaultModel = draftConfig.model.models.find((model) => model.id === agent.defaultModelId);
                      return (
                        <div className="capability-row" key={agent.id}>
                          <div>
                            <strong>{agent.name}</strong>
                            <span>{agent.description || '未填写描述'}</span>
                          </div>
                          <small>{agentTypeLabels[agent.type]}</small>
                          <small>{agent.modelIds.length} 个模型</small>
                          <small>{agent.capabilityIds.length} 个能力</small>
                          <small>{formatModelName(defaultModel)}</small>
                          <small className={agent.enabled ? 'enabled' : 'disabled'}>
                            {agent.enabled ? '已启用' : '未启用'}
                          </small>
                          <div className="button-row">
                            <button
                              type="button"
                              className="quiet-button compact-button"
                              onClick={() => setAgentEditor(agent)}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              className="quiet-button compact-button"
                              onClick={() => saveAgentConfig({ ...agent, enabled: !agent.enabled })}
                            >
                              {agent.enabled ? '停用' : '启用'}
                            </button>
                            <button
                              type="button"
                              className="quiet-button compact-button"
                              onClick={() => deleteAgentConfig(agent.id)}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
              )}

              {activeConfigTab === 'core' && (
              <section className="config-block">
                <div className="section-title-row">
                  <div>
                    <strong>智能体内核 / RPC</strong>
                    <span>控制客户端连接内置子进程还是外部 Pi RPC 服务。</span>
                  </div>
                  <button type="button" onClick={saveAgentCoreConfig}>
                    <Save size={16} />
                    <span>保存内核配置</span>
                  </button>
                </div>
                <div className="settings-grid">
                  <label>
                    <span>智能体内核模式</span>
                    <select
                      value={draftConfig.agentCore.mode}
                      onChange={(event) =>
                        updateAgentCore(
                          'mode',
                          event.target.value as ClientConfig['agentCore']['mode'],
                        )
                      }
                    >
                      <option value="embedded-rpc">内置 RPC 子进程</option>
                      <option value="external-rpc">外部 RPC 服务</option>
                    </select>
                  </label>
                  <label>
                    <span>RPC 地址</span>
                    <input
                      value={draftConfig.agentCore.rpcEndpoint}
                      onChange={(event) => updateAgentCore('rpcEndpoint', event.target.value)}
                      placeholder="例如 local-subprocess 或 http://127.0.0.1:3000"
                    />
                  </label>
                </div>
              </section>
              )}

              {activeConfigTab === 'models' && (
              <section className="config-block">
                <div className="section-title-row">
                  <div>
                    <strong>模型 / Provider</strong>
                    <span>按列表管理官方 Provider、自定义模型、国内厂商和本地模型。</span>
                  </div>
                  <button
                    type="button"
                    className="primary-action-button"
                    onClick={() => {
                      setModelEditorNotice(null);
                      setModelEditor(createModelProfile());
                    }}
                  >
                    <Plus size={16} />
                    <span>新增模型</span>
                  </button>
                </div>

                <div className="model-toolbar field-filters">
                  <label>
                    <span>Provider</span>
                    <select
                      value={modelFilters.provider}
                      onChange={(event) =>
                        setModelFilters((filters) => ({ ...filters, provider: event.target.value }))
                      }
                    >
                      <option value="">全部 Provider</option>
                      {providerPresets.map((preset) => (
                        <option value={preset.provider} key={preset.provider}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>接入方式</span>
                    <select
                      value={modelFilters.setupMode}
                      onChange={(event) =>
                        setModelFilters((filters) => ({ ...filters, setupMode: event.target.value }))
                      }
                    >
                      <option value="">全部方式</option>
                      {Object.entries(setupModeLabels).map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>状态</span>
                    <select
                      value={modelFilters.status}
                      onChange={(event) =>
                        setModelFilters((filters) => ({ ...filters, status: event.target.value }))
                      }
                    >
                      <option value="">全部状态</option>
                      <option value="enabled">已启用</option>
                      <option value="disabled">未启用</option>
                    </select>
                  </label>
                  <label>
                    <span>能力</span>
                    <select
                      value={modelFilters.input}
                      onChange={(event) =>
                        setModelFilters((filters) => ({ ...filters, input: event.target.value }))
                      }
                    >
                      <option value="">文本 / 视觉</option>
                      <option value="text">文本</option>
                      <option value="image">视觉</option>
                    </select>
                  </label>
                  <label>
                    <span>思考</span>
                    <select
                      value={modelFilters.reasoning}
                      onChange={(event) =>
                        setModelFilters((filters) => ({ ...filters, reasoning: event.target.value }))
                      }
                    >
                      <option value="">全部</option>
                      <option value="yes">支持</option>
                      <option value="no">不支持</option>
                    </select>
                  </label>
                  <div className="settings-meta compact-meta">
                    <strong>默认模型</strong>
                    <span>{defaultModelDisplayName}</span>
                  </div>
                </div>

                <div className="model-list">
                  {filteredModels.length === 0 ? (
                    <p className="empty-state">暂无匹配模型。可以新增官方 Provider、本地模型或自定义模型。</p>
                  ) : (
                    filteredModels.map((model) => (
                      <div className="model-row" key={model.id}>
                        <div>
                          <strong>{model.displayName}</strong>
                          <span>
                            {model.providerLabel || model.provider} / {model.modelId || '未填写模型 ID'}
                          </span>
                        </div>
                        <small>{setupModeLabels[model.setupMode]}</small>
                        <small>{model.input.includes('image') ? '文本 + 视觉' : '文本'}</small>
                        <small>{model.supportsReasoning ? '支持思考' : '无思考'}</small>
                        <small>{model.contextWindow ? `${model.contextWindow.toLocaleString()} ctx` : '上下文未填'}</small>
                        <small className={model.connectionStatus === 'success' ? 'enabled' : 'disabled'}>
                          {model.connectionStatus === 'success'
                            ? '联通'
                            : model.connectionStatus === 'failure'
                              ? '失败'
                              : '未测试'}
                        </small>
                        <div className="button-row">
                          <button
                            type="button"
                            className="quiet-button compact-button"
                            onClick={() => {
                              setModelEditorNotice(null);
                              setModelEditor(model);
                            }}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="quiet-button compact-button"
                            disabled={!model.enabled && model.connectionStatus !== 'success'}
                            title={!model.enabled && model.connectionStatus !== 'success' ? '请先测试联通成功' : undefined}
                            onClick={() => updateModelEnabled(model, !model.enabled)}
                          >
                            {model.enabled ? '停用' : '启用'}
                          </button>
                          <button
                            type="button"
                            className="quiet-button compact-button"
                            onClick={() => deleteModelProfile(model.id)}
                          >
                            删除
                          </button>
                          <button
                            type="button"
                            className="secondary-button compact-button"
                            onClick={() => testModelConnection(model)}
                          >
                            测试
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
              )}

              {activeConfigTab === 'capabilities' && (
              <section className="config-block">
                <div className="section-title-row">
                  <div>
                    <strong>业务能力 / Tools & Skills</strong>
                    <span>按列表管理企业接口、脚本、内置能力、MCP 工具和技能。</span>
                  </div>
                  <button type="button" className="icon-button" onClick={() => setCapabilityEditor(createCapabilityConfig())}>
                    <Plus size={16} />
                    <span>新增能力</span>
                  </button>
                </div>

                <div className="model-toolbar field-filters">
                  <label>
                    <span>类型</span>
                    <select
                      value={capabilityFilters.type}
                      onChange={(event) =>
                        setCapabilityFilters((filters) => ({ ...filters, type: event.target.value }))
                      }
                    >
                      <option value="">全部类型</option>
                      {Object.entries(capabilityTypeLabels).map(([value, label]) => (
                        <option value={value} key={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>执行方式</span>
                    <select
                      value={capabilityFilters.executionMode}
                      onChange={(event) =>
                        setCapabilityFilters((filters) => ({ ...filters, executionMode: event.target.value }))
                      }
                    >
                      <option value="">全部方式</option>
                      {Object.entries(capabilityExecutionLabels).map(([value, label]) => (
                        <option value={value} key={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>触发方式</span>
                    <select
                      value={capabilityFilters.triggerMode}
                      onChange={(event) =>
                        setCapabilityFilters((filters) => ({ ...filters, triggerMode: event.target.value }))
                      }
                    >
                      <option value="">全部触发</option>
                      {Object.entries(capabilityTriggerLabels).map(([value, label]) => (
                        <option value={value} key={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>状态</span>
                    <select
                      value={capabilityFilters.status}
                      onChange={(event) =>
                        setCapabilityFilters((filters) => ({ ...filters, status: event.target.value }))
                      }
                    >
                      <option value="">全部状态</option>
                      <option value="enabled">已启用</option>
                      <option value="disabled">未启用</option>
                    </select>
                  </label>
                  <div className="settings-meta compact-meta">
                    <strong>能力数量</strong>
                    <span>{filteredCapabilities.length} / {draftConfig.capabilities.length}</span>
                  </div>
                </div>

                <div className="capability-table">
                  {filteredCapabilities.length === 0 ? (
                    <p className="empty-state">暂无匹配能力。可以新增 HTTP API、本地命令、MCP 工具或 Skill。</p>
                  ) : (
                    filteredCapabilities.map((capability) => (
                      <div className="capability-row" key={capability.id}>
                        <div>
                          <strong>{capability.name}</strong>
                          <span>{capability.description || capability.category || '未填写描述'}</span>
                        </div>
                        <small>{capabilityTypeLabels[capability.type]}</small>
                        <small>{capabilityExecutionLabels[capability.executionMode]}</small>
                        <small>{capabilityTriggerLabels[capability.triggerMode]}</small>
                        <small className={capability.connectionStatus === 'success' ? 'enabled' : 'disabled'}>
                          {capability.connectionStatus === 'success'
                            ? '联通'
                            : capability.connectionStatus === 'failure'
                              ? '失败'
                              : '未测试'}
                        </small>
                        <small>{capability.enabled ? '已启用' : '未启用'}</small>
                        <div className="button-row">
                          <button
                            type="button"
                            className="quiet-button compact-button"
                            onClick={() => setCapabilityEditor(capability)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="quiet-button compact-button"
                            onClick={() => updateCapabilityEnabled(capability, !capability.enabled)}
                          >
                            {capability.enabled ? '停用' : '启用'}
                          </button>
                          <button
                            type="button"
                            className="secondary-button compact-button"
                            onClick={() => testCapabilityConnection(capability)}
                          >
                            测试
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="tool-list">
                  <div className="section-title-row">
                    <div>
                      <strong>当前可用业务能力</strong>
                      <span>这里展示智能体可见的内置能力和已保存的 Tool / Skill。</span>
                    </div>
                  </div>
                  {tools.map((tool) => (
                    <div className="tool-row" key={tool.name}>
                      <ShieldCheck size={18} />
                      <div>
                        <strong>{tool.name}</strong>
                        <span>{tool.businessAction}</span>
                      </div>
                      <small className={tool.enabled ? 'enabled' : 'disabled'}>
                        {tool.enabled ? '已启用' : '已预留'}
                      </small>
                    </div>
                  ))}
                </div>
              </section>
              )}
            </div>
          )}
        </article>
          </>
        )}

        {activeSection === 'logs' && (
          <article className="panel wide-panel">
            <div className="panel-heading with-action">
              <div>
                <ListChecks size={20} />
                <h3>操作日志</h3>
              </div>
              <button type="button" className="icon-button" onClick={refreshAuditLogs}>
                <RefreshCw size={16} />
                <span>刷新</span>
              </button>
            </div>
            <p className="subtle-text">
              {auditPath ? `日志文件：${auditPath}` : '今天还没有操作日志。'}
              {auditRefreshedAt
                ? ` 最新记录在上，刷新时间：${new Date(auditRefreshedAt).toLocaleTimeString('zh-CN')}`
                : ''}
            </p>
            <div className="audit-filters">
              <label>
                <span>操作类型</span>
                <select
                  value={auditQuery.businessAction ?? ''}
                  onChange={(event) =>
                    setAuditQuery((query) => ({ ...query, businessAction: event.target.value, offset: 0 }))
                  }
                >
                  <option value="">全部类型</option>
                  {Object.entries(auditActionLabels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>状态</span>
                <select
                  value={auditQuery.status ?? ''}
                  onChange={(event) =>
                    setAuditQuery((query) => ({
                      ...query,
                      status: event.target.value as AuditLogQuery['status'],
                      offset: 0,
                    }))
                  }
                >
                  <option value="">全部状态</option>
                  <option value="success">成功</option>
                  <option value="failure">失败</option>
                </select>
              </label>
              <label>
                <span>开始时间</span>
                <input
                  type="datetime-local"
                  step={1}
                  value={auditQuery.startTime ?? ''}
                  onChange={(event) => {
                    setAuditTimeRangeLocked(true);
                    setAuditQuery((query) => ({ ...query, startTime: event.target.value, offset: 0 }));
                  }}
                />
              </label>
              <label>
                <span>结束时间</span>
                <input
                  type="datetime-local"
                  step={1}
                  value={auditQuery.endTime ?? ''}
                  onChange={(event) => {
                    setAuditTimeRangeLocked(true);
                    setAuditQuery((query) => ({ ...query, endTime: event.target.value, offset: 0 }));
                  }}
                />
              </label>
              <label>
                <span>关键词</span>
                <input
                  value={auditQuery.keyword ?? ''}
                  onChange={(event) =>
                    setAuditQuery((query) => ({ ...query, keyword: event.target.value, offset: 0 }))
                  }
                  placeholder="搜索摘要、工具、工作区或错误"
                />
              </label>
              <div className="audit-filter-actions">
                <button type="button" onClick={applyAuditFilters}>
                  查询
                </button>
                <button type="button" className="quiet-button" onClick={resetAuditFilters}>
                  重置
                </button>
              </div>
            </div>
            <div className="audit-list">
              {auditEntries.length === 0 ? (
                <p className="empty-state">暂无操作记录。</p>
              ) : (
                auditEntries.map((entry) => (
                  <div className="audit-row" key={`${entry.timestamp}-${entry.businessAction}`}>
                    <strong>{auditActionLabels[entry.businessAction] ?? entry.businessAction}</strong>
                    <span>{new Date(entry.timestamp).toLocaleString('zh-CN')}</span>
                    <p>{entry.outputSummary ?? entry.inputSummary ?? entry.toolName}</p>
                    <small className={entry.status === 'success' ? 'enabled' : 'disabled'}>
                      {entry.status === 'success' ? '成功' : '失败'}
                    </small>
                  </div>
                ))
              )}
            </div>
            <div className="audit-pagination">
              <span>
                已显示 {auditEntries.length} / {auditTotal} 条
              </span>
              {auditHasMore && (
                <button type="button" className="secondary-button" onClick={loadMoreAuditLogs}>
                  加载更多
                </button>
              )}
            </div>
          </article>
        )}
      </section>

      {agentEditor && draftConfig && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-label="编辑智能体">
            <div className="panel-heading with-action">
              <div>
                <Bot size={20} />
                <h3>{agentEditor.name ? `编辑智能体：${agentEditor.name}` : '新增智能体'}</h3>
              </div>
              <button type="button" className="modal-close-button" onClick={() => setAgentEditor(null)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="model-form-layout">
              <div className="form-section-heading wide-field">
                <strong>基础信息</strong>
                <span>智能体是会话入口，负责绑定模型、业务能力和子智能体。</span>
              </div>
              <label>
                <span>智能体名称 *</span>
                <input
                  value={agentEditor.name}
                  onChange={(event) => updateAgentEditor('name', event.target.value)}
                  placeholder="例如 案件办理、合同审查、企业查询"
                />
              </label>
              <label>
                <span>类型</span>
                <select
                  value={agentEditor.type}
                  onChange={(event) =>
                    updateAgentEditor('type', event.target.value as AgentConfig['type'])
                  }
                >
                  <option value="primary">主智能体</option>
                  <option value="sub">子智能体</option>
                </select>
              </label>
              <label>
                <span>最大层级</span>
                <input
                  type="number"
                  min={1}
                  max={3}
                  value={agentEditor.maxDelegationDepth}
                  onChange={(event) =>
                    updateAgentEditor(
                      'maxDelegationDepth',
                      Math.min(Math.max(Number(event.target.value), 1), 3),
                    )
                  }
                />
              </label>
              <label className="wide-field">
                <span>描述</span>
                <textarea
                  value={agentEditor.description}
                  onChange={(event) => updateAgentEditor('description', event.target.value)}
                  rows={3}
                  placeholder="描述这个智能体负责的业务场景和边界。"
                />
              </label>

              {agentEditor.type === 'sub' && (
                <div className="wide-field checklist-box">
                  <strong>上级主智能体 / 可复用挂载点</strong>
                  {draftConfig.agents.filter((agent) => agent.id !== agentEditor.id).map((agent) => (
                    <label className="checkbox-row" key={agent.id}>
                      <input
                        type="checkbox"
                        checked={agentEditor.parentAgentIds.includes(agent.id)}
                        onChange={(event) => toggleAgentParent(agent.id, event.target.checked)}
                      />
                      <span>{agent.name}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="wide-field checklist-box">
                <strong>可用模型 *</strong>
                {draftConfig.model.models.length === 0 ? (
                  <p className="empty-state">请先在模型配置中新增并测试模型。</p>
                ) : (
                  draftConfig.model.models.map((model) => (
                    <label className="checkbox-row" key={model.id}>
                      <input
                        type="checkbox"
                        checked={agentEditor.modelIds.includes(model.id)}
                        disabled={!model.enabled || model.connectionStatus !== 'success'}
                        onChange={(event) => toggleAgentModel(model.id, event.target.checked)}
                      />
                      <span>{formatModelName(model)}{model.enabled && model.connectionStatus === 'success' ? '' : '（未启用或未联通）'}</span>
                    </label>
                  ))
                )}
              </div>

              <label>
                <span>默认模型</span>
                <select
                  value={agentEditor.defaultModelId ?? ''}
                  onChange={(event) => updateAgentEditor('defaultModelId', event.target.value || null)}
                >
                  <option value="">请选择</option>
                  {draftConfig.model.models
                    .filter((model) => agentEditor.modelIds.includes(model.id))
                    .map((model) => (
                      <option value={model.id} key={model.id}>
                        {formatModelName(model)}
                      </option>
                    ))}
                </select>
              </label>

              <div className="wide-field checklist-box">
                <strong>可用 Tools / Skills</strong>
                {draftConfig.capabilities.map((capability) => (
                  <label className="checkbox-row" key={capability.id}>
                    <input
                      type="checkbox"
                      checked={agentEditor.capabilityIds.includes(capability.id)}
                      disabled={!capability.enabled}
                      onChange={(event) => toggleAgentCapability(capability.id, event.target.checked)}
                    />
                    <span>{capability.name} / {capabilityTypeLabels[capability.type]}{capability.enabled ? '' : '（未启用）'}</span>
                  </label>
                ))}
              </div>

              {agentEditor.type === 'primary' && (
                <div className="wide-field checklist-box">
                  <strong>可调度子智能体</strong>
                  {draftConfig.agents
                    .filter((agent) => agent.type === 'sub' && agent.id !== agentEditor.id)
                    .map((agent) => (
                      <label className="checkbox-row" key={agent.id}>
                        <input
                          type="checkbox"
                          checked={agentEditor.childAgentIds.includes(agent.id)}
                          onChange={(event) => toggleAgentChild(agent.id, event.target.checked)}
                        />
                        <span>{agent.name}</span>
                      </label>
                    ))}
                </div>
              )}

              <label className="checkbox-row form-checkbox">
                <input
                  type="checkbox"
                  checked={agentEditor.enabled}
                  onChange={(event) => updateAgentEditor('enabled', event.target.checked)}
                />
                <span>启用该智能体</span>
              </label>
              <label className="wide-field">
                <span>备注</span>
                <textarea
                  value={agentEditor.notes}
                  onChange={(event) => updateAgentEditor('notes', event.target.value)}
                  rows={3}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => deleteAgentConfig(agentEditor.id)}>
                <Trash2 size={16} />
                <span>删除</span>
              </button>
              <button type="button" onClick={() => saveAgentConfig(agentEditor)}>
                <Save size={16} />
                <span>保存智能体</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {modelEditor && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-label="编辑模型">
            <div className="panel-heading with-action">
              <div>
                <Settings size={20} />
                <h3>{modelEditor.displayName ? `编辑模型：${modelEditor.displayName}` : '新增模型'}</h3>
              </div>
              <button type="button" className="modal-close-button" onClick={() => setModelEditor(null)} aria-label="关闭">
                ×
              </button>
            </div>
            {modelEditorNotice && (
              <div className={`inline-notice ${modelEditorNotice.tone}`}>{modelEditorNotice.text}</div>
            )}

            <div className="model-form-layout">
              <div className="form-section-heading wide-field">
                <strong>基础信息</strong>
                <span>选择供应商，填写模型和 API Key。带 * 的字段为保存前必填。</span>
              </div>
              <label>
                <span>{requiredLabel('供应商')}</span>
                <select value={modelProviderSelectValue} onChange={(event) => applyProviderPreset(event.target.value)}>
                  <option value="">请选择供应商</option>
                  {providerPresets.map((preset) => (
                    <option key={preset.provider} value={preset.provider}>
                      {preset.label}（{preset.provider}）
                    </option>
                  ))}
                  <option value="__custom__">自定义 / 未列出的供应商</option>
                </select>
                <small className="field-hint">
                  系统会自动选择接入方式：{setupModeLabels[modelEditor.setupMode]}。
                </small>
              </label>
              {isCustomProviderSelection(modelEditor.provider) && (
                <label>
                  <span>{requiredLabel('供应商标识')}</span>
                  <input
                    value={modelEditor.provider}
                    onChange={(event) => updateModelEditor('provider', event.target.value.trim())}
                    placeholder="例如 qwen、volcengine、my-provider"
                  />
                  <small className="field-hint">未列入字典的供应商才需要填写，用英文、数字或连字符。</small>
                </label>
              )}
              <label>
                <span>{requiredLabel('模型 ID')}</span>
                <input
                  list="model-id-suggestions"
                  value={modelEditor.modelId}
                  onChange={(event) => updateModelId(event.target.value)}
                  placeholder={modelSuggestions[0] ? `例如 ${modelSuggestions[0]}` : '例如 qwen-plus、doubao-seed-1-6'}
                />
                <datalist id="model-id-suggestions">
                  {modelSuggestions.map((modelId) => (
                    <option key={modelId} value={modelId} />
                  ))}
                </datalist>
                <small className="field-hint">填供应商控制台或文档里的模型名；候选只是常见示例，不限制输入。</small>
              </label>
              <label>
                <span>显示名称</span>
                <input
                  value={modelEditor.displayName}
                  onChange={(event) => updateModelEditor('displayName', event.target.value)}
                  placeholder="默认使用模型 ID，也可改成你熟悉的名字"
                />
                <small className="field-hint">可留空；保存时会自动使用模型 ID。多个模型显示名称相同也可以。</small>
              </label>

              <div className="form-section-heading wide-field">
                <strong>连接信息</strong>
                <span>普通用户直接粘贴 API Key 即可，客户端会在背后交给 Pi RPC 使用。</span>
              </div>
              {modelEditorRequirements.needsApiKey && (
                <label>
                  <span>{requiredLabel('API Key')}</span>
                  <input
                    type="password"
                    value={modelEditor.apiKeyValue}
                    onChange={(event) => updateModelEditor('apiKeyValue', event.target.value)}
                    placeholder="粘贴供应商控制台生成的 API Key"
                  />
                  <small className="field-hint">
                    已保存：{maskSecret(modelEditor.apiKeyValue)}。当前版本保存在本机配置文件中，后续会接入系统凭据管理。
                  </small>
                </label>
              )}
              <label>
                <span>{modelEditorRequirements.needsBaseUrl ? requiredLabel('Base URL') : 'Base URL'}</span>
                <input
                  value={modelEditor.baseUrl}
                  onChange={(event) => updateModelEditor('baseUrl', event.target.value)}
                  placeholder="官方 Provider 可留空，自定义/本地模型填写地址"
                />
                <small className="field-hint">
                  {modelEditor.setupMode === 'official-api-key'
                    ? '官方内置 Provider 可留空；只有代理或网关场景才需要覆盖。'
                    : 'Pi 的 models.json 需要用它定位兼容 API 地址。'}
                </small>
              </label>
              {!modelEditorRequirements.needsApiKey && (
                <label>
                  <span>认证</span>
                  <input value="无需 API Key 或使用本地占位 Key" readOnly />
                  <small className="field-hint">Ollama / LM Studio 等本地 OpenAI 兼容服务通常忽略 API Key。</small>
                </label>
              )}

              <div className="form-section-heading wide-field">
                <strong>模型能力</strong>
                <span>这些字段用于未来筛选模型、创建智能体、计算上下文和成本。</span>
              </div>
              <label>
                <span>默认 Thinking</span>
                <select
                  value={modelEditor.defaultThinkingLevel}
                  onChange={(event) =>
                    updateModelEditor(
                      'defaultThinkingLevel',
                      event.target.value as ModelProfileConfig['defaultThinkingLevel'],
                    )
                  }
                >
                  <option value="off">off</option>
                  <option value="minimal">minimal</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                </select>
              </label>
              <label>
                <span>上下文窗口</span>
                <input
                  type="number"
                  min={0}
                  value={modelEditor.contextWindow}
                  onChange={(event) => updateModelEditor('contextWindow', Number(event.target.value))}
                />
              </label>
              <label>
                <span>最大输出长度</span>
                <input
                  type="number"
                  min={0}
                  value={modelEditor.maxTokens}
                  onChange={(event) => updateModelEditor('maxTokens', Number(event.target.value))}
                />
              </label>
              <label>
                <span>输入能力</span>
                <div className="inline-options">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={modelEditor.input.includes('text')}
                      onChange={(event) => toggleModelInput('text', event.target.checked)}
                    />
                    <span>文本</span>
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={modelEditor.input.includes('image')}
                      onChange={(event) => toggleModelInput('image', event.target.checked)}
                    />
                    <span>视觉</span>
                  </label>
                </div>
              </label>
              <label className="checkbox-row form-checkbox">
                <input
                  type="checkbox"
                  checked={modelEditor.supportsReasoning}
                  onChange={(event) => updateModelEditor('supportsReasoning', event.target.checked)}
                />
                <span>支持思考 / Reasoning</span>
              </label>

              <div className="form-section-heading wide-field">
                <strong>价格信息</strong>
                <span>用于后续统计 token 成本；不清楚可以先保持 0。</span>
              </div>
              <div className="settings-grid advanced-grid wide-field">
                  <label>
                    <span>输入价格 / 百万 token</span>
                    <input
                      type="number"
                      min={0}
                      value={modelEditor.priceInputPerMTok}
                      onChange={(event) =>
                        updateModelEditor('priceInputPerMTok', Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    <span>输出价格 / 百万 token</span>
                    <input
                      type="number"
                      min={0}
                      value={modelEditor.priceOutputPerMTok}
                      onChange={(event) =>
                        updateModelEditor('priceOutputPerMTok', Number(event.target.value))
                      }
                    />
                  </label>
              </div>
              <label className="wide-field">
                <span>备注</span>
                <textarea
                  value={modelEditor.notes}
                  onChange={(event) => updateModelEditor('notes', event.target.value)}
                  rows={3}
                />
              </label>
            </div>

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => testModelConnection(modelEditor)}>
                测试
              </button>
              <button type="button" onClick={() => saveModelProfile(modelEditor)}>
                <Save size={16} />
                <span>保存模型</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {capabilityEditor && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-label="编辑业务能力">
            <div className="panel-heading with-action">
              <div>
                <ShieldCheck size={20} />
                <h3>{capabilityEditor.name ? `编辑能力：${capabilityEditor.name}` : '新增能力'}</h3>
              </div>
              <button type="button" className="quiet-button compact-button" onClick={() => setCapabilityEditor(null)}>
                关闭
              </button>
            </div>

            <div className="settings-grid">
              <label>
                <span>能力名称</span>
                <input
                  value={capabilityEditor.name}
                  onChange={(event) => updateCapabilityEditor('name', event.target.value)}
                  placeholder="例如 OCR 验证、合同条款检查"
                />
              </label>
              <label>
                <span>分类</span>
                <input
                  value={capabilityEditor.category}
                  onChange={(event) => updateCapabilityEditor('category', event.target.value)}
                  placeholder="例如 OCR、合同、财务、知识库"
                />
              </label>
              <label>
                <span>能力类型</span>
                <select
                  value={capabilityEditor.type}
                  onChange={(event) =>
                    updateCapabilityEditor('type', event.target.value as CapabilityConfig['type'])
                  }
                >
                  {Object.entries(capabilityTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>执行方式</span>
                <select
                  value={capabilityEditor.executionMode}
                  onChange={(event) =>
                    updateCapabilityEditor('executionMode', event.target.value as CapabilityExecutionMode)
                  }
                >
                  {Object.entries(capabilityExecutionLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>触发方式</span>
                <select
                  value={capabilityEditor.triggerMode}
                  onChange={(event) =>
                    updateCapabilityEditor('triggerMode', event.target.value as CapabilityConfig['triggerMode'])
                  }
                >
                  {Object.entries(capabilityTriggerLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>HTTP 方法</span>
                <select
                  value={capabilityEditor.httpMethod}
                  onChange={(event) =>
                    updateCapabilityEditor('httpMethod', event.target.value as CapabilityConfig['httpMethod'])
                  }
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </label>
              <label className="wide-field">
                <span>接口地址</span>
                <input
                  value={capabilityEditor.endpoint}
                  onChange={(event) => updateCapabilityEditor('endpoint', event.target.value)}
                  placeholder="HTTP API / MCP endpoint，例如 https://api.company.local/ocr"
                />
              </label>
              <label className="wide-field">
                <span>本地命令</span>
                <input
                  value={capabilityEditor.command}
                  onChange={(event) => updateCapabilityEditor('command', event.target.value)}
                  placeholder="例如 scripts/verify-ocr.ps1"
                />
              </label>
              <label>
                <span>工作目录</span>
                <input
                  value={capabilityEditor.workingDirectory}
                  onChange={(event) => updateCapabilityEditor('workingDirectory', event.target.value)}
                  placeholder="可选，默认工作区"
                />
              </label>
              <label>
                <span>Token 环境变量</span>
                <input
                  value={capabilityEditor.tokenEnv}
                  onChange={(event) => updateCapabilityEditor('tokenEnv', event.target.value)}
                  placeholder="例如 OCR_API_TOKEN"
                />
              </label>
              <label>
                <span>超时 ms</span>
                <input
                  type="number"
                  min={0}
                  value={capabilityEditor.timeoutMs}
                  onChange={(event) => updateCapabilityEditor('timeoutMs', Number(event.target.value))}
                />
              </label>
              <label>
                <span>重试次数</span>
                <input
                  type="number"
                  min={0}
                  value={capabilityEditor.retryCount}
                  onChange={(event) => updateCapabilityEditor('retryCount', Number(event.target.value))}
                />
              </label>
              <label className="wide-field">
                <span>能力描述</span>
                <textarea
                  value={capabilityEditor.description}
                  onChange={(event) => updateCapabilityEditor('description', event.target.value)}
                  rows={3}
                  placeholder="描述智能体什么时候应该调用这个能力。"
                />
              </label>
              <label className="wide-field">
                <span>请求头 JSON</span>
                <textarea
                  value={capabilityEditor.headersJson}
                  onChange={(event) => updateCapabilityEditor('headersJson', event.target.value)}
                  rows={3}
                  placeholder='例如 {"X-System":"contract"}'
                />
              </label>
              <label className="wide-field">
                <span>输入 Schema JSON</span>
                <textarea
                  value={capabilityEditor.inputSchemaJson}
                  onChange={(event) => updateCapabilityEditor('inputSchemaJson', event.target.value)}
                  rows={4}
                  placeholder='可选，用于描述 tool 参数，例如 {"type":"object","properties":{}}'
                />
              </label>
              <label className="wide-field">
                <span>输出 Schema JSON</span>
                <textarea
                  value={capabilityEditor.outputSchemaJson}
                  onChange={(event) => updateCapabilityEditor('outputSchemaJson', event.target.value)}
                  rows={4}
                />
              </label>
              <label>
                <span>标签</span>
                <input
                  value={capabilityEditor.tags.join(', ')}
                  onChange={(event) =>
                    updateCapabilityEditor(
                      'tags',
                      event.target.value
                        .split(',')
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    )
                  }
                  placeholder="用逗号分隔，例如 OCR, 验证"
                />
              </label>
              <label className="checkbox-row form-checkbox">
                <input
                  type="checkbox"
                  checked={capabilityEditor.enabled}
                  onChange={(event) => updateCapabilityEditor('enabled', event.target.checked)}
                />
                <span>启用该能力</span>
              </label>
              <label className="wide-field">
                <span>备注</span>
                <textarea
                  value={capabilityEditor.notes}
                  onChange={(event) => updateCapabilityEditor('notes', event.target.value)}
                  rows={3}
                />
              </label>
            </div>

            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => deleteCapabilityConfig(capabilityEditor.id)}>
                <Trash2 size={16} />
                <span>删除</span>
              </button>
              <button type="button" className="secondary-button" onClick={() => testCapabilityConnection(capabilityEditor)}>
                测试联通
              </button>
              <button type="button" onClick={() => saveCapabilityConfig(capabilityEditor)}>
                <Save size={16} />
                <span>保存能力</span>
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function sortAuditEntries(entries: AuditLogEntry[]): AuditLogEntry[] {
  return [...entries].sort((first, second) => second.timestamp.localeCompare(first.timestamp));
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
