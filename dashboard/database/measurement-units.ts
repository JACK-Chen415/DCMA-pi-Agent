import type { NumericField } from "./dashboard-types.ts";

/** Existing DCMA acquisition/display contract. Values already use these scales; no conversion is applied. */
export const measurementUnits: Record<NumericField, string> = {
	dc_voltage: "V", speed_setpoint: "r/min", speed_actual: "r/min", current_actual: "A",
	torque_setpoint: "N·m", torque_actual: "N·m", air_intake_temp: "°C", motor_temp: "°C",
	inverter_temp: "°C", actual_power: "kW", field_current: "A", torque_current: "A",
	inverter_radiator_temp: "°C", inverter_load_rate: "%", motor_load_rate: "%",
	motor_power: "kW", feedback_power: "kW", pulse_frequency: "kHz",
};
