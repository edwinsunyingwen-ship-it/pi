import type { WindowsClientApi } from "../shared/types";

declare global {
	interface Window {
		windowsClient: WindowsClientApi;
	}
}
