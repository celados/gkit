import { GoogleAuth, type JWTInput } from "google-auth-library";

export type GscAccess = "read" | "write";

// Reads keep the read-only scope; only reviewed write capabilities request the
// full Search Console scope, so a read never carries write authority.
const gscScopes: Readonly<Record<GscAccess, string>> = {
  read: "https://www.googleapis.com/auth/webmasters.readonly",
  write: "https://www.googleapis.com/auth/webmasters",
};

export async function deriveGscAccessToken(
  credentials: JWTInput,
  access: GscAccess = "read",
): Promise<string> {
  const auth = new GoogleAuth({ credentials, scopes: [gscScopes[access]] });
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const accessToken = typeof tokenResult === "string" ? tokenResult : (tokenResult?.token ?? null);
  if (!accessToken) throw new Error("Google OAuth did not return an access token.");
  return accessToken;
}
