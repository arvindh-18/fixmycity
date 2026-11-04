import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { Meta, Notification } from "@/types";
import { useAuth } from "@/contexts/AuthContext";

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/api/meta"), staleTime: 5 * 60_000 });
}

export function useNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ unread: number; items: Notification[] }>("/api/notifications"),
    enabled: !!user,
    refetchInterval: 120_000,
  });
}

export function useUnreadMessages() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["conversations", "unread"],
    queryFn: () => api.get<{ unread: number }>("/api/conversations/unread"),
    enabled: !!user,
  });
}
