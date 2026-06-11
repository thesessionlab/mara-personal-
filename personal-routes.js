/**
 * Mara Personal · Express Router
 * All /api/personal/* routes.
 *
 * Mounted in server.js: app.use('/api/personal', require('./personal-routes'));
 *
 * Routes:
 *   POST   /chat                       Streaming ORBIT coaching session
 *   POST   /session/start              Open or resume a session
 *   POST   /session/:id/close          Close session, write Track record
 *   GET    /life-model/:userId         Read all active Life Model entries
 *   POST   /life-model/:userId         Write a new entry
 *   PATCH  /life-model/:userId/:entryId  Update/lock an entry
 *   DELETE /life-model/:userId/:entryId  Retire an entry
 *   GET    /journal/:userId            Get journal entries (recent first)
 *   POST   /journal/:userId            Create a journal entry
 *   GET    /journal/:userId/prompt     Get today's personalised prompt
 *   GET    /patterns/:userId           Get surfaceable pattern candidates
 *   POST   /mirror/:userId             Generate a Growth Mirror digest
 *
 * (c) 2026 Jade Matthew. All rights reserved.
 */

"use strict";

const express   = require("express");
const Anthropic  = require("@anthropic-ai/sdk").default;
const fs         = require("fs");
const path       = require("path");
const { createClient } = require("@supabase/supabase-js");

const router    = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const supabase  = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Load the personal system prompt once at startup.
const PERSONAL_PROMPT = fs.readFileSync(
  path.join(__dirname, "system-prompt-personal.txt"),
  "utf8"
);

const CHAT_MODEL    = process.env.PERSONAL_CHAT_MODEL || "claude-sonnet-4-6";
const ANALYSIS_MODEL = process.env.PERSONAL_ANALYSIS_MODEL || "claude-opus-4-6";

// ─── In-memory session store (matching existing server.js pattern) ─────────
const personalConversations = new Map();
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, c] of personalConversations) {
    if (c.lastAccess < cutoff) personalConversations.delete(id);
  }
}, 60 * 60 * 1000);

// ─── Helpers ──────────────────────────────────────────────────────────────

