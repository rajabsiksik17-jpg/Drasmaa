import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { OtpForm } from "@/components/auth/otp-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.otp")
  return { title: t("title") }
}

export default async function VerifyPage({ searchParams }: PageProps<"/login/verify">) {
  const params = await searchParams
  const next =
    typeof params.next === "string" && params.next.startsWith("/") && !params.next.startsWith("//") && !params.next.startsWith("/login")
      ? params.next
      : "/dashboard"
  return <OtpForm next={next} />
}
