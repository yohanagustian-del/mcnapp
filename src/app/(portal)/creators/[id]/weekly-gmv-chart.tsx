"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface WeeklyGmvChartPoint {
  week: string; // "W1".."W5"
  gmv: number | null;
}

function formatRupiahFull(v: number): string {
  return `Rp${Math.round(v).toLocaleString("id-ID")}`;
}

function formatRupiahAxis(v: number): string {
  if (Math.abs(v) >= 1_000_000_000) return `Rp${(v / 1_000_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000_000) return `Rp${(v / 1_000_000).toFixed(0)}jt`;
  if (Math.abs(v) >= 1_000) return `Rp${(v / 1_000).toFixed(0)}rb`;
  return String(v);
}

/**
 * GMV affiliate mingguan (W1-W5) untuk satu creator satu bulan terpilih.
 * Client component murni presentasi — data & agregasi datang dari
 * src/lib/m8/weekly-growth.ts (server-side, 0 token AI).
 */
export function WeeklyGmvChart({ data }: { data: WeeklyGmvChartPoint[] }) {
  const chartData = data.map((d) => ({ week: d.week, gmv: d.gmv ?? 0 }));

  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={formatRupiahAxis} tick={{ fontSize: 12 }} width={64} />
          <Tooltip
            formatter={(value) => [formatRupiahFull(Number(value)), "GMV Affiliate"]}
            labelFormatter={(label) => `Minggu ${label}`}
          />
          <Bar dataKey="gmv" fill="#0f172a" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
