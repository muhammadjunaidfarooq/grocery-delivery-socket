# OmniMart Socket Server

Socket.IO + Express server for the OmniMart grocery app. It handles new orders, rider job offers, order and payment status updates, customer–rider chat and live rider location.

## Local
```bash
npm install
cp .env.example .env   # SOCKET_SERVER_SECRET must match the Next.js app
npm run dev            # or: npm start
```

## Render (Web Service)
- Runtime: Node · Build: `npm install` · Start: `npm start` · Health check path: `/health`
- Environment variables: `NEXT_BASE_URL` (your Vercel URL), `SOCKET_SERVER_SECRET` (same as Vercel) and optionally `CLIENT_ORIGINS`. Render sets `PORT` itself.
- It listens on `0.0.0.0:$PORT`. In production it refuses to start without `NEXT_BASE_URL` and `SOCKET_SERVER_SECRET`.

## API
- `GET /` and `GET /health`: health check
- `POST /notify`: called by the Next.js API (header `x-socket-secret`) to emit `{ event, data, socketId? }`
- Browser events: `identity`, `update-location`, `join-room`, `send-message`. Only origins in `CLIENT_ORIGINS` (default `NEXT_BASE_URL`) may connect.
