import { AlertCircle, BookOpen, ChartNoAxesCombined, FileText } from "lucide-react";

export function WelcomeView({
	deviceName,
	onSelectSuggestion,
}: {
	deviceName: string;
	onSelectSuggestion: (query: string) => void;
}) {
	const hour = new Date().getHours();
	const greeting = hour < 6 ? "夜深了" : hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";
	const groups = [
		{
			title: "运行概览",
			Icon: ChartNoAxesCombined,
			queries: [
				`${deviceName}当前运行状态怎么样？`,
				`${deviceName}最近1小时有没有故障或报警？是否已经恢复？`,
				`查询${deviceName}的设备档案，并查看最近30分钟的转速、电流、功率和温度情况`,
			],
		},
		{
			title: "异常诊断",
			Icon: AlertCircle,
			queries: [
				`诊断${deviceName}当前异常，并给出可能原因和排查顺序`,
				`当前${deviceName}哪些运行指标最值得优先检查？`,
				`结合${deviceName}当前运行数据，给出下一步现场检查和维护建议`,
			],
		},
		{
			title: "报告与趋势",
			Icon: FileText,
			queries: [
				`生成${deviceName}最近1小时运行报告`,
				`分析${deviceName}最近1小时电机温度和负载变化，是否存在异常趋势？`,
				`总结${deviceName}最近1小时的主要异常和风险`,
			],
		},
		{
			title: "故障知识",
			Icon: BookOpen,
			queries: [
				"A07089报警是什么意思？应该怎么处理？",
				"F30899故障的可能原因和处理步骤是什么？",
				"根据S120故障手册查询A07089相关参数和排查建议，并说明手册适用条件",
			],
		},
	];
	return (
		<div className="welcome-scroll">
			<div className="welcome-content">
				<div className="welcome-heading">
					<h1>
						{greeting}，我是 <span>MSPIC-AI</span>
					</h1>
					<p>基于设备运行数据、故障手册与诊断工具，协助进行运行分析、故障诊断、知识查询和报告生成。</p>
				</div>
				<div className="suggestion-heading">
					<strong>快速提问</strong>
					<span>选择一个问题即可开始对话</span>
				</div>
				<div className="suggestion-grid">
					{groups.map(({ title, Icon, queries }) => (
						<section className="suggestion-group" key={title}>
							<h2>
								<Icon size={18} />
								{title}
							</h2>
							<div>
								{queries.map((query) => (
									<button type="button" key={query} onClick={() => onSelectSuggestion(query)}>
										{query}
									</button>
								))}
							</div>
						</section>
					))}
				</div>
			</div>
		</div>
	);
}
