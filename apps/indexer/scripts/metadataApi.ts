import type { Hex } from "viem";

export interface Signer {
  address: Hex;
  signMessage: (input: { message: string }) => Promise<Hex>;
}

export function metadataApi(base: string, chainId: number) {
  async function call(path: string, init: RequestInit = {}) {
    const response = await fetch(`${base}${path}`, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status} ${JSON.stringify(body.error ?? body)}`);
    return body as Record<string, any>;
  }

  async function login(account: Signer): Promise<string> {
    const issued = await call("/v1/auth/nonce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: account.address, chainId }) });
    const signature = await account.signMessage({ message: issued.message });
    const opened = await call("/v1/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: issued.message, signature }) });
    return opened.token;
  }

  const post = (path: string, token: string, body: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

  function samplePdf(title: string): Uint8Array {
    return new TextEncoder().encode(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n%${title}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
  }

  async function upload(token: string, path: string, name: string, visibility: "public" | "restricted") {
    const bytes = samplePdf(name);
    const slot = await post(`${path}/documents/upload-url`, token, { name, mime: "application/pdf", size: bytes.length, visibility });
    return call(slot.uploadUrl, { method: "PUT", headers: { "content-type": "application/pdf" }, body: bytes as BodyInit });
  }

  return { call, login, post, upload };
}
