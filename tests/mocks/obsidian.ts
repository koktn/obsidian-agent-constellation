export class TFile {
	constructor(public path: string) {}
}

export class Notice {
	constructor(_message?: string, _timeout?: number) {}
	setMessage(_message: string): void {}
	hide(): void {}
}

export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\//, "")
		.replace(/\/$/, "");
}
