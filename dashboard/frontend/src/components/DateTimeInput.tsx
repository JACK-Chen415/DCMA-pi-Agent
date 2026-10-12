export function DateTimeInput({ label, value, onChange, required = false, showNow = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; showNow?: boolean }) {
	const [date = "", time = ""] = value.split("T");
	return <fieldset className="date-time-field">
		<legend><span>{label}</span>{showNow && <button type="button" className="date-time-now" aria-label={`${label}设为现在`} onClick={() => onChange(new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19))}>现在</button>}</legend>
		<div>
			<input type="date" aria-label={`${label}日期`} required={required || !!time} value={date} onChange={(event) => onChange(event.target.value ? `${event.target.value}T${time || "00:00:00"}` : "")} />
			<input type="text" aria-label={`${label}时间（24小时制）`} placeholder="HH:mm:ss" title="24小时制，例如18:30:00" pattern="([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?" maxLength={8} required={required || !!date} value={time} onChange={(event) => onChange(date || event.target.value ? `${date}T${event.target.value}` : "")} />
		</div>
	</fieldset>;
}
