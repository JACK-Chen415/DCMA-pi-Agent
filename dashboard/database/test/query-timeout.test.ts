import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { createPool } from "mysql2/promise";
import { closeDatabase, readAnalysisRows, readCodeHistory } from "../database.ts";
import { fieldLabels } from "../dashboard-types.ts";

test("流查询超时或取消后，迟到的命令错误不会成为未处理异常", async (context) => {
	process.env.MYSQL_HOST = "test.invalid";
	process.env.MYSQL_USER = "test";
	process.env.MYSQL_PASSWORD = "test";
	process.env.MYSQL_DATABASE = "dcma";
	const dummyPool = createPool({});
	let command: EventEmitter;
	let controller: AbortController;
	let cancel = false;
	let destroyed = 0;
	const timeout = Object.assign(new Error("Query inactivity timeout"), { code: "PROTOCOL_SEQUENCE_TIMEOUT" });
	const streamingQuery = () => {
		command = new EventEmitter();
		return Object.assign(command, {
			stream() {
				const stream = new Readable({ objectMode: true, read() {} });
				const onError = (error: Error) => stream.destroy(error);
				command.on("error", onError);
				// Match mysql2: closing a stream removes its command error listener.
				stream.once("close", () => command.removeListener("error", onError));
				setImmediate(() => { if (cancel) controller.abort(); else command.emit("error", timeout); });
				return stream;
			},
		});
	};
	const connection = {
		connection: { execute: streamingQuery, query: streamingQuery },
		async execute() {
			return [Object.keys(fieldLabels).map((field) => ({ TABLE_SCHEMA: "dcma", TABLE_NAME: "real_data_01", COLUMN_NAME: field, DATA_TYPE: "float", COLUMN_KEY: "", COLUMN_COMMENT: "" }))];
		},
		async query(options: { sql: string }) {
			if (options.sql.includes("SELECT DISTINCT")) return [[{ device_name: "synthetic", inverter_name: "synthetic" }]];
			if (options.sql.includes("invalid_times")) return [[{ invalid_times: 0, excluded: 0 }]];
			return [[]];
		},
		destroy() { destroyed++; }, release() {},
	};
	context.mock.method(Object.getPrototypeOf(dummyPool), "getConnection", async () => connection);
	context.after(async () => { await closeDatabase(); await dummyPool.end(); });
	for (const mode of ["analysis", "history"]) {
		for (cancel of [false, true]) {
			controller = new AbortController();
			const pending = mode === "analysis"
				? readAnalysisRows({ table: "real_data_01", from: "2026-10-22T00:00:00.000Z", to: "2026-10-22T01:00:00.000Z" }, controller.signal)
				: readCodeHistory({ table: "real_data_01", page: 1 }, controller.signal);
			await assert.rejects(pending, cancel ? /已取消/ : /Query inactivity timeout/);
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.equal(command!.listenerCount("error"), 1);
			assert.doesNotThrow(() => command!.emit("error", timeout));
		}
	}
	assert.ok(destroyed >= 4);
});
