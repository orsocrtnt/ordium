"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";

export type ChartPayload = {
  timeframe: "1d" | "1h";
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  indicators: {
    sma20: (number | null)[];
    sma50: (number | null)[];
    sma200: (number | null)[];
    rsi14: (number | null)[];
    bollinger: Array<{ mid: number; upper: number; lower: number } | null>;
    macd: Array<{ macd: number; signal: number; histogram: number } | null>;
  };
};

export type MarketChartOverlays = {
  sma?: boolean;
  bollinger?: boolean;
  rsi?: boolean;
  macd?: boolean;
  /** Lignes horizontales sur le panneau RSI (seuils stratégie). */
  rsiLevels?: number[];
  /** Marqueurs d’achat (unix sec). */
  buyMarkers?: Array<{ time: number; text?: string }>;
};

function linePoints(
  times: number[],
  values: (number | null)[],
): { time: UTCTimestamp; value: number }[] {
  const out: { time: UTCTimestamp; value: number }[] = [];
  for (let i = 0; i < times.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    out.push({ time: times[i]! as UTCTimestamp, value: v });
  }
  return out;
}

/**
 * Charts OHLC + overlays — séries fournies par @ordium/engine (mêmes formules que les règles).
 * `overlays` filtre les panneaux selon la stratégie ; défaut = tout afficher.
 */
export function MarketChart({
  data,
  overlays,
}: {
  data: ChartPayload;
  overlays?: MarketChartOverlays;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || data.candles.length === 0) return;

    const showSma = overlays?.sma ?? true;
    const showBb = overlays?.bollinger ?? true;
    const showRsi = overlays?.rsi ?? true;
    const showMacd = overlays?.macd ?? true;
    const rsiLevels = overlays?.rsiLevels ?? [];
    const buyMarkers = overlays?.buyMarkers ?? [];

    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#71717a",
        fontFamily: "inherit",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#f4f4f5" },
        horzLines: { color: "#f4f4f5" },
      },
      rightPriceScale: { borderColor: "#e4e4e7" },
      timeScale: {
        borderColor: "#e4e4e7",
        timeVisible: data.timeframe === "1h",
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
    });

    const times = data.candles.map((c) => c.time);

    const candleSeries = chart.addSeries(
      CandlestickSeries,
      {
        upColor: "#059669",
        downColor: "#dc2626",
        borderVisible: false,
        wickUpColor: "#059669",
        wickDownColor: "#dc2626",
      },
      0,
    );
    candleSeries.setData(
      data.candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    if (buyMarkers.length > 0) {
      const markers: SeriesMarker<UTCTimestamp>[] = [...buyMarkers]
        .sort((a, b) => a.time - b.time)
        .map((m) => ({
          time: m.time as UTCTimestamp,
          position: "belowBar" as const,
          color: "#059669",
          shape: "arrowUp" as const,
          text: m.text ?? "Achat",
        }));
      createSeriesMarkers(candleSeries, markers);
    }

    const addLine = (
      values: (number | null)[],
      color: string,
      paneIndex: number,
      lineWidth: 1 | 2 | 3 | 4 = 1,
    ): ISeriesApi<"Line"> => {
      const s = chart.addSeries(
        LineSeries,
        { color, lineWidth, priceLineVisible: false, lastValueVisible: false },
        paneIndex,
      );
      s.setData(linePoints(times, values));
      return s;
    };

    if (showSma) {
      addLine(data.indicators.sma20, "#2563eb", 0);
      addLine(data.indicators.sma50, "#7c3aed", 0);
      addLine(data.indicators.sma200, "#ca8a04", 0);
    }

    if (showBb) {
      const bbUpper = data.indicators.bollinger.map((b) => b?.upper ?? null);
      const bbMid = data.indicators.bollinger.map((b) => b?.mid ?? null);
      const bbLower = data.indicators.bollinger.map((b) => b?.lower ?? null);
      addLine(bbUpper, "#a1a1aa", 0);
      addLine(bbMid, "#d4d4d8", 0);
      addLine(bbLower, "#a1a1aa", 0);
    }

    let nextPane = 1;

    if (showRsi) {
      const rsiPaneIndex = nextPane;
      nextPane += 1;
      const rsiSeries = addLine(data.indicators.rsi14, "#ea580c", rsiPaneIndex, 2);
      for (const level of rsiLevels) {
        if (!Number.isFinite(level)) continue;
        rsiSeries.createPriceLine({
          price: level,
          color: "#ea580c",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `seuil ${level}`,
        });
      }
      // Zones classiques 30 / 70 si aucun seuil stratégie
      if (rsiLevels.length === 0) {
        for (const level of [30, 70]) {
          rsiSeries.createPriceLine({
            price: level,
            color: "#d4d4d8",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: "",
          });
        }
      }
      const rsiPane = chart.panes()[rsiPaneIndex];
      if (rsiPane) rsiPane.setHeight(100);
    }

    if (showMacd) {
      const macdPaneIndex = nextPane;
      nextPane += 1;
      const hist = chart.addSeries(
        HistogramSeries,
        {
          color: "#94a3b8",
          priceLineVisible: false,
          lastValueVisible: false,
        },
        macdPaneIndex,
      );
      hist.setData(
        times.flatMap((t, i) => {
          const m = data.indicators.macd[i];
          if (!m) return [];
          return [
            {
              time: t as UTCTimestamp,
              value: m.histogram,
              color: m.histogram >= 0 ? "#34d399" : "#f87171",
            },
          ];
        }),
      );
      addLine(
        data.indicators.macd.map((m) => m?.macd ?? null),
        "#2563eb",
        macdPaneIndex,
      );
      addLine(
        data.indicators.macd.map((m) => m?.signal ?? null),
        "#ea580c",
        macdPaneIndex,
      );
      const macdPane = chart.panes()[macdPaneIndex];
      if (macdPane) macdPane.setHeight(110);
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
    // overlays sérialisé pour éviter de recréer le chart à chaque render parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data,
    overlays?.sma,
    overlays?.bollinger,
    overlays?.rsi,
    overlays?.macd,
    overlays?.rsiLevels?.join(","),
    overlays?.buyMarkers?.map((m) => `${m.time}:${m.text ?? ""}`).join("|"),
  ]);

  const paneCount =
    1 +
    ((overlays?.rsi ?? true) ? 1 : 0) +
    ((overlays?.macd ?? true) ? 1 : 0);
  const height = paneCount <= 1 ? 360 : paneCount === 2 ? 460 : 560;

  return (
    <div
      ref={hostRef}
      className="w-full overflow-hidden rounded-xl border border-[var(--border)] bg-white"
      style={{ height }}
    />
  );
}
