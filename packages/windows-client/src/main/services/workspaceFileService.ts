import type { Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { WorkspaceFileInfo, WorkspaceFileListResult, WorkspaceFileReadResult } from "../../shared/types";
import type { AuditLogger } from "./auditLogger";
import type { WorkspaceService } from "./workspaceService";

const MAX_FILES = 120;
const MAX_READ_BYTES = 256 * 1024;

export class WorkspaceFileService {
	constructor(
		private readonly workspaceService: WorkspaceService,
		private readonly auditLogger: AuditLogger,
	) {}

	async listFiles(workspaceOverridePath?: string | null): Promise<WorkspaceFileListResult> {
		const workspace = workspaceOverridePath ? { path: workspaceOverridePath } : await this.workspaceService.getWorkspace();
		if (!workspace.path) {
			return { workspacePath: null, files: [] };
		}

		const workspacePath = resolve(workspace.path);
		const files = await this.walk(workspacePath, workspacePath);

		await this.auditLogger.write({
			timestamp: new Date().toISOString(),
			workspacePath,
			toolName: "workspace-file-service",
			businessAction: "list-workspace-files",
			outputSummary: `列出工作区文件：${files.length} 项。`,
			batch: false,
			status: "success",
		});

		return { workspacePath, files };
	}

	async readFile(relativePath: string, workspaceOverridePath?: string | null): Promise<WorkspaceFileReadResult> {
		const workspace = workspaceOverridePath ? { path: workspaceOverridePath } : await this.workspaceService.getWorkspace();
		if (!workspace.path) {
			throw new Error("请先选择工作区。");
		}

		const workspacePath = resolve(workspace.path);
		const absolutePath = this.resolveInsideWorkspace(workspacePath, relativePath);
		const fileStat = await stat(absolutePath);

		if (!fileStat.isFile()) {
			throw new Error("只能读取工作区内的文件。");
		}

		if (fileStat.size > MAX_READ_BYTES) {
			throw new Error("文件超过当前预览大小限制。");
		}

		const content = await readFile(absolutePath, "utf8");
		const file = this.toFileInfo(workspacePath, absolutePath, fileStat);

		await this.auditLogger.write({
			timestamp: new Date().toISOString(),
			workspacePath,
			toolName: "workspace-file-service",
			businessAction: "read-workspace-file",
			inputSummary: `读取工作区文件：${file.relativePath}`,
			outputSummary: `读取 ${content.length} 个字符。`,
			filesRead: [absolutePath],
			batch: false,
			status: "success",
		});

		return { file, content };
	}

	private async walk(workspacePath: string, currentPath: string): Promise<WorkspaceFileInfo[]> {
		const entries = await readdir(currentPath, { withFileTypes: true });
		const files: WorkspaceFileInfo[] = [];

		for (const entry of entries) {
			if (files.length >= MAX_FILES) {
				break;
			}

			if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "out") {
				continue;
			}

			const absolutePath = join(currentPath, entry.name);
			const fileStat = await stat(absolutePath);
			files.push(this.toFileInfo(workspacePath, absolutePath, fileStat));

			if (entry.isDirectory()) {
				const nestedFiles = await this.walk(workspacePath, absolutePath);
				files.push(...nestedFiles.slice(0, MAX_FILES - files.length));
			}
		}

		return files.slice(0, MAX_FILES);
	}

	private resolveInsideWorkspace(workspacePath: string, requestedPath: string): string {
		const absolutePath = resolve(workspacePath, requestedPath);
		const relativePath = relative(workspacePath, absolutePath);

		if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
			throw new Error("文件路径超出当前工作区。");
		}

		return absolutePath;
	}

	private toFileInfo(workspacePath: string, absolutePath: string, fileStat: Stats): WorkspaceFileInfo {
		return {
			name: absolutePath.split(/[\\/]/).at(-1) ?? absolutePath,
			relativePath: relative(workspacePath, absolutePath),
			absolutePath,
			kind: fileStat.isDirectory() ? "directory" : "file",
			size: fileStat.size,
			updatedAt: fileStat.mtime.toISOString(),
		};
	}
}