async function loadLifeModel(userId) {
  const { data } = await supabase
    .from("personal_life_model")
    .select("layer, content, confidence, source, updated_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("confidence", { ascending: false });
  return data || [];
}

function buildLifeModelContext(entries) {
  if (!entries.length) return "";
  const byLayer = {};
  for (const e of entries) {
    if (!byLayer[e.layer]) byLayer[e.layer] = [];
    byLayer[e.layer].push(`[${(e.confidence * 100).toFixed(0)}%] ${e.content}`);
  }
  const layerOrder = ["identity","values","emotional","behaviour","relationship","ambition","confidence","growth"];
  const lines = ["LIFE_MODEL_CONTEXT:"];
  for (const layer of layerOrder) {
    if (byLayer[layer]) {
      lines.push(`\n${layer.toUpperCase()}:`);
      for (const item of byLayer[layer]) lines.push(`  ${item}`);
    }
  }
  return lines.join("\n");
}

async function getRecentJournalEntries(userId, limit = 5) {
  const { data } = await supabase
    .from("personal_journal")
    .select("prompt, body, themes, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data || [];
}

async function getSessionCount(userId) {
  const { count } = await supabase
    .from("personal_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return count || 0;
}

// Write a Life Model entry from AI-inferred signal.
// Only writes if content is novel and confidence is above threshold.
async function writeLifeModelEntry(userId, layer, content, confidence, source = "conversation") {
  if (confidence < 0.25) return;
  await supabase.from("personal_life_model").insert({
    user_id: userId,
    layer,
    content,
    confidence,
    source,
    status: "active"
  });
}

// Extract Life Model signals from a completed session's messages.
// Runs post-session as a background task.
async function extractAndWriteSignals(userId, sessionId, messages) {
  if (!messages || messages.length < 4) return;
  const transcript = messages
    .map(m => `${m.role === "user" ? "User" : "Mara"}: ${m.content}`)
    .join("\n");
  try {
    const resp = await anthropic.messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `You are analysing a personal coaching conversation to extract Life Model signals.

Transcript:
${transcript}

Extract up to five concrete inferences across the eight Life Model layers:
identity, values, emotional, behaviour, relationship, ambition, confidence, growth.

Only extract things that are genuinely evidenced in this conversation, not assumptions.
For each entry, assign a confidence score between 0.25 and 0.80 (never above 0.80 from a single session).

Respond in this exact JSON format only, no other text:
{"signals": [{"layer": "...", "content": "...", "confidence": 0.00}]}`
      }]
    });
    const text = resp.content[0]?.text || "{}";
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}");
    if (json.signals && Array.isArray(json.signals)) {
      for (const s of json.signals) {
        if (s.layer && s.content && s.confidence) {
          await writeLifeModelEntry(userId, s.layer, s.content, s.confidence);
        }
      }
    }
  } catch (e) {
    console.error("[personal] signal extraction failed:", e.message);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────

// POST /api/personal/session/start
// Open or resume a session for a user.
router.post("/session/start", async (req, res) => {
  const { userId, sessionType = "open" } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  try {
    const { data, error } = await supabase
      .from("personal_sessions")
      .insert({
        user_id: userId,
        session_type: sessionType,
        orbit_stage: "observe",
        mode: "companion"
      })
      .select()
      .single();
    if (error) throw error;

    personalConversations.set(data.id, {
      messages: [],
      userId,
      sessionId: data.id,
      sessionType,
      lastAccess: Date.now()
    });

    res.json({ sessionId: data.id });
  } catch (err) {
    console.error("[personal] session start error:", err);
    res.status(500).json({ error: "Failed to start session" });
  }
});

// POST /api/personal/session/:id/close
// Close session and write Track record.
router.post("/session/:id/close", async (req, res) => {
  const { id } = req.params;
  const { theme, beliefWorked, actionSet, stateShift } = req.body;

  try {
    await supabase.from("personal_sessions").update({
      orbit_stage: "track",
      theme,
      belief_worked: beliefWorked,
      action_set: actionSet,
      state_shift: stateShift,
      closed_at: new Date().toISOString()
    }).eq("id", id);

    const convo = personalConversations.get(id);
    if (convo && convo.messages.length) {
      extractAndWriteSignals(convo.userId, id, convo.messages);
      personalConversations.delete(id);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[personal] session close error:", err);
    res.status(500).json({ error: "Failed to close session" });
  }
});

// POST /api/personal/chat
// Main ORBIT coaching stream.
// Body: { sessionId, userId, message, mode? }
router.post("/chat", async (req, res) => {
  const { sessionId, userId, message, mode } = req.body;
  if (!sessionId || !userId || !message) {
    return res.status(400).json({ error: "sessionId, userId and message required" });
  }

  let convo = personalConversations.get(sessionId);
  if (!convo) {
    convo = { messages: [], userId, sessionId, lastAccess: Date.now() };
    personalConversations.set(sessionId, convo);
  }
  convo.lastAccess = Date.now();
  convo.messages.push({ role: "user", content: message });

  // Persist message to DB (fire and forget).
  supabase.from("personal_messages").insert({
    session_id: sessionId,
    user_id: userId,
    role: "user",
    content: message
  }).then(() => {}).catch(() => {});

  // Build context.
  const [lifeModel, sessionCount] = await Promise.all([
    loadLifeModel(userId),
    getSessionCount(userId)
  ]);
  const lifeModelCtx = buildLifeModelContext(lifeModel);
  const isEarlySession = sessionCount <= 3;
  const modeInstruction = mode
    ? `\n\nCURRENT MODE: ${mode.toUpperCase()}`
    : "";
  const mirrorInstruction = isEarlySession && sessionCount === 1
    ? "\n\nFIRST SESSION: You are building the baseline. Listen carefully. Near the close of this conversation, offer the Mirror: one specific, non-obvious pattern you have genuinely perceived from how this person speaks and what they have chosen to say."
    : "";

  const systemPrompt = [
    PERSONAL_PROMPT,
    lifeModelCtx,
    modeInstruction,
    mirrorInstruction
  ].filter(Boolean).join("\n\n");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullReply = "";
  try {
    const stream = await anthropic.messages.stream({
      model: CHAT_MODEL,
      max_tokens: 800,
      system: systemPrompt,
      messages: convo.messages.map(m => ({ role: m.role, content: m.content }))
    });

    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
        const text = chunk.delta.text;
        fullReply += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

    convo.messages.push({ role: "assistant", content: fullReply });

    // Persist Mara's reply.
    supabase.from("personal_messages").insert({
      session_id: sessionId,
      user_id: userId,
      role: "assistant",
      content: fullReply
    }).then(() => {}).catch(() => {});

  } catch (err) {
    console.error("[personal] chat error:", err);
    res.write(`data: ${JSON.stringify({ error: "Something went wrong" })}\n\n`);
    res.end();
  }
});

// GET /api/personal/life-model/:userId
router.get("/life-model/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const entries = await loadLifeModel(userId);
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: "Failed to load Life Model" });
  }
});

