import { redirect } from "next/navigation"

/** Former "Today's visits" page: the live clinic flow now lives in Appointments (old links keep working). */
export default function TodayRedirect() {
  redirect("/appointments?tab=today&view=visits")
}
