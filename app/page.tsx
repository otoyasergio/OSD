import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { staffHomePath } from "@/lib/permissions";

export default async function Home() {
  const user = await getCurrentAppUser();
  if (user) {
    redirect(staffHomePath(user.role));
  }
  redirect("/login");
}
