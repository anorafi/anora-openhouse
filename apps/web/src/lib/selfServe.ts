export type ApprovalState = "idle" | "pending" | "done" | "failed";

export function shouldRequestApproval(input: { selfServe: boolean; connected: boolean; approved: boolean | undefined; state: ApprovalState }) {
  return input.selfServe && input.connected && input.approved === false && input.state === "idle";
}

export function approvalNotice(state: ApprovalState) {
  return state === "pending" ? "Approving this wallet as a demo originator…" : null;
}

export type ApprovalResult = { ok: true } | { ok: false; code: string };

export async function requestApproval(fetchImpl: typeof fetch, base: string, chainId: number, address: string): Promise<ApprovalResult> {
  try {
    const response = await fetchImpl(`${base.replace(/\/+$/, "")}/v1/originator-approvals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chainId, address }),
    });
    const body = (await response.json().catch(() => ({}))) as { approved?: boolean; error?: { code?: string } };
    if (response.ok && body.approved === true) return { ok: true };
    return { ok: false, code: body.error?.code ?? "APPROVAL_FAILED" };
  } catch {
    return { ok: false, code: "NETWORK_ERROR" };
  }
}
