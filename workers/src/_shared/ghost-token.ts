import { SignJWT } from "jose";

/**
 * Generate a short-lived Ghost Admin API JWT.
 *
 * The Ghost Admin API key has the form `<id>:<hex-secret>`. The token is signed
 * with HS256 using the hex-decoded secret, includes the key id as the `kid`
 * header, and is valid for 5 minutes with audience `/admin/`.
 */
export async function generateGhostToken(adminApiKey: string): Promise<string> {
  const [id, secret] = adminApiKey.split(":");

  // Hex-decode the secret into raw key bytes.
  const secretBytes = new Uint8Array(
    secret.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? []
  );

  return await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: id })
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience("/admin/")
    .sign(secretBytes);
}
