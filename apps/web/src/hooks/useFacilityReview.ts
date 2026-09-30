import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "viem";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { fetchDocuments, fetchMetadata, signIn } from "../lib/metadata";
import { useDeployment } from "./useDeployment";

export function useFacilityReview(facility: Address) {
  const chainId = useChainId();
  const api = useDeployment()?.indexerApi;
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | undefined>();

  const metadata = useQuery({
    queryKey: ["facility-metadata", chainId, facility],
    enabled: !!api,
    retry: 1,
    refetchInterval: 15_000,
    queryFn: () => fetchMetadata(fetch, api!, chainId, facility),
  });

  const documents = useQuery({
    queryKey: ["facility-documents", chainId, facility, token ?? "anonymous"],
    enabled: !!api,
    retry: 1,
    refetchInterval: 15_000,
    queryFn: () => fetchDocuments(fetch, api!, chainId, facility, token),
  });

  const login = useMutation({
    mutationFn: async () => {
      if (!api || !address) throw new Error("Connect a wallet first.");
      const session = await signIn(fetch, api, { address, chainId, sign: (message) => signMessageAsync({ message }) });
      setToken(session);
      await queryClient.invalidateQueries({ queryKey: ["facility-documents", chainId, facility] });
    },
  });

  return { api, metadata, documents, login, signedIn: !!token, canSignIn: !!address };
}
