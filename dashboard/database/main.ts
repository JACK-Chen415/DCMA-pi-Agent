import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { closeDatabase } from "./database.ts";
import { createDatabaseServer } from "./server.ts";

try {
	loadEnvFile(fileURLToPath(new URL(".env", import.meta.url)));
} catch (error) {
	if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const server = createDatabaseServer();
server.on("error", (error) => {
	console.error(`数据库服务启动失败：${error.message}`);
	process.exitCode = 1;
});
server.listen(3001, "127.0.0.1", () => console.log("数据库只读接口：http://127.0.0.1:3001"));

const shutdown = () => {
	server.close();
	server.closeAllConnections();
	void closeDatabase();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
