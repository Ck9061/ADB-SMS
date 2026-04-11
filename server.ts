import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { nanoid } from "nanoid";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // AI Studio 强制要求监听 3000 端口
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/ws' || pathname === '/ws/') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  // Store active sessions
  // sessionId -> { host: WebSocket, clients: Set<WebSocket> }
  const sessions = new Map<string, { host: WebSocket | null; clients: Set<WebSocket> }>();

  app.use(express.json());

  // API to create a session
  app.post("/api/session/create", (req, res) => {
    const sessionId = nanoid(10);
    sessions.set(sessionId, { host: null, clients: new Set() });
    res.json({ sessionId });
  });

  // API to check session status
  app.get("/api/session/:id", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json({ 
      sessionId: req.params.id,
      hasHost: !!session.host,
      clientCount: session.clients.size
    });
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", "http://localhost");
    const role = url.searchParams.get("role"); // 'host' or 'client'
    const sessionId = url.searchParams.get("sessionId");

    let session = sessions.get(sessionId);
    if (!session) {
      session = { host: null, clients: new Set() };
      sessions.set(sessionId, session);
    }

    if (role === "host") {
      if (session.host) {
        ws.close(1008, "Host already connected for this session");
        return;
      }
      session.host = ws;
      console.log(`Host connected to session ${sessionId}`);

      ws.on("close", () => {
        session.host = null;
        console.log(`Host disconnected from session ${sessionId}`);
        // Notify clients
        session.clients.forEach(client => {
          client.send(JSON.stringify({ type: "HOST_STATUS", payload: { online: false } }));
        });
      });

      // Forward messages from host to all clients (e.g., status updates)
      ws.on("message", (data) => {
        const message = data.toString();
        session.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      });

      // Notify existing clients that host is online
      session.clients.forEach(client => {
        client.send(JSON.stringify({ type: "HOST_STATUS", payload: { online: true } }));
      });

    } else if (role === "client") {
      session.clients.add(ws);
      console.log(`Client connected to session ${sessionId}`);

      ws.on("close", () => {
        session.clients.delete(ws);
        console.log(`Client disconnected from session ${sessionId}`);
      });

      // Forward messages from client to host (e.g., SEND_SMS)
      ws.on("message", (data) => {
        if (session.host && session.host.readyState === WebSocket.OPEN) {
          session.host.send(data.toString());
        } else {
          ws.send(JSON.stringify({ type: "ERROR", payload: "Host is offline" }));
        }
      });

      // Notify client about host status
      ws.send(JSON.stringify({ type: "HOST_STATUS", payload: { online: !!session.host } }));
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
