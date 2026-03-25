# Optimization project

Interactive React platform for the NYC child care optimization project.

## Features

- Left sidebar with three sections:
  - `Map New York`
  - `Model1`
  - `Model2`
- Dynamic NYC zipcode map with polygon boundaries.
- Hover tooltip and click details panel per zipcode.
- Integrated raw data from:
  - `avg_individual_income_nyc.csv`
  - `employment_rate_nyc.csv`
  - `population_nyc.csv`
  - `child_care_regulated_nyc.csv`
  - `potential_locations_nyc.csv`
- Child care desert classification shown in map tooltip and details panel.

## Project structure

- `src/views/MapNewYorkView.tsx`: main Leaflet map, hover/click interactions, metric coloring.
- `src/utils/zipData.ts`: raw CSV loading and zipcode-level aggregation.
- `src/utils/desertCriteria.ts`: high-demand and desert classification helpers.
- `src/views/Model1View.tsx`: idealized optimization model placeholder.
- `src/views/Model2View.tsx`: realistic optimization model placeholder.
- `public/nyc_zipcodes.geojson`: NYC zipcode boundaries.

## Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Build

```bash
npm run build
```

## Rebuild merged zipcode data (optional)

A script is included to generate a merged zipcode JSON:

```bash
npm run build-data
```

Output target:

- `public/zip_data_nyc.json`

Note: the current frontend already loads and aggregates directly from raw CSV files in `public/`, so this script is optional for now.

## Map usage

1. Go to `Map New York`.
2. Select a metric from `Color by`.
3. Hover over a zipcode polygon to see quick stats.
4. Click a zipcode to pin full details in the right panel.
