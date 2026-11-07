import assert from "node:assert/strict";
import { test } from "node:test";
import { SandboxRuntimeConfigSchema } from "@anthropic-ai/sandbox-runtime";

// The sandbox runtime uses zod/v3; keep its configuration checks working
// with the patched Zod 4 package override (GHSA-mrhx-c7xc-m3w5).
const config = {
	network: {
		allowedDomains: ["github.com", "*.npmjs.org", "localhost"],
		deniedDomains: ["blocked.example.com"],
		httpProxyPort: 8080,
		allowLocalBinding: false,
	},
	filesystem: {
		denyRead: ["~/.ssh"],
		allowWrite: [".", "/tmp"],
		denyWrite: [".env"],
		allowGitConfig: false,
	},
	ignoreViolations: { "git status": ["/tmp/git"], "*": ["/tmp/cache"] },
	ripgrep: { command: "rg", args: ["--hidden"] },
	mandatoryDenySearchDepth: 3,
	seccomp: { applyPath: "/tmp/apply-seccomp" },
};

test("sandbox configuration preserves restrictions with patched Zod", () => {
	assert.deepEqual(SandboxRuntimeConfigSchema.parse(config), config);
	assert.deepEqual(
		SandboxRuntimeConfigSchema.parse({ network: config.network, filesystem: config.filesystem }),
		{ network: config.network, filesystem: config.filesystem },
	);
});

test("sandbox configuration still rejects unsafe domain patterns", () => {
	for (const domain of ["*", "*.com", "https://github.com", "github.com/path", "github.com:0"]) {
		const invalid = structuredClone(config);
		invalid.network.allowedDomains = [domain];
		assert.equal(SandboxRuntimeConfigSchema.safeParse(invalid).success, false, domain);
	}
});

test("sandbox configuration still rejects invalid paths, ports, and violation rules", () => {
	for (const patch of [
		{ filesystem: { ...config.filesystem, denyRead: [""] } },
		{ network: { ...config.network, httpProxyPort: 0 } },
		{ network: { ...config.network, httpProxyPort: 65536 } },
		{ ignoreViolations: { "*": "/tmp/cache" } },
	]) {
		assert.equal(SandboxRuntimeConfigSchema.safeParse({ ...config, ...patch }).success, false);
	}
});
