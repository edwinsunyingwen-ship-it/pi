import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/ipc";
import type { WindowsClientApi } from "../shared/types";

const api: WindowsClientApi = {
	getEnvironment: () => ipcRenderer.invoke(IPC_CHANNELS.getEnvironment),
	getClientConfig: () => ipcRenderer.invoke(IPC_CHANNELS.configGet),
	saveAgentCoreConfig: (agentCore) => ipcRenderer.invoke(IPC_CHANNELS.configSaveAgentCore, agentCore),
	saveModelConfig: (model) => ipcRenderer.invoke(IPC_CHANNELS.configSaveModel, model),
	deleteModelConfig: (id) => ipcRenderer.invoke(IPC_CHANNELS.configDeleteModel, id),
	testModelConfig: (model) => ipcRenderer.invoke(IPC_CHANNELS.configTestModel, model),
	saveCapabilityConfig: (capability) => ipcRenderer.invoke(IPC_CHANNELS.configSaveCapability, capability),
	deleteCapabilityConfig: (id) => ipcRenderer.invoke(IPC_CHANNELS.configDeleteCapability, id),
	resetClientConfig: () => ipcRenderer.invoke(IPC_CHANNELS.configReset),
	getWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.getWorkspace),
	chooseWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.chooseWorkspace),
	listAuditLogs: (limit) => ipcRenderer.invoke(IPC_CHANNELS.auditListLogs, limit),
	listWorkspaceFiles: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceListFiles),
	readWorkspaceFile: (relativePath) => ipcRenderer.invoke(IPC_CHANNELS.workspaceReadFile, relativePath),
	startAgentSession: () => ipcRenderer.invoke(IPC_CHANNELS.agentStartSession),
	stopAgentSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.agentStopSession, sessionId),
	getAgentSessionState: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.agentGetSessionState, sessionId),
	sendAgentUserMessage: (sessionId, message) =>
		ipcRenderer.invoke(IPC_CHANNELS.agentSendUserMessage, sessionId, message),
	listAvailableTools: () => ipcRenderer.invoke(IPC_CHANNELS.agentListAvailableTools),
};

contextBridge.exposeInMainWorld("windowsClient", api);
