import express from "express";
import http from "http";
import dotenv from "dotenv";
import { Server } from "socket.io";
import axios from "axios";
dotenv.config();

// ---- Config -----------------------------------------------------------------
// Render (and most hosts) provide PORT; 4000 is only the local default
const port = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);

// URL of the Next.js app (used to call its API routes).
// Required in production; localhost is only the local development default.
if (isProduction && !process.env.NEXT_BASE_URL) {
  console.error("NEXT_BASE_URL is required in production (e.g. https://your-app.vercel.app).");
  process.exit(1);
}
const NEXT_BASE_URL = (process.env.NEXT_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
// Browsers allowed to connect. Comma-separated, defaults to the Next.js app URL.
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS || NEXT_BASE_URL)
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);
// Shared secret: sent to the Next.js API, and required on POST /notify
const SOCKET_SERVER_SECRET = process.env.SOCKET_SERVER_SECRET;
if (!SOCKET_SERVER_SECRET) {
  if (isProduction) {
    console.error("SOCKET_SERVER_SECRET is required in production.");
    process.exit(1);
  }
  console.warn("WARNING: SOCKET_SERVER_SECRET is not set. Calls to the Next.js API will be rejected.");
}

// Every call to the Next.js API carries the shared secret header
const api = axios.create({
  baseURL: NEXT_BASE_URL,
  timeout: 10000,
  headers: { "x-socket-secret": SOCKET_SERVER_SECRET || "" },
});

const logApiError = (where, error) => {
  console.error(`[${where}]`, error.response?.status ?? "", error.response?.data?.message ?? error.message);
};

// ---- HTTP + Socket.IO --------------------------------------------------------
const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGINS },
});

// Health check (used by Render)
const health = (req, res) => {
  res.json({ status: "ok", clients: io.engine.clientsCount });
};
app.get("/", health);
app.get("/health", health);

// The Next.js API calls this to push an event to one socket or to everyone
app.post("/notify", (req, res) => {
  if (!SOCKET_SERVER_SECRET || req.get("x-socket-secret") !== SOCKET_SERVER_SECRET) {
    console.warn("[notify] rejected: invalid socket secret (check SOCKET_SERVER_SECRET on Vercel and Render)");
    return res.status(401).json({ success: false, message: "invalid socket secret" });
  }
  const { event, data, socketId } = req.body || {};
  if (!event) {
    return res.status(400).json({ success: false, message: "event is required" });
  }
  console.log(`[notify] ${event} -> ${socketId || "everyone"} (${io.engine.clientsCount} connected)`);
  if (socketId) {
    io.to(socketId).emit(event, data);
  } else {
    io.emit(event, data);
  }
  return res.status(200).json({ success: true });
});

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id} from ${socket.handshake.headers.origin || "unknown origin"}`);
  // A logged-in browser tells us which user it is, so the app can reach it later
  socket.on("identity", async (userId) => {
    if (!userId) return;
    try {
      await api.post("/api/socket/connect", { userId, socketId: socket.id });
      console.log(`[identity] user ${userId} -> ${socket.id}`);
    } catch (error) {
      logApiError("identity", error);
    }
  });

  // Rider (or customer) location: save it, then broadcast it to the map pages
  socket.on("update-location", async ({ userId, latitude, longitude } = {}) => {
    if (!userId || typeof latitude !== "number" || typeof longitude !== "number") return;
    const location = { type: "Point", coordinates: [longitude, latitude] };
    try {
      await api.post("/api/socket/update-location", { userId, location });
      io.emit("update-deliveryBoy-location", { userId, location });
    } catch (error) {
      logApiError("update-location", error);
    }
  });

  // Each order has its own chat room (room id = order id)
  socket.on("join-room", (roomId) => {
    if (roomId) socket.join(String(roomId));
  });

  socket.on("send-message", async (message = {}) => {
    if (!message.roomId || !message.text?.trim()) return;
    try {
      const { data: saved } = await api.post("/api/chat/save", message);
      io.to(String(message.roomId)).emit("send-message", saved);
    } catch (error) {
      logApiError("send-message", error);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("User disconnected", socket.id, reason);
  });
});

server.listen(port, HOST, () => {
  console.log(`Socket server running on ${HOST}:${port}`);
  console.log(`Next.js app: ${NEXT_BASE_URL} | allowed origins: ${CLIENT_ORIGINS.join(", ")}`);
});
