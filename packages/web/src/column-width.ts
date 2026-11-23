/** Workspace column rules: narrow screens keep the current 800px, large displays open at 1088px. */
export const COLUMN_WIDTH_DEFAULT_NARROW = 800;
export const COLUMN_WIDTH_DEFAULT_WIDE = 1088;
export const COLUMN_WIDTH_MIN = 800;
export const COLUMN_WIDTH_STEP = 48;
/** Viewport width (CSS px) at or above which the workspace is treated as a large display. */
export const WIDE_VIEWPORT_MIN = 2000;
export const wideViewportQuery = `(min-width: ${WIDE_VIEWPORT_MIN}px)`;
export const columnWidthStorageKey = "dcma-column-width";

export function defaultColumnWidth(wide: boolean): number {
	return wide ? COLUMN_WIDTH_DEFAULT_WIDE : COLUMN_WIDTH_DEFAULT_NARROW;
}

/** The width is only bounded below; the ceiling is the chat area width that App applies. */
export function clampColumnWidth(value: number): number {
	const rounded = Math.round(value);
	if (!Number.isFinite(rounded)) return COLUMN_WIDTH_DEFAULT_WIDE;
	return Math.max(COLUMN_WIDTH_MIN, rounded);
}

/** `direction` is +1 to widen and -1 to narrow, one wheel notch or arrow key at a time. */
export function stepColumnWidth(value: number, direction: 1 | -1): number {
	return clampColumnWidth(value + direction * COLUMN_WIDTH_STEP);
}

/** Reads the stored width; damaged or below-minimum values are clamped, unparsable values are ignored. */
export function parseStoredColumnWidth(raw: string | null): number | null {
	if (raw === null || raw.trim() === "") return null;
	const value = Number(raw);
	return Number.isFinite(value) ? clampColumnWidth(value) : null;
}
