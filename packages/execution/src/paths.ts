import { existsSync } from "node:fs";
import path from "node:path";

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

export function executionDataRoot(): string {
  if (process.env.ORDIUM_DATA_DIR) {
    return path.join(path.dirname(process.env.ORDIUM_DATA_DIR), "execution");
  }
  return path.join(findRepoRoot(process.cwd()), "data", "execution");
}
