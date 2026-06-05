# UPI Payment Demo

Full-stack UPI payment integration demo using the PhonePe SDK — React frontend with Express API.

**Live:** [https://upi-demo-pi.vercel.app](https://upi-demo-pi.vercel.app)  
**Stack:** React, Vite, Express, PhonePe SDK, Axios

## Features

- PhonePe UPI payment flow (initiate, status check, callback handling)
- Separate React frontend and Express backend in a monorepo
- Environment-based configuration with `.env.example`
- Production-ready Vercel deployment setup

## Architecture

```
upi-demo-/
├── frontend/          # React + Vite UI
├── server.js          # Express API (payment routes)
├── scripts/           # Build/sync utilities
└── .env.example       # Required environment variables
```

## Setup

```bash
git clone https://github.com/AtulPandey429/upi-demo-.git
cd upi-demo-
npm run install:all
cp .env.example .env
# Edit .env with your PhonePe merchant credentials
npm run dev          # API on :5000
npm run dev:frontend # UI on :5173
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PHONEPE_MERCHANT_ID` | PhonePe merchant identifier |
| `PHONEPE_SALT_KEY` | PhonePe salt key for checksum |
| `PHONEPE_SALT_INDEX` | Salt key index |
| `PHONEPE_ENV` | `UAT` or `PRODUCTION` |
| `PORT` | API server port (default: 5000) |

## Deployment

**Vercel:** Connect the repository, set environment variables from `.env.example`, and deploy. The build script compiles the frontend and syncs static assets for the Express server.

## Author

**Atul Pandey** — [GitHub](https://github.com/AtulPandey429) | [LinkedIn](https://www.linkedin.com/in/atul-pandey429)
