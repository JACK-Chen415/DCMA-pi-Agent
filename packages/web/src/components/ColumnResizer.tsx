import { type KeyboardEvent, useEffect, useRef } from "react";
import { COLUMN_WIDTH_MIN, stepColumnWidth } from "../column-width.ts";

/** Native wheel events are throttled so one mouse notch changes the width once. */
const wheelIntervalMs = 70;

export function ColumnResizer({
	width,
	maxWidth,
	onResize,
	onReset,
}: {
	width: number;
	maxWidth: number;
	onResize: (next: number) => void;
	onReset: () => void;
}) {
	const element = useRef<HTMLDivElement>(null);
	const widthRef = useRef(width);
	widthRef.current = width;
	const resizeRef = useRef(onResize);
	resizeRef.current = onResize;
	const lastWheel = useRef(0);
	useEffect(() => {
		const node = element.current;
		if (!node) return;
		// React registers wheel listeners as passive, so the "do not scroll while resizing" rule needs a native listener.
		const wheel = (event: WheelEvent) => {
			if (!event.deltaY) return;
			event.preventDefault();
			const now = performance.now();
			if (now - lastWheel.current < wheelIntervalMs) return;
			lastWheel.current = now;
			resizeRef.current(stepColumnWidth(widthRef.current, event.deltaY < 0 ? 1 : -1));
		};
		node.addEventListener("wheel", wheel, { passive: false });
		return () => node.removeEventListener("wheel", wheel);
	}, []);
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		onResize(stepColumnWidth(width, event.key === "ArrowRight" ? 1 : -1));
	};
	return (
		<div className="column-resizer-row">
			<div
				ref={element}
				role="slider"
				tabIndex={0}
				aria-label="消息列宽度"
				aria-orientation="horizontal"
				aria-valuemin={COLUMN_WIDTH_MIN}
				aria-valuemax={maxWidth}
				aria-valuenow={width}
				aria-valuetext={`${width} 像素`}
				title="滚轮调节消息列宽度；双击恢复默认；聚焦后可用 ←/→ 调节"
				className="column-resizer"
				style={{ width: `${width}px` }}
				onKeyDown={onKeyDown}
				onDoubleClick={onReset}
			/>
		</div>
	);
}
