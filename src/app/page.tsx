import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: creatorUser } = await admin
    .from("creator_users")
    .select("id")
    .eq("auth_uid", user.id)
    .maybeSingle();

  if (creatorUser) redirect("/portal");

  redirect("/dashboard");
}
