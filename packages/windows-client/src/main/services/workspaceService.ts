import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, type BrowserWindow, dialog } from "electron";
import type { WorkspaceState } from "../../shared/types";
import type { AuditLogger } from "./auditLogger";

export class WorkspaceService {
	private readonly configPath = join(app.getPath("userData"), "workspace.json");

	constructor(private readonly auditLogger: AuditLogger) {}

	async getWorkspace(): Promise<WorkspaceState> {
		try {
			const raw = await readFile(this.configPath, "utf8");
			const parsed = JSON.parse(raw) as WorkspaceState;
			return {
				path: parsed.path ?? null,
				selectedAt: parsed.selectedAt ?? null,
			};
		} catch {
			return { path: null, selectedAt: null };
		}
	}

	async chooseWorkspace(window: BrowserWindow): Promise<WorkspaceState> {
		const result = await dialog.showOpenDialog(window, {
			title: "选择工作区",
			properties: ["openDirectory", "createDirectory"],
		});

		const selectedPath = result.filePaths[0];
		if (result.canceled || !selectedPath) {
			return this.getWorkspace();
		}

		const selectedAt = new Date().toISOString();
		const workspace: WorkspaceState = {
			path: selectedPath,
			selectedAt,
		};

		await mkdir(dirname(this.configPath), { recursive: true });
		await writeFile(this.configPath, JSON.stringify(workspace, null, 2), "utf8");

		await this.auditLogger.write({
			timestamp: selectedAt,
			workspacePath: workspace.path ?? undefined,
			toolName: "workspace-service",
			businessAction: "select-workspace",
			inputSummary: "用户选择了项目工作区目录。",
			outputSummary: workspace.path ?? undefined,
			batch: false,
			status: "success",
		});

		return workspace;
	}
}
