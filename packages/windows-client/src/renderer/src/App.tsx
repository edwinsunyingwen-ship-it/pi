import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent, ClipboardEvent, KeyboardEvent, ReactElement, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import {
  ArrowLeft,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Copy,
  FileText,
  FolderOpen,
  Info,
  Laptop,
  ListChecks,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AgentConfig,
  AgentKnowledgeItem,
  ConversationStoreState,
  AgentRuleConfig,
  AgentSession,
  AgentTaskTemplate,
  AgentToolInfo,
  AppEnvironment,
  AuditLogEntry,
  AuditLogQuery,
  CapabilityConfig,
  CapabilityExecutionMode,
  ClientConfig,
  ClientConfigState,
  ConversationAttachmentMeta,
  ModelInputCapability,
  ModelProfileConfig,
  ModelSetupMode,
  StoredAgentConversation,
  WorkspaceFileInfo,
  WorkspaceState,
} from '../../shared/types';
import { InlineNotice } from './components/ui/InlineNotice';
import { PaginationBar } from './components/ui/PaginationBar';
import { highlightSearchText, searchConversations } from './conversation-search';
import type { ConversationSearchMatch, SearchableConversation } from './conversation-search';
import './styles.css';

interface TranscriptItem {
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  attachments?: ConversationAttachmentMeta[];
}

interface LocalNotice {
  tone: 'info' | 'success' | 'error';
  text: string;
}

interface ConfirmDialogState {
  tone: 'default' | 'danger';
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
}

interface AgentConversationState {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  session: AgentSession | null;
  transcript: TranscriptItem[];
  draftMessage: string;
  workspace: WorkspaceState;
}

interface SearchNavigationTarget {
  matchId: string;
  agentId: string;
  conversationId: string;
  messageIndex: number;
  query: string;
}

const modelPageSize = 20;
const capabilityPageSize = 20;
const agentPageSize = 20;
const archivedConversationPageSize = 20;
const auditPageSize = 100;
const maxConversationTitleLength = 60;
const auditContentPreviewMaxLength = 120;
const maxComposerAttachments = 20;
const textAttachmentExtensions = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'jsonl',
  'csv',
  'tsv',
  'xml',
  'yaml',
  'yml',
  'html',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'c',
  'cpp',
  'cs',
  'go',
  'rs',
  'sh',
  'ps1',
  'sql',
  'log',
]);

type AppMenuName = 'File' | 'Edit' | 'View' | 'Window' | 'Help';

interface AppMenuItem {
  label: string;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

interface ComposerAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: 'image' | 'text' | 'document' | 'file';
  truncated: boolean;
  readable: boolean;
  sourcePath?: string;
  previewDataUrl?: string;
}

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
  'capability-invoked': '调用能力',
  'capability-result': '能力返回',
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
    baseUrl: 'https://api.deepseek.com',
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
    baseUrl: 'https://api.moonshot.cn/v1',
    note: 'Pi 内置 Provider，适合 Moonshot / Kimi 官方 API。',
    models: ['kimi-k2', 'kimi-latest', 'kimi-thinking-preview'],
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    provider: 'minimax-cn',
    label: 'MiniMax 中国区',
    setupMode: 'official-api-key',
    api: 'anthropic-messages',
    apiKeyEnv: 'MINIMAX_CN_API_KEY',
    baseUrl: 'https://api.minimaxi.com/anthropic',
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
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    note: 'Pi 内置 OpenAI 兼容 Provider。',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    provider: 'kimi-coding',
    label: 'Kimi For Coding',
    setupMode: 'official-api-key',
    api: 'anthropic-messages',
    apiKeyEnv: 'KIMI_API_KEY',
    baseUrl: 'https://api.kimi.com/coding',
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
  mcp: 'MCP',
  browser: '浏览器能力',
  http: 'HTTP 接口',
  command: '本地命令',
  other: '其他',
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

function getFileExtension(fileName: string): string {
  const extension = fileName.split('.').pop();
  return extension ? extension.toLowerCase() : '';
}

function isTextAttachment(file: File): boolean {
  if (file.type.startsWith('text/')) {
    return true;
  }
  return textAttachmentExtensions.has(getFileExtension(file.name));
}

function isPdfAttachment(file: File): boolean {
  return file.type === 'application/pdf' || getFileExtension(file.name) === 'pdf';
}

function getFileSourcePath(file: File): string | undefined {
  const candidate = window.windowsClient.getFilePath(file) || (file as File & { path?: string }).path;
  return candidate?.trim() || undefined;
}

async function createComposerAttachment(file: File): Promise<ComposerAttachment> {
  const sourcePath = getFileSourcePath(file);
  if (file.type.startsWith('image/')) {
    return {
      id: crypto.randomUUID(),
      name: file.name || 'pasted-image',
      type: file.type || 'image/*',
      size: file.size,
      kind: 'image',
      truncated: false,
      readable: Boolean(sourcePath),
      sourcePath,
    };
  }

  if (isTextAttachment(file)) {
    return {
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type || 'text/plain',
      size: file.size,
      kind: 'text',
      truncated: false,
      readable: Boolean(sourcePath),
      sourcePath,
    };
  }

  if (isPdfAttachment(file)) {
    return {
      id: crypto.randomUUID(),
      name: file.name,
      type: 'application/pdf',
      size: file.size,
      kind: 'document',
      truncated: false,
      readable: Boolean(sourcePath),
      sourcePath,
    };
  }

  return {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    kind: 'file',
    truncated: false,
    readable: false,
    sourcePath,
  };
}

function formatAttachmentForPrompt(attachment: ComposerAttachment, index: number): string {
  const header = `Attachment ${index + 1}: ${attachment.name} (${attachment.type || 'unknown'}, ${formatBytes(attachment.size)})`;
  const sourcePathLine = attachment.sourcePath
    ? `\npath: ${attachment.sourcePath}`
    : '\npath: unavailable';
  if (attachment.kind === 'image') {
    return `${header}${sourcePathLine}\nkind: image\ncontent: not inlined. No image payload was sent to the model.`;
  }
  if (attachment.kind === 'text') {
    return `${header}${sourcePathLine}\nkind: text\ncontent: not inlined. Use the available path and existing Pi tools such as read when the task needs file contents.`;
  }
  if (attachment.kind === 'document') {
    return `${header}${sourcePathLine}\nkind: document\ncontent: not inlined. Use the available path and existing Pi tools/commands to inspect or extract document text when needed.`;
  }
  return `${header}${sourcePathLine}\nkind: file\ncontent: not inlined. If a path is present, use existing Pi tools/commands when the task needs this file.`;
}

function buildMessageWithAttachments(message: string, attachments: ComposerAttachment[], workspacePath: string | null): string {
  if (attachments.length === 0) {
    return message;
  }
  return [
    message,
    '',
    '<client_attachment_manifest>',
    'The user attached files to this conversation. Treat this as internal context and do not repeat the manifest verbatim to the user.',
    'Only attachment metadata is provided here. The client did not inline attachment contents or send image payloads to the model.',
    'Use existing Pi tools such as read and bash to inspect attached files by absolute path when the task needs file contents.',
    'Do not require a workspace merely to read or analyze an attached file. Workspace selection is only needed when no output location can be inferred or when writing files requires a target directory.',
    'If the user asks to write output in the same directory as an attachment and that attachment has a path, use the attachment path directory as the intended output directory.',
    `Current workspace: ${workspacePath ?? 'not selected'}`,
    '',
    attachments.map((attachment, index) => formatAttachmentForPrompt(attachment, index)).join('\n\n'),
    '</client_attachment_manifest>',
  ].join('\n');
}

function buildTranscriptMessageWithAttachments(message: string, attachments: ComposerAttachment[]): string {
  return message || (attachments.length > 0 ? '已发送附件' : '');
}

function toConversationAttachmentMeta(attachment: ComposerAttachment): ConversationAttachmentMeta {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.type,
    size: attachment.size,
    kind: attachment.kind,
    sourcePath: attachment.sourcePath,
    readable: attachment.readable,
    truncated: attachment.truncated,
    previewDataUrl: attachment.previewDataUrl,
  };
}

function createCapabilityId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `capability-${Date.now()}`;
}

