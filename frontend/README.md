# InventIQ Frontend

React + Vite + Tailwind CSS foundation for the InventIQ inventory intelligence
web application.

## Tech stack

- React 18
- Vite 5
- Tailwind CSS 3
- JavaScript (ESM)

## Getting started

```bash
npm install
npm run dev
```

The dev server runs on `http://localhost:5173`.

## Scripts

| Command   | Description                |
| --------- | -------------------------- |
| `npm run dev`    | Start the Vite dev server |
| `npm run build`  | Production build          |
| `npm run preview`| Preview the production build |

## Project structure

```
frontend/
  public/           # Static assets (favicon, images)
  src/
    components/     # Reusable UI components
    pages/          # Route-level page components
    index.css       # Tailwind directives
    App.jsx         # Root component
    main.jsx        # Entry point
  vite.config.js    # Vite configuration
  tailwind.config.js# Tailwind configuration
  postcss.config.js # PostCSS configuration
  package.json
```