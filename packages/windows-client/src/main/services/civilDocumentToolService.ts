import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { AuditLogger } from "./auditLogger";

type CivilDocumentTemplate =
	| "civil_complaint_natural_person"
	| "civil_complaint_legal_entity"
	| "civil_defense_natural_person"
	| "civil_defense_legal_entity";

interface CivilDocumentRequest {
	workspacePath?: string;
	outputMode: "preview" | "docx";
	confirmed: boolean;
	template: CivilDocumentTemplate;
	partyLines: string[];
	opposingPartyLines?: string[];
	claims?: string[];
	factsAndReasons?: string[];
	caseReference?: string;
	defenseOpinions?: string[];
	evidence?: string[];
	court?: string;
	copies?: string;
	signatureName?: string;
	date?: string;
	fileName?: string;
}

interface CivilDocumentResult {
	template: CivilDocumentTemplate;
	documentTitle: "民事起诉状" | "民事答辩状";
	previewText: string;
	actualFileName?: string;
	filePath?: string;
	missingFields: string[];
}

interface CivilMaterialExtractionResult {
	path: string;
	fileType: "docx" | "pdf" | "text";
	text: string;
	usedOcr: false;
	needsOcr: boolean;
	pageCount?: number;
}

interface DocumentParagraph {
	text: string;
	style: "title" | "body" | "label" | "signature" | "blank";
}

interface ZipEntry {
	name: string;
	data: Buffer;
}

const missingValue = (field: string): string => `[待补充：${field}]`;

export class CivilDocumentToolService {
	private readonly token = randomUUID();
	private server: Server | null = null;
	private bridgeBaseUrl: string | null = null;

	constructor(private readonly auditLogger: AuditLogger) {}

