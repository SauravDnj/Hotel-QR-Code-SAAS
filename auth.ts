import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getDb } from "@/lib/db/client";
import { verifyCredentials } from "@/lib/auth/credentials";
import { clientIp } from "@/lib/auth/ip";

class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Credentials provider requires JWT sessions. The token is an HttpOnly, Secure (in
  // production), SameSite=Lax cookie and is re-validated against the database on every
  // request (status + session version) in lib/auth/session.ts, so disabling a user or
  // bumping session_version revokes access immediately.
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  // Host trust comes from the platform (Vercel) or AUTH_TRUST_HOST, not hardcoded.
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const result = await verifyCredentials(getDb(), credentials, clientIp(request.headers));
        if (!result.ok) {
          if (result.reason === "rate_limited") throw new RateLimitedSignin();
          return null;
        }
        return {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          sessionVersion: result.user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.sv = (user as { sessionVersion?: number }).sessionVersion;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid as string;
      session.sv = token.sv as number;
      return session;
    },
  },
});
