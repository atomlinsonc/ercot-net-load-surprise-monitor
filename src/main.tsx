import React from "react";
import ReactDOM from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock3,
  Database,
  Gauge,
  RefreshCcw,
  TrendingDown,
  TrendingUp,
  Zap
} from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import "./styles.css";

type RiskLabel = "Normal" | "Watch" | "Tight" | "Scarcity Risk";

type HourlyPoint = {
  hour: string;
  hourEnding: number;
  timestamp?: string;
  load: number | null;
  loadForecast: number | null;
  wind: number | null;
  windForecast: number | null;
  solar: number | null;
  solarForecast: number | null;
  forecastNetLoad: number | null;
  actualNetLoad: number | null;
  netLoadSurprise: number | null;
  rtPrice: number | null;
  daPrice: number | null;
  priceSpread: number | null;
};

type SnapshotHistoryPoint = {
  generatedAt: string;
  hourEnding: number;
  netLoadSurprise: number | null;
  rtPrice: number | null;
  daPrice: number | null;
  priceSpread: number | null;
  reserveMargin: number | null;
  riskLabel: RiskLabel;
};

type DashboardData = {
  generatedAt: string;
  sourceStatus: string;
  sourceUrls?: Record<string, string>;
  sourceLastUpdated?: Record<string, string>;
  summary: {
    riskLabel: RiskLabel;
    riskScore: number;
    factors?: string[];
    traderNote: string;
  };
  current: HourlyPoint & {
    loadSurprise: number | null;
    windMissTightness: number | null;
    solarMissTightness: number | null;
    rtTimestamp?: string;
    capacity: number | null;
    demand: number | null;
    reserveMargin: number | null;
    reserveMarginPct: number | null;
    rampRisk: string;
    rampWindow?: string;
    forecastRamp?: number | null;
  };
  series: HourlyPoint[];
  history?: SnapshotHistoryPoint[];
  methodology?: Record<string, string>;
};

