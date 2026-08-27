import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer as createNetServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserWindow } from "electron";
import type { AuditLogger } from "./auditLogger";

interface BrowserToolCapability {
	id: string;
	name: string;
	browserMode?: "builtin" | "chrome" | "mcp";
	browserAllowedDomains?: string[];
	browserBlockedDomains?: string[];
	browserAllowScreenshots?: boolean;
	browserAllowDownloads?: boolean;
	browserRequireConfirmation?: boolean;
	browserMaxSteps?: number;
	browserTimeoutMs?: number;
}

interface BrowserToolRequest {
	action: "open" | "extract" | "click" | "type" | "scroll" | "press" | "wait" | "back" | "reload" | "select";
	url?: string;
	ref?: number;
	selector?: string;
	text?: string;
	value?: string;
	exact?: boolean;
	submit?: boolean;
	direction?: "up" | "down" | "left" | "right";
	amount?: number;
	key?: string;
	timeoutMs?: number;
	capability?: BrowserToolCapability;
}

interface BrowserInteractiveElement {
	ref: number;
	role: string;
	text: string;
	selector: string;
	href?: string;
}

interface BrowserSnapshot {
	title: string;
	url: string;
	visibleText: string;
	interactiveElements: BrowserInteractiveElement[];
}

interface ChromeTarget {
	id?: string;
	webSocketDebuggerUrl?: string;
	url?: string;
	title?: string;
}

interface ChromeEvaluateResult {
	result?: {
		value?: BrowserSnapshot | BrowserClickResult | string | boolean;
	};
}

interface BrowserClickResult {
	ok: boolean;
	message: string;
	text?: string;
	selector?: string;
	href?: string;
}

export class BrowserToolService {
	private readonly token = randomUUID();
	private server: Server | null = null;
	private bridgeUrl: string | null = null;
	private browserWindow: BrowserWindow | null = null;
	private chromeProcess: ChildProcess | null = null;
	private chromeEndpoint: string | null = null;
	private chromeUserDataDir: string | null = null;
	private chromeTarget: ChromeTarget | null = null;

	constructor(private readonly auditLogger: AuditLogger) {}

