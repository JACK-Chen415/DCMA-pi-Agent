export interface DatabaseColumn {
	name: string;
	type: string;
	primaryKey: boolean;
	comment: string;
}
export interface DatabaseTable {
	schema: string;
	name: string;
	kind: "simulation" | "acquired";
	label: string;
	columns: DatabaseColumn[];
}
export interface DatabaseCatalog {
	configured: boolean;
	connected: boolean;
	checkedAt: string;
	tables: DatabaseTable[];
	message: string;
}
export interface DatabaseRows {
	table: DatabaseTable;
	queriedAt: string;
	rows: Record<string, unknown>[];
	returned: number;
	hasMore: boolean;
	orderBy: string | null;
	note: string;
}
