const mode = process.argv[2];
if (mode !== "dev" && mode !== "build") throw new Error("Expected dev or build");
const args = ["bun", "x", "@tauri-apps/cli@2", mode];
if (mode === "build") {
  const raw = process.env.LEADFLOW_DESKTOP_URL;
  const url = raw && URL.canParse(raw) ? new URL(raw) : null;
  if (
    !url ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Set LEADFLOW_DESKTOP_URL to the deployed LeadFlow HTTPS origin.");
  }
  args.push("--config", JSON.stringify({ build: { frontendDist: url.href } }));
}
const child = Bun.spawn(args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
process.exit(await child.exited);
