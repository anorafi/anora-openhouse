import { createContext, useContext } from "react";
import type { Manifest } from "./manifest";

export const ManifestContext = createContext<Manifest | null>(null);

export function useManifest(): Manifest {
  const manifest = useContext(ManifestContext);
  if (!manifest) throw new Error("The network manifest is not loaded.");
  return manifest;
}
