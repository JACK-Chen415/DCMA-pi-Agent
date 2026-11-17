export interface KnowledgeTarget {
	source: string;
	locator?: string;
	code?: string;
}

export interface KnowledgeEvaluationCase {
	id: string;
	kind: "exact" | "symptom" | "applicability";
	query: string;
	expected: KnowledgeTarget[];
	incompatibleSource?: string;
}

const s120 = "s120-fault-manual";
const yfb = "yfb801-2-manual";
const motor90l = "90l-4-manual";

export const knowledgeEvaluationCases: KnowledgeEvaluationCase[] = [
	{
		id: "s120-f30004",
		kind: "exact",
		query: "SINAMICS S120 报 F30004，请查手册定义和出处。",
		expected: [{ source: s120, code: "F30004", locator: "第 380、381 页" }],
	},
	{
		id: "s120-a01007",
		kind: "exact",
		query: "SINAMICS S120 上的 A01007 是什么意思？手册在哪一页？",
		expected: [{ source: s120, code: "A01007", locator: "第 4 页" }],
	},
	{
		id: "s120-heatsink",
		kind: "symptom",
		query: "S120 变频器里面的散热片越来越烫，最后驱动停了，手册有对应的条目吗？",
		expected: [
			{ source: s120, code: "F30004", locator: "第 379、380、381 页" },
			{ source: s120, code: "F30004", locator: "第 380、381、382 页" },
			{ source: s120, code: "A05000", locator: "第 195、196 页" },
		],
	},
	{
		id: "yfb-no-start",
		kind: "symptom",
		query: "YFB801-2 一送电就嗡嗡响，轴却没转起来，这种情况说明书里有吗？",
		expected: [{ source: yfb, locator: "段落 70-72" }],
	},
	{
		id: "90l-low-speed",
		kind: "symptom",
		query: "90L-4 接上负载后转得比原来慢，感觉没劲，可能有哪些原因？",
		expected: [{ source: motor90l, locator: "段落 84-86" }],
	},
	{
		id: "drag-test-data-loss",
		kind: "symptom",
		query: "两台电机对拖时，上位机数值时有时无，设好的参数有时也下不去。试验方案哪一节讲这个？",
		expected: [{ source: "0.75kw-1.5kw-drag-test", locator: "段落 54-61" }],
	},
	{
		id: "wrong-drive-family",
		kind: "applicability",
		query: "现场确认为 SINAMICS G120（CU250 + PM240），显示 F30004，给我这套驱动的厂家故障定义。",
		expected: [],
		incompatibleSource: s120,
	},
	{
		id: "wrong-motor-manual",
		kind: "applicability",
		query: "南京苏玛 90L-4 用 380V 电源，查电气接线规范时该参考哪份说明书？",
		expected: [{ source: motor90l, locator: "段落 48-53" }],
		incompatibleSource: yfb,
	},
];
