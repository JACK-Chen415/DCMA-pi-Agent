import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import {
	AriaComponent,
	DataZoomComponent,
	GraphicComponent,
	GridComponent,
	LegendComponent,
	MarkLineComponent,
	TitleComponent,
	TooltipComponent,
} from "echarts/components";
import { init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import type { ChartArtifact } from "../chart-contracts.ts";
import { chartHeight, createChartOptions } from "./chart-options.ts";

use([
	LineChart,
	ScatterChart,
	BarChart,
	GridComponent,
	TooltipComponent,
	LegendComponent,
	DataZoomComponent,
	AriaComponent,
	TitleComponent,
	GraphicComponent,
	MarkLineComponent,
	SVGRenderer,
]);
export { init };
export function renderChartSvg(chart: ChartArtifact): string {
	const instance = init(null, undefined, {
		renderer: "svg",
		ssr: true,
		width: 1000,
		height: chartHeight(chart) + 300,
	});
	try {
		instance.setOption(createChartOptions(chart, 1000, true));
		return instance.renderToSVGString();
	} finally {
		instance.dispose();
	}
}
