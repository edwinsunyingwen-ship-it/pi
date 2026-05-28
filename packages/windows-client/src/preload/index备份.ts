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
	saveAgentConfig: (agent) => ipcRenderer.invoke(IPC_CHANNELS.configSaveAgent, agent),
	deleteAgentConfig: (id) => ipcRenderer.invoke(IPC_CHANNELS.configDeleteAgent, id),
	resetClientConfig: () => ipcRenderer.invoke(IPC_CHANNELS.configReset),
	getWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.getWorkspace),
	chooseWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.chooseWorkspace),
	listAuditLogs: (query) => ipcRenderer.invoke(IPC_CHANNELS.auditListLogs, query),
	listWorkspaceFiles: (workspacePath) => ipcRenderer.invoke(IPC_CHANNELS.workspaceListFiles, workspacePath),
	readWorkspaceFile: (relativePath, workspacePath) =>
		ipcRenderer.invoke(IPC_CHANNELS.workspaceReadFile, relativePath, workspacePath),
	startAgentSession: (agentId, workspacePath) =>
		ipcRenderer.invoke(IPC_CHANNELS.agentStartSession, agentId, workspacePath),
	stopAgentSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.agentStopSession, sessionId),
	getAgentSessionState: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.agentGetSessionState, sessionId),
	sendAgentUserMessage: (sessionId, message) =>
		ipcRenderer.invoke(IPC_CHANNELS.agentSendUserMessage, sessionId, message),
	listAvailableTools: () => ipcRenderer.invoke(IPC_CHANNELS.agentListAvailableTools),
};

contextBridge.exposeInMainWorld("windowsClient", api);
