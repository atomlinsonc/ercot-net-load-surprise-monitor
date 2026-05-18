# ERCOT Net Load Surprise Monitor

Trader-facing ERCOT fundamentals monitor that turns public ERCOT dashboard feeds into a live net-load surprise signal.

## Core Signal

```text
Forecast Net Load = Forecast Load - Forecast Wind - Forecast Solar
Actual Net Load = Actual Load - Actual Wind - Actual Solar
Net Load Surprise = Actual Net Load - Forecast Net Load
```

Positive surprise means ERCOT is tighter than forecast. Negative surprise means ERCOT is looser than forecast.

## Data Refresh

The GitHub Pages app reads static JSON from `public/data/latest.json`. A scheduled GitHub Action runs every 15 minutes to:

- fetch ERCOT dashboard JSON feeds server-side,
- normalize load, wind, solar, price, and supply/demand inputs,
- write `public/data/latest.json`,
- append compact records to `public/data/history.json` and `public/data/snapshots/YYYY-MM-DD.jsonl`,
- rebuild and redeploy the Pages site.

## Local Development

```bash
npm install
npm run fetch:data
npm run dev
```

## Sources

- ERCOT System-Wide Demand dashboard JSON
- ERCOT Combined Wind and Solar dashboard JSON
- ERCOT System-Wide Prices dashboard JSON
- ERCOT Supply and Demand dashboard JSON
