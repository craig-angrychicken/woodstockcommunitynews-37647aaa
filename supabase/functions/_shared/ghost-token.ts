function base64UrlEncode(str: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export async function generateGhostToken(apiKey: string): Promise<string> {
  const [id, secret] = apiKey.split(":");

  const header = {
    alg: "HS256",
    typ: "JWT",
    kid: id,
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    exp: now + 5 * 60, // 5 minutes
    aud: "/admin/",
  };

  const base64Header = base64UrlEncode(JSON.stringify(header));
  const base64Payload = base64UrlEncode(JSON.stringify(payload));
  const message = `${base64Header}.${base64Payload}`;

  const encoder = new TextEncoder();
  const secretBytes = new Uint8Array(
    secret.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
  );
  const messageBytes = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, messageBytes);
  const signatureArray = new Uint8Array(signature);

  let binary = "";
  for (let i = 0; i < signatureArray.length; i++) {
    binary += String.fromCharCode(signatureArray[i]);
  }
  const base64Signature = btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${message}.${base64Signature}`;
}
