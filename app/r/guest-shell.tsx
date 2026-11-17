import type { ReactNode } from "react";

/** Mobile-first frame shared by the guest portal and its error pages. */
export function GuestShell({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 py-4"
      style={accent ? ({ "--accent": accent } as React.CSSProperties) : undefined}
    >
      {children}
    </main>
  );
}

export { readableOn } from "./readable";
