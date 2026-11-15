import Link from "next/link";

export function PermissionDenied() {
  return (
    <div className="rounded-ui border border-border bg-surface p-8 text-center" role="alert">
      <h1 className="text-lg font-semibold">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Ask your hotel owner or manager to update your role if you need it.
      </p>
      <Link href="/dashboard" className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
