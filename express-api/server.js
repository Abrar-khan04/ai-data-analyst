/**
 * Express.js API Gateway
 * ──────────────────────
 * Acts as the public-facing backend (port 3000).
 * Proxies data-processing requests to the Python microservice (port 8010).
 */

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
const PORT = process.env.PORT || 3000;
const PYTHON_SERVICE = process.env.PYTHON_SERVICE_URL || "http://127.0.0.1:8010";

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

// Multer stores uploads in memory so we can forward them as-is
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  try {
    const { data } = await axios.get(`${PYTHON_SERVICE}/api/health`);
    return res.json({ express: "ok", python: data.status });
  } catch {
    return res.json({ express: "ok", python: "unreachable" });
  }
});

// ── CSV Upload ───────────────────────────────────────────────────────────────
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ detail: "No file provided" });
    }

    // Build a FormData-like payload for the Python service
    const form = new FormData();
    form.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const { data } = await axios.post(`${PYTHON_SERVICE}/api/upload`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    return res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = err.response?.data?.detail || err.message;
    return res.status(status).json({ detail });
  }
});

// ── Natural-language query ───────────────────────────────────────────────────
app.post("/api/query", async (req, res) => {
  try {
    const { data } = await axios.post(`${PYTHON_SERVICE}/api/query`, req.body);
    return res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = err.response?.data?.detail || err.message;
    return res.status(status).json({ detail });
  }
});

// ── Session delete ───────────────────────────────────────────────────────────
app.delete("/api/session/:sessionId", async (req, res) => {
  try {
    const { data } = await axios.delete(
      `${PYTHON_SERVICE}/api/session/${req.params.sessionId}`
    );
    return res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = err.response?.data?.detail || err.message;
    return res.status(status).json({ detail });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Express API gateway running on http://localhost:${PORT}`);
  console.log(`📡  Proxying to Python service at ${PYTHON_SERVICE}\n`);
});
