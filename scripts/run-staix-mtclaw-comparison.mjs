import "./benchmark-dom-shim.mjs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { app } from "electron";
import { RpcAgentAdapter } from "../packages/windows-client/src/main/agent/agentAdapter.ts";
import { AgentService } from "../packages/windows-client/src/main/services/agentService.ts";
import { AuditLogger } from "../packages/windows-client/src/main/services/auditLogger.ts";
import { BrowserToolService } from "../packages/windows-client/src/main/services/browserToolService.ts";
import { CivilDocumentToolService } from "../packages/windows-client/src/main/services/civilDocumentToolService.ts";
import { SubagentBridgeService } from "../packages/windows-client/src/main/services/subagentBridgeService.ts";

const projectRoot = process.cwd();
const sourceConfigPath = join(homedir(), "AppData", "Roaming", "Staix", "config.json");
const tasksPath = join(projectRoot, "benchmarks", "staix-mtclaw-comparison", "tasks.json");
const routerTemplatePath = join(projectRoot, "mtclaw-integration", "config.local.json");
const mtclawSourceRoot = join(projectRoot, "MTClaw");
const defaultOutputRoot = join(projectRoot, "output", "benchmarks");
const argumentsList = process.argv.slice(2);
const pilot = argumentsList.includes("--pilot");
const resume = !argumentsList.includes("--no-resume");
const outputArgumentIndex = argumentsList.indexOf("--output");
const onlyTaskArgumentIndex = argumentsList.indexOf("--only-task");
const onlyTaskId =
	onlyTaskArgumentIndex >= 0 && argumentsList[onlyTaskArgumentIndex + 1]
		? argumentsList[onlyTaskArgumentIndex + 1]
		: null;
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputDirectory = resolve(
	outputArgumentIndex >= 0 && argumentsList[outputArgumentIndex + 1]
		? argumentsList[outputArgumentIndex + 1]
		: join(defaultOutputRoot, `${pilot ? "pilot" : "full"}-${runId}`),
);
const rawResultsPath = join(outputDirectory, "raw-results.jsonl");
const workspacePath = join(outputDirectory, "workspace");
const isolatedUserDataPath = join(outputDirectory, "electron-user-data");

app.setPath("userData", isolatedUserDataPath);
process.env.NODE_ENV = "development";
process.env.PI_WINDOWS_CLIENT_NODE_PATH ||= process.env.ComSpec ? "node.exe" : "node";

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

