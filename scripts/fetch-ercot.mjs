import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = path.join(process.cwd(), "public", "data");
const SNAPSHOT_DIR = path.join(OUTPUT_DIR, "snapshots");

const ENDPOINTS = {
  systemDemand:
    "https://www.ercot.com/api/1/services/read/dashboards/system-wide-demand.json",
  windSolar:
    "https://www.ercot.com/api/1/services/read/dashboards/combine-wind-solar.json",
  supplyDemand:
    "https://www.ercot.com/api/1/services/read/dashboards/supply-demand.json",
  prices:
    "https://www.ercot.com/api/1/services/read/dashboards/system-wide-prices.json"
};

const toNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const round = (value, digits = 0) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const formatMw = (value) =>
  `${Math.abs(Math.round(value)).toLocaleString("en-US")} MW`;

const formatPrice = (value) =>
  typeof value === "number" ? `$${value.toFixed(2)}/MWh` : "unavailable";

const normalizeErcotTimestamp = (value) => {
  if (!value || typeof value !== "string") return null;
  const cleaned = value.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return cleaned;
};

const localDateKey = (isoLike) => {
  const normalized = normalizeErcotTimestamp(isoLike) ?? isoLike;
  return normalized.slice(0, 10);
};

async function fetchJson(name, url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent": "ERCOT-Net-Load-Surprise-Monitor/0.1"
    }
  });

  if (!response.ok) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      return fetchJson(name, url, attempt + 1);
    }
    throw new Error(`${name} fetch failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

const latestWith = (rows, predicate) =>
  [...rows].reverse().find((row) => predicate(row)) ?? null;

const objectValuesSorted = (value) =>
  Object.values(value ?? {}).sort((a, b) => (a.epoch ?? 0) - (b.epoch ?? 0));

function hourEndingFromIntervalEnding(value) {
  if (!value || typeof value !== "string") return null;
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour === 0 && minute === 0) return 24;
  return minute === 0 ? hour : hour + 1;
}

function buildPriceMaps(prices) {
  const daByHour = new Map();
  for (const row of prices.damSppData ?? []) {
    if (typeof row.hourEnding === "number") daByHour.set(row.hourEnding, row);
  }

  const latestRtByHour = new Map();
  for (const row of prices.rtSppData ?? []) {
    const hourEnding = hourEndingFromIntervalEnding(row.intervalEnding);
    if (hourEnding) latestRtByHour.set(hourEnding, row);
  }

  return { daByHour, latestRtByHour };
}

function normalizeSeries(systemDemand, windSolar, prices) {
  const loadRows = systemDemand.currentDay?.data ?? [];
  const renewableRows = objectValuesSorted(windSolar.currentDay?.data);
  const renewablesByHour = new Map(
    renewableRows.map((row) => [row.hourEnding, row])
  );
  const { daByHour, latestRtByHour } = buildPriceMaps(prices);

  return loadRows
    .map((loadRow) => {
      const renewableRow = renewablesByHour.get(loadRow.hourEnding);
      if (!renewableRow) return null;

      const load = toNumber(loadRow.systemLoad);
      const loadForecast = toNumber(loadRow.currentLoadForecast);
      const wind = toNumber(renewableRow.actualWind);
      const windForecast = toNumber(renewableRow.stwpf);
      const solar = toNumber(renewableRow.actualSolar);
      const solarForecast = toNumber(renewableRow.stppf);
      const rtPrice = toNumber(latestRtByHour.get(loadRow.hourEnding)?.hbHubAvg);
      const daPrice = toNumber(daByHour.get(loadRow.hourEnding)?.hbHubAvg);

      const hasActuals =
        load !== null &&
        loadForecast !== null &&
        wind !== null &&
        windForecast !== null &&
        solar !== null &&
        solarForecast !== null;

      const forecastNetLoad = hasActuals
        ? loadForecast - windForecast - solarForecast
        : null;
      const actualNetLoad = hasActuals ? load - wind - solar : null;
      const netLoadSurprise =
        hasActuals && forecastNetLoad !== null && actualNetLoad !== null
          ? actualNetLoad - forecastNetLoad
          : null;

      return {
        hour: `HE ${loadRow.hourEnding}`,
        hourEnding: loadRow.hourEnding,
        timestamp: normalizeErcotTimestamp(loadRow.timestamp),
        load: round(load),
        loadForecast: round(loadForecast),
        wind: round(wind),
        windForecast: round(windForecast),
        solar: round(solar),
        solarForecast: round(solarForecast),
        forecastNetLoad: round(forecastNetLoad),
        actualNetLoad: round(actualNetLoad),
        netLoadSurprise: round(netLoadSurprise),
        rtPrice: round(rtPrice, 2),
        daPrice: round(daPrice, 2),
        priceSpread:
          rtPrice !== null && daPrice !== null ? round(rtPrice - daPrice, 2) : null
      };
    })
    .filter(Boolean);
}

function forecastNetLoadAt(series, hourEnding) {
  return series.find((row) => row.hourEnding === hourEnding)?.forecastNetLoad ?? null;
}

function assessRamp(series, currentHour, surprise) {
  const inMorningRamp = currentHour >= 6 && currentHour <= 10;
  const inEveningRamp = currentHour >= 16 && currentHour <= 21;
  const inRamp = inMorningRamp || inEveningRamp;
  const currentForecast = forecastNetLoadAt(series, currentHour);
  const nextThreeForecast = forecastNetLoadAt(series, Math.min(currentHour + 3, 24));
  const forecastRamp =
    currentForecast !== null && nextThreeForecast !== null
      ? nextThreeForecast - currentForecast
      : null;

  let label = "Normal";
  if (inRamp && forecastRamp !== null && forecastRamp > 4500) label = "Tight";
  else if (inRamp && forecastRamp !== null && forecastRamp > 2500) label = "Watch";
  else if (inRamp && Math.abs(surprise ?? 0) > 2000) label = "Watch";
  else if (!inRamp && currentHour >= 14 && currentHour < 16) label = "Monitor evening";

  return {
    label,
    inRamp,
    window: inMorningRamp ? "Morning ramp" : inEveningRamp ? "Evening ramp" : "Off-ramp",
    forecastRamp: round(forecastRamp)
  };
}

function riskFromInputs(current, ramp) {
  let score = 0;
  const factors = [];

  if (current.netLoadSurprise >= 6000) {
    score += 4;
    factors.push("net load surprise above +6 GW");
  } else if (current.netLoadSurprise >= 3500) {
    score += 3;
    factors.push("net load surprise above +3.5 GW");
  } else if (current.netLoadSurprise >= 2000) {
    score += 2;
    factors.push("net load surprise above +2 GW");
  } else if (current.netLoadSurprise >= 1000) {
    score += 1;
    factors.push("net load surprise above +1 GW");
  } else if (current.netLoadSurprise <= -2000) {
    factors.push("net load surprise is materially loose");
  }

  if (current.reserveMargin !== null && current.reserveMargin < 3000) {
    score += 3;
    factors.push("capacity cushion below 3 GW");
  } else if (current.reserveMargin !== null && current.reserveMargin < 5000) {
    score += 2;
    factors.push("capacity cushion below 5 GW");
  } else if (current.reserveMargin !== null && current.reserveMargin < 8000) {
    score += 1;
    factors.push("capacity cushion below 8 GW");
  }

  if (current.priceSpread >= 200) {
    score += 3;
    factors.push("RT hub price is more than $200/MWh above DA");
  } else if (current.priceSpread >= 75) {
    score += 2;
    factors.push("RT hub price is more than $75/MWh above DA");
  } else if (current.priceSpread >= 25) {
    score += 1;
    factors.push("RT hub price is more than $25/MWh above DA");
  }

  if (ramp.label === "Tight") {
    score += 2;
    factors.push("large forecast net-load ramp is active");
  } else if (ramp.label === "Watch") {
    score += 1;
    factors.push("ramp window is active with notable stress");
  }

  const riskLabel =
    score >= 6 ? "Scarcity Risk" : score >= 4 ? "Tight" : score >= 2 ? "Watch" : "Normal";

  return { riskLabel, riskScore: score, factors };
}

function buildTraderNote(current, risk) {
  const direction =
    current.netLoadSurprise > 500
      ? "tighter than expected"
      : current.netLoadSurprise < -500
        ? "looser than expected"
        : "close to forecast";

  const drivers = [
    {
      name: "load",
      value: current.loadSurprise,
      phrase:
        current.loadSurprise >= 0
          ? `load is ${formatMw(current.loadSurprise)} above forecast`
          : `load is ${formatMw(current.loadSurprise)} below forecast`
    },
    {
      name: "wind",
      value: current.windMissTightness,
      phrase:
        current.windMissTightness >= 0
          ? `wind is ${formatMw(current.windMissTightness)} below forecast`
          : `wind is ${formatMw(current.windMissTightness)} above forecast`
    },
    {
      name: "solar",
      value: current.solarMissTightness,
      phrase:
        current.solarMissTightness >= 0
          ? `solar is ${formatMw(current.solarMissTightness)} below forecast`
          : `solar is ${formatMw(current.solarMissTightness)} above forecast`
    }
  ].sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0));

  const priceText =
    current.priceSpread === null
      ? "Price response is unavailable from the current snapshot."
      : current.priceSpread > 10
        ? `RT hub prices are trading ${formatPrice(current.priceSpread)} above day-ahead, suggesting the market is pricing tighter real-time conditions.`
        : current.priceSpread < -10
          ? `RT hub prices are trading ${formatPrice(Math.abs(current.priceSpread))} below day-ahead, so prices have not confirmed scarcity in this snapshot.`
          : "RT hub prices are close to day-ahead for the current hour.";

  const riskText =
    risk.factors.length > 0
      ? `Risk label is ${risk.riskLabel} because ${risk.factors.join(", ")}.`
      : `Risk label is ${risk.riskLabel}; the transparent inputs are not flashing material stress.`;

  return `ERCOT is currently running ${direction}. ${drivers[0].phrase}, ${drivers[1].phrase}, and ${drivers[2].phrase}. Actual net load is therefore about ${formatMw(current.netLoadSurprise)} ${current.netLoadSurprise >= 0 ? "higher" : "lower"} than expected. ${priceText} ${riskText}`;
}

async function readHistory() {
  try {
    const raw = await readFile(path.join(OUTPUT_DIR, "history.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function main() {
  await mkdir(SNAPSHOT_DIR, { recursive: true });

  const [systemDemand, windSolar, supplyDemand, prices] = await Promise.all([
    fetchJson("system-wide demand", ENDPOINTS.systemDemand),
    fetchJson("combined wind and solar", ENDPOINTS.windSolar),
    fetchJson("supply and demand", ENDPOINTS.supplyDemand),
    fetchJson("system-wide prices", ENDPOINTS.prices)
  ]);

  const series = normalizeSeries(systemDemand, windSolar, prices);
  const currentHourRow = latestWith(
    series,
    (row) => typeof row.netLoadSurprise === "number"
  );

  if (!currentHourRow) {
    throw new Error("No current ERCOT actual net load surprise row could be built.");
  }

  const latestSupply = latestWith(
    supplyDemand.data ?? [],
    (row) => row.forecast === 0 && typeof row.demand === "number"
  );

  const latestRt = latestWith(prices.rtSppData ?? [], (row) => typeof row.hbHubAvg === "number");
  const latestRtHour = hourEndingFromIntervalEnding(latestRt?.intervalEnding);
  const matchingDa = (prices.damSppData ?? []).find(
    (row) => row.hourEnding === latestRtHour
  );

  const loadSurprise = currentHourRow.load - currentHourRow.loadForecast;
  const windMissTightness = currentHourRow.windForecast - currentHourRow.wind;
  const solarMissTightness = currentHourRow.solarForecast - currentHourRow.solar;
  const reserveMargin =
    latestSupply?.capacity !== undefined && latestSupply?.demand !== undefined
      ? latestSupply.capacity - latestSupply.demand
      : null;
  const reserveMarginPct =
    reserveMargin !== null && latestSupply?.capacity
      ? (reserveMargin / latestSupply.capacity) * 100
      : null;

  const current = {
    ...currentHourRow,
    loadSurprise: round(loadSurprise),
    windMissTightness: round(windMissTightness),
    solarMissTightness: round(solarMissTightness),
    rtTimestamp: normalizeErcotTimestamp(latestRt?.timestamp),
    rtPrice: round(toNumber(latestRt?.hbHubAvg), 2),
    daPrice: round(toNumber(matchingDa?.hbHubAvg), 2),
    priceSpread:
      typeof latestRt?.hbHubAvg === "number" && typeof matchingDa?.hbHubAvg === "number"
        ? round(latestRt.hbHubAvg - matchingDa.hbHubAvg, 2)
        : null,
    capacity: round(toNumber(latestSupply?.capacity)),
    demand: round(toNumber(latestSupply?.demand)),
    reserveMargin: round(reserveMargin),
    reserveMarginPct: round(reserveMarginPct, 1)
  };

  const ramp = assessRamp(series, current.hourEnding, current.netLoadSurprise);
  current.rampRisk = ramp.label;
  current.rampWindow = ramp.window;
  current.forecastRamp = ramp.forecastRamp;

  const risk = riskFromInputs(current, ramp);
  const traderNote = buildTraderNote(current, risk);
  const generatedAt = new Date().toISOString();

  const snapshot = {
    generatedAt,
    sourceStatus: "ok",
    sourceUrls: ENDPOINTS,
    sourceLastUpdated: {
      systemDemand: systemDemand.lastUpdated,
      windSolar: windSolar.lastUpdated,
      supplyDemand: supplyDemand.lastUpdated,
      prices: prices.lastUpdated
    },
    summary: {
      ...risk,
      traderNote
    },
    current,
    series,
    methodology: {
      forecastNetLoad:
        "Forecast Load - Short-Term Wind Power Forecast - Short-Term PhotoVoltaic Power Forecast",
      actualNetLoad: "Actual System Load - Actual Wind - Actual Solar",
      netLoadSurprise: "Actual Net Load - Forecast Net Load",
      pricePoint: "ERCOT System-Wide Prices hbHubAvg, latest RT interval versus matching DA hour",
      reserveProxy:
        "Supply and Demand dashboard capacity minus demand; this is a capacity cushion proxy, not a replacement for ERCOT reserve products."
    }
  };

  const compactSnapshot = {
    generatedAt,
    timestamp: current.timestamp,
    hourEnding: current.hourEnding,
    netLoadSurprise: current.netLoadSurprise,
    forecastNetLoad: current.forecastNetLoad,
    actualNetLoad: current.actualNetLoad,
    loadSurprise: current.loadSurprise,
    windMissTightness: current.windMissTightness,
    solarMissTightness: current.solarMissTightness,
    rtPrice: current.rtPrice,
    daPrice: current.daPrice,
    priceSpread: current.priceSpread,
    reserveMargin: current.reserveMargin,
    riskLabel: risk.riskLabel,
    riskScore: risk.riskScore
  };

  const history = await readHistory();
  const nextHistory = [...history, compactSnapshot].slice(-1000);
  snapshot.history = nextHistory;

  await writeFile(path.join(OUTPUT_DIR, "latest.json"), JSON.stringify(snapshot, null, 2));
  await writeFile(path.join(OUTPUT_DIR, "history.json"), JSON.stringify(nextHistory, null, 2));

  const dayKey = localDateKey(current.timestamp ?? generatedAt);
  await appendFile(
    path.join(SNAPSHOT_DIR, `${dayKey}.jsonl`),
    `${JSON.stringify(compactSnapshot)}\n`
  );

  console.log(
    `ERCOT snapshot written: ${risk.riskLabel}, surprise ${current.netLoadSurprise} MW, RT-DA ${current.priceSpread}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
