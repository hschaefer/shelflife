import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import { createProxyMiddleware } from "http-proxy-middleware";
import { initDatabase } from "./server/db.js";
import { apiRouter } from "./server/api-routes.js";
import { startSyncService } from "./server/sync.js";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  let ABS_URL = process.env.ABS_URL || "";
  if (ABS_URL.endsWith('/')) {
    ABS_URL = ABS_URL.slice(0, -1);
  }
  const ABS_TOKEN = process.env.ABS_TOKEN;

  // Initialize SQLite cache database
  initDatabase();

  // Mount cache API routes
  app.use("/api", apiRouter());

  // Start background delta sync if configured
  if (ABS_URL && ABS_TOKEN) {
    startSyncService(false);
  }

  // Parse optional extra headers (e.g. Cloudflare Access service tokens)
  let envExtraHeaders: Record<string, string> = {};
  if (process.env.ABS_EXTRA_HEADERS) {
    try {
      envExtraHeaders = JSON.parse(process.env.ABS_EXTRA_HEADERS);
      console.log(`Extra headers loaded from env: ${Object.keys(envExtraHeaders).join(", ")}`);
    } catch {
      console.error("WARNING: ABS_EXTRA_HEADERS is not valid JSON — ignoring.");
    }
  }

  if (!ABS_URL || !ABS_TOKEN) {
    console.error("WARNING: Audiobookshelf URL and Token are not configured.");
  }


  // Format dynamic proxy error messages nicely
  function formatError(error: any): string {
    const msg = error?.message || String(error);
    if (msg.includes("EPROTO") || msg.includes("SSL routines") || msg.includes("tls_get_more_records") || msg.includes("WRONG_VERSION_NUMBER")) {
      return "SSL/TLS Protocol Error: Attempted secure connection (https://) to a non-secure (http://) server. Please change the URL scheme to http://";
    }
    return msg;
  }

  // Intercept and log manual library rescans initiated from the UI
  app.post("/gateway/api/libraries/:id/scan", (req, res, next) => {
    console.log(`[Gateway] Library rescan manually triggered via UI/API for library: ${req.params.id}`);
    next();
  });

  // Always mount the generic gateway proxy middleware so all client calls (API + images) are proxied statelessly
  app.use("/gateway", createProxyMiddleware({
    target: ABS_URL || "http://localhost:13378",
    changeOrigin: true,
    pathRewrite: {
      '^/gateway': ''
    },
    on: {
      proxyReq: (proxyReq) => {
        // Inject env-level extra headers
        for (const [key, value] of Object.entries(envExtraHeaders)) {
          proxyReq.setHeader(key, value);
        }
        // Always authenticate with server-configured token
        if (ABS_TOKEN) {
          proxyReq.setHeader('Authorization', `Bearer ${ABS_TOKEN}`);
        }
      },
      error: (err, req, res: any) => {
        console.error("Gateway proxy error:", err.message);
        const errorMsg = formatError(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: errorMsg }));
      }
    }
  }));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
