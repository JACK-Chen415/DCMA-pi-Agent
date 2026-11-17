import assert from "node:assert/strict";
import { test } from "node:test";
import { createPool } from "mysql2/promise";
import { closeDatabase, readSignalMetadata } from "../database.ts";

test("simulation dictionary uses deployed columns and binds source filters", async (context) => {
	process.env.MYSQL_HOST = "test.invalid";
	process.env.MYSQL_USER = "test";
	process.env.MYSQL_PASSWORD = "test";
	process.env.MYSQL_DATABASE = "dcma";
	const pool = createPool({});
	const conventions = { legacy_invalid_sentinel: -200, hardware_mapping_verified: false };
	const invalidValues = [null, -200];
	const connection = {
		async query() {},
		async execute({ sql }: { sql: string }, parameters: string[]) {
			assert.match(sql, /stored_unit, display_unit, value_conventions, invalid_values/);
			assert.match(sql, /WHERE schema_name = \? AND table_name = \? AND field_name = \? AND profile_version = \?/);
			assert.deepEqual(parameters, ["dcma", "sim_normal", "air_intake_temp", "g120_sim_v1"]);
			return [[{
				table_name: "sim_normal", field_name: "air_intake_temp", description: "模拟进气温度",
				stored_unit: "degC", display_unit: "°C", value_conventions: conventions,
				invalid_values: invalidValues, profile_version: "g120_sim_v1",
			}]];
		},
		destroy() {},
		release() {},
	};
	context.mock.method(Object.getPrototypeOf(pool), "getConnection", async () => connection);
	context.after(async () => { await closeDatabase(); await pool.end(); });
	const result = await readSignalMetadata({ tableName: "sim_normal", fieldName: "air_intake_temp" });
	assert.deepEqual(result.definitions, [{
		tableName: "sim_normal", fieldName: "air_intake_temp", fieldLabel: "进气温度",
		unit: "°C", storedUnit: "degC", description: "模拟进气温度", direction: null, valueConventions: conventions,
		invalidValues, profileVersion: "g120_sim_v1",
	}]);
});
