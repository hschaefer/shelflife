import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import { createProxyMiddleware } from "http-proxy-middleware";
import type { IncomingMessage } from "http";
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

  // Parse client-supplied extra headers forwarded as X-ABS-Extra-Headers JSON
  // Accepts both express.Request and raw IncomingMessage (used in proxy callbacks)
  function parseClientExtraHeaders(req: { headers: IncomingMessage['headers'] }): Record<string, string> {
    const raw = req.headers['x-abs-extra-headers'];
    if (!raw || typeof raw !== 'string') return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  // Format dynamic proxy error messages nicely
  function formatError(error: any): string {
    const msg = error?.message || String(error);
    if (msg.includes("EPROTO") || msg.includes("SSL routines") || msg.includes("tls_get_more_records") || msg.includes("WRONG_VERSION_NUMBER")) {
      return "SSL/TLS Protocol Error: Attempted secure connection (https://) to a non-secure (http://) server. Please change the URL scheme to http://";
    }
    return msg;
  }

  // Always mount the generic gateway proxy middleware so all client calls (API + images) are proxied statelessly
  app.use("/gateway", createProxyMiddleware({
    target: ABS_URL || "http://localhost:13378",
    router: (req) => {
      const xTargetUrl = req.headers['x-target-url'];
      if (typeof xTargetUrl === 'string' && xTargetUrl) {
        return xTargetUrl.endsWith('/') ? xTargetUrl.slice(0, -1) : xTargetUrl;
      }
      return ABS_URL || undefined;
    },
    changeOrigin: true,
    pathRewrite: {
      '^/gateway': ''
    },
    on: {
      proxyReq: (proxyReq, req) => {
        // Inject env-level extra headers first, then client-supplied ones
        const clientExtra = parseClientExtraHeaders(req);
        const merged = { ...envExtraHeaders, ...clientExtra };
        for (const [key, value] of Object.entries(merged)) {
          proxyReq.setHeader(key, value);
        }
        
        // Remove temporary routing headers so they don't leak upstream
        proxyReq.removeHeader('x-target-url');
        proxyReq.removeHeader('x-abs-extra-headers');
        
        // If client sends Authorization header, keep it. Otherwise, use ABS_TOKEN if configured.
        const clientAuth = req.headers['authorization'];
        if (!clientAuth && ABS_TOKEN) {
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
