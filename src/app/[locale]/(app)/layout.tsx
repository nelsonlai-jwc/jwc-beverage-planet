import { AppShell } from "@/components/shell/AppShell";
import { getCurrentUser } from "@/lib/auth/currentUser";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  return <AppShell user={user}>{children}</AppShell>;
}
