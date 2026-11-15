import "next-auth";

declare module "next-auth" {
  interface Session {
    /** Session version the token was issued with; compared to users.session_version. */
    sv: number;
  }
}
