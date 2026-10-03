import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { LoginForm } from "@/components/auth/login-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth")
  return { title: t("signIn") }
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams
  const next = typeof params.next === "string" && params.next.startsWith("/") && !params.next.startsWith("//") ? params.next : "/dashboard"
  const ended = params.ended === "revoked" || params.ended === "signed_out" ? params.ended : null
  return <LoginForm next={next} notice={ended} />
}