// POST /api/personal/life-model/:userId
// Write a user-sourced entry (from the Glass Box editor).
router.post("/life-model/:userId", async (req, res) => {
  const { userId } = req.params;
  const { layer, content } = req.body;
  if (!layer || !content) return res.status(400).json({ error: "layer and content required" });

  try {
    const { data, error } = await supabase.from("personal_life_model").insert({
      user_id: userId,
      layer,
      content,
      confidence: 1.0,
      source: "user",
      status: "active",
      user_locked: true
    }).select().single();
    if (error) throw error;
    res.json({ entry: data });
  } catch (err) {
    res.status(500).json({ error: "Failed to write entry" });
  }
});

// PATCH /api/personal/life-model/:userId/:entryId
// Update or lock a Life Model entry.
router.patch("/life-model/:userId/:entryId", async (req, res) => {
  const { entryId } = req.params;
  const { content, userLocked } = req.body;
  try {
    const update = {};
    if (content !== undefined) update.content = content;
    if (userLocked !== undefined) update.user_locked = userLocked;
    if (content !== undefined) { update.source = "user"; update.confidence = 1.0; }
    const { data, error } = await supabase.from("personal_life_model")
      .update(update).eq("id", entryId).select().single();
    if (error) throw error;
    res.json({ entry: data });
  } catch (err) {
    res.status(500).json({ error: "Failed to update entry" });
  }
});

// DELETE /api/personal/life-model/:userId/:entryId
// Retire a Life Model entry.
router.delete("/life-model/:userId/:entryId", async (req, res) => {
  const { entryId } = req.params;
  try {
    await supabase.from("personal_life_model")
      .update({ status: "retired" }).eq("id", entryId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

// GET /api/personal/journal/:userId
router.get("/journal/:userId", async (req, res) => {
  const { userId } = req.params;
  const limit = parseInt(req.query.limit || "20", 10);
  try {
    const entries = await getRecentJournalEntries(userId, limit);
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: "Failed to load journal" });
  }
});

// GET /api/personal/journal/:userId/prompt
// Generate today's personalised prompt from the Life Model.
router.get("/journal/:userId/prompt", async (req, res) => {
  const { userId } = req.params;
  try {
    const [lifeModel, recentEntries] = await Promise.all([
      loadLifeModel(userId),
      getRecentJournalEntries(userId, 3)
    ]);
    const lifeModelCtx = buildLifeModelContext(lifeModel);
    const recentCtx = recentEntries.length
      ? `\nRECENT_REFLECTIONS:\n${recentEntries.map(e => `- ${e.body.slice(0, 120)}`).join("\n")}`
      : "";

    const resp = await anthropic.messages.create({
      model: CHAT_MODEL,
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `${lifeModelCtx}${recentCtx}

Generate one reflection prompt for this specific person, written for today. Not a generic prompt. Drawn from where they actually are and what they have been working on.

The prompt should be a single question or invitation, maximum two sentences. Warm but precise. British English. No em or en dashes. No bullet points.

Return only the prompt text, nothing else.`
      }]
    });

    const prompt = resp.content[0]?.text?.trim() || "What is true for you right now, underneath the surface of the day?";
    res.json({ prompt });
  } catch (err) {
    console.error("[personal] prompt generation error:", err);
    res.json({ prompt: "What is true for you right now, underneath the surface of the day?" });
  }
});

