import { execFileSync } from "node:child_process";

/** Makes the folder a git repository with everything in it committed. */
export function commitAll(root: string, message = "init"): void {
  const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", message);
}
