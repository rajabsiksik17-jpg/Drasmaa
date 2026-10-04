// Shared by the Appointments page (server) and its filter chips (client).
// Values must live in a plain module: a server component importing a value
// from a "use client" module only receives a client reference, not the value.
export const DAY_VIEWS = ["all", "appointments", "visits", "waiting", "with_doctor", "completed"] as const
export type DayView = (typeof DAY_VIEWS)[number]
