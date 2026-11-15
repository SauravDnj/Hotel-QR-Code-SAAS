import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NoAccessPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <Card className="text-center">
        <h1 className="text-lg font-semibold">No hotel access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account is not an active member of any hotel. Ask your hotel owner to invite you.
        </p>
        <form action={logoutAction} className="mt-4">
          <Button variant="secondary" type="submit">
            Sign out
          </Button>
        </form>
      </Card>
    </main>
  );
}
