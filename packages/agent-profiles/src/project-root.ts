import { dirname, resolve } from "node:path";

export interface FileSystemLike {
	existsSync(path: string): boolean;
	statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
}

export function findProjectRoot(cwd: string, fs: FileSystemLike): string {
	let current = resolve(cwd);
	while (true) {
		const gitPath = resolve(current, ".git");
		if (fs.existsSync(gitPath)) {
			const stat = fs.statSync(gitPath);
			if (stat.isDirectory() || stat.isFile()) return current;
		}
		const parent = dirname(current);
		if (parent === current) return resolve(cwd);
		current = parent;
	}
}
