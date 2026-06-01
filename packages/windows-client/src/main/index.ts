import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS } from "../shared/ipc";
import type {
	AgentConfig,
	AgentCoreConfig,
	AppEnvironment,
	AuditLogQuery,
	CapabilityConfig,
	ClientVariableConfig,
	ModelConfig,
	ModelProfileConfig,
} from "../shared/types";
import { RpcAgentAdapter } from "./agent/agentAdapter";
import { AgentService } from "./services/agentService";
import { AuditLogger } from "./services/auditLogger";
import { BrowserToolService } from "./services/browserToolService";
import { ConfigService } from "./services/configService";
import { ConversationStoreService } from "./services/conversationStoreService";
import { WorkspaceFileService } from "./services/workspaceFileService";
import { WorkspaceService } from "./services/workspaceService";

const auditLogger = new AuditLogger();
const configService = new ConfigService(auditLogger);
const workspaceService = new WorkspaceService(auditLogger);
const workspaceFileService = new WorkspaceFileService(workspaceService, auditLogger);
const browserToolService = new BrowserToolService(auditLogger);
const conversationStoreService = new ConversationStoreService();
const agentAdapter = new RpcAgentAdapter(() => browserToolService.getBridgeConfig());
const agentService = new AgentService(agentAdapter, auditLogger, workspaceService, configService);
const mainDir = dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
	const window = new BrowserWindow({
		width: 1180,
		height: 760,
		minWidth: 980,
		minHeight: 640,
		title: "Pi 智能体客户端",
		autoHideMenuBar: true,
		backgroundColor: "#f6f5f2",
		titleBarOverlay: {
			color: "#fbfaf7",
			height: 32,
			symbolColor: "#202124",
		},
		titleBarStyle: "hidden",
		webPreferences: {
			preload: join(mainDir, "../preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
		console.error(`Renderer failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
	});

	window.webContents.on("console-message", (_event, level, message) => {
		if (level >= 2) {
			console.error(`Renderer console: ${message}`);
		}
	});

	const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? "http://localhost:5173";
	if (process.env.NODE_ENV === "development" || process.env.ELECTRON_RENDERER_URL) {
		void window.loadURL(rendererUrl);
	} else {
		void window.loadFile(join(mainDir, "../renderer/index.html"));
	}
}

function registerIpcHandlers(): void {
	ipcMain.handle(
		IPC_CHANNELS.getEnvironment,
		(): AppEnvironment => ({
			appVersion: app.getVersion(),
			platform: process.platform,
			arch: process.arch,
			nodeVersion: process.versions.node,
			electronVersion: process.versions.electron,
		}),
	);
	ipcMain.handle(IPC_CHANNELS.configGet, () => configService.getConfig());
	ipcMain.handle(IPC_CHANNELS.configSaveAgentCore, (_event, agentCore: AgentCoreConfig) =>
		configService.saveAgentCoreConfig(agentCore),
	);
	ipcMain.handle(IPC_CHANNELS.configSaveVariables, (_event, variables: ClientVariableConfig[]) =>
		configService.saveVariablesConfig(variables),
	);
	ipcMain.handle(IPC_CHANNELS.configSaveModel, (_event, model: ModelConfig) => configService.saveModelConfig(model));
	ipcMain.handle(IPC_CHANNELS.configDeleteModel, (_event, id: string) => configService.deleteModelConfig(id));
	ipcMain.handle(IPC_CHANNELS.configTestModel, (_event, model: ModelProfileConfig) =>
		agentService.testModelConnection(model),
	);
	ipcMain.handle(IPC_CHANNELS.configSaveCapability, (_event, capability: CapabilityConfig) =>
		configService.saveCapabilityConfig(capability),
	);
	ipcMain.handle(IPC_CHANNELS.configDeleteCapability, (_event, id: string) =>
		configService.deleteCapabilityConfig(id),
	);
	ipcMain.handle(IPC_CHANNELS.configDiscoverMcpTools, (_event, capability: CapabilityConfig) =>
		agentService.discoverMcpTools(capability),
	);
	ipcMain.handle(IPC_CHANNELS.configSaveAgent, (_event, agent: AgentConfig) => configService.saveAgentConfig(agent));
	ipcMain.handle(IPC_CHANNELS.configDeleteAgent, (_event, id: string) => configService.deleteAgentConfig(id));
	ipcMain.handle(IPC_CHANNELS.configReset, () => configService.resetConfig());

	ipcMain.handle(IPC_CHANNELS.getWorkspace, () => workspaceService.getWorkspace());
	ipcMain.handle(IPC_CHANNELS.chooseWorkspace, (event) => {
		const window = BrowserWindow.fromWebContents(event.sender);
		if (!window) {
			throw new Error("Workspace selection requires an active application window.");
		}
		return workspaceService.chooseWorkspace(window);
	});
	ipcMain.handle(IPC_CHANNELS.workspaceListFiles, (_event, workspacePath?: string | null) =>
		workspaceFileService.listFiles(workspacePath),
	);
	ipcMain.handle(IPC_CHANNELS.workspaceReadFile, (_event, relativePath: string, workspacePath?: string | null) =>
		workspaceFileService.readFile(relativePath, workspacePath),
	);
	ipcMain.handle(IPC_CHANNELS.auditListLogs, (_event, query?: AuditLogQuery) => auditLogger.listRecent(query));
	ipcMain.handle(IPC_CHANNELS.conversationStoreGet, () => conversationStoreService.getStore());
	ipcMain.handle(IPC_CHANNELS.conversationStoreSave, (_event, store) => conversationStoreService.saveStore(store));

	ipcMain.handle(IPC_CHANNELS.agentStartSession, (_event, agentId?: string, workspacePath?: string | null) =>
		agentService.startSession(agentId, workspacePath),
	);
	ipcMain.handle(IPC_CHANNELS.agentStopSession, (_event, sessionId: string) => agentService.stopSession(sessionId));
	ipcMain.handle(IPC_CHANNELS.agentGetSessionState, (_event, sessionId: string) =>
		agentService.getSessionState(sessionId),
	);
	ipcMain.handle(IPC_CHANNELS.agentSendUserMessage, (_event, sessionId: string, message: string) =>
		agentService.sendUserMessage(sessionId, message),
	);
	ipcMain.handle(IPC_CHANNELS.agentListAvailableTools, () => agentService.listAvailableTools());
}

app.whenReady().then(() => {
	registerIpcHandlers();
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
