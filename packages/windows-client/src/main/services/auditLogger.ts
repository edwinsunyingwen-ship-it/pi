import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import type { AuditLogEntry, AuditLogListResult, AuditLogQuery } from "../../shared/types";

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

	async listRecent(query: AuditLogQuery = {}): Promise<AuditLogListResult> {
		const now = new Date();
		const defaultStart = new Date(now);
		defaultStart.setDate(defaultStart.getDate() - 7);
		defaultStart.setHours(0, 0, 0, 0);
		const start = this.parseQueryDate(query.startTime, defaultStart);
		const end = this.parseQueryDate(query.endTime, now);
		const limit = Math.min(Math.max(Number(query.limit ?? 100), 1), 500);
		const offset = Math.max(Number(query.offset ?? 0), 0);
		const keyword = query.keyword?.trim().toLowerCase() ?? "";
		const files = this.getLogFilePaths(start, end);
		const entries: AuditLogEntry[] = [];

		for (const filePath of files) {
			try {
				const raw = await readFile(filePath, "utf8");
				for (const line of raw.split("\n")) {
					if (!line.trim()) {
						continue;
					}
					try {
						const entry = JSON.parse(line) as AuditLogEntry;
						if (!this.matchesQuery(entry, start, end, query, keyword)) {
							continue;
						}
						entries.push(entry);
					} catch {
						// Skip malformed lines so one bad record does not block the log view.
					}
				}
			} catch {
				// Missing days are normal when no actions were recorded.
			}
		}

		const sorted = entries.sort((first, second) => second.timestamp.localeCompare(first.timestamp));
		const paged = sorted.slice(offset, offset + limit);
		return {
			logFilePath: this.logsDirectory,
			entries: paged,
			total: sorted.length,
			hasMore: offset + limit < sorted.length,
		};
	}

	private parseQueryDate(value: string | undefined, fallback: Date): Date {
		if (!value) {
			return fallback;
		}
		const normalized = value.includes("T") ? value : value.replace(" ", "T");
		const parsed = new Date(normalized);
		return Number.isNaN(parsed.getTime()) ? fallback : parsed;
	}

	private getLogFilePaths(start: Date, end: Date): string[] {
		const paths: string[] = [];
		const cursor = new Date(start);
		cursor.setHours(0, 0, 0, 0);
		const final = new Date(end);
		final.setHours(0, 0, 0, 0);

		while (cursor <= final) {
			paths.push(join(this.logsDirectory, `audit-${this.formatLocalDate(cursor)}.jsonl`));
			cursor.setDate(cursor.getDate() + 1);
		}
		return paths;
	}

	private formatLocalDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}

	private matchesQuery(entry: AuditLogEntry, start: Date, end: Date, query: AuditLogQuery, keyword: string): boolean {
		const timestamp = new Date(entry.timestamp);
		if (Number.isNaN(timestamp.getTime()) || timestamp < start || timestamp > end) {
			return false;
		}
		if (query.businessAction && entry.businessAction !== query.businessAction) {
			return false;
		}
		if (query.status && entry.status !== query.status) {
			return false;
		}
		if (!keyword) {
			return true;
		}
		return [
			entry.businessAction,
			entry.toolName,
			entry.sessionId,
			entry.workflowId,
			entry.workspacePath,
			entry.inputSummary,
			entry.outputSummary,
			entry.errorMessage,
		]
			.filter(Boolean)
			.join(" ")
			.toLowerCase()
			.includes(keyword);
	}
}