function log(message, data = undefined) {
	const line = data === undefined ? message : `${message} ${JSON.stringify(data)}`;
	process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

function redact(value) {
	return String(value)
		.replace(/("(?:api[_-]?key|token|authorization|password|secret)"\s*:\s*)"[^"]+"/gi, '$1"***"')
		.replace(/(bearer\s+)[a-z0-9._-]+/gi, "$1***");
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

function clone(value) {
	return structuredClone(value);
}

function csvCell(value) {
	return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function percentile(values, percentage) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.ceil((percentage / 100) * sorted.length) - 1;
	return sorted[Math.max(0, index)];
}

function summarizeResults(results) {
	const groups = [];
	for (const agentType of [
		"enterprise_due_diligence",
		"legal_research",
		"civil_litigation_document_generation",
	]) {
		for (const mode of ["direct", "mtclaw"]) {
			const matching = results.filter((result) => result.agentType === agentType && result.mode === mode);
			const durations = matching.filter((result) => result.executionSuccess).map((result) => result.durationMs);
			groups.push({
				agentType,
				mode,
				runs: matching.length,
				executionSuccesses: matching.filter((result) => result.executionSuccess).length,
				taskCompletionPasses: matching.filter((result) => result.taskCompletionPass).length,
				structurePasses: matching.filter((result) => result.structurePass).length,
				artifactPasses: matching.filter((result) => result.artifactPass).length,
				routeEvidencePasses: matching.filter((result) => result.routeEvidencePass).length,
				averageDurationMs:
					durations.length > 0 ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length) : null,
				p50DurationMs: percentile(durations, 50),
				p95DurationMs: percentile(durations, 95),
			});
		}
	}
	return groups;
}

function buildRecordedEvidenceText(result) {
	return [
		result.responseText,
		...(result.capabilityCalls ?? []).flatMap((call) => [call.toolName, call.outputSummary, call.fullOutput]),
	]
		.filter(Boolean)
		.join("\n");
}

function normalizeRecordedEvidence(result, task) {
	if (!task) return result;
	const evidenceText = buildRecordedEvidenceText(result);
	const structureChecks = task.checks.map((check) => ({ check, passed: evidenceText.includes(check) }));
	const delegationCall = (result.capabilityCalls ?? []).find(
		(call) => call.toolName === "delegate_to_subagent" && call.status === "success",
	);
	const roleEvent = (result.progressEvents ?? []).find((event) => event.subagentRole === task.agentType);
	const routerTraceEvent = (result.progressEvents ?? []).find(
		(event) => event.title.includes("MTClaw") && event.status === "success",
	);
	const routeEvidencePass =
		result.mode === "direct" || Boolean(delegationCall && roleEvent && (result.routerEvidence || routerTraceEvent));
	const artifactPass =
		task.agentType !== "civil_litigation_document_generation" || /(?:[A-Z]:\\|\/)[^\n"`]*\.docx\b/i.test(evidenceText);
	const taskCompletionPass =
		result.executionSuccess &&
		structureChecks.every((check) => check.passed) &&
		artifactPass &&
		routeEvidencePass;
	return {
		...result,
		structurePass: structureChecks.every((check) => check.passed),
		structureChecks,
		routeEvidencePass,
		artifactPass,
		taskCompletionPass,
		selectedRole: result.selectedRole ?? roleEvent?.subagentRole ?? null,
		routeEvidenceSources:
			result.mode === "mtclaw"
				? {
						delegationCall: delegationCall ?? null,
						subagentProgressEvent: roleEvent ?? null,
						routerTraceEvent: routerTraceEvent ?? null,
					}
				: null,
	};
}

function buildFunctionsDefinition() {
	return {
		name: "delegate_to_subagent",
		description:
			"将完整的专业任务委托给 Staix 配置的对应法律子智能体。根据用户任务本身选择角色，不要要求用户指定角色。",
		parameters: {
			type: "object",
			properties: {
				role: {
					type: "string",
					enum: [
						"enterprise_due_diligence",
						"legal_research",
						"civil_litigation_document_generation",
					],
					description: "与任务相匹配的专业子智能体角色。",
				},
				objective: { type: "string", description: "需要专业子智能体完成的完整目标。" },
				context: { type: "string", description: "必要的事实、约束或材料上下文。" },
			},
			required: ["role", "objective"],
			additionalProperties: false,
		},
	};
}

async function createRouterFiles(baseConfig) {
	const functionsPath = join(outputDirectory, "router-functions.jsonl");
	const configPath = join(outputDirectory, "router-config.json");
	await writeFile(functionsPath, `${JSON.stringify(buildFunctionsDefinition())}\n`, "utf8");
	const config = clone(baseConfig);
	config.listen_host = "127.0.0.1";
	config.functions_file = functionsPath;
	config.scripts_dir = join(projectRoot, "mtclaw-integration", "scripts");
	config.tools_base_dir = projectRoot;
	config.debug_logging = { enabled: true };
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	return configPath;
}

async function requestJson(url) {
	const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
	const text = await response.text();
	if (!response.ok) throw new Error(`HTTP ${response.status}: ${redact(text)}`);
	return text ? JSON.parse(text) : {};
}

async function waitForRouter(baseUrl, processHandle) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		if (processHandle.exitCode !== null) throw new Error(`MTClaw Router exited with code ${processHandle.exitCode}.`);
		try {
			const health = await requestJson(`${baseUrl}/health`);
			const ready = await requestJson(`${baseUrl}/ready`);
			return { health, ready };
		} catch {
			await sleep(500);
		}
	}
	throw new Error("MTClaw Router did not become ready within 30 seconds.");
}

