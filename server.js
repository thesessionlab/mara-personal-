/**
 * Mara Personal · Server
 *
 * A Personal Growth Intelligence System. Standalone Express server that serves
 * the app and mounts the /api/personal/* routes (ORBIT coaching, the Life Model,
 * journal, the Growth Mirror).
 *
 * Required environment variables (see .env.example):
 *   CLAUDE_API_KEY        Anthropic API key
 *   SUPABASE_URL          Supabase project URL
 *   SUPABASE_SERVICE_KEY  Supabase service role key
 *
 * (c) 2026 Session · Property of Jade Matthew. All rights reserved.
 */

"use strict";

require("dotenv").config();

const express = require("express");
const path    = require("path");
const cors    = require("cors");

const app = express();

// ─── Fail loudly on missing config ──────────────────────────────────────────
const REQUIRED_ENV = ["CLAUDE_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"];
const missing = REQUIRED_ENV.filter(k => !process.env[k] || !String(process.env[k]).trim());
if (missing.length) {
  console.error("[startup] Missing required environment variables: " + missing.join(", "));
  console.error("[startup] Copy .env.example to .env and fill them in, or set them in your host.");
  process.exit(1);
}

// ─── Security headers ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://cdn.jsdelivr.net",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'"
  ].join("; "));
  next();
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ─── Health ──────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ ok: true, product: "mara-personal", time: new Date().toISOString() });
});

// ─── Mara Personal routes ──────────────────────────────────────────────────
app.use("/api/personal", require("./personal-routes"));

// ─── SPA fallback ────────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[mara-personal] listening on http://localhost:${PORT}`);
});
