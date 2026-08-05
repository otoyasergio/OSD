import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { staffHomePath } from "@/lib/permissions";

export default async function Home() {
  const preview = await getRolePreviewContext();
  if (preview) {
    redirect(staffHomePath(preview.role));
  }
  redirect("/login");
}