async function startRouter(config, routerConfigPath) {
	const rootUrl = config.mtclawRouter.baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
	try {
		const health = await requestJson(`${rootUrl}/health`);
		const ready = await requestJson(`${rootUrl}/ready`);
		log("Reusing an already-running MTClaw Router.");
		return { process: null, rootUrl, health, ready };
	} catch {
		// A local router is not running; start an isolated benchmark router below.
	}

	const defaultModel = config.model.models.find((model) => model.id === config.model.defaultModelId);
	const arkModel =
		config.model.models.find((model) => model.provider === "volcengine" && model.apiKeyValue) ?? defaultModel;
	const arkApiKey = process.env.ARK_API_KEY || arkModel?.apiKeyValue;
	if (!arkApiKey) throw new Error("ARK_API_KEY is unavailable in the environment or Staix model configuration.");

	const pythonPath = [mtclawSourceRoot, process.env.PYTHONPATH].filter(Boolean).join(";");
	const stdoutPath = join(outputDirectory, "router-stdout.log");
	const stderrPath = join(outputDirectory, "router-stderr.log");
	const processHandle = spawn("python", ["-m", "function_router.server", "--config", routerConfigPath], {
		cwd: projectRoot,
		env: { ...process.env, ARK_API_KEY: arkApiKey, PYTHONPATH: pythonPath },
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	processHandle.stdout.on("data", (chunk) => void appendFile(stdoutPath, chunk));
	processHandle.stderr.on("data", (chunk) => void appendFile(stderrPath, chunk));
	const state = await waitForRouter(rootUrl, processHandle);
	log("Started isolated MTClaw Router.", { pid: processHandle.pid });
	return { process: processHandle, rootUrl, ...state };
}

async function loadExistingResults() {
	if (!resume) return [];
	try {
		const raw = await readFile(rawResultsPath, "utf8");
		return raw
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	} catch {
		return [];
	}
}

async function fetchRouterEvidence(rootUrl, sessionId, startedAt, expectedRole) {
	try {
		const history = await requestJson(`${rootUrl}/v1/tool_history?limit=100`);
		const entries = Array.isArray(history.entries) ? history.entries : [];
		const startedAtMs = Date.parse(startedAt);
		const candidates = entries.filter(
			(entry) => entry.session_key === sessionId && Date.parse(entry.timestamp || "") >= startedAtMs,
		);
		const entry = candidates.at(-1) ?? null;
		const toolCalls = Array.isArray(entry?.tool_calls) ? entry.tool_calls : [];
		const delegatedCall = toolCalls.find((call) => call.name === "delegate_to_subagent");
		const rawArguments = delegatedCall?.arguments ?? delegatedCall?.input ?? {};
		const parsedArguments = typeof rawArguments === "string" ? JSON.parse(rawArguments) : rawArguments;
		return {
			entry,
			selectedRole: parsedArguments?.role ?? null,
			passed: Boolean(delegatedCall && parsedArguments?.role === expectedRole),
		};
	} catch (error) {
		return { entry: null, selectedRole: null, passed: false, error: redact(error instanceof Error ? error.message : error) };
	}
}

function firstProgressDuration(startedAt, progressEvents) {
	const first = progressEvents.find((event) => Date.parse(event.timestamp) >= Date.parse(startedAt));
	return first ? Math.max(0, Date.parse(first.timestamp) - Date.parse(startedAt)) : null;
}

async function executeCase({ task, mode, baseConfig, routerRootUrl }) {
	const caseWorkspacePath = join(workspacePath, task.id, mode);
	await mkdir(caseWorkspacePath, { recursive: true });
	const config = clone(baseConfig);
	config.mtclawRouter = { ...config.mtclawRouter, enabled: mode === "mtclaw" };
	const configService = {
		getConfig: async () => ({ configPath: sourceConfigPath, config }),
	};
	const workspaceService = {
		getWorkspace: async () => ({ path: caseWorkspacePath, selectedAt: new Date().toISOString() }),
	};
	const auditLogger = new AuditLogger(join(outputDirectory, "audit"));
	const browserToolService = new BrowserToolService(auditLogger);
	const civilDocumentToolService = new CivilDocumentToolService(auditLogger);
	const subagentBridgeService = new SubagentBridgeService();
	const adapter = new RpcAgentAdapter(
		() => browserToolService.getBridgeConfig(),
		() => subagentBridgeService.getBridgeConfig(),
		() => civilDocumentToolService.getBridgeConfig(),
	);
	const agentService = new AgentService(adapter, auditLogger, workspaceService, configService);
	subagentBridgeService.setHandler((request) => agentService.delegateSubagent(request));
	const wallStartedAt = new Date().toISOString();
	const wallStart = performance.now();
	let session = null;
	try {
		session = await agentService.startSession(config.defaultAgentId, caseWorkspacePath);
		const progressEvents = [];
		const result = await agentService.sendUserMessage(session.id, task.prompt, undefined, (event) => {
			progressEvents.push(event);
		});
		const durationMs = Math.round(performance.now() - wallStart);
		const routerEvidence =
			mode === "mtclaw"
				? await fetchRouterEvidence(routerRootUrl, session.id, wallStartedAt, task.agentType)
				: { entry: null, selectedRole: null, passed: true };
		return normalizeRecordedEvidence({
			taskId: task.id,
			title: task.title,
			agentType: task.agentType,
			mode,
			prompt: task.prompt,
			sessionId: session.id,
			startedAt: wallStartedAt,
			endedAt: new Date().toISOString(),
			durationMs,
			firstProgressMs: firstProgressDuration(wallStartedAt, progressEvents),
			executionSuccess: Boolean(result.responseText.trim()),
			structurePass: false,
			structureChecks: [],
			routeEvidencePass: routerEvidence.passed,
			selectedRole: routerEvidence.selectedRole,
			routerEvidence: routerEvidence.entry,
			responseText: result.responseText,
			capabilityCalls: result.capabilityCalls ?? [],
			modelInteractions: result.modelInteractions ?? [],
			progressEvents: result.progressEvents ?? progressEvents,
			manualLegalReviewRequired: true,
			error: null,
		}, task);
	} catch (error) {
		return {
			taskId: task.id,
			title: task.title,
			agentType: task.agentType,
			mode,
			prompt: task.prompt,
			sessionId: session?.id ?? null,
			startedAt: wallStartedAt,
			endedAt: new Date().toISOString(),
			durationMs: Math.round(performance.now() - wallStart),
			firstProgressMs: null,
			executionSuccess: false,
			structurePass: false,
			structureChecks: task.checks.map((check) => ({ check, passed: false })),
			routeEvidencePass: false,
			selectedRole: null,
			routerEvidence: null,
			responseText: "",
			capabilityCalls: [],
			modelInteractions: [],
			progressEvents: [],
			manualLegalReviewRequired: true,
			error: redact(error instanceof Error ? error.stack || error.message : error),
		};
	} finally {
		if (session) {
			try {
				await agentService.stopSession(session.id);
			} catch {
				// The child runtime may already be stopped after a failed provider or tool call.
			}
		}
	}
}

async function writeReports(results, metadata) {
	const summary = summarizeResults(results);
	await writeFile(join(outputDirectory, "summary.json"), `${JSON.stringify({ metadata, summary }, null, 2)}\n`, "utf8");
	const csvHeader = [
		"taskId",
		"agentType",
		"mode",
		"executionSuccess",
		"taskCompletionPass",
		"structurePass",
		"artifactPass",
		"routeEvidencePass",
		"selectedRole",
		"durationMs",
		"firstProgressMs",
		"toolCalls",
		"modelInteractions",
		"error",
	].join(",");
	const csvRows = results.map((result) =>
		[
			result.taskId,
			result.agentType,
			result.mode,
			result.executionSuccess,
			result.taskCompletionPass,
			result.structurePass,
			result.artifactPass,
			result.routeEvidencePass,
			result.selectedRole,
			result.durationMs,
			result.firstProgressMs,
			result.capabilityCalls.length,
			result.modelInteractions.length,
			result.error,
		]
			.map(csvCell)
			.join(","),
	);
	await writeFile(join(outputDirectory, "results.csv"), `${csvHeader}\n${csvRows.join("\n")}\n`, "utf8");
	const markdownRows = summary.map(
		(group) =>
			`| ${group.agentType} | ${group.mode} | ${group.executionSuccesses}/${group.runs} | ${group.taskCompletionPasses}/${group.runs} | ${group.structurePasses}/${group.runs} | ${group.artifactPasses}/${group.runs} | ${group.routeEvidencePasses}/${group.runs} | ${group.averageDurationMs ?? "-"} | ${group.p95DurationMs ?? "-"} |`,
	);
	const failureLines = results
		.filter((result) => !result.executionSuccess)
		.map((result) => `- ${result.taskId}/${result.mode}: ${result.error}`);
	const report = [
		"# Staix / MTClaw 对照测试报告",
		"",
		`- 阶段：${metadata.stage}`,
		`- 开始时间：${metadata.startedAt}`,
		`- 完成时间：${metadata.endedAt}`,
		`- 完成运行：${results.length}`,
		"- 注意：结构检查不等于法律结论正确；完整回答需由专业人员人工复核。",
		"",
		"| 智能体 | 模式 | 执行成功 | 任务完成 | 结构通过 | 产物通过 | 路由通过 | 平均耗时(ms) | P95(ms) |",
		"|---|---:|---:|---:|---:|---:|---:|---:|---:|",
		...markdownRows,
		"",
		"## 失败运行",
		"",
		...(failureLines.length > 0 ? failureLines : ["无"]),
		"",
	];
	await writeFile(join(outputDirectory, "REPORT.md"), report.join("\n"), "utf8");
	const hashTargets = [rawResultsPath, join(outputDirectory, "summary.json"), join(outputDirectory, "results.csv")];
	const hashes = [];
	for (const path of hashTargets) {
		const digest = createHash("sha256").update(await readFile(path)).digest("hex");
		hashes.push(`${digest}  ${path.replace(`${outputDirectory}\\`, "")}`);
	}
	await writeFile(join(outputDirectory, "SHA256SUMS.txt"), `${hashes.join("\n")}\n`, "utf8");
}

async function main() {
	await mkdir(workspacePath, { recursive: true });
	await mkdir(isolatedUserDataPath, { recursive: true });
	await app.whenReady();
	const [baseConfig, taskSet, routerTemplate] = await Promise.all([
		readJson(sourceConfigPath),
		readJson(tasksPath),
		readJson(routerTemplatePath),
	]);
	const selectedTasks = onlyTaskId
		? taskSet.tasks.filter((task) => task.id === onlyTaskId)
		: pilot
			? [
				taskSet.tasks.find((task) => task.id === "enterprise-01"),
				taskSet.tasks.find((task) => task.id === "legal-01"),
				taskSet.tasks.find((task) => task.id === "civil-01"),
				].filter(Boolean)
			: taskSet.tasks;
	if (selectedTasks.length === 0) throw new Error(`Task not found: ${onlyTaskId}`);
	const routerConfigPath = await createRouterFiles(routerTemplate);
	const router = await startRouter(baseConfig, routerConfigPath);
	const startedAt = new Date().toISOString();
	const metadata = {
		stage: onlyTaskId ? `supplement:${onlyTaskId}` : pilot ? "pilot" : "full",
		startedAt,
		outputDirectory,
		taskSetVersion: taskSet.version,
		routerHealth: router.health,
		routerReady: router.ready,
		platform: process.platform,
		arch: process.arch,
		nodeVersion: process.version,
		electronVersion: process.versions.electron,
	};
	await writeFile(join(outputDirectory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
	const taskById = new Map(taskSet.tasks.map((task) => [task.id, task]));
	const results = (await loadExistingResults()).map((result) =>
		normalizeRecordedEvidence(result, taskById.get(result.taskId)),
	);
	const completed = new Set(results.map((result) => `${result.taskId}:${result.mode}`));
	try {
		for (const [taskIndex, task] of selectedTasks.entries()) {
			const modes = taskIndex % 2 === 0 ? ["direct", "mtclaw"] : ["mtclaw", "direct"];
			for (const mode of modes) {
				const resultKey = `${task.id}:${mode}`;
				if (completed.has(resultKey)) {
					log("Skipping completed run.", { taskId: task.id, mode });
					continue;
				}
				log("Starting run.", { taskId: task.id, agentType: task.agentType, mode });
				const result = await executeCase({ task, mode, baseConfig, routerRootUrl: router.rootUrl });
				await appendFile(rawResultsPath, `${JSON.stringify(result)}\n`, "utf8");
				results.push(result);
				completed.add(resultKey);
				log("Finished run.", {
					taskId: task.id,
					mode,
					executionSuccess: result.executionSuccess,
					structurePass: result.structurePass,
					routeEvidencePass: result.routeEvidencePass,
					durationMs: result.durationMs,
				});
			}
		}
		await writeReports(results, { ...metadata, endedAt: new Date().toISOString() });
		const pilotPass = results.every((result) => result.taskCompletionPass);
		await writeFile(join(outputDirectory, "stage-result.json"), `${JSON.stringify({ pilotPass }, null, 2)}\n`, "utf8");
		log("Benchmark stage completed.", { pilotPass, runs: results.length, outputDirectory });
		process.exitCode = pilotPass ? 0 : 2;
	} finally {
		if (router.process?.exitCode === null) router.process.kill("SIGTERM");
		app.quit();
	}
}

void main().catch((error) => {
	process.stderr.write(`${redact(error instanceof Error ? error.stack || error.message : error)}\n`);
	app.quit();
	process.exitCode = 1;
});