	async getBridgeConfig(): Promise<{ url: string; token: string }> {
		if (this.bridgeUrl) {
			return { url: this.bridgeUrl, token: this.token };
		}

		this.server = createHttpServer((request, response) => {
			void this.handleRequest(request, response);
		});
		await new Promise<void>((resolvePromise, rejectPromise) => {
			this.server?.once("error", rejectPromise);
			this.server?.listen(0, "127.0.0.1", () => resolvePromise());
		});
		const address = this.server.address() as AddressInfo;
		this.bridgeUrl = `http://127.0.0.1:${address.port}/browser`;
		return { url: this.bridgeUrl, token: this.token };
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			if (request.method !== "POST" || request.url !== "/browser") {
				this.sendJson(response, 404, { error: "Browser bridge endpoint not found." });
				return;
			}
			if (request.headers.authorization !== `Bearer ${this.token}`) {
				this.sendJson(response, 401, { error: "Browser bridge authorization failed." });
				return;
			}

			const body = (await this.readBody(request)) as BrowserToolRequest;
			const result = await this.execute(body);
			this.sendJson(response, 200, result);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.sendJson(response, 500, { error: message });
		}
	}

	private async execute(request: BrowserToolRequest): Promise<BrowserSnapshot> {
		const capability = request.capability;
		if (capability?.browserMode === "chrome") {
			if (request.url) {
				await this.openChromeUrl(request.url, capability);
			}
			if (request.action === "click") {
				await this.clickChromeElement(request, capability);
			}
			if (request.action === "type") {
				await this.typeChromeElement(request, capability);
			}
			await this.runChromeSimpleAction(request, capability);
			const snapshot = await this.extractChromeVisibleText();
			await this.writeBrowserAudit(request, snapshot);
			return snapshot;
		}
		if (capability?.browserMode === "mcp") {
			throw new Error("MCP 浏览器模式需要配置并发现浏览器 MCP 工具；当前内置 bridge 不会代理 MCP 模式。");
		}

		if (request.url) {
			await this.openUrl(request.url, capability);
		}
		if (request.action === "click") {
			await this.clickVisibleElement(request, capability);
		}
		if (request.action === "type") {
			await this.typeVisibleElement(request, capability);
		}
		await this.runBuiltinSimpleAction(request, capability);
		const snapshot = await this.extractVisibleText();
		await this.writeBrowserAudit(request, snapshot);
		return snapshot;
	}

	private async writeBrowserAudit(request: BrowserToolRequest, snapshot: BrowserSnapshot): Promise<void> {
		await this.auditLogger.write({
			timestamp: new Date().toISOString(),
			toolName:
				request.action === "open"
					? "browser_open"
					: request.action === "click"
						? "browser_click"
						: request.action === "type"
							? "browser_type"
							: `browser_${request.action === "extract" ? "extract" : request.action}`,
			businessAction: "browser-tool",
			inputSummary: request.url,
			outputSummary: `${snapshot.title} ${snapshot.url}`,
			batch: false,
			status: "success",
		});
	}

	private async openUrl(value: string, capability: BrowserToolCapability | undefined): Promise<void> {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			throw new Error("浏览器工具只允许打开 http 或 https 地址。");
		}
		this.assertDomainAllowed(url, capability);

		const window = this.getOrCreateWindow();
		const timeoutMs = capability?.browserTimeoutMs ?? 120000;
		await Promise.race([
			window.loadURL(url.toString()),
			new Promise((_, rejectPromise) =>
				setTimeout(() => rejectPromise(new Error("浏览器打开页面超时。")), timeoutMs),
			),
		]);
	}

	private async extractVisibleText(): Promise<BrowserSnapshot> {
		const window = this.getOrCreateWindow();
		return window.webContents.executeJavaScript(this.createSnapshotScript(), true) as Promise<BrowserSnapshot>;
	}

	private async clickVisibleElement(
		request: BrowserToolRequest,
		capability: BrowserToolCapability | undefined,
	): Promise<void> {
		const window = this.getOrCreateWindow();
		const result = (await window.webContents.executeJavaScript(
			this.createClickScript(request),
			true,
		)) as BrowserClickResult;
		if (!result.ok) {
			throw new Error(result.message);
		}
		await new Promise((resolvePromise) =>
			setTimeout(resolvePromise, Math.min(capability?.browserTimeoutMs ?? 1500, 1500)),
		);
	}

	private async typeVisibleElement(
		request: BrowserToolRequest,
		capability: BrowserToolCapability | undefined,
	): Promise<void> {
		const window = this.getOrCreateWindow();
		const result = (await window.webContents.executeJavaScript(
			this.createTypeScript(request),
			true,
		)) as BrowserClickResult;
		if (!result.ok) {
			throw new Error(result.message);
		}
		await new Promise((resolvePromise) =>
			setTimeout(resolvePromise, Math.min(capability?.browserTimeoutMs ?? 1500, 1500)),
		);
	}

	private async runBuiltinSimpleAction(
		request: BrowserToolRequest,
		capability: BrowserToolCapability | undefined,
	): Promise<void> {
		const window = this.getOrCreateWindow();
		if (request.action === "scroll") {
			await window.webContents.executeJavaScript(this.createScrollScript(request), true);
			await this.sleep(300);
			return;
		}
		if (request.action === "press") {
			const key = request.key || "Enter";
			window.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
			window.webContents.sendInputEvent({ type: "keyUp", keyCode: key });
			await this.sleep(500);
			return;
		}
		if (request.action === "wait") {
			await this.waitForBuiltinText(request.text, request.timeoutMs ?? capability?.browserTimeoutMs ?? 10000);
			return;
		}
		if (request.action === "back") {
			if (window.webContents.canGoBack()) {
				window.webContents.goBack();
			}
			await this.sleep(1000);
			return;
		}
		if (request.action === "reload") {
			window.webContents.reload();
			await this.sleep(1000);
			return;
		}
		if (request.action === "select") {
			const result = (await window.webContents.executeJavaScript(
				this.createSelectScript(request),
				true,
			)) as BrowserClickResult;
			if (!result.ok) {
				throw new Error(result.message);
			}
			await this.sleep(500);
		}
	}

	private async openChromeUrl(value: string, capability: BrowserToolCapability | undefined): Promise<void> {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			throw new Error("浏览器工具只允许打开 http 或 https 地址。");
		}
		this.assertDomainAllowed(url, capability);

		const endpoint = await this.ensureChromeEndpoint();
		const target = await this.createChromeTarget(endpoint, url.toString());
		this.chromeTarget = target;
		const client = await CdpClient.connect(this.requireChromeWebSocket(target));
		try {
			await client.send("Page.enable");
			await client.send("Runtime.enable");
			await client.send("Page.navigate", { url: url.toString() });
			await this.waitForChromePageReady(client, capability?.browserTimeoutMs ?? 120000);
		} finally {
			client.close();
		}
	}

	private async extractChromeVisibleText(): Promise<BrowserSnapshot> {
		const endpoint = await this.ensureChromeEndpoint();
		const target = this.chromeTarget ?? (await this.findChromePageTarget(endpoint));
		if (!target) {
			throw new Error("没有可用的 Chrome 页面，请先调用 browser_open 打开网页。");
		}

		const client = await CdpClient.connect(this.requireChromeWebSocket(target));
		try {
			await client.send("Runtime.enable");
			const result = (await client.send("Runtime.evaluate", {
				expression: this.createSnapshotScript(),
				returnByValue: true,
			})) as ChromeEvaluateResult;
			const value = result.result?.value;
			if (this.isBrowserSnapshot(value)) {
				return value;
			}
			throw new Error("Chrome 页面内容提取失败。");
		} finally {
			client.close();
		}
	}

	private async clickChromeElement(
		request: BrowserToolRequest,
		capability: BrowserToolCapability | undefined,
	): Promise<void> {
		const endpoint = await this.ensureChromeEndpoint();
		const target = this.chromeTarget ?? (await this.findChromePageTarget(endpoint));
		if (!target) {
			throw new Error("没有可用的 Chrome 页面，请先调用 browser_open 打开网页。");
		}

		const client = await CdpClient.connect(this.requireChromeWebSocket(target));
		try {
			await client.send("Runtime.enable");
			const result = (await client.send("Runtime.evaluate", {
				expression: this.createClickScript(request),
				returnByValue: true,
			})) as ChromeEvaluateResult;
			const value = result.result?.value;
			if (!this.isBrowserClickResult(value) || !value.ok) {
				throw new Error(this.isBrowserClickResult(value) ? value.message : "Chrome 页面点击失败。");
			}
			await new Promise((resolvePromise) =>
				setTimeout(resolvePromise, Math.min(capability?.browserTimeoutMs ?? 1500, 1500)),
			);
			await this.waitForChromePageReady(client, Math.min(capability?.browserTimeoutMs ?? 10000, 10000));
		} finally {
			client.close();
		}
	}

	private async typeChromeElement(
		request: BrowserToolRequest,
		capability: BrowserToolCapability | undefined,
	): Promise<void> {
		const endpoint = await this.ensureChromeEndpoint();
		const target = this.chromeTarget ?? (await this.findChromePageTarget(endpoint));
		if (!target) {
			throw new Error("没有可用的 Chrome 页面，请先调用 browser_open 打开网页。");
		}

		const client = await CdpClient.connect(this.requireChromeWebSocket(target));
		try {
			await client.send("Runtime.enable");
			const result = (await client.send("Runtime.evaluate", {
				expression: this.createTypeScript(request),
				returnByValue: true,
			})) as ChromeEvaluateResult;
			const value = result.result?.value;
			if (!this.isBrowserClickResult(value) || !value.ok) {
				throw new Error(this.isBrowserClickResult(value) ? value.message : "Chrome 页面输入失败。");
			}
			await new Promise((resolvePromise) =>
				setTimeout(resolvePromise, Math.min(capability?.browserTimeoutMs ?? 1500, 1500)),
			);
			if (request.submit) {
				await this.waitForChromePageReady(client, Math.min(capability?.browserTimeoutMs ?? 10000, 10000));
			}
		} finally {
			client.close();
		}
	}

	private async runChromeSimpleAction(
		request: BrowserToolRequest,
		capability: BrowserToolCapability | undefined,
	): Promise<void> {
		if (!["scroll", "press", "wait", "back", "reload", "select"].includes(request.action)) {
			return;
		}
		const endpoint = await this.ensureChromeEndpoint();
		const target = this.chromeTarget ?? (await this.findChromePageTarget(endpoint));
		if (!target) {
			throw new Error("没有可用的 Chrome 页面，请先调用 browser_open 打开网页。");
		}

		const client = await CdpClient.connect(this.requireChromeWebSocket(target));
		try {
			await client.send("Runtime.enable");
			if (request.action === "scroll") {
				await client.send("Runtime.evaluate", {
					expression: this.createScrollScript(request),
					returnByValue: true,
				});
				await this.sleep(300);
				return;
			}
			if (request.action === "press") {
				const key = request.key || "Enter";
				await client.send("Input.dispatchKeyEvent", { type: "keyDown", key });
				await client.send("Input.dispatchKeyEvent", { type: "keyUp", key });
				await this.sleep(500);
				return;
			}
			if (request.action === "wait") {
				await this.waitForChromeText(
					client,
					request.text,
					request.timeoutMs ?? capability?.browserTimeoutMs ?? 10000,
				);
				return;
			}
			if (request.action === "back") {
				await client.send("Runtime.evaluate", { expression: "history.back()", returnByValue: true });
				await this.sleep(1000);
				return;
			}
			if (request.action === "reload") {
				await client.send("Page.reload");
				await this.waitForChromePageReady(client, Math.min(capability?.browserTimeoutMs ?? 10000, 10000));
				return;
			}
			if (request.action === "select") {
				const result = (await client.send("Runtime.evaluate", {
					expression: this.createSelectScript(request),
					returnByValue: true,
				})) as ChromeEvaluateResult;
				const value = result.result?.value;
				if (!this.isBrowserClickResult(value) || !value.ok) {
					throw new Error(this.isBrowserClickResult(value) ? value.message : "Chrome 下拉选择失败。");
				}
				await this.sleep(500);
			}
		} finally {
			client.close();
		}
	}

	private createSnapshotScript(): string {
		return `(() => {
			function textOf(element) {
				return (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || element.value || "").trim().replace(/\\s+/g, " ");
			}
			function isVisible(element) {
				const rect = element.getBoundingClientRect();
				const style = window.getComputedStyle(element);
				return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight && style.visibility !== "hidden" && style.display !== "none";
			}
			function cssPath(element) {
				if (element.id) return "#" + CSS.escape(element.id);
				const parts = [];
				let current = element;
				while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
					let part = current.tagName.toLowerCase();
					const parent = current.parentElement;
					if (parent) {
						const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
						if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
					}
					parts.unshift(part);
					current = parent;
				}
				return parts.join(" > ");
			}
			const visibleTexts = [];
			const textElements = Array.from(document.body?.querySelectorAll("body, main, article, section, h1, h2, h3, p, li, td, th, a, button, span, div") ?? []);
			for (const element of textElements) {
				if (!isVisible(element)) continue;
				const text = textOf(element);
				if (text && text.length <= 500) visibleTexts.push(text);
			}
			const interactiveElements = [];
			const clickableElements = Array.from(document.body?.querySelectorAll('a, button, input[type="button"], input[type="submit"], input[type="search"], input[type="text"], [role="button"], [role="link"], [onclick]') ?? []);
			for (const element of clickableElements) {
				if (!isVisible(element)) continue;
				const text = textOf(element) || element.placeholder || element.name || element.id || element.tagName.toLowerCase();
				interactiveElements.push({
					ref: interactiveElements.length + 1,
					role: element.getAttribute("role") || element.tagName.toLowerCase(),
					text: text.slice(0, 160),
					selector: cssPath(element),
					href: element.href || element.getAttribute("href") || undefined,
				});
				if (interactiveElements.length >= 40) break;
			}
			return {
				title: document.title,
				url: location.href,
				visibleText: Array.from(new Set(visibleTexts)).join("\\n").slice(0, 12000),
				interactiveElements,
			};
		})()`;
	}

	private createClickScript(request: BrowserToolRequest): string {
		const query = JSON.stringify({
			ref: request.ref,
			selector: request.selector?.trim() || "",
			text: request.text?.trim() || "",
			exact: request.exact ?? false,
		});
		return `(() => {
			const query = ${query};
			function textOf(element) {
				return (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || element.value || "").trim().replace(/\\s+/g, " ");
			}
			function isVisible(element) {
				const rect = element.getBoundingClientRect();
				const style = window.getComputedStyle(element);
				return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
			}
			function cssPath(element) {
				if (element.id) return "#" + CSS.escape(element.id);
				const parts = [];
				let current = element;
				while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
					let part = current.tagName.toLowerCase();
					const parent = current.parentElement;
					if (parent) {
						const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
						if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
					}
					parts.unshift(part);
					current = parent;
				}
				return parts.join(" > ");
			}
			const allCandidates = Array.from(document.body?.querySelectorAll('a, button, input[type="button"], input[type="submit"], input[type="search"], input[type="text"], [role="button"], [role="link"], [onclick]') ?? []).filter(isVisible);
			const candidates = query.selector
				? [document.querySelector(query.selector)].filter(Boolean)
				: query.ref
					? [allCandidates[query.ref - 1]].filter(Boolean)
					: allCandidates;
			const target = candidates.find((element) => {
				if (!isVisible(element)) return false;
				if (!query.text) return true;
				const text = textOf(element);
				return query.exact ? text === query.text : text.includes(query.text);
			});
			if (!target) {
				return { ok: false, message: "No clickable element matched selector or text." };
			}
			target.scrollIntoView({ block: "center", inline: "center" });
			target.focus?.();
			target.click();
			return {
				ok: true,
				message: "Clicked element.",
				text: textOf(target),
				selector: cssPath(target),
				href: target.href || target.getAttribute("href") || undefined,
			};
		})()`;
	}

	private createTypeScript(request: BrowserToolRequest): string {
		const query = JSON.stringify({
			ref: request.ref,
			selector: request.selector?.trim() || "",
			text: request.text?.trim() || "",
			value: request.value ?? "",
			exact: request.exact ?? false,
			submit: request.submit ?? false,
		});
		return `(() => {
			const query = ${query};
			function textOf(element) {
				return (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || element.placeholder || element.name || element.id || element.value || "").trim().replace(/\\s+/g, " ");
			}
			function isVisible(element) {
				const rect = element.getBoundingClientRect();
				const style = window.getComputedStyle(element);
				return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
			}
			function cssPath(element) {
				if (element.id) return "#" + CSS.escape(element.id);
				const parts = [];
				let current = element;
				while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
					let part = current.tagName.toLowerCase();
					const parent = current.parentElement;
					if (parent) {
						const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
						if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
					}
					parts.unshift(part);
					current = parent;
				}
				return parts.join(" > ");
			}
			const inputSelector = 'input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"]';
			const allCandidates = Array.from(document.body?.querySelectorAll(inputSelector) ?? []).filter(isVisible);
			const candidates = query.selector
				? [document.querySelector(query.selector)].filter(Boolean)
				: query.ref
					? [allCandidates[query.ref - 1]].filter(Boolean)
					: allCandidates;
			const target = candidates.find((element) => {
				if (!isVisible(element)) return false;
				if (!query.text) return true;
				const text = textOf(element);
				return query.exact ? text === query.text : text.includes(query.text);
			});
			if (!target) {
				return { ok: false, message: "No input element matched selector, ref, or text." };
			}
			target.scrollIntoView({ block: "center", inline: "center" });
			target.focus?.();
			if (target.isContentEditable) {
				target.textContent = query.value;
			} else {
				target.value = query.value;
			}
			for (const type of ["input", "change"]) {
				target.dispatchEvent(new Event(type, { bubbles: true }));
			}
			if (query.submit) {
				target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
				target.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
				const form = target.closest?.("form");
				if (form?.requestSubmit) {
					form.requestSubmit();
				}
			}
			return {
				ok: true,
				message: "Typed into element.",
				text: textOf(target),
				selector: cssPath(target),
			};
		})()`;
	}

	private createScrollScript(request: BrowserToolRequest): string {
		const amount = Math.max(Math.min(request.amount ?? 700, 5000), 1);
		const direction = request.direction ?? "down";
		const x = direction === "left" ? -amount : direction === "right" ? amount : 0;
		const y = direction === "up" ? -amount : direction === "down" ? amount : 0;
		return `(() => { window.scrollBy(${x}, ${y}); return { ok: true, message: "Scrolled." }; })()`;
	}

	private createSelectScript(request: BrowserToolRequest): string {
		const query = JSON.stringify({
			ref: request.ref,
			selector: request.selector?.trim() || "",
			text: request.text?.trim() || "",
			value: request.value ?? "",
			exact: request.exact ?? false,
		});
		return `(() => {
			const query = ${query};
			function textOf(element) {
				return (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || element.name || element.id || "").trim().replace(/\\s+/g, " ");
			}
			function isVisible(element) {
				const rect = element.getBoundingClientRect();
				const style = window.getComputedStyle(element);
				return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
			}
			const allCandidates = Array.from(document.body?.querySelectorAll("select") ?? []).filter(isVisible);
			const candidates = query.selector
				? [document.querySelector(query.selector)].filter(Boolean)
				: query.ref
					? [allCandidates[query.ref - 1]].filter(Boolean)
					: allCandidates;
			const target = candidates.find((element) => {
				if (!isVisible(element)) return false;
				if (!query.text) return true;
				const text = textOf(element);
				return query.exact ? text === query.text : text.includes(query.text);
			});
			if (!target) {
				return { ok: false, message: "No select element matched selector, ref, or text." };
			}
			const option = Array.from(target.options).find((item) => item.value === query.value || item.text.includes(query.value));
			if (!option) {
				return { ok: false, message: "No select option matched value." };
			}
			target.value = option.value;
			target.dispatchEvent(new Event("input", { bubbles: true }));
			target.dispatchEvent(new Event("change", { bubbles: true }));
			return { ok: true, message: "Selected option.", text: textOf(target), selector: query.selector };
		})()`;
	}

	private async waitForBuiltinText(text: string | undefined, timeoutMs: number): Promise<void> {
		if (!text?.trim()) {
			await this.sleep(Math.min(timeoutMs, 3000));
			return;
		}
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const snapshot = await this.extractVisibleText();
			if (snapshot.visibleText.includes(text)) {
				return;
			}
			await this.sleep(500);
		}
		throw new Error(`等待页面文本超时：${text}`);
	}

	private async waitForChromeText(client: CdpClient, text: string | undefined, timeoutMs: number): Promise<void> {
		if (!text?.trim()) {
			await this.sleep(Math.min(timeoutMs, 3000));
			return;
		}
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const result = (await client.send("Runtime.evaluate", {
				expression: `document.body?.innerText?.includes(${JSON.stringify(text)}) ?? false`,
				returnByValue: true,
			})) as ChromeEvaluateResult;
			if (result.result?.value === true) {
				return;
			}
			await this.sleep(500);
		}
		throw new Error(`等待页面文本超时：${text}`);
	}

	private sleep(milliseconds: number): Promise<void> {
		return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
	}

	private async ensureChromeEndpoint(): Promise<string> {
		if (this.chromeEndpoint && this.chromeProcess && !this.chromeProcess.killed) {
			return this.chromeEndpoint;
		}

		const chromePath = this.findChromeExecutable();
		if (!chromePath) {
			throw new Error("未找到本机 Chrome，可先使用内置受控浏览器，或安装 Google Chrome。");
		}

		const port = await this.getFreePort();
		this.chromeUserDataDir = await mkdtemp(join(tmpdir(), "pi-windows-chrome-"));
		this.chromeEndpoint = `http://127.0.0.1:${port}`;
		const chromeProcess = spawn(
			chromePath,
			[
				`--remote-debugging-port=${port}`,
				`--user-data-dir=${this.chromeUserDataDir}`,
				"--no-first-run",
				"--no-default-browser-check",
				"--new-window",
				"about:blank",
			],
			{ stdio: "ignore", windowsHide: false },
		);
		this.chromeProcess = chromeProcess;
		chromeProcess.on("exit", () => {
			this.chromeProcess = null;
			this.chromeEndpoint = null;
			this.chromeTarget = null;
		});
		await this.waitForChromeEndpoint(this.chromeEndpoint);
		return this.chromeEndpoint;
	}

	private async waitForChromeEndpoint(endpoint: string): Promise<void> {
		const deadline = Date.now() + 15000;
		while (Date.now() < deadline) {
			try {
				const response = await fetch(`${endpoint}/json/version`);
				if (response.ok) {
					return;
				}
			} catch {
				// Chrome is still starting.
			}
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
		}
		throw new Error("Chrome 远程调试端口启动超时。");
	}

	private async createChromeTarget(endpoint: string, url: string): Promise<ChromeTarget> {
		const encodedUrl = encodeURIComponent(url);
		const response = await fetch(`${endpoint}/json/new?${encodedUrl}`, { method: "PUT" });
		if (!response.ok) {
			throw new Error(`Chrome 新建页面失败：HTTP ${response.status}`);
		}
		const target = (await response.json()) as ChromeTarget;
		if (!target.webSocketDebuggerUrl) {
			throw new Error("Chrome 新建页面未返回 DevTools WebSocket 地址。");
		}
		return target;
	}

	private async findChromePageTarget(endpoint: string): Promise<ChromeTarget | null> {
		const response = await fetch(`${endpoint}/json/list`);
		if (!response.ok) {
			return null;
		}
		const targets = (await response.json()) as ChromeTarget[];
		return targets.find((target) => target.webSocketDebuggerUrl && target.url?.startsWith("http")) ?? null;
	}

	private async waitForChromePageReady(client: CdpClient, timeoutMs: number): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const result = (await client.send("Runtime.evaluate", {
				expression: "document.readyState",
				returnByValue: true,
			})) as ChromeEvaluateResult;
			const value = result.result?.value;
			if (value === "complete" || value === "interactive") {
				await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
				return;
			}
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
		}
		throw new Error("Chrome 页面加载超时。");
	}

	private requireChromeWebSocket(target: ChromeTarget): string {
		if (!target.webSocketDebuggerUrl) {
			throw new Error("Chrome 页面没有可用的 DevTools WebSocket 地址。");
		}
		return target.webSocketDebuggerUrl;
	}

	private findChromeExecutable(): string | null {
		const candidates = [
			process.env.CHROME_PATH,
			process.platform === "darwin"
				? join("/Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome")
				: undefined,
			process.platform === "darwin"
				? join(homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome")
				: undefined,
			process.env.LOCALAPPDATA
				? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
				: undefined,
			process.env.PROGRAMFILES
				? join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe")
				: undefined,
			process.env["PROGRAMFILES(X86)"]
				? join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")
				: undefined,
		];
		return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null;
	}

	private getFreePort(): Promise<number> {
		return new Promise((resolvePromise, rejectPromise) => {
			const server = createNetServer();
			server.once("error", rejectPromise);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address() as AddressInfo;
				server.close(() => resolvePromise(address.port));
			});
		});
	}

	private getOrCreateWindow(): BrowserWindow {
		if (this.browserWindow && !this.browserWindow.isDestroyed()) {
			return this.browserWindow;
		}

		this.browserWindow = new BrowserWindow({
			width: 1280,
			height: 900,
			show: false,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		this.browserWindow.on("closed", () => {
			this.browserWindow = null;
		});
		return this.browserWindow;
	}

	private assertDomainAllowed(url: URL, capability: BrowserToolCapability | undefined): void {
		const hostname = url.hostname.toLowerCase();
		const blocked = capability?.browserBlockedDomains ?? [];
		if (blocked.some((domain) => this.matchesDomain(hostname, domain))) {
			throw new Error(`浏览器能力禁止访问该域名：${hostname}`);
		}

		const allowed = capability?.browserAllowedDomains ?? [];
		if (allowed.length > 0 && !allowed.some((domain) => this.matchesDomain(hostname, domain))) {
			throw new Error(`浏览器能力未允许访问该域名：${hostname}`);
		}
	}

	private matchesDomain(hostname: string, domain: string): boolean {
		const normalized = domain
			.trim()
			.toLowerCase()
			.replace(/^https?:\/\//, "")
			.split("/")[0];
		return hostname === normalized || hostname.endsWith(`.${normalized}`);
	}

	private readBody(request: IncomingMessage): Promise<unknown> {
		return new Promise((resolvePromise, rejectPromise) => {
			let body = "";
			request.setEncoding("utf8");
			request.on("data", (chunk: string) => {
				body += chunk;
				if (body.length > 1024 * 1024) {
					rejectPromise(new Error("Browser bridge request is too large."));
				}
			});
			request.on("end", () => {
				try {
					resolvePromise(body ? JSON.parse(body) : {});
				} catch {
					rejectPromise(new Error("Browser bridge request is not valid JSON."));
				}
			});
			request.on("error", rejectPromise);
		});
	}

	private sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
		response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
		response.end(JSON.stringify(data));
	}

	private isBrowserSnapshot(value: unknown): value is BrowserSnapshot {
		return (
			value !== null && typeof value === "object" && "title" in value && "url" in value && "visibleText" in value
		);
	}

	private isBrowserClickResult(value: unknown): value is BrowserClickResult {
		return value !== null && typeof value === "object" && "ok" in value && "message" in value;
	}
}

class CdpClient {
	private requestId = 0;
	private readonly pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
		}
	>();

	private constructor(private readonly socket: WebSocket) {}

	static connect(url: string): Promise<CdpClient> {
		return new Promise((resolvePromise, rejectPromise) => {
			const socket = new WebSocket(url);
			const client = new CdpClient(socket);
			socket.addEventListener("open", () => resolvePromise(client), { once: true });
			socket.addEventListener("error", () => rejectPromise(new Error("连接 Chrome DevTools WebSocket 失败。")), {
				once: true,
			});
			socket.addEventListener("message", (event: MessageEvent) => {
				client.handleMessage(event.data);
			});
		});
	}

	send(method: string, params?: Record<string, unknown>): Promise<unknown> {
		const id = ++this.requestId;
		const payload = JSON.stringify({ id, method, params });
		return new Promise((resolvePromise, rejectPromise) => {
			this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
			this.socket.send(payload);
		});
	}

	close(): void {
		this.socket.close();
	}

	private handleMessage(data: unknown): void {
		if (typeof data !== "string") {
			return;
		}
		const message = JSON.parse(data) as {
			id?: number;
			result?: unknown;
			error?: { message?: string };
		};
		if (!message.id) {
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		this.pending.delete(message.id);
		if (message.error) {
			pending.reject(new Error(message.error.message ?? "Chrome DevTools command failed."));
			return;
		}
		pending.resolve(message.result);
	}
}