	async getBridgeConfig(): Promise<{ generateUrl: string; extractUrl: string; token: string }> {
		if (this.bridgeBaseUrl) {
			return {
				generateUrl: `${this.bridgeBaseUrl}/civil-document/generate`,
				extractUrl: `${this.bridgeBaseUrl}/civil-document/extract`,
				token: this.token,
			};
		}

		this.server = createHttpServer((request, response) => {
			void this.handleRequest(request, response);
		});
		await new Promise<void>((resolvePromise, rejectPromise) => {
			this.server?.once("error", rejectPromise);
			this.server?.listen(0, "127.0.0.1", () => resolvePromise());
		});
		const address = this.server.address() as AddressInfo;
		this.bridgeBaseUrl = `http://127.0.0.1:${address.port}`;
		return {
			generateUrl: `${this.bridgeBaseUrl}/civil-document/generate`,
			extractUrl: `${this.bridgeBaseUrl}/civil-document/extract`,
			token: this.token,
		};
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			if (request.method !== "POST") {
				this.sendJson(response, 404, { error: "Civil document bridge endpoint not found." });
				return;
			}
			if (request.headers.authorization !== `Bearer ${this.token}`) {
				this.sendJson(response, 401, { error: "Civil document bridge authorization failed." });
				return;
			}

			const body = await this.readBody(request);
			if (request.url === "/civil-document/generate") {
				const result = await this.generateDocument(this.parseRequest(body));
				this.sendJson(response, 200, result);
				return;
			}
			if (request.url === "/civil-document/extract") {
				const result = await this.extractMaterial(body);
				this.sendJson(response, 200, result);
				return;
			}
			this.sendJson(response, 404, { error: "Civil document bridge endpoint not found." });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.sendJson(response, 500, { error: message });
		}
	}

	private async extractMaterial(value: unknown): Promise<CivilMaterialExtractionResult> {
		if (!this.isRecord(value)) {
			throw new Error("案件材料提取请求必须是 JSON 对象。");
		}
		const requestedPath = this.asString(value.path);
		if (!requestedPath || !isAbsolute(requestedPath)) {
			throw new Error("案件材料路径必须是有效的本地绝对路径。");
		}
		const path = resolve(requestedPath);
		const fileStat = await stat(path);
		if (!fileStat.isFile()) {
			throw new Error("案件材料路径不是文件。");
		}
		if (fileStat.size > 50 * 1024 * 1024) {
			throw new Error("案件材料超过 50 MB 限制。");
		}
		const extension = extname(path).toLowerCase();
		if (extension === ".txt" || extension === ".md") {
			return {
				path,
				fileType: "text",
				text: this.normalizeExtractedText(await readFile(path, "utf8")),
				usedOcr: false,
				needsOcr: false,
			};
		}
		const data = await readFile(path);
		if (extension === ".docx") {
			const text = this.normalizeExtractedText(this.extractDocxText(data));
			if (!text) {
				throw new Error("DOCX 中未提取到可用文本，请检查文件是否损坏或内容是否仅包含图片。");
			}
			return { path, fileType: "docx", text, usedOcr: false, needsOcr: false };
		}
		if (extension === ".pdf") {
			return this.extractPdfText(path, data);
		}
		throw new Error("目前仅支持 DOCX、文本型 PDF、TXT 和 Markdown；图片或扫描件请调用 OCR。");
	}

	private extractDocxText(data: Buffer): string {
		const documentXml = this.readZipEntry(data, "word/document.xml").toString("utf8");
		return this.decodeXmlText(
			documentXml
				.replace(/<w:tab\b[^>]*\/>/g, "\t")
				.replace(/<w:br\b[^>]*\/>/g, "\n")
				.replace(/<\/w:p>/g, "\n")
				.replace(/<[^>]+>/g, ""),
		);
	}

	private async extractPdfText(path: string, data: Buffer): Promise<CivilMaterialExtractionResult> {
		const loadingTask = getDocument({
			data: new Uint8Array(data),
			isEvalSupported: false,
			useSystemFonts: true,
		});
		const pdf = await loadingTask.promise;
		try {
			const pages: string[] = [];
			for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
				const page = await pdf.getPage(pageNumber);
				const content = await page.getTextContent();
				let pageText = "";
				for (const item of content.items) {
					if (!("str" in item) || typeof item.str !== "string") {
						continue;
					}
					pageText += item.str;
					pageText += item.hasEOL ? "\n" : " ";
				}
				pages.push(pageText);
			}
			const text = this.normalizeExtractedText(pages.join("\n\n"));
			return {
				path,
				fileType: "pdf",
				text,
				usedOcr: false,
				needsOcr: text.replace(/\s/g, "").length < 20,
				pageCount: pdf.numPages,
			};
		} finally {
			await pdf.destroy();
		}
	}

	private readZipEntry(archive: Buffer, expectedName: string): Buffer {
		const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
		const endOffset = archive.lastIndexOf(endSignature);
		if (endOffset < 0 || endOffset + 22 > archive.length) {
			throw new Error("DOCX ZIP 目录无效。");
		}
		const entryCount = archive.readUInt16LE(endOffset + 10);
		let offset = archive.readUInt32LE(endOffset + 16);
		for (let index = 0; index < entryCount; index++) {
			if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) {
				throw new Error("DOCX ZIP 条目无效。");
			}
			const compressionMethod = archive.readUInt16LE(offset + 10);
			const compressedSize = archive.readUInt32LE(offset + 20);
			const nameLength = archive.readUInt16LE(offset + 28);
			const extraLength = archive.readUInt16LE(offset + 30);
			const commentLength = archive.readUInt16LE(offset + 32);
			const localOffset = archive.readUInt32LE(offset + 42);
			const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
			if (name === expectedName) {
				if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) {
					throw new Error("DOCX ZIP 本地条目无效。");
				}
				const localNameLength = archive.readUInt16LE(localOffset + 26);
				const localExtraLength = archive.readUInt16LE(localOffset + 28);
				const dataStart = localOffset + 30 + localNameLength + localExtraLength;
				const compressed = archive.subarray(dataStart, dataStart + compressedSize);
				if (compressed.length !== compressedSize) {
					throw new Error("DOCX ZIP 条目数据不完整。");
				}
				if (compressionMethod === 0) return compressed;
				if (compressionMethod === 8) return inflateRawSync(compressed);
				throw new Error(`DOCX ZIP 使用了不支持的压缩方式：${compressionMethod}。`);
			}
			offset += 46 + nameLength + extraLength + commentLength;
		}
		throw new Error(`DOCX 缺少 ${expectedName}。`);
	}

	private decodeXmlText(value: string): string {
		return value
			.replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
			.replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/&amp;/g, "&");
	}

	private normalizeExtractedText(value: string): string {
		return value
			.replace(/\r\n?/g, "\n")
			.replace(/(\d)[ \t\n]+(?=\d)/g, "$1")
			.replace(/[ \t]+/g, " ")
			.replace(/ *\n */g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
	}

	private parseRequest(value: unknown): CivilDocumentRequest {
		if (!this.isRecord(value)) {
			throw new Error("文书生成请求必须是 JSON 对象。");
		}
		const template = value.template;
		if (!this.isTemplate(template)) {
			throw new Error("文书模板无效，只支持自然人/法人起诉状和自然人/法人答辩状。");
		}
		const outputMode = value.outputMode;
		if (outputMode !== "preview" && outputMode !== "docx") {
			throw new Error("文书输出模式无效，只支持 preview 或 docx。");
		}
		const confirmed = value.confirmed === true;
		if (outputMode === "docx" && !confirmed) {
			throw new Error("生成 DOCX 前必须取得用户明确确认，并将 confirmed 设为 true。");
		}
		const workspacePath = this.asString(value.workspacePath);
		if (outputMode === "docx" && (!workspacePath || !isAbsolute(workspacePath))) {
			throw new Error("生成 DOCX 前必须在 Staix 中选择有效的工作区。");
		}

		return {
			workspacePath: workspacePath || undefined,
			outputMode,
			confirmed,
			template,
			partyLines: this.asStringArray(value.partyLines),
			opposingPartyLines: this.asStringArray(value.opposingPartyLines),
			claims: this.asStringArray(value.claims),
			factsAndReasons: this.asStringArray(value.factsAndReasons),
			caseReference: this.asString(value.caseReference),
			defenseOpinions: this.asStringArray(value.defenseOpinions),
			evidence: this.asStringArray(value.evidence),
			court: this.asString(value.court),
			copies: this.asString(value.copies),
			signatureName: this.asString(value.signatureName),
			date: this.asString(value.date),
			fileName: this.asString(value.fileName),
		};
	}

	private async generateDocument(request: CivilDocumentRequest): Promise<CivilDocumentResult> {
		const missingFields: string[] = [];
		const paragraphs = this.buildParagraphs(request, missingFields);
		const previewText = paragraphs.map((paragraph) => paragraph.text).join("\n");
		const result: CivilDocumentResult = {
			template: request.template,
			documentTitle: this.isComplaint(request.template) ? "民事起诉状" : "民事答辩状",
			previewText,
			missingFields,
		};
		if (request.outputMode === "preview") {
			return result;
		}

		const workspacePath = request.workspacePath;
		if (!workspacePath) {
			throw new Error("生成 DOCX 前必须在 Staix 中选择有效的工作区。");
		}
		const outputDirectory = join(resolve(workspacePath), "generated-documents");
		await mkdir(outputDirectory, { recursive: true });
		const fileName = this.createFileName(request);
		const filePath = join(outputDirectory, fileName);
		const documentBuffer = this.createDocx(paragraphs);
		await writeFile(filePath, documentBuffer);

		await this.auditLogger.write({
			timestamp: new Date().toISOString(),
			workspacePath: resolve(workspacePath),
			toolName: "generate_civil_litigation_document",
			businessAction: "civil-litigation-document-generation",
			inputSummary: request.template,
			outputSummary: filePath,
			filesCreated: [filePath],
			batch: false,
			status: "success",
		});

		return { ...result, actualFileName: fileName, filePath };
	}

	private buildParagraphs(request: CivilDocumentRequest, missingFields: string[]): DocumentParagraph[] {
		const complaint = this.isComplaint(request.template);
		const legalEntity = request.template.endsWith("_legal_entity");
		const paragraphs: DocumentParagraph[] = [
			{ text: complaint ? "民事起诉状" : "民事答辩状", style: "title" },
			{ text: "", style: "blank" },
		];

		this.appendPartyLines(
			paragraphs,
			request.partyLines,
			complaint ? "原告" : "答辩人",
			complaint ? "原告基本信息" : "答辩人基本信息",
			missingFields,
		);
		if (complaint) {
			this.appendPartyLines(paragraphs, request.opposingPartyLines ?? [], "被告", "被告基本信息", missingFields);
		}
		paragraphs.push({ text: "", style: "blank" });

		if (complaint) {
			paragraphs.push({ text: "诉讼请求：", style: "label" });
			this.appendNumberedItems(paragraphs, request.claims ?? [], "诉讼请求", missingFields);
			paragraphs.push({ text: "", style: "blank" }, { text: "事实和理由：", style: "label" });
			this.appendRequiredLines(paragraphs, request.factsAndReasons ?? [], "事实和理由", missingFields);
		} else {
			const caseReference = request.caseReference || missingValue("受理法院、案号、当事人及案由");
			if (!request.caseReference) missingFields.push("受理法院、案号、当事人及案由");
			paragraphs.push({ text: `对${caseReference}一案的起诉，答辩如下：`, style: "body" });
			this.appendRequiredLines(paragraphs, request.defenseOpinions ?? [], "答辩意见", missingFields);
		}

		paragraphs.push({ text: "", style: "blank" }, { text: "证据和证据来源，证人姓名和住所：", style: "label" });
		this.appendRequiredLines(paragraphs, request.evidence ?? [], "证据和证据来源", missingFields);
		paragraphs.push({ text: "", style: "blank" }, { text: "此致", style: "body" });
		paragraphs.push({ text: request.court || missingValue("受理法院"), style: "body" });
		if (!request.court) missingFields.push("受理法院");
		paragraphs.push({ text: "", style: "blank" });
		const copies = request.copies || missingValue("副本份数");
		if (!request.copies) missingFields.push("副本份数");
		paragraphs.push({ text: `附：本${complaint ? "起诉状" : "答辩状"}副本${copies}份`, style: "body" });
		const signatureRole = complaint ? "起诉人" : "答辩人";
		const signatureMethod = legalEntity ? "公章和签名" : "签名";
		const signatureName = request.signatureName || missingValue(`${signatureRole}名称`);
		if (!request.signatureName) missingFields.push(`${signatureRole}名称`);
		const date = request.date || missingValue("签署日期");
		if (!request.date) missingFields.push("签署日期");
		paragraphs.push({
			text: `${signatureRole}(${signatureMethod})：${signatureName}\n${date}`,
			style: "signature",
		});
		return paragraphs;
	}

	private appendRequiredLines(
		paragraphs: DocumentParagraph[],
		values: string[],
		field: string,
		missingFields: string[],
	): void {
		if (values.length === 0) {
			paragraphs.push({ text: missingValue(field), style: "body" });
			missingFields.push(field);
			return;
		}
		for (const value of values) {
			paragraphs.push({ text: value, style: "body" });
		}
	}

	private appendPartyLines(
		paragraphs: DocumentParagraph[],
		values: string[],
		partyLabel: "原告" | "被告" | "答辩人",
		field: string,
		missingFields: string[],
	): void {
		if (values.length === 0) {
			paragraphs.push({ text: missingValue(field), style: "body" });
			missingFields.push(field);
			return;
		}
		const [firstLine, ...remainingLines] = values;
		const hasPartyLabel = new RegExp(`^${partyLabel}[：:]`).test(firstLine);
		paragraphs.push({ text: hasPartyLabel ? firstLine : `${partyLabel}：${firstLine}`, style: "body" });
		for (const value of remainingLines) {
			paragraphs.push({ text: value, style: "body" });
		}
	}

	private appendNumberedItems(
		paragraphs: DocumentParagraph[],
		values: string[],
		field: string,
		missingFields: string[],
	): void {
		if (values.length === 0) {
			paragraphs.push({ text: missingValue(field), style: "body" });
			missingFields.push(field);
			return;
		}
		for (const [index, value] of values.entries()) {
			paragraphs.push({ text: `${this.toChineseNumber(index + 1)}、${value}`, style: "body" });
		}
	}

	private createFileName(request: CivilDocumentRequest): string {
		const fallback = `${this.isComplaint(request.template) ? "民事起诉状" : "民事答辩状"}-${Date.now()}`;
		const requestedName = basename(request.fileName || fallback)
			.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
			.trim();
		const normalizedName = requestedName.toLowerCase().endsWith(".docx") ? requestedName : `${requestedName}.docx`;
		return normalizedName || `${fallback}.docx`;
	}

	private createDocx(paragraphs: DocumentParagraph[]): Buffer {
		const createdAt = new Date().toISOString();
		const entries: ZipEntry[] = [
			{ name: "[Content_Types].xml", data: Buffer.from(this.contentTypesXml(), "utf8") },
			{ name: "_rels/.rels", data: Buffer.from(this.packageRelationshipsXml(), "utf8") },
			{ name: "docProps/app.xml", data: Buffer.from(this.appPropertiesXml(), "utf8") },
			{ name: "docProps/core.xml", data: Buffer.from(this.corePropertiesXml(createdAt), "utf8") },
			{ name: "word/document.xml", data: Buffer.from(this.documentXml(paragraphs), "utf8") },
			{ name: "word/styles.xml", data: Buffer.from(this.stylesXml(), "utf8") },
		];
		return this.createZip(entries);
	}

	private documentXml(paragraphs: DocumentParagraph[]): string {
		const body = paragraphs.map((paragraph) => this.paragraphXml(paragraph)).join("");
		return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1701" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
	}

	private paragraphXml(paragraph: DocumentParagraph): string {
		if (paragraph.style === "blank") {
			return "<w:p/>";
		}
		const alignment =
			paragraph.style === "title"
				? '<w:jc w:val="center"/>'
				: paragraph.style === "signature"
					? '<w:jc w:val="right"/>'
					: "";
		const spacing = '<w:spacing w:line="360" w:lineRule="auto" w:after="0"/>';
		const pagination = paragraph.style === "signature" ? "<w:keepLines/>" : "";
		const bold = paragraph.style === "title" || paragraph.style === "label" ? "<w:b/>" : "";
		const size = paragraph.style === "title" ? "36" : "24";
		const textXml = paragraph.text
			.split("\n")
			.map((line, index) => `${index > 0 ? "<w:br/>" : ""}<w:t xml:space="preserve">${this.escapeXml(line)}</w:t>`)
			.join("");
		return `<w:p><w:pPr>${alignment}${spacing}${pagination}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="宋体"/>${bold}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>${textXml}</w:r></w:p>`;
	}

	private contentTypesXml(): string {
		return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
	}

	private packageRelationshipsXml(): string {
		return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
	}

	private appPropertiesXml(): string {
		return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Staix</Application><AppVersion>1.0</AppVersion></Properties>';
	}

	private corePropertiesXml(createdAt: string): string {
		return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>民事诉讼文书</dc:title><dc:creator>Staix</dc:creator><cp:lastModifiedBy>Staix</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified></cp:coreProperties>`;
	}

	private stylesXml(): string {
		return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="宋体"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>';
	}

	private createZip(entries: ZipEntry[]): Buffer {
		const localParts: Buffer[] = [];
		const centralParts: Buffer[] = [];
		let offset = 0;
		for (const entry of entries) {
			const name = Buffer.from(entry.name, "utf8");
			const crc = this.crc32(entry.data);
			const localHeader = Buffer.alloc(30);
			localHeader.writeUInt32LE(0x04034b50, 0);
			localHeader.writeUInt16LE(20, 4);
			localHeader.writeUInt16LE(0x0800, 6);
			localHeader.writeUInt16LE(0, 8);
			localHeader.writeUInt32LE(crc, 14);
			localHeader.writeUInt32LE(entry.data.length, 18);
			localHeader.writeUInt32LE(entry.data.length, 22);
			localHeader.writeUInt16LE(name.length, 26);
			localParts.push(localHeader, name, entry.data);

			const centralHeader = Buffer.alloc(46);
			centralHeader.writeUInt32LE(0x02014b50, 0);
			centralHeader.writeUInt16LE(20, 4);
			centralHeader.writeUInt16LE(20, 6);
			centralHeader.writeUInt16LE(0x0800, 8);
			centralHeader.writeUInt16LE(0, 10);
			centralHeader.writeUInt32LE(crc, 16);
			centralHeader.writeUInt32LE(entry.data.length, 20);
			centralHeader.writeUInt32LE(entry.data.length, 24);
			centralHeader.writeUInt16LE(name.length, 28);
			centralHeader.writeUInt32LE(offset, 42);
			centralParts.push(centralHeader, name);
			offset += localHeader.length + name.length + entry.data.length;
		}
		const centralDirectory = Buffer.concat(centralParts);
		const end = Buffer.alloc(22);
		end.writeUInt32LE(0x06054b50, 0);
		end.writeUInt16LE(entries.length, 8);
		end.writeUInt16LE(entries.length, 10);
		end.writeUInt32LE(centralDirectory.length, 12);
		end.writeUInt32LE(offset, 16);
		return Buffer.concat([...localParts, centralDirectory, end]);
	}

	private crc32(data: Buffer): number {
		let crc = 0xffffffff;
		for (const byte of data) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit++) {
				crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
			}
		}
		return (crc ^ 0xffffffff) >>> 0;
	}

	private escapeXml(value: string): string {
		return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	private toChineseNumber(value: number): string {
		const values = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
		return values[value - 1] ?? String(value);
	}

	private isComplaint(template: CivilDocumentTemplate): boolean {
		return template.startsWith("civil_complaint_");
	}

	private isTemplate(value: unknown): value is CivilDocumentTemplate {
		return (
			value === "civil_complaint_natural_person" ||
			value === "civil_complaint_legal_entity" ||
			value === "civil_defense_natural_person" ||
			value === "civil_defense_legal_entity"
		);
	}

	private asString(value: unknown): string {
		return typeof value === "string" ? value.trim() : "";
	}

	private asStringArray(value: unknown): string[] {
		return Array.isArray(value)
			? value
					.filter((item): item is string => typeof item === "string")
					.map((item) => item.trim())
					.filter(Boolean)
			: [];
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return Boolean(value) && typeof value === "object" && !Array.isArray(value);
	}

	private readBody(request: IncomingMessage): Promise<unknown> {
		return new Promise((resolvePromise, rejectPromise) => {
			let body = "";
			request.setEncoding("utf8");
			request.on("data", (chunk: string) => {
				body += chunk;
				if (body.length > 2 * 1024 * 1024) {
					rejectPromise(new Error("文书生成请求超过 2 MB 限制。"));
				}
			});
			request.on("end", () => {
				try {
					resolvePromise(body ? JSON.parse(body) : {});
				} catch {
					rejectPromise(new Error("文书生成请求不是有效 JSON。"));
				}
			});
			request.on("error", rejectPromise);
		});
	}

	private sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
		response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
		response.end(JSON.stringify(data));
	}
}
