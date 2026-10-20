import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, type Me, type Scope } from "./api";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/me"), staleTime: 5 * 60_000, retry: false });

/** Keeps a value in the URL so views can be bookmarked and shared between the two of you. */
export function useParam<T extends string>(name: string, fallback: T): [T, (v: T) => void] {
  const [params, setParams] = useSearchParams();
  const value = (params.get(name) as T) ?? fallback;
  const set = (v: T) => { const p = new URLSearchParams(params); if (v === fallback) p.delete(name); else p.set(name, v); setParams(p, { replace: true }); };
  return [value, set];
}
export const useScope = () => useParam<Scope>("who", "both");
