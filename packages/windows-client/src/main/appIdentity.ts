import { join } from "node:path";
import { app } from "electron";

export const STAIX_APP_NAME = "Staix";
export const STAIX_APP_ID = "com.staix.desktop";
export const STAIX_UPDATE_BASE_URL = "https://aidocspro.com/staix-updates";

export function configureStaixAppIdentity(): void {
	app.setName(STAIX_APP_NAME);
	app.setPath("userData", join(app.getPath("appData"), STAIX_APP_NAME));
}

export function getStaixUpdateFeedUrl(): string {
	const baseUrl = (process.env.STAIX_UPDATE_BASE_URL || STAIX_UPDATE_BASE_URL).replace(/\/+$/, "");
	const platformPath = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform;
	return `${baseUrl}/${platformPath}`;
}
