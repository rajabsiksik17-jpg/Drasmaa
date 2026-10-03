import { notFound } from "next/navigation"
import { FormsPreview } from "./preview"

export const metadata = { title: "Form preview (dev)", robots: { index: false } }

/**
 * Development-only visual QA of the digitized paper forms with fictional
 * fixture data. Edits are not saved. Returns 404 in production builds.
 */
export default async function DevFormsPage({ searchParams }: PageProps<"/dev/forms">) {
  if (process.env.NODE_ENV === "production") notFound()
  const sp = await searchParams
  return <FormsPreview form={typeof sp.form === "string" ? sp.form : "history"} />
}
