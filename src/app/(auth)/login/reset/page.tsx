import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/session"
import { NewPasswordForm } from "@/components/auth/new-password-form"

export default async function ResetPasswordPage() {
  // Reached through the emailed link, which signs the user in first.
  const session = await getSession()
  if (!session) redirect("/forgot-password")
  return <NewPasswordForm />
}
