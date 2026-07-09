import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";

export default async function Home() {
  const user = await getCurrentAppUser();
  if (user) {
    redirect("/dashboard");
  }
  redirect("/login");
}
