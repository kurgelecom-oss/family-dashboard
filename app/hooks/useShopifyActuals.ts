"use client";
import { useState, useEffect, useCallback } from "react";

type PeriodData = { revenue: number; orders: number };

type ActualsData = {
  daily:   PeriodData;
  weekly:  PeriodData;
  monthly: PeriodData;
};

export type UseShopifyActualsResult = ActualsData & {
  loading: boolean;
  error:   string | null;
};

const DEFAULT: ActualsData = {
  daily:   { revenue: 0, orders: 0 },
  weekly:  { revenue: 0, orders: 0 },
  monthly: { revenue: 0, orders: 0 },
};

export function useShopifyActuals(): UseShopifyActualsResult {
  const [data,    setData]    = useState<ActualsData>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/test-actuals"); // TODO: revert to /api/shopify-actuals after visual check
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ActualsData & { error?: string };
      if (json.error) throw new Error(json.error);
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 60000);
    return () => clearInterval(id);
  }, [poll]);

  return { ...data, loading, error };
}
