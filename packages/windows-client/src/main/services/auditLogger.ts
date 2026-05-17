import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import type { AuditLogEntry, AuditLogListResult } from "../../shared/types";

export class AuditLogger {
	private readonly logsDirectory: string;

	constructor(logsDirectory = join(app.getPath("userData"), "logs")) {
		this.logsDirectory = logsDirectory;
	}

	async write(entry: AuditLogEntry): Promise<void> {
		await mkdir(this.logsDirectory, { recursive: true });

		const day = entry.timestamp.slice(0, 10);
		const filePath = join(this.logsDirectory, `audit-${day}.jsonl`);
		await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
	}

	async listRecent(limit = 80): Promise<AuditLogListResult> {
		const today = new Date().toISOString().slice(0, 10);
		const filePath = join(this.logsDirectory, `audit-${today}.jsonl`);

		try {
			const raw = await readFile(filePath, "utf8");
			const entries = raw
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as AuditLogEntry)
				.sort((first, second) => second.timestamp.localeCompare(first.timestamp))
				.slice(0, limit);

			return { logFilePath: filePath, entries };
		} catch {
			return { logFilePath: null, entries: [] };
		}
	}
}
