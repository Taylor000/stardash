import { requireAuth } from "@/lib/auth"
import { UserProvider } from "@/components/providers/user-provider"
import { PersonalShell } from "@/components/personal-shell"

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth()
  return (
    <UserProvider user={user}>
      <PersonalShell>{children}</PersonalShell>
    </UserProvider>
  )
}
