import { app, BrowserWindow } from "electron";
import type { UpdateInfo } from "electron-updater";
import { autoUpdater } from "electron-updater";
import { IPC_CHANNELS } from "../../shared/ipc";
import type { UpdateState, UpdateStatus } from "../../shared/types";
import { getStaixUpdateFeedUrl } from "../appIdentity";

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class UpdateService {
	private readonly feedUrl = getStaixUpdateFeedUrl();
	private state: UpdateState = {
		status: "idle",
		currentVersion: app.getVersion(),
		updateVersion: null,
		message: "No update check has run.",
		feedUrl: this.feedUrl,
		progressPercent: null,
		checkedAt: null,
		downloadedAt: null,
	};

	constructor() {
		autoUpdater.autoDownload = false;
		autoUpdater.autoInstallOnAppQuit = false;
		autoUpdater.allowDowngrade = false;
		autoUpdater.setFeedURL({ provider: "generic", url: this.feedUrl });
		autoUpdater.logger = {
			info: (message: unknown) => console.info("[updater]", message),
			warn: (message: unknown) => console.warn("[updater]", message),
			error: (message: unknown) => console.error("[updater]", message),
			debug: (message: string) => console.debug("[updater]", message),
		};

		autoUpdater.on("checking-for-update", () => {
			this.setState({
				status: "checking",
				message: "Checking for updates.",
				progressPercent: null,
			});
		});
		autoUpdater.on("update-available", (info) => {
			this.applyUpdateInfo("available", info, `Version ${info.version} is available.`);
		});
		autoUpdater.on("update-not-available", (info) => {
			this.applyUpdateInfo("not-available", info, "Staix is up to date.");
		});
		autoUpdater.on("download-progress", (progress) => {
			this.setState({
				status: "downloading",
				message: `Downloading update: ${Math.round(progress.percent)}%.`,
				progressPercent: progress.percent,
			});
		});
		autoUpdater.on("update-downloaded", (info) => {
			this.applyUpdateInfo("downloaded", info, `Version ${info.version} is ready to install.`);
			this.setState({ downloadedAt: new Date().toISOString(), progressPercent: 100 });
		});
		autoUpdater.on("error", (error, message) => {
			this.setState({
				status: "error",
				message: message || getErrorMessage(error),
				progressPercent: null,
			});
		});
	}

	getState(): UpdateState {
		return this.state;
	}

	async checkForUpdates(): Promise<UpdateState> {
		if (!this.isUpdateSupported()) {
			this.setState({
				status: "unsupported",
				message: app.isPackaged
					? `Updates are not supported on ${process.platform}.`
					: "Update checks run only in packaged Staix builds.",
				checkedAt: new Date().toISOString(),
				progressPercent: null,
			});
			return this.state;
		}

		try {
			this.setState({ status: "checking", message: "Checking for updates.", progressPercent: null });
			const result = await autoUpdater.checkForUpdates();
			if (result?.isUpdateAvailable) {
				this.applyUpdateInfo("available", result.updateInfo, `Version ${result.updateInfo.version} is available.`);
			} else if (result?.updateInfo) {
				this.applyUpdateInfo("not-available", result.updateInfo, "Staix is up to date.");
			}
			return this.state;
		} catch (error) {
			this.setState({
				status: "error",
				message: getErrorMessage(error),
				checkedAt: new Date().toISOString(),
				progressPercent: null,
			});
			return this.state;
		}
	}

	async downloadUpdate(): Promise<UpdateState> {
		if (this.state.status === "downloaded") {
			return this.state;
		}
		if (this.state.status !== "available") {
			this.setState({
				status: "error",
				message: "No downloadable update is available.",
				progressPercent: null,
			});
			return this.state;
		}

		try {
			this.setState({
				status: "downloading",
				message: "Downloading update.",
				progressPercent: 0,
			});
			await autoUpdater.downloadUpdate();
			return this.state;
		} catch (error) {
			this.setState({
				status: "error",
				message: getErrorMessage(error),
				progressPercent: null,
			});
			return this.state;
		}
	}

	installUpdate(): UpdateState {
		if (this.state.status !== "downloaded") {
			this.setState({
				status: "error",
				message: "No downloaded update is ready to install.",
			});
			return this.state;
		}
		autoUpdater.quitAndInstall(false, true);
		return this.state;
	}

	scheduleStartupCheck(): void {
		if (!this.isUpdateSupported()) {
			return;
		}
		setTimeout(() => {
			void this.checkForUpdates();
		}, 5000);
	}

	private isUpdateSupported(): boolean {
		if (!app.isPackaged && process.env.STAIX_FORCE_UPDATE_CHECK !== "1") {
			return false;
		}
		return process.platform === "win32" || process.platform === "darwin";
	}

	private applyUpdateInfo(status: UpdateStatus, info: UpdateInfo, message: string): void {
		this.setState({
			status,
			updateVersion: info.version,
			message,
			checkedAt: new Date().toISOString(),
			progressPercent: status === "downloaded" ? 100 : null,
		});
	}

	private setState(nextState: Partial<UpdateState>): void {
		this.state = { ...this.state, ...nextState };
		for (const window of BrowserWindow.getAllWindows()) {
			window.webContents.send(IPC_CHANNELS.updateStatus, this.state);
		}
	}
}