// POST /api/personal/journal/:userId
// Create a journal entry and extract signal.
router.post("/journal/:userId", async (req, res) => {
  const { userId } = req.params;
  const { body, prompt, modality = "text" } = req.body;
  if (!body) return res.status(400).json({ error: "body required" });

  try {
    const { data, error } = await supabase.from("personal_journal").insert({
      user_id: userId,
      prompt,
      body,
      modality,
      themes: [],
      emotional_markers: []
    }).select().single();
    if (error) throw error;

    // Extract themes and write Life Model signals in background.
    (async () => {
      try {
        const analysisResp = await anthropic.messages.create({
          model: ANALYSIS_MODEL,
          max_tokens: 512,
          messages: [{
            role: "user",
            content: `Journal entry:
"${body}"

1. Extract up to three themes as short phrases (e.g. "fear of disappointing others", "uncertainty about direction").
2. Extract up to three emotional markers (e.g. "grief", "relief", "resignation").
3. Extract up to two Life Model signals with layer and confidence.

JSON only:
{"themes": ["..."], "emotional_markers": ["..."], "signals": [{"layer": "...", "content": "...", "confidence": 0.00}]}`
          }]
        });
        const text = analysisResp.content[0]?.text || "{}";
        const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}");

        await supabase.from("personal_journal").update({
          themes: json.themes || [],
          emotional_markers: json.emotional_markers || []
        }).eq("id", data.id);

        if (json.signals) {
          for (const s of json.signals) {
            if (s.layer && s.content && s.confidence >= 0.25) {
              await writeLifeModelEntry(userId, s.layer, s.content, s.confidence, "journal");
            }
          }
        }
      } catch (e) {
        console.error("[personal] journal analysis error:", e.message);
      }
    })();

    res.json({ entry: data });
  } catch (err) {
    res.status(500).json({ error: "Failed to save journal entry" });
  }
});

// GET /api/personal/patterns/:userId
// Return surfaceable pattern candidates.
router.get("/patterns/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const { data } = await supabase
      .from("personal_pattern_candidates")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "surfaceable")
      .order("confidence", { ascending: false })
      .limit(3);
    res.json({ patterns: data || [] });
  } catch (err) {
    res.status(500).json({ error: "Failed to load patterns" });
  }
});

// POST /api/personal/mirror/:userId
// Generate a Growth Mirror digest from the Growth layer.
router.post("/mirror/:userId", async (req, res) => {
  const { userId } = req.params;
  const { period = "30days" } = req.body;

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (period === "30days" ? 30 : 90));

    const [growthEntries, recentSessions] = await Promise.all([
      supabase.from("personal_life_model")
        .select("content, confidence, created_at, updated_at")
        .eq("user_id", userId)
        .eq("layer", "growth")
        .eq("status", "active")
        .gte("updated_at", cutoff.toISOString())
        .order("confidence", { ascending: false }),
      supabase.from("personal_sessions")
        .select("theme, belief_worked, action_set, state_shift, started_at")
        .eq("user_id", userId)
        .not("closed_at", "is", null)
        .gte("started_at", cutoff.toISOString())
        .order("started_at", { ascending: false })
        .limit(10)
    ]);

    if (!growthEntries.data?.length && !recentSessions.data?.length) {
      return res.json({ mirror: "There is not yet enough in the record to show you. Keep going. It builds from here." });
    }

    const evidenceText = [
      growthEntries.data?.map(e => `Growth evidence: ${e.content}`).join("\n"),
      recentSessions.data?.filter(s => s.theme || s.action_set)
        .map(s => `Session: ${s.theme || ""}. ${s.action_set ? "Action taken: " + s.action_set : ""}`).join("\n")
    ].filter(Boolean).join("\n\n");

    const resp = await anthropic.messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `You are writing a Growth Mirror for a specific person.

Evidence from the past ${period === "30days" ? "30 days" : "90 days"}:
${evidenceText}

Write a Growth Mirror: a precise, honest reflection of what has actually moved in this period. Three to five specific, concrete observations drawn from the evidence. Not "you seem happier." The actual words they no longer say. The belief their own actions contradict. The state they described before that they handled differently.

British English. No em or en dashes. No bullet points. No inflation. If the evidence is thin, say so honestly but briefly, then name the one thing that is genuinely there.

Write it directly, as if speaking to the person. Maximum 200 words.`
      }]
    });

    const mirror = resp.content[0]?.text?.trim() || "";
    res.json({ mirror });
  } catch (err) {
    console.error("[personal] mirror error:", err);
    res.status(500).json({ error: "Failed to generate mirror" });
  }
});

module.exports = router;
