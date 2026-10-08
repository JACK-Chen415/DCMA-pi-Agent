import { AlertTriangle, ArrowRight, BarChart2, FileText, Search } from "lucide-react";
import type React from "react";
import { suggestionCards } from "../mockData";
import type { SuggestionCard } from "../types.ts";

interface WelcomeViewProps {
	onSelectSuggestion: (query: string) => void;
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({ onSelectSuggestion }) => {
	const renderIcon = (type: SuggestionCard["iconType"]) => {
		switch (type) {
			case "search":
				return <Search className="w-4 h-4 text-[#2563eb] stroke-[2.2]" />;
			case "chart":
				return <BarChart2 className="w-4 h-4 text-[#2563eb] stroke-[2.2]" />;
			case "alert":
				return <AlertTriangle className="w-4 h-4 text-[#ef4444] stroke-[2.2]" />;
			case "clipboard":
				return <FileText className="w-4 h-4 text-[#10b981] stroke-[2.2]" />;
			default:
				return <Search className="w-4 h-4 text-[#2563eb]" />;
		}
	};

	return (
		<div className="flex-1 min-h-0 overflow-y-auto w-full">
			<div className="min-h-full flex flex-col items-center justify-center max-w-4xl mx-auto w-full px-4 sm:px-6 py-6">
				{/* 1. Main Title & Subtitle */}
				<div className="text-center mb-3">
					<h1 className="text-2xl sm:text-[32px] font-bold tracking-tight">
						<span className="text-[#2563eb]">DCMA</span> <span className="text-[#1e293b]">工业故障诊断助手</span>
					</h1>
					<p className="text-[14px] text-[#64748b] mt-1.5 font-normal tracking-wide">
						DCMA Agent，面向重大装备的智能运维与故障分析
					</p>
				</div>

				{/* 2. Hero 3D Industrial Turbine Graphic with seamless fade */}
				<div className="relative w-full max-w-[680px] my-1 flex items-center justify-center pointer-events-none">
					<img
						src="/assets/center_illustration.png"
						alt="DCMA 工业装备全息全景"
						className="w-full h-auto object-contain max-h-[220px]"
					/>
				</div>

				{/* 3. 2x2 Feature / Suggestion Cards Grid */}
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-[750px] mt-2">
					{suggestionCards.map((card) => {
						return (
							<button
								type="button"
								key={card.id}
								onClick={() => onSelectSuggestion(card.query.replace(/^[“”"]|[“”"]$/g, ""))}
								className="group text-left bg-white hover:bg-slate-50/70 rounded-2xl p-5 border border-slate-100/90 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:border-blue-200/80 cursor-pointer transition-all duration-200 flex flex-col justify-between relative min-h-[105px]"
							>
								<div className="flex items-start gap-3.5">
									{/* Icon rounded container */}
									<div
										className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
											card.iconType === "alert"
												? "bg-[#fef2f2]"
												: card.iconType === "clipboard"
													? "bg-[#f0fdf4]"
													: "bg-[#eff6ff]"
										}`}
									>
										{renderIcon(card.iconType)}
									</div>

									<div className="flex-1 pr-6">
										<h3 className="text-[14.5px] font-bold text-[#1e293b] group-hover:text-[#2563eb] transition-colors leading-snug">
											{card.title}
										</h3>
										<p className="text-[12.5px] text-[#64748b] mt-1 line-clamp-2 leading-relaxed">
											{card.query}
										</p>
									</div>
								</div>

								{/* Bottom right arrow */}
								<div className="absolute bottom-4 right-4 text-[#94a3b8] group-hover:text-[#2563eb] group-hover:translate-x-0.5 transition-all">
									<ArrowRight className="w-4 h-4 stroke-[1.8]" />
								</div>
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
};