function createCapabilityConfig(): CapabilityConfig {
  const createdAt = new Date().toISOString();
  return {
    id: createCapabilityId(),
    createdAt,
    updatedAt: createdAt,
    name: '未命名能力',
    type: 'tool',
    toolName: '',
    category: '',
    description: '',
    useWhen: '',
    avoidWhen: '',
    content: '',
    advancedConfig: '',
    triggerMode: 'agent',
    executionMode: 'http',
    endpoint: '',
    httpMethod: 'POST',
    httpBodyType: 'json',
    httpContentType: 'application/json',
    httpQueryParamsJson: '',
    httpAuthType: 'none',
    httpAuthHeaderName: 'Authorization',
    httpAuthTokenEnv: '',
    httpAuthTokenValue: '',
    command: '',
    mcpServerName: '',
    mcpUrl: '',
    mcpTransport: 'stream-http',
    mcpAuthType: 'none',
    mcpApiKeyValue: '',
    mcpHeadersJson: '',
    mcpTools: [],
    browserMode: 'builtin',
    workingDirectory: '',
    tokenEnv: '',
    headersJson: '',
    inputSchemaJson: '',
    outputSchemaJson: '',
    resultFormat: 'text',
    resultMapping: '',
    costPolicy: 'free',
    requiresConfirmation: false,
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
    rules: {
      role: '',
      goals: '',
      process: '',
      outputFormat: '',
      constraints: '',
      terminology: '',
    },
    taskTemplates: [],
    knowledgeItems: [],
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

function createAgentKnowledgeItem(type: AgentKnowledgeItem['type'] = 'text'): AgentKnowledgeItem {
  return {
    id: crypto.randomUUID(),
    title: '',
    type,
    overview: '',
    content: '',
    filePath: '',
  };
}

function createAgentTaskTemplate(): AgentTaskTemplate {
  return {
    id: crypto.randomUUID(),
    name: '未命名常规任务',
    description: '',
    prompt: '',
    expectedInputs: '',
    enabled: true,
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

function requiredLabel(label: string): ReactElement {
  return (
    <>
      {label} <span className="required-star">*</span>
    </>
  );
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

function getKnowledgeSummary(item: AgentKnowledgeItem): string {
  return item.type === 'document' ? item.overview : item.content;
}

function truncateInlineText(value: string, maxLength = 120): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function formatKnowledgeContextPreview(items: AgentKnowledgeItem[] | undefined): string[] {
  if (!items?.length) {
    return ['知识：未配置'];
  }
  return [
    '知识：',
    ...items.map((item) => {
      if (item.type === 'document') {
        return `- ${item.title || '未命名知识'}（文档）：路径：${item.filePath || '未选择'}；概述：${item.overview || '未填写'}`;
      }
      return `- ${item.title || '未命名知识'}（纯文本）：\n${item.content || '未填写'}`;
    }),
  ];
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

function formatLocalTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function getAuditStartTime(entry: AuditLogEntry): string {
  return entry.operationStartedAt ?? entry.timestamp;
}

function getAuditEndTime(entry: AuditLogEntry): string | null {
  if (!entry.operationEndedAt || entry.operationEndedAt === getAuditStartTime(entry)) {
    return null;
  }
  return entry.operationEndedAt;
}

function getAuditContent(entry: AuditLogEntry): string {
  return entry.outputSummary ?? entry.inputSummary ?? entry.errorMessage ?? entry.toolName;
}

function getAuditFullContent(entry: AuditLogEntry): string {
  const sections: string[] = [];
  const input = entry.fullInput ?? entry.inputSummary;
  const output = entry.fullOutput ?? entry.outputSummary;
  if (input) {
    sections.push(`输入：\n${input}`);
  }
  if (output) {
    sections.push(`输出：\n${output}`);
  }
  if (entry.errorMessage) {
    sections.push(`错误：\n${entry.errorMessage}`);
  }
  return sections.join('\n\n') || entry.toolName;
}

function hasAuditFullContent(entry: AuditLogEntry): boolean {
  return Boolean(entry.fullInput || entry.fullOutput || entry.errorMessage);
}

function getAuditContentPreview(content: string): string {
  return content.length > auditContentPreviewMaxLength
    ? `${content.slice(0, auditContentPreviewMaxLength).trimEnd()}...`
    : content;
}

function getAuditEntryLogFilePath(logsDirectory: string | null, entry: AuditLogEntry): string | null {
  if (!logsDirectory) {
    return null;
  }
  const separator = logsDirectory.includes('\\') ? '\\' : '/';
  const base = logsDirectory.endsWith('\\') || logsDirectory.endsWith('/') ? logsDirectory.slice(0, -1) : logsDirectory;
  return `${base}${separator}audit-${entry.timestamp.slice(0, 10)}.jsonl`;
}

function getMessageAnchorId(conversationId: string, messageIndex: number): string {
  return `${conversationId}:${messageIndex}`;
}

function renderHighlightedText(text: string, query: string): ReactElement {
  const segments = highlightSearchText(text, query);

  return (
    <>
      {segments.map((segment, index) =>
        segment.matched ? (
          <mark className="search-highlight" key={`${segment.text}-${index}`}>
            {segment.text}
          </mark>
        ) : (
          <span key={`${segment.text}-${index}`}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function isSafeMarkdownUrl(value: string): boolean {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return false;
  }
  if (trimmedValue.startsWith('#') || trimmedValue.startsWith('/')) {
    return true;
  }
  try {
    const url = new URL(trimmedValue);
    return ['http:', 'https:', 'mailto:', 'file:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function getMarkdownText(token: Token): string {
  if ('text' in token && typeof token.text === 'string') {
    return token.text;
  }
  if ('raw' in token && typeof token.raw === 'string') {
    return token.raw;
  }
  return '';
}

function renderMarkdownText(text: string, key: string, searchQuery?: string): ReactNode {
  if (!searchQuery) {
    return text;
  }
  return <span key={key}>{renderHighlightedText(text, searchQuery)}</span>;
}

function getTextAlign(align: Tokens.TableCell['align']): CSSProperties | undefined {
  return align ? { textAlign: align } : undefined;
}

function renderMarkdownHeading(token: Tokens.Heading, key: string, searchQuery?: string): ReactElement {
  const children = renderMarkdownInlineTokens(token.tokens, key, searchQuery);
  switch (Math.min(Math.max(token.depth, 1), 6)) {
    case 1:
      return <h1 key={key}>{children}</h1>;
    case 2:
      return <h2 key={key}>{children}</h2>;
    case 3:
      return <h3 key={key}>{children}</h3>;
    case 4:
      return <h4 key={key}>{children}</h4>;
    case 5:
      return <h5 key={key}>{children}</h5>;
    default:
      return <h6 key={key}>{children}</h6>;
  }
}

function MarkdownCodeBlock({ code, language }: { code: string; language?: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const copyCode = async (): Promise<void> => {
    await navigator.clipboard?.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-toolbar">
        <span>{language || 'text'}</span>
        <button className="markdown-copy-button" type="button" onClick={copyCode}>
          <Copy size={14} />
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderMarkdownInlineTokens(tokens: Token[] | undefined, keyPrefix: string, searchQuery?: string): ReactNode[] {
  if (!tokens || tokens.length === 0) {
    return [];
  }

  return tokens.flatMap((token, index): ReactNode[] => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case 'text':
      case 'escape':
        return [renderMarkdownText(getMarkdownText(token), key, searchQuery)];
      case 'strong':
        return [<strong key={key}>{renderMarkdownInlineTokens(token.tokens, key, searchQuery)}</strong>];
      case 'em':
        return [<em key={key}>{renderMarkdownInlineTokens(token.tokens, key, searchQuery)}</em>];
      case 'del':
        return [<del key={key}>{renderMarkdownInlineTokens(token.tokens, key, searchQuery)}</del>];
      case 'codespan':
        return [<code key={key}>{token.text}</code>];
      case 'br':
        return [<br key={key} />];
      case 'link': {
        if (!isSafeMarkdownUrl(token.href)) {
          return [renderMarkdownText(token.text, key, searchQuery)];
        }
        return [
          <a href={token.href} key={key} rel="noreferrer" target="_blank" title={token.title ?? undefined}>
            {renderMarkdownInlineTokens(token.tokens, key, searchQuery)}
          </a>,
        ];
      }
      case 'image': {
        if (!isSafeMarkdownUrl(token.href)) {
          return [renderMarkdownText(token.text, key, searchQuery)];
        }
        return [<img alt={token.text} className="markdown-image" key={key} src={token.href} title={token.title ?? undefined} />];
      }
      case 'html':
        return [renderMarkdownText(token.raw, key, searchQuery)];
      default:
        return [renderMarkdownText(getMarkdownText(token), key, searchQuery)];
    }
  });
}

function renderMarkdownBlocks(tokens: Token[], searchQuery?: string): ReactNode[] {
  return tokens.flatMap((token, index): ReactNode[] => {
    const key = `markdown-block-${index}`;
    switch (token.type) {
      case 'space':
        return [];
      case 'paragraph': {
        const paragraph = token as Tokens.Paragraph;
        return [<p key={key}>{renderMarkdownInlineTokens(paragraph.tokens, key, searchQuery)}</p>];
      }
      case 'heading':
        return [renderMarkdownHeading(token as Tokens.Heading, key, searchQuery)];
      case 'blockquote': {
        const blockquote = token as Tokens.Blockquote;
        return [<blockquote key={key}>{renderMarkdownBlocks(blockquote.tokens, searchQuery)}</blockquote>];
      }
      case 'list': {
        const list = token as Tokens.List;
        const ListTag = list.ordered ? 'ol' : 'ul';
        return [
          <ListTag key={key} start={list.ordered && list.start ? list.start : undefined}>
            {list.items.map((item: Tokens.ListItem, itemIndex: number) => (
              <li key={`${key}-${itemIndex}`}>
                {item.task && <input checked={Boolean(item.checked)} disabled readOnly type="checkbox" />}
                {renderMarkdownBlocks(item.tokens, searchQuery)}
              </li>
            ))}
          </ListTag>,
        ];
      }
      case 'code': {
        const code = token as Tokens.Code;
        return [<MarkdownCodeBlock code={code.text} key={key} language={code.lang} />];
      }
      case 'hr':
        return [<hr key={key} />];
      case 'table': {
        const table = token as Tokens.Table;
        return [
          <div className="markdown-table-wrap" key={key}>
            <table>
              <thead>
                <tr>
                  {table.header.map((cell: Tokens.TableCell, cellIndex: number) => (
                    <th key={`${key}-head-${cellIndex}`} style={getTextAlign(cell.align)}>
                      {renderMarkdownInlineTokens(cell.tokens, `${key}-head-${cellIndex}`, searchQuery)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row: Tokens.TableCell[], rowIndex: number) => (
                  <tr key={`${key}-row-${rowIndex}`}>
                    {row.map((cell: Tokens.TableCell, cellIndex: number) => (
                      <td key={`${key}-cell-${rowIndex}-${cellIndex}`} style={getTextAlign(cell.align)}>
                        {renderMarkdownInlineTokens(cell.tokens, `${key}-cell-${rowIndex}-${cellIndex}`, searchQuery)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        ];
      }
      case 'html':
        return [<p key={key}>{token.raw}</p>];
      default:
        return [<p key={key}>{renderMarkdownText(getMarkdownText(token), key, searchQuery)}</p>];
    }
  });
}

function MarkdownMessage({ text, searchQuery }: { text: string; searchQuery?: string }): ReactElement {
  const tokens = useMemo(() => marked.lexer(text, { breaks: true, gfm: true }), [text]);
  return <div className="markdown-message">{renderMarkdownBlocks(tokens, searchQuery)}</div>;
}

function AttachmentList({ attachments }: { attachments?: ConversationAttachmentMeta[] }): ReactElement | null {
  if (!attachments || attachments.length === 0) {
    return null;
  }
  return (
    <div className="message-attachment-list">
      {attachments.map((attachment) => (
        <details className="message-attachment-card" key={attachment.id}>
          <summary>
            {attachment.previewDataUrl ? (
              <img src={attachment.previewDataUrl} alt="" className="message-attachment-preview" />
            ) : (
              <FileText size={18} />
            )}
            <span className="message-attachment-main">
              <strong>{attachment.name}</strong>
              <small>
                {formatBytes(attachment.size)} ·{' '}
                {attachment.sourcePath ? '有本地路径' : attachment.readable ? '内容已随消息提供' : '仅记录附件'}
                {attachment.truncated ? ' · 已截断' : ''}
              </small>
            </span>
          </summary>
          <dl>
            <div>
              <dt>类型</dt>
              <dd>{attachment.mimeType || 'unknown'}</dd>
            </div>
            <div>
              <dt>来源路径</dt>
              <dd>{attachment.sourcePath || '无本地路径'}</dd>
            </div>
          </dl>
        </details>
      ))}
    </div>
  );
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
    archivedAt: null,
    session: null,
    transcript: [],
    draftMessage: '',
    workspace: { path: null, selectedAt: null },
  };
}

function conversationFromStoredConversation(conversation: StoredAgentConversation): AgentConversationState {
  return {
    ...conversation,
    session: null,
    archivedAt: conversation.archivedAt ?? null,
    transcript: conversation.transcript.map((item) => ({ ...item })),
    workspace: { ...conversation.workspace },
  };
}

function conversationToStoredConversation(conversation: AgentConversationState): StoredAgentConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    archivedAt: conversation.archivedAt,
    transcript: conversation.transcript.map((item) => ({ ...item })),
    draftMessage: conversation.draftMessage,
    workspace: { ...conversation.workspace },
  };
}

function createConversationStoreState(
  conversationsByAgentId: Record<string, AgentConversationState[]>,
  activeConversationIdsByAgentId: Record<string, string>,
): ConversationStoreState {
  return {
    conversationsByAgentId: Object.fromEntries(
      Object.entries(conversationsByAgentId).map(([agentId, conversations]) => [
        agentId,
        conversations.map((conversation) => conversationToStoredConversation(conversation)),
      ]),
    ),
    activeConversationIdsByAgentId,
    updatedAt: new Date().toISOString(),
  };
}

function createConversationTitleFromMessage(message: string): string {
  const compactMessage = message.replace(/\s+/g, ' ').trim();
  if (!compactMessage) {
    return '新的会话';
  }
  return compactMessage.length > 24 ? `${compactMessage.slice(0, 24)}...` : compactMessage;
}

function isDefaultConversationTitle(title: string, agent: AgentConfig): boolean {
  return title === `${agent.name} 会话` || title === '新的会话' || title.trim() === '';
}

function getConversationDisplayTitle(conversation: AgentConversationState, agent: AgentConfig | null): string {
  if (!agent || !isDefaultConversationTitle(conversation.title, agent)) {
    return conversation.title || '新对话';
  }
  const firstUserMessage = conversation.transcript.find((item) => item.role === 'user')?.text;
  return firstUserMessage ? createConversationTitleFromMessage(firstUserMessage) : '新对话';
}

function hydrateModelAgentUsage(model: ModelProfileConfig, agents: AgentConfig[]): ModelProfileConfig {
  return {
    ...model,
    usedByAgentIds: agents.filter((agent) => agent.modelIds.includes(model.id)).map((agent) => agent.id),
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
  const [auditTimeRangeLocked, setAuditTimeRangeLocked] = useState(false);
  const [expandedAuditEntry, setExpandedAuditEntry] = useState<AuditLogEntry | null>(null);
  const [statusText, setStatusText] = useState('就绪');
  const [agentNotice, setAgentNotice] = useState<LocalNotice | null>(null);
  const [configNotice, setConfigNotice] = useState<LocalNotice | null>(null);
  const [modelEditorNotice, setModelEditorNotice] = useState<LocalNotice | null>(null);
  const [activeSection, setActiveSection] = useState<'workbench' | 'search' | 'workspace' | 'agent' | 'config' | 'logs' | 'billing'>(
    'workbench',
  );
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [conversationRevision, setConversationRevision] = useState(0);
  const conversationStoreLoadedRef = useRef(false);
  const [startingConversationId, setStartingConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchAgentId, setSearchAgentId] = useState('');
  const [searchNavigationTarget, setSearchNavigationTarget] = useState<SearchNavigationTarget | null>(null);
  const agentConversationsRef = useRef<Record<string, AgentConversationState[]>>({});
  const activeConversationIdsRef = useRef<Record<string, string>>({});
  const manualStoppedConversationIdsRef = useRef<Set<string>>(new Set());
  const messageElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [activeConfigTab, setActiveConfigTab] = useState<'agents' | 'models' | 'core' | 'capabilities' | 'archived'>(
    'models',
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [modelEditorSetAsDefault, setModelEditorSetAsDefault] = useState(false);
  const [modelProviderSelectOverride, setModelProviderSelectOverride] = useState<string | null>(null);
  const [modelPage, setModelPage] = useState(1);
  const [modelPageInput, setModelPageInput] = useState('1');
  const [capabilityFilters, setCapabilityFilters] = useState({
    type: '',
    executionMode: '',
    status: '',
    triggerMode: '',
  });
  const [capabilityEditor, setCapabilityEditor] = useState<CapabilityConfig | null>(null);
  const [capabilityPage, setCapabilityPage] = useState(1);
  const [capabilityPageInput, setCapabilityPageInput] = useState('1');
  const [agentPage, setAgentPage] = useState(1);
  const [agentPageInput, setAgentPageInput] = useState('1');
  const [archivedConversationPage, setArchivedConversationPage] = useState(1);
  const [archivedConversationPageInput, setArchivedConversationPageInput] = useState('1');
  const [auditPageInput, setAuditPageInput] = useState('1');
  const [agentEditor, setAgentEditor] = useState<AgentConfig | null>(null);
  const [agentKnowledgeEditor, setAgentKnowledgeEditor] = useState<AgentKnowledgeItem | null>(null);
  const [agentKnowledgeViewer, setAgentKnowledgeViewer] = useState<AgentKnowledgeItem | null>(null);
  const [conversationMenuId, setConversationMenuId] = useState<string | null>(null);
  const [renamingConversation, setRenamingConversation] = useState<AgentConversationState | null>(null);
  const [renameConversationTitle, setRenameConversationTitle] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [openAppMenu, setOpenAppMenu] = useState<AppMenuName | null>(null);
  const [attachmentsByConversationId, setAttachmentsByConversationId] = useState<Record<string, ComposerAttachment[]>>({});
  const composerFileInputRef = useRef<HTMLInputElement | null>(null);
  const knowledgeFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void refreshInitialState();
  }, []);

  useEffect(() => {
    if (!openAppMenu) {
      return;
    }

    const closeMenu = (): void => setOpenAppMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [openAppMenu]);

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

  const modelTotalPages = Math.max(1, Math.ceil(filteredModels.length / modelPageSize));
  const pagedModels = useMemo(() => {
    const safePage = Math.min(modelPage, modelTotalPages);
    return filteredModels.slice((safePage - 1) * modelPageSize, safePage * modelPageSize);
  }, [filteredModels, modelPage, modelTotalPages]);
  const capabilityTotalPages = Math.max(1, Math.ceil(filteredCapabilities.length / capabilityPageSize));
  const pagedCapabilities = useMemo(() => {
    const safePage = Math.min(capabilityPage, capabilityTotalPages);
    return filteredCapabilities.slice((safePage - 1) * capabilityPageSize, safePage * capabilityPageSize);
  }, [capabilityPage, capabilityTotalPages, filteredCapabilities]);

  const agentTotalPages = Math.max(1, Math.ceil((draftConfig?.agents.length ?? 0) / agentPageSize));
  const pagedAgents = useMemo(() => {
    const agents = draftConfig?.agents ?? [];
    const safePage = Math.min(agentPage, agentTotalPages);
    return agents.slice((safePage - 1) * agentPageSize, safePage * agentPageSize);
  }, [agentPage, agentTotalPages, draftConfig?.agents]);

  useEffect(() => {
    setModelPage(1);
    setModelPageInput('1');
  }, [modelFilters]);

  useEffect(() => {
    if (modelPage > modelTotalPages) {
      setModelPage(modelTotalPages);
      setModelPageInput(String(modelTotalPages));
    }
  }, [modelPage, modelTotalPages]);

  useEffect(() => {
    setCapabilityPage(1);
    setCapabilityPageInput('1');
  }, [capabilityFilters]);

  useEffect(() => {
    if (capabilityPage > capabilityTotalPages) {
      setCapabilityPage(capabilityTotalPages);
      setCapabilityPageInput(String(capabilityTotalPages));
    }
  }, [capabilityPage, capabilityTotalPages]);

  useEffect(() => {
    if (agentPage > agentTotalPages) {
      setAgentPage(agentTotalPages);
      setAgentPageInput(String(agentTotalPages));
    }
  }, [agentPage, agentTotalPages]);

  const primaryAgents = useMemo(
    () => (draftConfig?.agents ?? []).filter((agent) => agent.type === 'primary' && agent.enabled),
    [draftConfig?.agents],
  );

  const searchableConversations = useMemo<SearchableConversation[]>(() => {
    const agentNameById = new Map((draftConfig?.agents ?? []).map((agent) => [agent.id, agent.name]));
    return Object.entries(agentConversationsRef.current).flatMap(([agentId, conversations]) =>
      conversations.map((conversation) => ({
        agentId,
        agentName: agentNameById.get(agentId) ?? '未命名智能体',
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        updatedAt: conversation.updatedAt,
        transcript: conversation.transcript.map((item) => ({ ...item })),
      })),
    );
  }, [draftConfig?.agents, conversationRevision]);

  const archivedConversations = useMemo(() => {
    const agentNameById = new Map((draftConfig?.agents ?? []).map((agent) => [agent.id, agent.name]));
    return Object.entries(agentConversationsRef.current)
      .flatMap(([agentId, conversations]) =>
        conversations
          .filter((conversation) => conversation.archivedAt)
          .map((conversation) => ({
            agentId,
            agentName: agentNameById.get(agentId) ?? '未命名智能体',
            conversation,
          })),
      )
      .sort((first, second) =>
        (second.conversation.archivedAt ?? second.conversation.updatedAt).localeCompare(
          first.conversation.archivedAt ?? first.conversation.updatedAt,
        ),
      );
  }, [draftConfig?.agents, conversationRevision]);

  const archivedConversationTotalPages = Math.max(
    1,
    Math.ceil(archivedConversations.length / archivedConversationPageSize),
  );
  const pagedArchivedConversations = useMemo(() => {
    const safePage = Math.min(archivedConversationPage, archivedConversationTotalPages);
    return archivedConversations.slice(
      (safePage - 1) * archivedConversationPageSize,
      safePage * archivedConversationPageSize,
    );
  }, [archivedConversationPage, archivedConversationTotalPages, archivedConversations]);

  useEffect(() => {
    if (archivedConversationPage > archivedConversationTotalPages) {
      setArchivedConversationPage(archivedConversationTotalPages);
      setArchivedConversationPageInput(String(archivedConversationTotalPages));
    }
  }, [archivedConversationPage, archivedConversationTotalPages]);

  const searchableAgentOptions = useMemo(() => {
    const agentSummaries = new Map<string, { id: string; name: string; conversationCount: number }>();
    for (const conversation of searchableConversations) {
      const existing = agentSummaries.get(conversation.agentId);
      if (existing) {
        existing.conversationCount += 1;
        continue;
      }
      agentSummaries.set(conversation.agentId, {
        id: conversation.agentId,
        name: conversation.agentName,
        conversationCount: 1,
      });
    }
    return [...agentSummaries.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  }, [searchableConversations]);

  const filteredSearchConversations = useMemo(
    () =>
      searchAgentId
        ? searchableConversations.filter((conversation) => conversation.agentId === searchAgentId)
        : searchableConversations,
    [searchAgentId, searchableConversations],
  );

  const searchResults = useMemo(
    () => searchConversations(searchQuery, filteredSearchConversations),
    [filteredSearchConversations, searchQuery],
  );

  useEffect(() => {
    if (searchAgentId && !searchableAgentOptions.some((agent) => agent.id === searchAgentId)) {
      setSearchAgentId('');
    }
  }, [searchAgentId, searchableAgentOptions]);

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
  const composerAttachments = attachmentsByConversationId[selectedConversation.id] ?? [];
  const sessionReady = Boolean(session && session.state !== 'stopped');
  const sessionStarting = startingConversationId === selectedConversation.id;
  const selectedAgentConversations = selectedAgent
    ? (agentConversationsRef.current[selectedAgent.id] ?? [selectedConversation]).filter(
        (conversation) => !conversation.archivedAt,
      )
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
      selectedConversation.archivedAt ||
      sessionReady ||
      sessionStarting ||
      manualStoppedConversationIdsRef.current.has(selectedConversation.id)
    ) {
      return;
    }

    void startSession({ silent: true });
  }, [selectedAgent?.id, selectedConversation.id, selectedConversation.archivedAt, sessionReady, sessionStarting]);

  useEffect(() => {
    if (
      !searchNavigationTarget ||
      activeSection !== 'workbench' ||
      searchNavigationTarget.conversationId !== selectedConversation.id
    ) {
      return;
    }

    const anchorId = getMessageAnchorId(searchNavigationTarget.conversationId, searchNavigationTarget.messageIndex);
    const timer = window.setTimeout(() => {
      const targetElement = messageElementRefs.current[anchorId];
      targetElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeSection, searchNavigationTarget, selectedConversation.id, transcript.length]);

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
    persistConversationStore();
    setConversationRevision((revision) => revision + 1);
  }

  function persistConversationStore(): void {
    if (!conversationStoreLoadedRef.current) {
      return;
    }

    const store = createConversationStoreState(agentConversationsRef.current, activeConversationIdsRef.current);
    void window.windowsClient.saveConversationStore(store);
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
    persistConversationStore();
    setAgentNotice(null);
    setConversationRevision((revision) => revision + 1);
  }

  function openRenameConversation(conversation: AgentConversationState): void {
    setConversationMenuId(null);
    setRenamingConversation(conversation);
    setRenameConversationTitle(getConversationDisplayTitle(conversation, selectedAgent));
  }

  function saveConversationRename(): void {
    if (!selectedAgent || !renamingConversation) {
      return;
    }
    const nextTitle = renameConversationTitle.trim();
    if (!nextTitle) {
      setAgentNotice({ tone: 'error', text: '会话名称不能为空。' });
      return;
    }
    if (nextTitle.length > maxConversationTitleLength) {
      setAgentNotice({ tone: 'error', text: `会话名称不能超过 ${maxConversationTitleLength} 个字符。` });
      return;
    }
    commitAgentConversation(selectedAgent.id, {
      ...renamingConversation,
      title: nextTitle,
    });
    setRenamingConversation(null);
    setRenameConversationTitle('');
    setAgentNotice({ tone: 'success', text: '会话名称已更新。' });
  }

  function archiveConversation(conversation: AgentConversationState): void {
    if (!selectedAgent) {
      return;
    }
    const agent = selectedAgent;
    requestConfirm({
      tone: 'default',
      title: '归档会话',
      message: `确认归档“${getConversationDisplayTitle(conversation, agent)}”？`,
      confirmLabel: '归档',
      onConfirm: () => {
        const agentConversations = agentConversationsRef.current[agent.id] ?? [];
        const nextConversation = {
          ...conversation,
          archivedAt: new Date().toISOString(),
        };
        const nextConversations = agentConversations.map((item) =>
          item.id === conversation.id ? nextConversation : item,
        );
        const nextActiveConversation =
          nextConversations.find((item) => !item.archivedAt && item.id !== conversation.id) ??
          createAgentConversation(agent);
        agentConversationsRef.current = {
          ...agentConversationsRef.current,
          [agent.id]: nextConversations.some((item) => item.id === nextActiveConversation.id)
            ? nextConversations
            : [nextActiveConversation, ...nextConversations],
        };
        activeConversationIdsRef.current = {
          ...activeConversationIdsRef.current,
          [agent.id]: nextActiveConversation.id,
        };
        setConversationMenuId(null);
        openSettings('archived');
        persistConversationStore();
        setConversationRevision((revision) => revision + 1);
      },
    });
  }

  function openArchivedConversation(agentId: string, conversationId: string): void {
    activeConversationIdsRef.current = {
      ...activeConversationIdsRef.current,
      [agentId]: conversationId,
    };
    selectedAgentIdRef.current = agentId;
    setSelectedAgentId(agentId);
    setActiveSection('workbench');
    setConversationRevision((revision) => revision + 1);
  }

  function openSearchResult(match: ConversationSearchMatch): void {
    activeConversationIdsRef.current = {
      ...activeConversationIdsRef.current,
      [match.agentId]: match.conversationId,
    };
    persistConversationStore();
    selectedAgentIdRef.current = match.agentId;
    setSelectedAgentId(match.agentId);
    setSearchNavigationTarget({
      matchId: match.id,
      agentId: match.agentId,
      conversationId: match.conversationId,
      messageIndex: match.messageIndex,
      query: searchQuery,
    });
    setAgentNotice(null);
    setActiveSection('workbench');
    setConversationRevision((revision) => revision + 1);
  }

  async function refreshInitialState(): Promise<void> {
    const initialAuditQuery = createDefaultAuditQuery();
    const [nextEnvironment, nextConfig, nextWorkspace, nextTools, nextAudit, nextConversationStore] = await Promise.all([
      window.windowsClient.getEnvironment(),
      window.windowsClient.getClientConfig(),
      window.windowsClient.getWorkspace(),
      window.windowsClient.listAvailableTools(),
      window.windowsClient.listAuditLogs(initialAuditQuery),
      window.windowsClient.getConversationStore(),
    ]);

    const nextConversations = Object.fromEntries(
      Object.entries(nextConversationStore.conversationsByAgentId).map(([agentId, conversations]) => [
        agentId,
        conversations
          .map((conversation) => conversationFromStoredConversation(conversation))
          .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt)),
      ]),
    );
    for (const agent of nextConfig.config.agents) {
      if (!nextConversations[agent.id]?.length) {
        nextConversations[agent.id] = [createAgentConversation(agent)];
      }
    }
    const nextActiveConversationIds = { ...nextConversationStore.activeConversationIdsByAgentId };
    for (const [agentId, conversations] of Object.entries(nextConversations)) {
      const latestConversation = conversations.find((conversation) => !conversation.archivedAt) ?? conversations[0];
      nextActiveConversationIds[agentId] = latestConversation?.id ?? '';
    }
    agentConversationsRef.current = nextConversations;
    activeConversationIdsRef.current = nextActiveConversationIds;
    conversationStoreLoadedRef.current = true;

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
    setConversationRevision((revision) => revision + 1);
    persistConversationStore();

    if (nextWorkspace.path) {
      await refreshWorkspaceFiles();
    }
  }

  async function loadAuditLogs(query: AuditLogQuery): Promise<void> {
    const nextQuery: AuditLogQuery = {
      ...query,
      limit: auditPageSize,
      offset: query.offset ?? 0,
    };
    const result = await window.windowsClient.listAuditLogs(nextQuery);
    setAuditQuery(nextQuery);
    setAuditEntries(sortAuditEntries(result.entries));
    setAuditPageInput(String(Math.floor((nextQuery.offset ?? 0) / auditPageSize) + 1));
    setAuditPath(result.logFilePath);
    setAuditRefreshedAt(new Date().toISOString());
    setAuditTotal(result.total);
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

  function commitLocalPageInput(
    value: string,
    totalPages: number,
    setPage: (page: number) => void,
    setInput: (value: string) => void,
  ): void {
    const parsedPage = Number.parseInt(value, 10);
    const nextPage = Number.isFinite(parsedPage)
      ? Math.min(Math.max(parsedPage, 1), totalPages)
      : 1;
    setPage(nextPage);
    setInput(String(nextPage));
  }

  function renderLocalPagination(options: {
    page: number;
    totalPages: number;
    totalItems: number;
    pageInput: string;
    setPage: (page: number) => void;
    setPageInput: (value: string) => void;
  }): ReactElement {
    return (
      <PaginationBar
        summary={`第 ${options.page} / ${options.totalPages} 页，共 ${options.totalItems} 条`}
        page={options.page}
        totalPages={options.totalPages}
        pageInput={options.pageInput}
        onPageInputChange={options.setPageInput}
        onPageInputCommit={() =>
          commitLocalPageInput(options.pageInput, options.totalPages, options.setPage, options.setPageInput)
        }
        onPrevious={() => {
          const nextPage = Math.max(1, options.page - 1);
          options.setPage(nextPage);
          options.setPageInput(String(nextPage));
        }}
        onNext={() => {
          const nextPage = Math.min(options.totalPages, options.page + 1);
          options.setPage(nextPage);
          options.setPageInput(String(nextPage));
        }}
      />
    );
  }

  async function goToAuditPage(page: number): Promise<void> {
    const auditTotalPages = Math.max(1, Math.ceil(auditTotal / auditPageSize));
    const nextPage = Math.min(Math.max(page, 1), auditTotalPages);
    setAuditPageInput(String(nextPage));
    await loadAuditLogs({ ...auditQuery, offset: (nextPage - 1) * auditPageSize });
  }

  async function commitAuditPageInput(): Promise<void> {
    const auditTotalPages = Math.max(1, Math.ceil(auditTotal / auditPageSize));
    const parsedPage = Number.parseInt(auditPageInput, 10);
    const nextPage = Number.isFinite(parsedPage)
      ? Math.min(Math.max(parsedPage, 1), auditTotalPages)
      : 1;
    await goToAuditPage(nextPage);
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
      knowledgeItems: agent.knowledgeItems
        .map((item) => ({
          ...item,
          title: item.title.trim(),
          overview: item.overview.trim(),
          content: item.type === 'text' ? item.content.trim() : item.content,
          filePath: item.type === 'document' ? item.filePath.trim() : '',
        }))
        .filter((item) =>
          item.title &&
          (item.type === 'document'
            ? item.overview.length > 0 && item.filePath.length > 0
            : item.content.length > 0),
        ),
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
    requestConfirm({
      tone: 'danger',
      title: '删除智能体',
      message: `确认删除“${agent.name}”？`,
      confirmLabel: '删除',
      onConfirm: async () => {
        const nextConfig = await window.windowsClient.deleteAgentConfig(id);
        setConfigState(nextConfig);
        setDraftConfig(nextConfig.config);
        setAgentEditor(null);
        setSelectedAgentId(nextConfig.config.defaultAgentId);
        setConfigNotice({ tone: 'success', text: `智能体已删除：${agent.name}` });
        setStatusText(`智能体已删除：${agent.name}`);
        await refreshAuditLogs();
      },
    });
  }

  async function syncModelAgentBindings(profile: ModelProfileConfig, setAsDefault: boolean): Promise<ClientConfigState> {
    if (!draftConfig) {
      throw new Error('Missing draft config');
    }
    let nextConfigState = await window.windowsClient.saveModelConfig({
      ...draftConfig.model,
      defaultModelId: setAsDefault || !draftConfig.model.defaultModelId ? profile.id : draftConfig.model.defaultModelId,
      models: draftConfig.model.models.some((model) => model.id === profile.id)
        ? draftConfig.model.models.map((model) => (model.id === profile.id ? profile : model))
        : [...draftConfig.model.models, profile],
    });

    const targetAgentIds = new Set(profile.usedByAgentIds);
    for (const agent of nextConfigState.config.agents) {
      const shouldUseModel = targetAgentIds.has(agent.id);
      const hasModel = agent.modelIds.includes(profile.id);
      if (shouldUseModel === hasModel) {
        continue;
      }
      const nextModelIds = shouldUseModel
        ? Array.from(new Set([...agent.modelIds, profile.id]))
        : agent.modelIds.filter((id) => id !== profile.id);
      const nextAgent: AgentConfig = {
        ...agent,
        modelIds: nextModelIds,
        defaultModelId:
          agent.defaultModelId && nextModelIds.includes(agent.defaultModelId)
            ? agent.defaultModelId
            : (nextModelIds[0] ?? null),
      };
      nextConfigState = await window.windowsClient.saveAgentConfig(nextAgent);
    }
    return nextConfigState;
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

    setStatusText(`正在保存模型：${normalizedProfile.displayName}`);
    const nextConfig = await syncModelAgentBindings(normalizedProfile, modelEditorSetAsDefault);
    setConfigState(nextConfig);
    setDraftConfig(nextConfig.config);
    closeModelEditor();
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
    requestConfirm({
      tone: enabled ? 'default' : 'danger',
      title: enabled ? '启用模型' : '停用模型',
      message: `${enabled ? '启用' : '停用'}“${profile.displayName || profile.modelId}”？`,
      confirmLabel: enabled ? '启用' : '停用',
      onConfirm: () => saveModelProfile({ ...profile, enabled }),
    });
  }

  function testModelConnection(profile: ModelProfileConfig): void {
    requestConfirm({
      tone: 'default',
      title: '测试模型联通',
      message: `将向“${profile.displayName || profile.modelId || profile.provider}”发送一条短测试消息。`,
      confirmLabel: '开始测试',
      onConfirm: () => runModelConnectionTest(profile),
    });
  }

  async function runModelConnectionTest(profile: ModelProfileConfig): Promise<void> {
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
    requestConfirm({
      tone: 'danger',
      title: '删除模型',
      message: `确认删除“${profile.displayName || profile.modelId || profile.id}”？删除后不能从客户端直接恢复。`,
      confirmLabel: '删除',
      onConfirm: async () => {
        setStatusText(`正在删除模型：${profile.displayName}`);
        const nextConfig = await window.windowsClient.deleteModelConfig(id);
        setConfigState(nextConfig);
        setDraftConfig(nextConfig.config);
        setConfigNotice({ tone: 'success', text: `模型已删除：${profile.displayName}` });
        setStatusText(`模型已删除：${profile.displayName}`);
        await refreshAuditLogs();
      },
    });
  }

  async function saveCapabilityConfig(capability: CapabilityConfig): Promise<void> {
    if (!capability.name.trim()) {
      setStatusText('业务能力名称不能为空');
      return;
    }
    if (!capability.description.trim()) {
      setStatusText('业务能力说明不能为空');
      return;
    }
    if (!capability.content.trim()) {
      setStatusText('能力内容不能为空，请粘贴能力说明、配置片段或使用要求');
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
    const hasTarget = Boolean(capability.content.trim() || capability.endpoint.trim() || capability.command.trim());
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

  function openModelEditor(profile: ModelProfileConfig): void {
    setModelEditorNotice(null);
    setModelProviderSelectOverride(null);
    setModelEditorSetAsDefault(
      draftConfig?.model.defaultModelId === profile.id || !draftConfig?.model.defaultModelId,
    );
    setModelEditor(profile);
  }

  function closeModelEditor(): void {
    setModelProviderSelectOverride(null);
    setModelEditor(null);
    setModelEditorSetAsDefault(false);
  }

  function openSettings(tab: typeof activeConfigTab = activeConfigTab): void {
    setActiveConfigTab(tab);
    setSettingsOpen(true);
  }

  function closeSettings(): void {
    setSettingsOpen(false);
  }

  function requestConfirm(dialog: ConfirmDialogState): void {
    setConfirmDialog(dialog);
  }

  async function confirmDialogAction(): Promise<void> {
    const dialog = confirmDialog;
    if (!dialog) {
      return;
    }
    setConfirmDialog(null);
    await dialog.onConfirm();
  }

  function applyProviderPreset(provider: string): void {
    setModelEditorNotice(null);
    setModelProviderSelectOverride(provider || null);
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

  function toggleModelAgent(agentId: string, checked: boolean): void {
    setModelEditor((model) => {
      if (!model) {
        return model;
      }
      return {
        ...model,
        usedByAgentIds: checked
          ? Array.from(new Set([...model.usedByAgentIds, agentId]))
          : model.usedByAgentIds.filter((id) => id !== agentId),
      };
    });
  }

  function updateCapabilityEditor<K extends keyof CapabilityConfig>(
    key: K,
    value: CapabilityConfig[K],
  ): void {
    setCapabilityEditor((capability) => (capability ? { ...capability, [key]: value } : capability));
  }

  function applyCapabilityType(type: CapabilityConfig['type']): void {
    const defaultExecutionModeByType: Record<CapabilityConfig['type'], CapabilityExecutionMode> = {
      tool: 'builtin',
      skill: 'manual',
      mcp: 'mcp',
      browser: 'builtin',
      http: 'http',
      command: 'command',
      other: 'manual',
    };
    setCapabilityEditor((capability) =>
      capability
        ? {
            ...capability,
            type,
            executionMode: defaultExecutionModeByType[type],
          }
        : capability,
    );
  }

  async function discoverMcpTools(capability: CapabilityConfig): Promise<void> {
    setStatusText(`正在发现 MCP 工具：${capability.name || capability.mcpServerName || capability.mcpUrl}`);
    const result = await window.windowsClient.discoverMcpTools(capability);
    setCapabilityEditor((current) =>
      current && current.id === capability.id
        ? {
            ...current,
            mcpTools: result.tools,
            connectionStatus: result.status,
            lastTestedAt: new Date().toISOString(),
          }
        : current,
    );
    setConfigNotice({ tone: result.status === 'success' ? 'success' : 'error', text: result.message });
    setStatusText(result.message);
  }

  function updateAgentEditor<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]): void {
    setAgentEditor((agent) => (agent ? { ...agent, [key]: value } : agent));
  }

  function updateAgentRule(key: keyof AgentRuleConfig, value: string): void {
    setAgentEditor((agent) =>
      agent
        ? {
            ...agent,
            rules: {
              ...agent.rules,
              [key]: value,
            },
          }
        : agent,
    );
  }

  function updateAgentTaskTemplate(
    templateId: string,
    patch: Partial<AgentTaskTemplate>,
  ): void {
    setAgentEditor((agent) =>
      agent
        ? {
            ...agent,
            taskTemplates: agent.taskTemplates.map((template) =>
              template.id === templateId ? { ...template, ...patch } : template,
            ),
          }
        : agent,
    );
  }

  function addAgentTaskTemplate(): void {
    setAgentEditor((agent) =>
      agent
        ? {
            ...agent,
            taskTemplates: [...agent.taskTemplates, createAgentTaskTemplate()],
          }
        : agent,
    );
  }

  function deleteAgentTaskTemplate(templateId: string): void {
    setAgentEditor((agent) =>
      agent
        ? {
            ...agent,
            taskTemplates: agent.taskTemplates.filter((template) => template.id !== templateId),
          }
        : agent,
    );
  }

  function addAgentKnowledgeItem(): void {
    setAgentKnowledgeEditor(createAgentKnowledgeItem());
  }

  function selectAgentKnowledgeFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const filePath = window.windowsClient.getFilePath(file);
    setAgentKnowledgeEditor((item) =>
      item
        ? {
            ...item,
            filePath,
            title: item.title || file.name,
          }
        : item,
    );
    event.target.value = '';
  }

  function saveAgentKnowledgeItem(item: AgentKnowledgeItem): void {
    const title = item.title.trim();
    const overview = item.overview.trim();
    const content = item.content.trim();
    const filePath = item.filePath.trim();
    if (!title) {
      setConfigNotice({ tone: 'error', text: '知识标题不能为空。' });
      return;
    }
    if (item.type === 'document' && !filePath) {
      setConfigNotice({ tone: 'error', text: '文档类型的知识需要选择本地文件。' });
      return;
    }
    if (item.type === 'document' && !overview) {
      setConfigNotice({ tone: 'error', text: '文档类型的知识需要填写概述。' });
      return;
    }
    if (item.type === 'text' && !content) {
      setConfigNotice({ tone: 'error', text: '纯文本类型的知识需要填写内容。' });
      return;
    }

    const normalizedItem: AgentKnowledgeItem = {
      ...item,
      title,
      overview,
      content: item.type === 'document' ? item.content : content,
      filePath: item.type === 'document' ? filePath : '',
    };
    setAgentEditor((agent) => {
      if (!agent) {
        return agent;
      }
      const exists = agent.knowledgeItems.some((knowledge) => knowledge.id === normalizedItem.id);
      return {
        ...agent,
        knowledgeItems: exists
          ? agent.knowledgeItems.map((knowledge) =>
              knowledge.id === normalizedItem.id ? normalizedItem : knowledge,
            )
          : [...agent.knowledgeItems, normalizedItem],
      };
    });
    setAgentKnowledgeEditor(null);
  }

  function deleteAgentKnowledgeItem(itemId: string): void {
    setAgentEditor((agent) =>
      agent
        ? {
            ...agent,
            knowledgeItems: agent.knowledgeItems.filter((item) => item.id !== itemId),
          }
        : agent,
    );
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

  function clearCurrentConversationAttachments(conversationId = selectedConversation.id): void {
    setAttachmentsByConversationId((current) => {
      if (!current[conversationId]) {
        return current;
      }
      const { [conversationId]: _removed, ...remaining } = current;
      return remaining;
    });
  }

  async function addComposerFiles(fileList: FileList | File[]): Promise<void> {
    const filesToAdd = Array.from(fileList);
    if (filesToAdd.length === 0) {
      return;
    }

    const availableSlots = maxComposerAttachments - composerAttachments.length;
    if (availableSlots <= 0) {
      setAgentNotice({ tone: 'error', text: `最多只能上传 ${maxComposerAttachments} 个文件。` });
      return;
    }

    const acceptedFiles = filesToAdd.slice(0, availableSlots);
    const skippedCount = filesToAdd.length - acceptedFiles.length;
    try {
      const nextAttachments = await Promise.all(acceptedFiles.map((file) => createComposerAttachment(file)));
      setAttachmentsByConversationId((current) => ({
        ...current,
        [selectedConversation.id]: [...(current[selectedConversation.id] ?? []), ...nextAttachments],
      }));
      setAgentNotice(
        skippedCount > 0
          ? {
              tone: 'info',
              text: `已添加 ${nextAttachments.length} 个文件；最多支持 ${maxComposerAttachments} 个，已忽略 ${skippedCount} 个。`,
            }
          : null,
      );
    } catch (error) {
      const message = error instanceof Error ? `读取附件失败：${error.message}` : '读取附件失败。';
      setAgentNotice({ tone: 'error', text: message });
    }
  }

  function removeComposerAttachment(attachmentId: string): void {
    setAttachmentsByConversationId((current) => ({
      ...current,
      [selectedConversation.id]: (current[selectedConversation.id] ?? []).filter((attachment) => attachment.id !== attachmentId),
    }));
  }

  function handleComposerFileInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const { files: selectedFiles } = event.target;
    if (selectedFiles) {
      void addComposerFiles(selectedFiles);
    }
    event.target.value = '';
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const pastedFiles = Array.from(event.clipboardData.files);
    if (pastedFiles.length === 0) {
      return;
    }
    event.preventDefault();
    void addComposerFiles(pastedFiles);
  }

  async function sendMessage(): Promise<void> {
    const message = draftMessage.trim();
    const messageAgent = selectedAgent;
    if ((!message && composerAttachments.length === 0) || !messageAgent) {
      return;
    }
    const attachmentsToSend = composerAttachments;
    const outboundMessage = buildMessageWithAttachments(message, attachmentsToSend, activeWorkspace.path);
    const transcriptMessage = buildTranscriptMessageWithAttachments(message, attachmentsToSend);
    const transcriptAttachments = attachmentsToSend.map((attachment) => toConversationAttachmentMeta(attachment));
    let messageSession = session;
    const messageConversation = selectedConversation;
    if (!messageSession || messageSession.state === 'stopped') {
      messageSession = await startSession({ silent: true });
      if (!messageSession) {
        return;
      }
    }

    const userItem: TranscriptItem = {
      role: 'user',
      text: transcriptMessage,
      createdAt: new Date().toISOString(),
      attachments: transcriptAttachments,
    };
    const userTranscript = [...transcript, userItem];
    const nextTitle =
      transcript.length === 0 && isDefaultConversationTitle(messageConversation.title, messageAgent)
        ? createConversationTitleFromMessage(message)
        : messageConversation.title;
    commitAgentConversation(messageAgent.id, {
      ...messageConversation,
      draftMessage: '',
      title: nextTitle,
      transcript: userTranscript,
    });
    clearCurrentConversationAttachments(messageConversation.id);
    setStatusText('正在通过适配器发送消息');

    const result = await window.windowsClient.sendAgentUserMessage(messageSession.id, outboundMessage);
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
      title: nextTitle,
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

  function applyTaskTemplate(templateId: string): void {
    const template = selectedAgentTaskTemplates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }
    const parts = [
      `常规任务：${template.name}`,
      template.description ? `任务说明：${template.description}` : '',
      template.expectedInputs ? `需要补充的信息或材料：${template.expectedInputs}` : '',
      '',
      template.prompt,
    ].filter(Boolean);
    saveCurrentConversation({
      draftMessage: parts.join('\n'),
      title: transcript.length === 0 ? template.name : sessionTitle,
    });
  }

  const canSend = Boolean(
    (draftMessage.trim() || composerAttachments.length > 0) &&
      selectedAgent &&
      !sessionStarting &&
      !selectedConversation.archivedAt,
  );
  const selectedAgentModel = draftConfig?.model.models.find((model) => model.id === selectedAgent?.defaultModelId);
  const selectedAgentCapabilities = draftConfig?.capabilities.filter((capability) =>
    selectedAgent?.capabilityIds.includes(capability.id),
  ) ?? [];
  const selectedAgentChildAgents = draftConfig?.agents.filter((agent) =>
    selectedAgent?.childAgentIds.includes(agent.id),
  ) ?? [];
  const selectedAgentTaskTemplates = selectedAgent?.taskTemplates.filter((template) => template.enabled) ?? [];
  const promptContextPreview = useMemo(() => {
    const capabilityNames = selectedAgentCapabilities.map((capability) => capability.name).filter(Boolean);
    const childAgentNames = selectedAgentChildAgents.map((agent) => agent.name).filter(Boolean);
    const taskNames = selectedAgentTaskTemplates.map((template) => template.name).filter(Boolean);
    return [
      `智能体：${selectedAgent?.name ?? '未选择'}`,
      `类型：${selectedAgent ? agentTypeLabels[selectedAgent.type] : '未选择'}`,
      `描述：${selectedAgent?.description || '未填写'}`,
      `角色定位：${selectedAgent?.rules.role || '未填写'}`,
      `工作目标：${selectedAgent?.rules.goals || '未填写'}`,
      `处理流程：${selectedAgent?.rules.process || '未填写'}`,
      `输出格式：${selectedAgent?.rules.outputFormat || '未填写'}`,
      `工作区：${activeWorkspace.path ?? '未选择'}`,
      `默认模型：${formatModelName(selectedAgentModel)}`,
      `绑定能力：${capabilityNames.length > 0 ? capabilityNames.join('、') : '未绑定'}`,
      `子智能体：${childAgentNames.length > 0 ? childAgentNames.join('、') : '未配置'}`,
      `常规任务：${taskNames.length > 0 ? taskNames.join('、') : '未配置'}`,
      ...formatKnowledgeContextPreview(selectedAgent?.knowledgeItems),
      selectedFile ? `当前预览文件：${selectedFile.relativePath}` : '当前预览文件：未选择',
      '项目指令：Pi 会根据当前工作区自动发现并读取 AGENTS.md、CLAUDE.md 等项目上下文文件。',
      '说明：这里展示会补充到 Pi system prompt 的产品配置摘要；Tools / Skills 只有接入为 Pi 工具后才会被真实调用。',
    ].join('\n');
  }, [
    activeWorkspace.path,
    selectedAgent,
    selectedAgentCapabilities,
    selectedAgentChildAgents,
    selectedAgentTaskTemplates,
    selectedAgentModel,
    selectedFile,
  ]);
  const modelEditorPreset = modelEditor ? findProviderPreset(modelEditor.provider) : undefined;
  const modelEditorRequirements = modelEditor
    ? getProviderRequirements(modelEditor)
    : { needsBaseUrl: false, needsApiKey: false };
  const modelProviderSelectValue =
    modelProviderSelectOverride ??
    (modelEditor
      ? modelEditorPreset
        ? modelEditorPreset.provider
        : modelEditor.provider
          ? '__custom__'
          : ''
      : '');
  const shouldShowCustomProviderId =
    modelEditor !== null && (modelProviderSelectValue === '__custom__' || isCustomProviderSelection(modelEditor.provider));
  const modelSuggestions = modelEditorPreset?.models ?? [];
  const capabilityEditorExists = Boolean(
    capabilityEditor && draftConfig?.capabilities.some((capability) => capability.id === capabilityEditor.id),
  );
  const activeSearchScopeName = searchAgentId
    ? searchableAgentOptions.find((agent) => agent.id === searchAgentId)?.name ?? '当前智能体'
    : '全部智能体';
  const appMenus: Record<AppMenuName, AppMenuItem[]> = {
    File: [
      { label: '新建对话', disabled: !selectedAgent, onSelect: createNewConversation },
      { label: '选择工作区', onSelect: chooseWorkspace },
      {
        label: '添加附件',
        disabled: composerAttachments.length >= maxComposerAttachments,
        onSelect: () => composerFileInputRef.current?.click(),
      },
    ],
    Edit: [
      {
        label: '清空输入',
        disabled: !draftMessage && composerAttachments.length === 0,
        onSelect: () => {
          saveCurrentConversation({ draftMessage: '' });
          clearCurrentConversationAttachments();
        },
      },
      { label: '清空附件', disabled: composerAttachments.length === 0, onSelect: () => clearCurrentConversationAttachments() },
    ],
    View: [
      { label: '工作台', onSelect: () => setActiveSection('workbench') },
      { label: '搜索', onSelect: () => setActiveSection('search') },
      { label: '运行日志', onSelect: () => setActiveSection('logs') },
      { label: contextPanelOpen ? '收起上下文' : '显示上下文', onSelect: () => setContextPanelOpen((open) => !open) },
    ],
    Window: [
      { label: sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏', onSelect: () => setSidebarCollapsed((collapsed) => !collapsed) },
      { label: '设置', onSelect: () => openSettings('models') },
    ],
    Help: [
      {
        label: environment ? `版本 ${environment.appVersion}` : '版本信息',
        onSelect: () => setAgentNotice({ tone: 'info', text: environmentLine }),
      },
    ],
  };

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <header className="app-chrome" aria-label="应用栏">
        <button
          type="button"
          className="sidebar-toggle-button"
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
          title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <div className="app-brand" aria-label="Aidocs Pro">
          <span className="app-brand-mark">A</span>
          <span className="app-brand-name">Aidocs Pro</span>
        </div>
        <nav className="app-menu" aria-label="应用菜单">
          {(Object.keys(appMenus) as AppMenuName[]).map((menuName) => (
            <div className="app-menu-item" key={menuName}>
              <button
                type="button"
                className={openAppMenu === menuName ? 'active' : ''}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenAppMenu((current) => (current === menuName ? null : menuName));
                }}
              >
                {menuName}
              </button>
              {openAppMenu === menuName && (
                <div className="app-menu-popover" onClick={(event) => event.stopPropagation()}>
                  {appMenus[menuName].map((item) => (
                    <button
                      type="button"
                      disabled={item.disabled}
                      key={item.label}
                      onClick={() => {
                        setOpenAppMenu(null);
                        void item.onSelect();
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </header>
      <aside className="global-sidebar" aria-label="司南导航">
        <div className="sidebar-actions">
          <button type="button" onClick={createNewConversation} disabled={!selectedAgent} title="新对话">
            <Plus size={16} />
            <span>新对话</span>
          </button>
          <button
            type="button"
            className={activeSection === 'search' ? 'active' : ''}
            onClick={() => setActiveSection('search')}
            title="搜索"
          >
            <Search size={16} />
            <span>搜索</span>
          </button>
          <button
            type="button"
            className={activeSection === 'logs' ? 'active' : ''}
            onClick={() => setActiveSection('logs')}
            title="运行日志"
          >
            <ListChecks size={16} />
            <span>运行日志</span>
          </button>
          <button
            type="button"
            className={activeSection === 'billing' ? 'active' : ''}
            onClick={() => setActiveSection('billing')}
            title="消费明细"
          >
            <FileText size={16} />
            <span>消费明细</span>
          </button>
        </div>

        <div className="sidebar-section-title">历史会话</div>
        <div className="sidebar-conversations">
          {selectedAgentConversations.length === 0 ? (
            <p className="sidebar-empty">当前智能体暂无历史会话</p>
          ) : (
            selectedAgentConversations.map((conversation) => (
              <div
                className={`sidebar-thread ${conversation.id === selectedConversation.id ? 'active' : ''}`}
                key={conversation.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  selectConversation(conversation.id);
                  setActiveSection('workbench');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectConversation(conversation.id);
                    setActiveSection('workbench');
                  }
                }}
              >
                <span>{getConversationDisplayTitle(conversation, selectedAgent)}</span>
                <small>{formatLocalTimestamp(conversation.updatedAt)}</small>
                <button
                  type="button"
                  className="sidebar-thread-menu-button"
                  aria-label="会话操作"
                  onClick={(event) => {
                    event.stopPropagation();
                    setConversationMenuId((current) => (current === conversation.id ? null : conversation.id));
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
                {conversationMenuId === conversation.id && (
                  <div className="sidebar-thread-menu" onClick={(event) => event.stopPropagation()}>
                    <button type="button" onClick={() => openRenameConversation(conversation)}>
                      重命名
                    </button>
                    <button type="button" onClick={() => archiveConversation(conversation)}>
                      归档
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <button type="button" className="sidebar-settings" onClick={() => openSettings('models')} title="设置">
          <Settings size={16} />
          <span>设置</span>
        </button>
      </aside>

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
          className={activeSection === 'search' ? 'active' : ''}
          onClick={() => setActiveSection('search')}
        >
          搜索
        </button>
        <button
          type="button"
          className={settingsOpen ? 'active' : ''}
          onClick={() => openSettings('models')}
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
        {activeSection === 'search' && (
          <article className="panel wide-panel search-panel">
            <div className="panel-heading">
              <Search size={20} />
              <h3>搜索</h3>
            </div>

            <div className="search-toolbar">
              <label className="search-input-wrap">
                <span>关键词</span>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="搜索用户消息或智能体回复，支持短语、关键词和模糊匹配"
                />
              </label>
              <label className="search-filter-wrap">
                <span>智能体范围</span>
                <select value={searchAgentId} onChange={(event) => setSearchAgentId(event.target.value)}>
                  <option value="">全部智能体</option>
                  {searchableAgentOptions.map((agent) => (
                    <option value={agent.id} key={agent.id}>
                      {agent.name} ({agent.conversationCount})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="search-summary">
              {!searchQuery.trim()
                ? `当前可检索 ${searchableConversations.length} 个会话，默认覆盖全部智能体；结果按短语命中、关键词覆盖和模糊相关度综合排序。`
                : `在 ${activeSearchScopeName} 中找到 ${searchResults.length} 条结果，已按相关性从高到低排序。`}
            </div>

            {searchableConversations.length === 0 ? (
              <p className="empty-state search-empty-state">当前还没有可搜索的对话内容。</p>
            ) : !searchQuery.trim() ? (
              <p className="empty-state search-empty-state">输入关键词后即可搜索用户内容和智能体回复。</p>
            ) : searchResults.length === 0 ? (
              <p className="empty-state search-empty-state">没有找到匹配结果，试试更短的关键词或更换智能体范围。</p>
            ) : (
              <div className="search-results">
                {searchResults.map((match) => (
                  <button
                    type="button"
                    className={`search-result-item ${searchNavigationTarget?.matchId === match.id ? 'active' : ''}`}
                    key={match.id}
                    onClick={() => openSearchResult(match)}
                  >
                    <div className="search-result-header">
                      <strong>{match.conversationTitle || '未命名会话'}</strong>
                      <small>{formatLocalTimestamp(match.createdAt)}</small>
                    </div>
                    <div className="search-result-meta">
                      <span>{match.agentName}</span>
                      <span>{match.role === 'user' ? '用户消息' : '智能体回复'}</span>
                    </div>
                    <p className="search-result-snippet">{renderHighlightedText(match.snippet, searchQuery)}</p>
                  </button>
                ))}
              </div>
            )}
          </article>
        )}

        {activeSection === 'billing' && (
          <article className="panel wide-panel">
            <div className="panel-heading">
              <FileText size={20} />
              <h3>消费明细</h3>
            </div>
            <p className="empty-state">消费明细暂未接入，后续会汇总会话 token、模型价格和工具调用用量。</p>
          </article>
        )}

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
              <div className="agent-tab-actions">
                <button
                  type="button"
                  className="quiet-button compact-button icon-only-button"
                  onClick={() => {
                    setAgentEditor(createAgentConfig());
                    setActiveConfigTab('agents');
                  }}
                  aria-label="新增智能体"
                  title="新增智能体"
                >
                  <Plus size={18} />
                </button>
              </div>
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
                  <div className="chat-header-main">
                    <span className="chat-header-label">工作区</span>
                    <strong>{activeWorkspace.path ?? '尚未选择工作区'}</strong>
                  </div>
                  <div className="chat-header-actions">
                    <button type="button" className="composer-tool-button" onClick={chooseWorkspace}>
                      <FolderOpen size={16} />
                      <span>工作区</span>
                    </button>
                    <button type="button" className="composer-tool-button" onClick={() => setContextPanelOpen(true)}>
                      <FileText size={16} />
                      <span>上下文</span>
                    </button>
                    <button
                      type="button"
                      className="composer-tool-button"
                      onClick={() => {
                        if (selectedAgent) {
                          setAgentEditor(selectedAgent);
                          setActiveConfigTab('agents');
                        }
                      }}
                      disabled={!selectedAgent}
                    >
                      <Settings size={16} />
                      <span>智能体设置</span>
                    </button>
                    <div className={`agent-runtime-state ${sessionStarting ? 'running' : sessionReady ? 'online' : 'offline'}`}>
                      <span className={`status-dot ${sessionStarting ? 'running' : sessionReady ? 'online' : 'offline'}`} />
                      <strong>{sessionStarting ? '准备中' : sessionReady ? '已就绪' : '未就绪'}</strong>
                    </div>
                  </div>
                </div>

                {agentNotice && agentNotice.tone !== 'success' && <InlineNotice tone={agentNotice.tone} text={agentNotice.text} />}

                <div className="conversation-list focused-conversation">
                  {transcript.length === 0 ? (
                    <p className="empty-state">选择智能体后即可开始对话，系统会自动准备会话。</p>
                  ) : (
                    transcript.map((item, messageIndex) => {
                      const targetMessageIndex = searchNavigationTarget?.messageIndex;
                      const targetQuery = searchNavigationTarget?.query ?? '';
                      const isSearchTarget =
                        searchNavigationTarget?.conversationId === selectedConversation.id &&
                        targetMessageIndex === messageIndex;
                      const anchorId = getMessageAnchorId(selectedConversation.id, messageIndex);

                      return (
                        <div
                          className={`message-bubble ${item.role}${isSearchTarget ? ' search-target' : ''}`}
                          key={`${item.createdAt}-${item.role}-${messageIndex}`}
                          ref={(node) => {
                            messageElementRefs.current[anchorId] = node;
                          }}
                        >
                          <div className="message-meta">
                            <strong>{item.role === 'user' ? '用户' : 'Pi 智能体'}</strong>
                            <time dateTime={item.createdAt}>{formatLocalTimestamp(item.createdAt)}</time>
                          </div>
                          <MarkdownMessage text={item.text} searchQuery={isSearchTarget ? targetQuery : undefined} />
                          <AttachmentList attachments={item.attachments} />
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="composer workbench-composer">
                  <input
                    ref={composerFileInputRef}
                    className="composer-file-input"
                    type="file"
                    multiple
                    onChange={handleComposerFileInputChange}
                  />
                  <textarea
                    value={draftMessage}
                    onChange={(event) => {
                      saveCurrentConversation({ draftMessage: event.target.value });
                    }}
                    onKeyDown={handleComposerKeyDown}
                    onPaste={handleComposerPaste}
                    placeholder="向当前智能体发送消息"
                    rows={3}
                  />
                  {composerAttachments.length > 0 && (
                    <div className="composer-attachments" aria-label="已添加附件">
                      {composerAttachments.map((attachment) => (
                        <span className="composer-attachment-chip" key={attachment.id} title={attachment.name}>
                          <FileText size={14} />
                          <span>{attachment.name}</span>
                          <small>{formatBytes(attachment.size)}</small>
                          <button
                            type="button"
                            onClick={() => removeComposerAttachment(attachment.id)}
                            aria-label={`移除附件 ${attachment.name}`}
                          >
                            <X size={13} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="composer-bottom-bar">
                    <div className="composer-bottom-left">
                      <button
                        type="button"
                        className="composer-tool-button icon-only-button"
                        disabled={composerAttachments.length >= maxComposerAttachments}
                        onClick={() => composerFileInputRef.current?.click()}
                        aria-label="添加附件"
                        title={`添加附件，最多 ${maxComposerAttachments} 个`}
                      >
                        <Plus size={18} />
                      </button>
                      {selectedAgentTaskTemplates.length > 0 && (
                        <select
                          className="task-template-select"
                          value=""
                          onChange={(event) => applyTaskTemplate(event.target.value)}
                          aria-label="选择常规任务"
                        >
                          <option value="">选择常规任务</option>
                          {selectedAgentTaskTemplates.map((template) => (
                            <option value={template.id} key={template.id}>
                              {template.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="composer-bottom-right">
                      {!sessionReady && (
                        <button
                          type="button"
                          className="composer-tool-button"
                          onClick={() => startSession({ force: true })}
                          disabled={!selectedAgent || sessionStarting}
                        >
                          <Bot size={16} />
                          <span>{sessionStarting ? '准备中' : '重试'}</span>
                        </button>
                      )}
                      <button type="button" className="composer-tool-button" disabled={!sessionReady} onClick={stopSession}>
                        <Square size={16} />
                        <span>停止</span>
                      </button>
                      <button type="button" className="composer-send-button" disabled={!canSend} onClick={sendMessage}>
                        <Send size={18} />
                        <span>发送</span>
                      </button>
                    </div>
                  </div>
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
                  <div className="prompt-context-preview">
                    <small>本次 Prompt 上下文预览</small>
                    <pre>{promptContextPreview}</pre>
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
              {agentNotice && <InlineNotice tone={agentNotice.tone} text={agentNotice.text} />}
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
                      <MarkdownMessage text={item.text} />
                      <AttachmentList attachments={item.attachments} />
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

        {settingsOpen && (
          <div className="settings-overlay" role="presentation">
        <article className="panel wide-panel config-panel settings-panel" role="dialog" aria-modal="true" aria-label="配置中心">
          <div className="panel-heading with-action">
            <div>
              <Settings size={20} />
              <h3>配置中心</h3>
              <button
                type="button"
                className="hint-icon-button"
                title={configState ? `配置文件：${configState.configPath}` : '正在读取客户端配置。'}
                aria-label="配置文件位置"
              >
                <Info size={15} />
              </button>
              <button type="button" className="quiet-button compact-button settings-back-button" onClick={closeSettings}>
                <ArrowLeft size={16} />
                <span>返回</span>
              </button>
            </div>
          </div>
          {configNotice && <InlineNotice tone={configNotice.tone} text={configNotice.text} />}
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
                  className={activeConfigTab === 'archived' ? 'active' : ''}
                  onClick={() => setActiveConfigTab('archived')}
                >
                  已归档对话
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
              <section className="config-block list-page">
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
                <div className="list-page-body">
                <div className="capability-table">
                  {draftConfig.agents.length === 0 ? (
                    <p className="empty-state">暂无智能体。系统会默认创建一个主智能体。</p>
                  ) : (
                    pagedAgents.map((agent) => {
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
                </div>
                {renderLocalPagination({
                  page: agentPage,
                  totalPages: agentTotalPages,
                  totalItems: draftConfig.agents.length,
                  pageInput: agentPageInput,
                  setPage: setAgentPage,
                  setPageInput: setAgentPageInput,
                })}
              </section>
              )}

              {activeConfigTab === 'core' && (
              <section className="config-block list-page">
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

              {activeConfigTab === 'archived' && (
              <section className="config-block list-page">
                <div className="section-title-row">
                  <div>
                    <strong>已归档对话</strong>
                    <span>按归档时间展示来自不同智能体的会话，详情复用当前对话页。</span>
                  </div>
                </div>
                <div className="list-page-body">
                  <div className="capability-table">
                    {archivedConversations.length === 0 ? (
                      <p className="empty-state">暂无已归档对话。</p>
                    ) : (
                      pagedArchivedConversations.map(({ agentId, agentName, conversation }) => (
                        <div className="capability-row archived-conversation-row" key={`${agentId}-${conversation.id}`}>
                          <div>
                            <strong>{getConversationDisplayTitle(conversation, null)}</strong>
                            <span>{agentName}</span>
                          </div>
                          <small>{formatLocalTimestamp(conversation.archivedAt ?? conversation.updatedAt)}</small>
                          <small>{conversation.transcript.length} 条消息</small>
                          <div className="button-row">
                            <button
                              type="button"
                              className="secondary-button compact-button"
                              onClick={() => openArchivedConversation(agentId, conversation.id)}
                            >
                              查看
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                {renderLocalPagination({
                  page: archivedConversationPage,
                  totalPages: archivedConversationTotalPages,
                  totalItems: archivedConversations.length,
                  pageInput: archivedConversationPageInput,
                  setPage: setArchivedConversationPage,
                  setPageInput: setArchivedConversationPageInput,
                })}
              </section>
              )}

              {activeConfigTab === 'models' && (
              <section className="config-block list-page">
                <div className="section-title-row">
                  <div>
                    <strong>模型 / Provider</strong>
                    <button
                      type="button"
                      className="hint-icon-button"
                      title="按列表管理官方 Provider、自定义模型、国内厂商和本地模型。默认模型全局只能有一个，可在新建或编辑模型时指定。"
                      aria-label="模型列表说明"
                    >
                      <Info size={15} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="primary-action-button"
                    onClick={() => {
                      openModelEditor(createModelProfile());
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
                </div>

                <div className="model-list list-page-body">
                  {filteredModels.length === 0 ? (
                    <p className="empty-state">暂无匹配模型。可以新增官方 Provider、本地模型或自定义模型。</p>
                  ) : (
                    <>
                      <div className="model-row model-row-header">
                        <strong>模型</strong>
                        <strong>默认</strong>
                        <strong>接入方式</strong>
                        <strong>能力</strong>
                        <strong>思考</strong>
                        <strong>上下文</strong>
                        <strong>状态</strong>
                        <strong>操作</strong>
                      </div>
                      {pagedModels.map((model) => (
                        <div className="model-row" key={model.id}>
                          <div>
                            <strong>{model.displayName}</strong>
                            <span>
                              {model.providerLabel || model.provider} / {model.modelId || '未填写模型 ID'}
                            </span>
                          </div>
                          <small className={draftConfig.model.defaultModelId === model.id ? 'enabled' : 'muted-cell'}>
                            {draftConfig.model.defaultModelId === model.id ? '默认' : '-'}
                          </small>
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
                                openModelEditor(hydrateModelAgentUsage(model, draftConfig.agents));
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
                      ))}
                    </>
                  )}
                </div>
                {renderLocalPagination({
                  page: modelPage,
                  totalPages: modelTotalPages,
                  totalItems: filteredModels.length,
                  pageInput: modelPageInput,
                  setPage: setModelPage,
                  setPageInput: setModelPageInput,
                })}
                <div className="list-page-footer legacy-list-footer">
                  <span>已显示 {filteredModels.length} / {draftConfig.model.models.length} 个模型</span>
                  <button
                    type="button"
                    className="primary-action-button compact-button"
                    onClick={() => {
                      openModelEditor(createModelProfile());
                    }}
                  >
                    <Plus size={16} />
                    <span>新增模型</span>
                  </button>
                </div>
              </section>
              )}

              {activeConfigTab === 'capabilities' && (
              <section className="config-block list-page">
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

                <div className="list-page-body">
                <div className="capability-table">
                  {filteredCapabilities.length === 0 ? (
                    <p className="empty-state">暂无匹配能力。可以新增 HTTP API、本地命令、MCP 工具或 Skill。</p>
                  ) : (
                    pagedCapabilities.map((capability) => (
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
                </div>
                {renderLocalPagination({
                  page: capabilityPage,
                  totalPages: capabilityTotalPages,
                  totalItems: filteredCapabilities.length,
                  pageInput: capabilityPageInput,
                  setPage: setCapabilityPage,
                  setPageInput: setCapabilityPageInput,
                })}
                <div className="list-page-footer legacy-list-footer">
                  <span>已显示 {filteredCapabilities.length} / {draftConfig.capabilities.length} 个能力</span>
                  <button type="button" className="primary-action-button compact-button" onClick={() => setCapabilityEditor(createCapabilityConfig())}>
                    <Plus size={16} />
                    <span>新增能力</span>
                  </button>
                </div>
              </section>
              )}
            </div>
          )}
        </article>
          </div>
        )}

        {activeSection === 'logs' && (
          <article className="panel wide-panel audit-panel">
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
                <>
                  <div className="audit-row audit-header">
                    <strong>操作类型</strong>
                    <strong>开始时间</strong>
                    <strong>结束时间</strong>
                    <strong>操作内容</strong>
                  </div>
                  {auditEntries.map((entry, index) => {
                    const content = getAuditContent(entry);
                    const isLongContent =
                      content.length > auditContentPreviewMaxLength ||
                      getAuditFullContent(entry).length > auditContentPreviewMaxLength;
                    const canInspectFullContent = isLongContent || hasAuditFullContent(entry);

                    return (
                      <div className="audit-row" key={`${entry.timestamp}-${entry.businessAction}-${entry.toolName}-${index}`}>
                        <strong>{auditActionLabels[entry.businessAction] ?? entry.businessAction}</strong>
                        <span>{formatLocalTimestamp(getAuditStartTime(entry))}</span>
                        <span>{getAuditEndTime(entry) ? formatLocalTimestamp(getAuditEndTime(entry) as string) : '-'}</span>
                        <div className="audit-content-cell">
                          <p className="audit-content-preview">{getAuditContentPreview(content)}</p>
                          {canInspectFullContent && (
                            <button
                              type="button"
                              className="audit-more-button"
                              onClick={() => setExpandedAuditEntry(entry)}
                            >
                              查看全部
                            </button>
                          )}
                        </div>
                        <small className={entry.status === 'success' ? 'enabled' : 'disabled'}>
                          {entry.status === 'success' ? '成功' : '失败'}
                        </small>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
            <PaginationBar
              summary={`第 ${Math.floor((auditQuery.offset ?? 0) / auditPageSize) + 1} / ${Math.max(1, Math.ceil(auditTotal / auditPageSize))} 页，共 ${auditTotal} 条`}
              page={Math.floor((auditQuery.offset ?? 0) / auditPageSize) + 1}
              totalPages={Math.max(1, Math.ceil(auditTotal / auditPageSize))}
              pageInput={auditPageInput}
              onPageInputChange={setAuditPageInput}
              onPageInputCommit={() => {
                void commitAuditPageInput();
              }}
              onPrevious={() => {
                void goToAuditPage(Math.floor((auditQuery.offset ?? 0) / auditPageSize));
              }}
              onNext={() => {
                void goToAuditPage(Math.floor((auditQuery.offset ?? 0) / auditPageSize) + 2);
              }}
            />
          </article>
        )}
      </section>

      {renamingConversation && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel rename-conversation-modal" role="dialog" aria-modal="true" aria-label="重命名会话">
            <div className="panel-heading with-action">
              <div>
                <Settings size={20} />
                <h3>重命名会话</h3>
              </div>
              <button type="button" className="modal-close-button" onClick={() => setRenamingConversation(null)} aria-label="关闭">
                <X size={18} />
              </button>
            </div>
            <div className="model-form-layout">
              <label className="wide-field">
                <span>会话名称</span>
                <input
                  value={renameConversationTitle}
                  maxLength={maxConversationTitleLength}
                  onChange={(event) => setRenameConversationTitle(event.target.value)}
                  autoFocus
                />
                <small className="field-hint">最多 {maxConversationTitleLength} 个字符。</small>
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setRenamingConversation(null)}>
                取消
              </button>
              <button type="button" onClick={saveConversationRename}>
                <Save size={16} />
                <span>保存</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {expandedAuditEntry && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel audit-detail-modal" role="dialog" aria-modal="true" aria-label="完整日志内容">
            <div className="panel-heading with-action">
              <div>
                <ListChecks size={20} />
                <h3>完整日志内容</h3>
              </div>
              <button
                type="button"
                className="modal-close-button"
                onClick={() => setExpandedAuditEntry(null)}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <div className="audit-detail-meta">
              <span>{auditActionLabels[expandedAuditEntry.businessAction] ?? expandedAuditEntry.businessAction}</span>
              <span>{formatLocalTimestamp(getAuditStartTime(expandedAuditEntry))}</span>
              <small className={expandedAuditEntry.status === 'success' ? 'enabled' : 'disabled'}>
                {expandedAuditEntry.status === 'success' ? '成功' : '失败'}
              </small>
            </div>
            <pre className="audit-detail-content">{getAuditFullContent(expandedAuditEntry)}</pre>
            {getAuditEntryLogFilePath(auditPath, expandedAuditEntry) && (
              <p className="audit-detail-path">
                完整日志文件：{getAuditEntryLogFilePath(auditPath, expandedAuditEntry)}
              </p>
            )}
          </section>
        </div>
      )}

      {confirmDialog && (
        <div className="modal-backdrop action-dialog-backdrop" role="presentation">
          <section
            className={`modal-panel action-dialog ${confirmDialog.tone === 'danger' ? 'danger' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={confirmDialog.title}
          >
            <div className="action-dialog-icon">
              <AlertTriangle size={22} />
            </div>
            <div className="action-dialog-copy">
              <h3>{confirmDialog.title}</h3>
              <p>{confirmDialog.message}</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setConfirmDialog(null)}>
                {confirmDialog.cancelLabel ?? '取消'}
              </button>
              <button
                type="button"
                className={confirmDialog.tone === 'danger' ? 'danger-button' : 'primary-action-button'}
                onClick={() => {
                  void confirmDialogAction();
                }}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}

      {agentEditor && draftConfig && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-label="编辑智能体">
            <div className="panel-heading with-action">
              <div>
                <Bot size={20} />
                <h3>{agentEditor.name ? `编辑智能体：${agentEditor.name}` : '新增智能体'}</h3>
              </div>
              <button type="button" className="modal-close-button" onClick={() => setAgentEditor(null)} aria-label="关闭">
                <X size={18} />
              </button>
            </div>
            <div className="model-form-layout">
              <div className="form-section-heading wide-field">
                <strong>基础信息</strong>
                <span>智能体是会话入口，负责绑定模型、业务能力和子智能体。</span>
              </div>
              <label>
                <span>{requiredLabel('智能体名称')}</span>
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

              <div className="form-section-heading wide-field">
                <strong>智能体规则</strong>
                <span>这些是长期生效的工作方法，不是单次任务说明；保存后会进入当前智能体的对话上下文。</span>
              </div>
              <label>
                <span>角色定位</span>
                <textarea
                  value={agentEditor.rules.role}
                  onChange={(event) => updateAgentRule('role', event.target.value)}
                  rows={3}
                  placeholder="例如：你是企业法务助手，擅长合同审查、案件材料梳理和风险提示。"
                />
              </label>
              <label>
                <span>工作目标</span>
                <textarea
                  value={agentEditor.rules.goals}
                  onChange={(event) => updateAgentRule('goals', event.target.value)}
                  rows={3}
                  placeholder="例如：优先帮助用户发现风险、整理证据、形成可复用的审查结论。"
                />
              </label>
              <label className="wide-field">
                <span>处理流程</span>
                <textarea
                  value={agentEditor.rules.process}
                  onChange={(event) => updateAgentRule('process', event.target.value)}
                  rows={4}
                  placeholder="例如：先确认材料范围，再提取关键信息，最后给出结论、依据和待补充事项。"
                />
              </label>
              <label>
                <span>输出格式</span>
                <textarea
                  value={agentEditor.rules.outputFormat}
                  onChange={(event) => updateAgentRule('outputFormat', event.target.value)}
                  rows={3}
                  placeholder="例如：默认用结论摘要、风险清单、修改建议三段输出。"
                />
              </label>
              <label>
                <span>注意事项</span>
                <textarea
                  value={agentEditor.rules.constraints}
                  onChange={(event) => updateAgentRule('constraints', event.target.value)}
                  rows={3}
                  placeholder="例如：不要编造未提供的事实；不确定时明确说明需要补充材料。"
                />
              </label>
              <label className="wide-field">
                <span>业务术语 / 偏好</span>
                <textarea
                  value={agentEditor.rules.terminology}
                  onChange={(event) => updateAgentRule('terminology', event.target.value)}
                  rows={3}
                  placeholder="例如：公司内部把客户资料称为客户档案，把案件阶段称为立案、举证、庭审、执行。"
                />
              </label>

              <div className="form-section-heading wide-field">
                <strong>知识</strong>
                <span>配置会长期注入当前智能体上下文的文档概述或纯文本知识。</span>
                <button type="button" className="quiet-button compact-button" onClick={addAgentKnowledgeItem}>
                  <Plus size={16} />
                  <span>新增知识</span>
                </button>
              </div>
              <div className="wide-field knowledge-table">
                <div className="knowledge-row knowledge-row-header">
                  <strong>标题</strong>
                  <strong>类型</strong>
                  <strong>内容 / 概述</strong>
                  <strong>操作</strong>
                </div>
                {agentEditor.knowledgeItems.length === 0 ? (
                  <p className="empty-state knowledge-empty">暂无知识，可以先添加文档概述或纯文本知识。</p>
                ) : (
                  agentEditor.knowledgeItems.map((item) => {
                    const summary =
                      item.type === 'document'
                        ? `路径：${item.filePath || '未选择'}；概述：${item.overview || '未填写'}`
                        : getKnowledgeSummary(item);
                    const shouldCollapse = summary.length > 120;
                    return (
                      <div className="knowledge-row" key={item.id}>
                        <strong>{item.title || '未命名知识'}</strong>
                        <span>{item.type === 'document' ? '文档' : '纯文本'}</span>
                        <div className="knowledge-summary">
                          <span>{truncateInlineText(summary || '未填写')}</span>
                          {shouldCollapse && (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => setAgentKnowledgeViewer(item)}
                            >
                              查看更多
                            </button>
                          )}
                        </div>
                        <div className="knowledge-actions">
                          <button
                            type="button"
                            className="quiet-button compact-button"
                            onClick={() => setAgentKnowledgeEditor(item)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="quiet-button compact-button"
                            onClick={() => deleteAgentKnowledgeItem(item.id)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="form-section-heading wide-field">
                <strong>常规任务</strong>
                <span>把某一类常见任务沉淀成快捷入口，使用时只需选择任务并补充材料。</span>
                <button type="button" className="quiet-button compact-button" onClick={addAgentTaskTemplate}>
                  <Plus size={16} />
                  <span>新增常规任务</span>
                </button>
              </div>
              <div className="wide-field task-template-editor-list">
                {agentEditor.taskTemplates.length === 0 ? (
                  <p className="empty-state">暂无常规任务，可以先把高频提示词沉淀成一个任务模板。</p>
                ) : (
                  agentEditor.taskTemplates.map((template) => (
                    <div className="task-template-editor" key={template.id}>
                      <div className="section-title-row compact-title">
                        <strong>{template.name || '未命名常规任务'}</strong>
                        <button
                          type="button"
                          className="quiet-button compact-button"
                          onClick={() => deleteAgentTaskTemplate(template.id)}
                        >
                          删除
                        </button>
                      </div>
                      <label>
                        <span>任务名称</span>
                        <input
                          value={template.name}
                          onChange={(event) => updateAgentTaskTemplate(template.id, { name: event.target.value })}
                          placeholder="例如 合同风险审查、案件材料摘要"
                        />
                      </label>
                      <label>
                        <span>任务说明</span>
                        <input
                          value={template.description}
                          onChange={(event) =>
                            updateAgentTaskTemplate(template.id, { description: event.target.value })
                          }
                          placeholder="说明这个任务适合什么时候使用"
                        />
                      </label>
                      <label className="wide-field">
                        <span>需要用户补充的信息或材料</span>
                        <textarea
                          value={template.expectedInputs}
                          onChange={(event) =>
                            updateAgentTaskTemplate(template.id, { expectedInputs: event.target.value })
                          }
                          rows={2}
                          placeholder="例如：合同正文、对方主体名称、重点关注条款。"
                        />
                      </label>
                      <label className="wide-field">
                        <span>任务提示词 / 执行要求</span>
                        <textarea
                          value={template.prompt}
                          onChange={(event) => updateAgentTaskTemplate(template.id, { prompt: event.target.value })}
                          rows={4}
                          placeholder="例如：请审查合同中的付款、违约、解除、管辖条款，输出风险等级、依据和修改建议。"
                        />
                      </label>
                      <label className="checkbox-row form-checkbox">
                        <input
                          type="checkbox"
                          checked={template.enabled}
                          onChange={(event) =>
                            updateAgentTaskTemplate(template.id, { enabled: event.target.checked })
                          }
                        />
                        <span>在对话框中显示这个任务</span>
                      </label>
                    </div>
                  ))
                )}
              </div>

              {agentEditor.type === 'sub' && (
                <div className="wide-field checklist-box selection-list">
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

              <div className="wide-field checklist-box selection-list">
                <strong>{requiredLabel('可用模型')}</strong>
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

              <div className="wide-field checklist-box selection-list">
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
                <div className="wide-field checklist-box selection-list">
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

      {agentKnowledgeEditor && (
        <div className="modal-backdrop action-dialog-backdrop" role="presentation">
          <section className="modal-panel knowledge-modal" role="dialog" aria-modal="true" aria-label="编辑知识">
            <div className="panel-heading with-action">
              <div>
                <FileText size={20} />
                <h3>{agentKnowledgeEditor.title ? `编辑知识：${agentKnowledgeEditor.title}` : '新增知识'}</h3>
              </div>
              <button
                type="button"
                className="modal-close-button"
                onClick={() => setAgentKnowledgeEditor(null)}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <div className="model-form-layout">
              <label className="wide-field">
                <span>{requiredLabel('标题')}</span>
                <input
                  value={agentKnowledgeEditor.title}
                  onChange={(event) =>
                    setAgentKnowledgeEditor((item) => (item ? { ...item, title: event.target.value } : item))
                  }
                  placeholder="例如 KYC 卡证 OCR 识别规则"
                />
              </label>
              <label>
                <span>类型</span>
                <select
                  value={agentKnowledgeEditor.type}
                  onChange={(event) =>
                    setAgentKnowledgeEditor((item) =>
                      item ? { ...item, type: event.target.value as AgentKnowledgeItem['type'] } : item,
                    )
                  }
                >
                  <option value="document">文档</option>
                  <option value="text">纯文本</option>
                </select>
              </label>
              {agentKnowledgeEditor.type === 'document' ? (
                <>
                  <div className="wide-field knowledge-file-picker">
                    <span>{requiredLabel('本地文件')}</span>
                    <div className="knowledge-file-row">
                      <input value={agentKnowledgeEditor.filePath} readOnly placeholder="请选择一个本地文件" />
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() => knowledgeFileInputRef.current?.click()}
                      >
                        <FolderOpen size={16} />
                        <span>选择文件</span>
                      </button>
                    </div>
                    <input
                      ref={knowledgeFileInputRef}
                      className="hidden-file-input"
                      type="file"
                      onChange={selectAgentKnowledgeFile}
                    />
                  </div>
                  <label className="wide-field">
                    <span>{requiredLabel('概述')}</span>
                    <textarea
                      value={agentKnowledgeEditor.overview}
                      onChange={(event) =>
                        setAgentKnowledgeEditor((item) =>
                          item ? { ...item, overview: event.target.value } : item,
                        )
                      }
                      rows={5}
                      placeholder="说明这份文档是什么、何时参考、包含哪些关键内容。"
                    />
                  </label>
                </>
              ) : (
                <label className="wide-field">
                  <span>{requiredLabel('文本内容')}</span>
                  <textarea
                    value={agentKnowledgeEditor.content}
                    onChange={(event) =>
                      setAgentKnowledgeEditor((item) =>
                        item ? { ...item, content: event.target.value } : item,
                      )
                    }
                    rows={8}
                    placeholder="填写会直接注入智能体上下文的纯文本知识。"
                  />
                </label>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setAgentKnowledgeEditor(null)}>
                取消
              </button>
              <button type="button" onClick={() => saveAgentKnowledgeItem(agentKnowledgeEditor)}>
                <Save size={16} />
                <span>保存知识</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {agentKnowledgeViewer && (
        <div className="modal-backdrop action-dialog-backdrop" role="presentation">
          <section className="modal-panel knowledge-modal" role="dialog" aria-modal="true" aria-label="查看知识">
            <div className="panel-heading with-action">
              <div>
                <FileText size={20} />
                <h3>{agentKnowledgeViewer.title || '知识内容'}</h3>
              </div>
              <button
                type="button"
                className="modal-close-button"
                onClick={() => setAgentKnowledgeViewer(null)}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <pre className="knowledge-full-text">{getKnowledgeSummary(agentKnowledgeViewer)}</pre>
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
              <button type="button" className="modal-close-button" onClick={closeModelEditor} aria-label="关闭">
                <X size={18} />
              </button>
            </div>
            {modelEditorNotice && (
              <InlineNotice tone={modelEditorNotice.tone} text={modelEditorNotice.text} />
            )}

            <div className="model-form-layout">
              <div className="form-section-heading wide-field">
                <strong>基础信息</strong>
                <span>
                  选择供应商，填写模型和 API Key。带 <span className="required-star">*</span> 的字段为保存前必填。
                </span>
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
              {shouldShowCustomProviderId && (
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
              <label className="checkbox-row form-checkbox">
                <input
                  type="checkbox"
                  checked={modelEditorSetAsDefault}
                  onChange={(event) => setModelEditorSetAsDefault(event.target.checked)}
                />
                <span>设为默认模型</span>
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

              <details className="wide-field advanced-capability-box">
                <summary>高级接入参数</summary>
                <div className="settings-grid advanced-grid">
                  <label>
                    <span>{requiredLabel('API 类型')}</span>
                    <select
                      value={modelEditor.api}
                      onChange={(event) => updateModelEditor('api', event.target.value as ModelProfileConfig['api'])}
                    >
                      <option value="openai-responses">OpenAI Responses</option>
                      <option value="openai-completions">OpenAI Chat Completions</option>
                      <option value="anthropic-messages">Anthropic Messages</option>
                      <option value="google-generative-ai">Google Generative AI</option>
                      <option value="mistral-conversations">Mistral Conversations</option>
                      <option value="custom">自定义</option>
                    </select>
                  </label>
                  <label>
                    <span>API Key 环境变量</span>
                    <input
                      value={modelEditor.apiKeyEnv}
                      onChange={(event) => updateModelEditor('apiKeyEnv', event.target.value.trim())}
                      placeholder="例如 DASHSCOPE_API_KEY"
                    />
                  </label>
                  <label>
                    <span>认证方式</span>
                    <select
                      value={modelEditor.authType}
                      onChange={(event) => updateModelEditor('authType', event.target.value as ModelProfileConfig['authType'])}
                    >
                      <option value="env">API Key</option>
                      <option value="oauth">OAuth</option>
                      <option value="none">无需认证</option>
                    </select>
                  </label>
                  <label>
                    <span>Transport</span>
                    <select
                      value={modelEditor.transport}
                      onChange={(event) => updateModelEditor('transport', event.target.value as ModelProfileConfig['transport'])}
                    >
                      <option value="auto">auto</option>
                      <option value="sse">sse</option>
                      <option value="websocket">websocket</option>
                    </select>
                  </label>
                  <label>
                    <span>超时毫秒</span>
                    <input
                      type="number"
                      min={0}
                      value={modelEditor.timeoutMs}
                      onChange={(event) => updateModelEditor('timeoutMs', Number(event.target.value))}
                    />
                  </label>
                  <label>
                    <span>最大重试次数</span>
                    <input
                      type="number"
                      min={0}
                      value={modelEditor.maxRetries}
                      onChange={(event) => updateModelEditor('maxRetries', Number(event.target.value))}
                    />
                  </label>
                  <label className="wide-field">
                    <span>Compat JSON</span>
                    <textarea
                      value={modelEditor.compat}
                      onChange={(event) => updateModelEditor('compat', event.target.value)}
                      rows={4}
                      placeholder='例如 {"thinkingFormat":"qwen"}'
                    />
                  </label>
                </div>
              </details>

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

              <div className="wide-field checklist-box selection-list">
                <strong>可用智能体</strong>
                {(draftConfig?.agents ?? []).length === 0 ? (
                  <p className="empty-state">暂无智能体。</p>
                ) : (
                  (draftConfig?.agents ?? []).map((agent) => (
                    <label className="checkbox-row" key={agent.id}>
                      <input
                        type="checkbox"
                        checked={modelEditor.usedByAgentIds.includes(agent.id)}
                        onChange={(event) => toggleModelAgent(agent.id, event.target.checked)}
                      />
                      <span>{agent.name || '未命名智能体'}</span>
                    </label>
                  ))
                )}
              </div>

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
                <h3>{capabilityEditorExists ? `编辑能力：${capabilityEditor.name}` : '新增能力'}</h3>
              </div>
              <button
                type="button"
                className="modal-close-button"
                onClick={() => setCapabilityEditor(null)}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>

            <div className="model-form-layout capability-editor-layout">
              <div className="form-section-heading wide-field">
                <strong>基础信息</strong>
                <span>只保留必要字段；能力内容支持粘贴 Skill 文本、MCP 配置、curl、接口说明或同事分享的说明。</span>
              </div>
              <label>
                <span>{requiredLabel('能力名称')}</span>
                <input
                  value={capabilityEditor.name}
                  onChange={(event) => updateCapabilityEditor('name', event.target.value)}
                  placeholder="例如 企业主体查询、合同风险审查"
                />
              </label>
              <label>
                <span>{requiredLabel('能力类型')}</span>
                <select
                  value={capabilityEditor.type}
                  onChange={(event) => applyCapabilityType(event.target.value as CapabilityConfig['type'])}
                >
                  {Object.entries(capabilityTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="wide-field">
                <span>{requiredLabel('能力说明')}</span>
                <textarea
                  value={capabilityEditor.description}
                  onChange={(event) => updateCapabilityEditor('description', event.target.value)}
                  rows={3}
                  placeholder="用业务语言描述：智能体在什么情况下应该参考或使用这个能力。"
                />
              </label>
              <label className="wide-field">
                <span>{requiredLabel('能力内容')}</span>
                <textarea
                  className="capability-content-editor"
                  value={capabilityEditor.content}
                  onChange={(event) => updateCapabilityEditor('content', event.target.value)}
                  rows={14}
                  placeholder={`可以直接粘贴任意来源的能力内容，例如：
- 同事分享的 Skill 使用说明
- MCP 服务配置片段
- 企业接口文档或 curl 示例
- 本地脚本路径和参数说明
- 浏览器操作要求

第一期不会自动解析，只会原样保存并作为智能体理解能力的上下文。`}
                />
              </label>

              <div className="form-section-heading wide-field">
                <strong>类型专属配置</strong>
                <span>不同能力类型只展示对应字段，避免新增 Tools / Skills 时表单完全一样。</span>
              </div>

              {capabilityEditor.type === 'tool' && (
                <div className="tool-config-panel wide-field">
                  <label>
                    <span>工具名</span>
                    <input
                      value={capabilityEditor.toolName}
                      onChange={(event) => updateCapabilityEditor('toolName', event.target.value)}
                      placeholder="enterprise_lookup"
                    />
                  </label>
                  <label className="wide-field">
                    <span>适用场景</span>
                    <textarea
                      value={capabilityEditor.useWhen}
                      onChange={(event) => updateCapabilityEditor('useWhen', event.target.value)}
                      rows={3}
                    />
                  </label>
                  <label className="wide-field">
                    <span>不适用场景</span>
                    <textarea
                      value={capabilityEditor.avoidWhen}
                      onChange={(event) => updateCapabilityEditor('avoidWhen', event.target.value)}
                      rows={3}
                    />
                  </label>
                </div>
              )}

              {capabilityEditor.type === 'skill' && (
                <div className="tool-config-panel wide-field">
                  <label className="wide-field">
                    <span>Skill 使用说明</span>
                    <textarea
                      value={capabilityEditor.useWhen}
                      onChange={(event) => updateCapabilityEditor('useWhen', event.target.value)}
                      rows={4}
                      placeholder="写清楚智能体什么时候应该调用这个 Skill。"
                    />
                  </label>
                  <label className="wide-field">
                    <span>边界和限制</span>
                    <textarea
                      value={capabilityEditor.avoidWhen}
                      onChange={(event) => updateCapabilityEditor('avoidWhen', event.target.value)}
                      rows={3}
                    />
                  </label>
                </div>
              )}

              {capabilityEditor.type === 'http' && (
                <div className="tool-config-panel wide-field">
                  <label className="wide-field">
                    <span>接口地址</span>
                    <input
                      value={capabilityEditor.endpoint}
                      onChange={(event) => updateCapabilityEditor('endpoint', event.target.value)}
                      placeholder="https://api.example.com/v1/resource"
                    />
                  </label>
                  <label>
                    <span>请求方法</span>
                    <select
                      value={capabilityEditor.httpMethod}
                      onChange={(event) =>
                        updateCapabilityEditor('httpMethod', event.target.value as CapabilityConfig['httpMethod'])
                      }
                    >
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                        <option key={method} value={method}>{method}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Body 类型</span>
                    <select
                      value={capabilityEditor.httpBodyType}
                      onChange={(event) =>
                        updateCapabilityEditor('httpBodyType', event.target.value as CapabilityConfig['httpBodyType'])
                      }
                    >
                      <option value="json">JSON</option>
                      <option value="form-data">Form Data</option>
                      <option value="text">Text</option>
                      <option value="binary">Binary</option>
                      <option value="url-text">URL Text</option>
                    </select>
                  </label>
                  <label className="wide-field">
                    <span>Header JSON</span>
                    <textarea
                      value={capabilityEditor.headersJson}
                      onChange={(event) => updateCapabilityEditor('headersJson', event.target.value)}
                      rows={4}
                    />
                  </label>
                </div>
              )}

              {capabilityEditor.type === 'mcp' && (
                <div className="mcp-config-panel wide-field">
                  <label>
                    <span>MCP 服务名</span>
                    <input
                      value={capabilityEditor.mcpServerName}
                      onChange={(event) => updateCapabilityEditor('mcpServerName', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>传输协议</span>
                    <select
                      value={capabilityEditor.mcpTransport}
                      onChange={(event) =>
                        updateCapabilityEditor('mcpTransport', event.target.value as CapabilityConfig['mcpTransport'])
                      }
                    >
                      <option value="stream-http">Stream HTTP</option>
                      <option value="sse">SSE</option>
                    </select>
                  </label>
                  <label className="wide-field">
                    <span>MCP URL</span>
                    <input
                      value={capabilityEditor.mcpUrl}
                      onChange={(event) => updateCapabilityEditor('mcpUrl', event.target.value)}
                      placeholder="http://127.0.0.1:3000/mcp"
                    />
                  </label>
                  <label className="wide-field">
                    <span>MCP Headers JSON</span>
                    <textarea
                      value={capabilityEditor.mcpHeadersJson}
                      onChange={(event) => updateCapabilityEditor('mcpHeadersJson', event.target.value)}
                      rows={4}
                    />
                  </label>
                  <div className="wide-field">
                    <button type="button" className="secondary-button" onClick={() => discoverMcpTools(capabilityEditor)}>
                      发现 MCP 工具
                    </button>
                  </div>
                  <div className="mcp-tool-list wide-field">
                    {capabilityEditor.mcpTools.length === 0 ? (
                      <p className="empty-state">还没有发现工具。</p>
                    ) : (
                      capabilityEditor.mcpTools.map((tool, index) => (
                        <label className="mcp-tool-row" key={`${tool.name}-${index}`}>
                          <span className="checkbox-row compact-checkbox">
                            <input
                              type="checkbox"
                              checked={tool.enabled}
                              onChange={(event) => {
                                const nextTools = capabilityEditor.mcpTools.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, enabled: event.target.checked } : item,
                                );
                                updateCapabilityEditor('mcpTools', nextTools);
                              }}
                            />
                            启用
                          </span>
                          <strong>{tool.name}</strong>
                          <span>{tool.description || '暂无说明'}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}

              {capabilityEditor.type === 'browser' && (
                <div className="browser-config-panel wide-field">
                  <label>
                    <span>浏览器模式</span>
                    <select
                      value={capabilityEditor.browserMode ?? 'builtin'}
                      onChange={(event) =>
                        updateCapabilityEditor('browserMode', event.target.value as CapabilityConfig['browserMode'])
                      }
                    >
                      <option value="builtin">内置受控浏览器</option>
                      <option value="chrome">本机 Chrome</option>
                      <option value="mcp">MCP 浏览器</option>
                    </select>
                  </label>
                  <label>
                    <span>最大步骤数</span>
                    <input
                      type="number"
                      min={1}
                      value={capabilityEditor.browserMaxSteps ?? 8}
                      onChange={(event) => updateCapabilityEditor('browserMaxSteps', Number(event.target.value))}
                    />
                  </label>
                  <label className="wide-field">
                    <span>允许域名</span>
                    <input
                      value={(capabilityEditor.browserAllowedDomains ?? []).join(', ')}
                      onChange={(event) =>
                        updateCapabilityEditor(
                          'browserAllowedDomains',
                          event.target.value.split(',').map((domain) => domain.trim()).filter(Boolean),
                        )
                      }
                    />
                  </label>
                </div>
              )}

              {capabilityEditor.type === 'command' && (
                <div className="tool-config-panel wide-field">
                  <label className="wide-field">
                    <span>命令</span>
                    <input
                      value={capabilityEditor.command}
                      onChange={(event) => updateCapabilityEditor('command', event.target.value)}
                      placeholder="node scripts/example.js"
                    />
                  </label>
                  <label className="wide-field">
                    <span>工作目录</span>
                    <input
                      value={capabilityEditor.workingDirectory}
                      onChange={(event) => updateCapabilityEditor('workingDirectory', event.target.value)}
                    />
                  </label>
                </div>
              )}

              <div className="form-section-heading wide-field">
                <strong>管理信息</strong>
                <span>用于列表筛选、智能体绑定和后续治理；不影响能力内容本身。</span>
              </div>
              <label>
                <span>分类</span>
                <input
                  value={capabilityEditor.category}
                  onChange={(event) => updateCapabilityEditor('category', event.target.value)}
                  placeholder="例如 OCR、合同、财务、知识库"
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

              <details className="wide-field advanced-capability-box">
                <summary>高级配置（可选）</summary>
                <div className="settings-grid">
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
                  <label className="wide-field">
                    <span>高级配置文本</span>
                    <textarea
                      value={capabilityEditor.advancedConfig}
                      onChange={(event) => updateCapabilityEditor('advancedConfig', event.target.value)}
                      rows={8}
                      placeholder="可选：粘贴 JSON、YAML、MCP server config、参数映射、安全说明或测试说明。"
                    />
                  </label>
                  <label className="wide-field">
                    <span>接口地址 / 服务地址</span>
                    <input
                      value={capabilityEditor.endpoint}
                      onChange={(event) => updateCapabilityEditor('endpoint', event.target.value)}
                      placeholder="可选，未来真实执行时使用"
                    />
                  </label>
                  <label className="wide-field">
                    <span>本地命令</span>
                    <input
                      value={capabilityEditor.command}
                      onChange={(event) => updateCapabilityEditor('command', event.target.value)}
                      placeholder="可选，未来真实执行时使用"
                    />
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
              </details>
            </div>

            <div className="modal-actions">
              {capabilityEditorExists && (
                <button type="button" className="quiet-button" onClick={() => deleteCapabilityConfig(capabilityEditor.id)}>
                  <Trash2 size={16} />
                  <span>删除</span>
                </button>
              )}
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