const formatMw = (value: number | null | undefined, decimals = 0) => {
  if (typeof value !== "number") return "n/a";
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  })} MW`;
};

const formatGw = (value: number | null | undefined) => {
  if (typeof value !== "number") return "n/a";
  return `${(value / 1000).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  })} GW`;
};

const formatPrice = (value: number | null | undefined) => {
  if (typeof value !== "number") return "n/a";
  const absolute = Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  });
  return value < 0 ? `-$${absolute}` : `$${absolute}`;
};

const formatDate = (value: string | undefined) => {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
};

const signedClass = (value: number | null | undefined) => {
  if (typeof value !== "number") return "";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "";
};

function RiskBadge({ label }: { label: RiskLabel }) {
  return <span className={`risk-badge ${label.toLowerCase().replaceAll(" ", "-")}`}>{label}</span>;
}

function StatCard({
  icon: Icon,
  label,
  value,
  subvalue,
  tone = "neutral"
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  subvalue?: string;
  tone?: "neutral" | "positive" | "negative" | "warn";
}) {
  return (
    <section className={`stat-card ${tone}`}>
      <div className="stat-label">
        <Icon size={16} />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      {subvalue ? <small>{subvalue}</small> : null}
    </section>
  );
}

function MiniComparison({
  title,
  actual,
  forecast,
  surprise,
  driverLabel
}: {
  title: string;
  actual: number | null;
  forecast: number | null;
  surprise: number | null;
  driverLabel: string;
}) {
  const max = Math.max(Math.abs(actual ?? 0), Math.abs(forecast ?? 0), 1);
  const actualPct = Math.min(100, Math.max(4, ((actual ?? 0) / max) * 100));
  const forecastPct = Math.min(100, Math.max(4, ((forecast ?? 0) / max) * 100));

  return (
    <section className="comparison-card">
      <div className="comparison-header">
        <span>{title}</span>
        <strong className={signedClass(surprise)}>{formatMw(surprise)}</strong>
      </div>
      <div className="bar-pair" aria-label={`${title} actual versus forecast`}>
        <div>
          <span>Actual</span>
          <div className="meter">
            <i style={{ width: `${actualPct}%` }} />
          </div>
          <b>{formatGw(actual)}</b>
        </div>
        <div>
          <span>Forecast</span>
          <div className="meter forecast">
            <i style={{ width: `${forecastPct}%` }} />
          </div>
          <b>{formatGw(forecast)}</b>
        </div>
      </div>
      <small>{driverLabel}</small>
    </section>
  );
}

function Dashboard() {
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}data/latest.json`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json());
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Unable to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    const id = window.setInterval(load, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!data) {
    return (
      <main className="shell">
        <section className="empty-state">
          <Database size={28} />
          <h1>ERCOT Net Load Surprise Monitor</h1>
          <p>{error ? `Data load failed: ${error}` : "Loading ERCOT snapshot..."}</p>
          <button type="button" onClick={load}>
            <RefreshCcw size={16} /> Retry
          </button>
        </section>
      </main>
    );
  }

  const current = data.current;
  const latestHistory = (data.history ?? []).slice(-48);
  const surpriseTone =
    typeof current.netLoadSurprise === "number" && current.netLoadSurprise > 0
      ? "positive"
      : typeof current.netLoadSurprise === "number" && current.netLoadSurprise < 0
        ? "negative"
        : "neutral";

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Live ERCOT trading support</p>
          <h1>ERCOT Net Load Surprise Monitor</h1>
        </div>
        <div className="topbar-actions">
          <RiskBadge label={data.summary.riskLabel} />
          <button type="button" onClick={load} disabled={loading} title="Refresh snapshot">
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>
      </header>

      <section className="status-strip">
        <span>
          <Clock3 size={15} />
          Snapshot {formatDate(data.generatedAt)}
        </span>
        <span>
          <Activity size={15} />
          ERCOT fundamentals through {formatDate(current.timestamp)}
        </span>
        <span>
          <Zap size={15} />
          RT price through {formatDate(current.rtTimestamp)}
        </span>
        <span className={data.sourceStatus === "ok" ? "ok-dot" : "warn-dot"}>
          Source {data.sourceStatus}
        </span>
      </section>

      {error ? <div className="data-warning">Latest refresh failed: {error}</div> : null}

      <section className="metric-grid">
        <StatCard
          icon={Gauge}
          label="Net Load Surprise"
          value={formatMw(current.netLoadSurprise)}
          subvalue={`${formatGw(current.actualNetLoad)} actual vs ${formatGw(current.forecastNetLoad)} forecast`}
          tone={surpriseTone}
        />
        <StatCard
          icon={TrendingUp}
          label="RT - DA Hub Spread"
          value={formatPrice(current.priceSpread)}
          subvalue={`${formatPrice(current.rtPrice)} RT vs ${formatPrice(current.daPrice)} DA`}
          tone={current.priceSpread && current.priceSpread > 25 ? "warn" : "neutral"}
        />
        <StatCard
          icon={AlertTriangle}
          label="Reserve / Tightness Proxy"
          value={formatGw(current.reserveMargin)}
          subvalue={`${formatGw(current.capacity)} capacity vs ${formatGw(current.demand)} demand`}
          tone={current.reserveMargin && current.reserveMargin < 8000 ? "warn" : "neutral"}
        />
        <StatCard
          icon={BarChart3}
          label="Ramp Risk"
          value={current.rampRisk}
          subvalue={`${current.rampWindow ?? "Ramp window"}; next 3h forecast ramp ${formatMw(current.forecastRamp)}`}
          tone={current.rampRisk === "Tight" || current.rampRisk === "Watch" ? "warn" : "neutral"}
        />
      </section>

      <section className="layout-two">
        <article className="panel trader-note">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Plain-English market setup</p>
              <h2>Trader Note</h2>
            </div>
            <RiskBadge label={data.summary.riskLabel} />
          </div>
          <p>{data.summary.traderNote}</p>
          <div className="risk-factors">
            {(data.summary.factors?.length ? data.summary.factors : ["Inputs are below alert thresholds"]).map(
              (factor) => (
                <span key={factor}>{factor}</span>
              )
            )}
          </div>
        </article>

        <article className="panel driver-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Forecast miss decomposition</p>
              <h2>Current Drivers</h2>
            </div>
          </div>
          <div className="driver-list">
            <MiniComparison
              title="Load"
              actual={current.load}
              forecast={current.loadForecast}
              surprise={current.loadSurprise}
              driverLabel="Positive means actual demand is tighter than forecast."
            />
            <MiniComparison
              title="Wind"
              actual={current.wind}
              forecast={current.windForecast}
              surprise={current.windMissTightness}
              driverLabel="Positive means wind underperformed forecast."
            />
            <MiniComparison
              title="Solar"
              actual={current.solar}
              forecast={current.solarForecast}
              surprise={current.solarMissTightness}
              driverLabel="Positive means solar underperformed forecast."
            />
          </div>
        </article>
      </section>

      <section className="chart-grid">
        <article className="panel chart-panel wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Current operating day</p>
              <h2>Hourly Net Load Surprise</h2>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data.series} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="hour" tick={{ fill: "#98a2ad", fontSize: 11 }} interval={1} />
              <YAxis tick={{ fill: "#98a2ad", fontSize: 11 }} tickFormatter={(v) => `${v / 1000} GW`} />
              <Tooltip contentStyle={{ background: "#14161b", border: "1px solid #303844" }} />
              <ReferenceLine y={0} stroke="#667085" />
              <Bar dataKey="netLoadSurprise" name="Net Load Surprise" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="priceSpread" name="RT - DA" stroke="#7dd3fc" dot={false} yAxisId={0} />
            </ComposedChart>
          </ResponsiveContainer>
        </article>

        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Net load stack</p>
              <h2>Actual vs Forecast</h2>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={data.series} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="hour" tick={{ fill: "#98a2ad", fontSize: 11 }} interval={2} />
              <YAxis tick={{ fill: "#98a2ad", fontSize: 11 }} tickFormatter={(v) => `${v / 1000} GW`} />
              <Tooltip contentStyle={{ background: "#14161b", border: "1px solid #303844" }} />
              <Line type="monotone" dataKey="actualNetLoad" name="Actual Net Load" stroke="#34d399" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="forecastNetLoad" name="Forecast Net Load" stroke="#c4b5fd" dot={false} strokeWidth={2} />
              <Legend wrapperStyle={{ color: "#d0d5dd", fontSize: 12 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </article>

        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Hub price response</p>
              <h2>RT vs DA Prices</h2>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={data.series} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="hour" tick={{ fill: "#98a2ad", fontSize: 11 }} interval={2} />
              <YAxis tick={{ fill: "#98a2ad", fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={{ background: "#14161b", border: "1px solid #303844" }} />
              <Line type="monotone" dataKey="rtPrice" name="RT HB Hub Avg" stroke="#f97316" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="daPrice" name="DA HB Hub Avg" stroke="#60a5fa" dot={false} strokeWidth={2} />
              <Legend wrapperStyle={{ color: "#d0d5dd", fontSize: 12 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </article>

        <article className="panel chart-panel wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Stored snapshots</p>
              <h2>Surprise vs Price Outcome Trail</h2>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={latestHistory} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="hourEnding" tick={{ fill: "#98a2ad", fontSize: 11 }} label={{ value: "Hour Ending", fill: "#98a2ad", position: "insideBottom", offset: -4 }} />
              <YAxis yAxisId="left" tick={{ fill: "#98a2ad", fontSize: 11 }} tickFormatter={(v) => `${v / 1000} GW`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: "#98a2ad", fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={{ background: "#14161b", border: "1px solid #303844" }} />
              <Area yAxisId="left" type="monotone" dataKey="netLoadSurprise" name="Surprise" fill="#f59e0b44" stroke="#f59e0b" />
              <Line yAxisId="right" type="monotone" dataKey="priceSpread" name="RT - DA" stroke="#7dd3fc" dot={false} strokeWidth={2} />
              <Legend wrapperStyle={{ color: "#d0d5dd", fontSize: 12 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </article>
      </section>

      <footer className="footer-panel">
        <div>
          <strong>Methodology</strong>
          <p>
            Forecast net load = forecast load - forecast wind - forecast solar. Actual net load = actual load -
            actual wind - actual solar. Positive surprise means ERCOT is tighter than forecast.
          </p>
        </div>
        <div className="source-links">
          {data.sourceUrls
            ? Object.entries(data.sourceUrls).map(([key, url]) => (
                <a href={url} key={key} target="_blank" rel="noreferrer">
                  {key}
                </a>
              ))
            : null}
        </div>
      </footer>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>
);
