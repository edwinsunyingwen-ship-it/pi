import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC_CHANNELS } from "../shared/ipc";
import type { WindowsClientApi } from "../shared/types";

const api: WindowsClientApi = {
	getEnvironment: () => ipcRenderer.invoke(IPC_CHANNELS.getEnvironment),
	getClientConfig: () => ipcRenderer.invoke(IPC_CHANNELS.configGet),
	saveAgentCoreConfig: (agentCore) => ipcRenderer.invoke(IPC_CHANNELS.configSaveAgentCore, agentCore),
	saveMtclawRouterConfig: (router) => ipcRenderer.invoke(IPC_CHANNELS.configSaveMtclawRouter, router),
	testMtclawRouterConfig: (router) => ipcRenderer.invoke(IPC_CHANNELS.configTestMtclawRouter, router),
	saveContextCompactionConfig: (contextCompaction) =>
		ipcRenderer.invoke(IPC_CHANNELS.configSaveContextCompaction, contextCompaction),
	saveVariablesConfig: (variables) => ipcRenderer.invoke(IPC_CHANNELS.configSaveVariables, variables),
	saveModelConfig: (model) => ipcRenderer.invoke(IPC_CHANNELS.configSaveModel, model),
	deleteModelConfig: (id) => ipcRenderer.invoke(IPC_CHANNELS.configDeleteModel, id),
	testModelConfig: (model) => ipcRenderer.invoke(IPC_CHANNELS.configTestModel, model),
	saveCapabilityConfig: (capability) => ipcRenderer.invoke(IPC_CHANNELS.configSaveCapability, capability),
	deleteCapabilityConfig: (id) => ipcRenderer.invoke(IPC_CHANNELS.configDeleteCapability, id),
	discoverMcpTools: (capability) => ipcRenderer.invoke(IPC_CHANNELS.configDiscoverMcpTools, capability),
	saveSubagentRoles: (roles) => ipcRenderer.invoke(IPC_CHANNELS.configSaveSubagentRoles, roles),
	saveAgentConfig: (agent) => ipcRenderer.invoke(IPC_CHANNELS.configSaveAgent, agent),
	deleteAgentConfig: (id) => ipcRenderer.invoke(IPC_CHANNELS.configDeleteAgent, id),
	resetClientConfig: () => ipcRenderer.invoke(IPC_CHANNELS.configReset),
	getWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.getWorkspace),
	chooseWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.chooseWorkspace),
	listAuditLogs: (query) => ipcRenderer.invoke(IPC_CHANNELS.auditListLogs, query),
	getConversationStore: () => ipcRenderer.invoke(IPC_CHANNELS.conversationStoreGet),
	saveConversationStore: (store) => ipcRenderer.invoke(IPC_CHANNELS.conversationStoreSave, store),
	listWorkspaceFiles: (workspacePath) => ipcRenderer.invoke(IPC_CHANNELS.workspaceListFiles, workspacePath),
	readWorkspaceFile: (relativePath, workspacePath) =>
		ipcRenderer.invoke(IPC_CHANNELS.workspaceReadFile, relativePath, workspacePath),
	openLocalPath: (path) => ipcRenderer.invoke(IPC_CHANNELS.localPathOpen, path),
	showLocalPathInFolder: (path) => ipcRenderer.invoke(IPC_CHANNELS.localPathShowInFolder, path),
	getUpdateState: () => ipcRenderer.invoke(IPC_CHANNELS.updateGetState),
	checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.updateCheck),
	downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updateDownload),
	installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updateInstall),
	onUpdateStatus: (handler) => {
		const listener = (_event: Electron.IpcRendererEvent, updateState: Parameters<typeof handler>[0]) => {
			handler(updateState);
		};
		ipcRenderer.on(IPC_CHANNELS.updateStatus, listener);
		return () => ipcRenderer.off(IPC_CHANNELS.updateStatus, listener);
	},
	startAgentSession: (agentId, workspacePath) =>
		ipcRenderer.invoke(IPC_CHANNELS.agentStartSession, agentId, workspacePath),
	stopAgentSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.agentStopSession, sessionId),
	getAgentSessionState: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.agentGetSessionState, sessionId),
	getFilePath: (file) => webUtils.getPathForFile(file),
	sendAgentUserMessage: (sessionId, message, images) =>
		ipcRenderer.invoke(IPC_CHANNELS.agentSendUserMessage, sessionId, message, images),
	onAgentProgress: (handler) => {
		const listener = (_event: Electron.IpcRendererEvent, progressEvent: Parameters<typeof handler>[0]) => {
			handler(progressEvent);
		};
		ipcRenderer.on(IPC_CHANNELS.agentProgress, listener);
		return () => ipcRenderer.off(IPC_CHANNELS.agentProgress, listener);
	},
	listAvailableTools: () => ipcRenderer.invoke(IPC_CHANNELS.agentListAvailableTools),
};

contextBridge.exposeInMainWorld("windowsClient", api);
