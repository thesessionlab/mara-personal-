# Mara Personal

**A Personal Growth Intelligence System.**

Every personal growth product treats the user as an audience. Mara treats the user as the subject. The product is the human being. Mara builds a model of a specific person so accurate, and so continuously updated, that their own reflection becomes the intervention.

This is the MVP build: the smallest product that delivers the defining moment, built on the shared spine of ORBIT and the Life Model.

---

## What is in this repo

| Path | What it is |
|------|------------|
| `server.js` | Standalone Express server. Serves the app, mounts the API. |
| `personal-routes.js` | All `/api/personal/*` routes: ORBIT coaching, Life Model CRUD, journal, Growth Mirror. |
| `system-prompt-personal.txt` | The full Mara system prompt: ORBIT, the four modes, the Mirror, safety. |
| `public/index.html` | The single-page app: Today, Coaching, Journal, the Glass Box. |
| `migrations/001_mara-personal.sql` | The database schema. Run once in Supabase. |

---

## The architecture

Two systems run underneath everything and are never rebuilt:

- **ORBIT** is the methodology in every coaching interaction: Observe, Regulate, Become, Integrate, Track. Regulation always precedes challenge.
- **The Life Model** is the eight-layer living model of the user that every surface reads from and writes to: Identity, Values, Emotional, Behaviour, Relationship, Ambition, Confidence, Growth. It grows from signal, never from forms. It is a glass box: every entry is visible, editable and deletable by the user.

The MVP surfaces:

- **Today** · one honest question, how are you arriving, then routing.
- **Coaching** · the full ORBIT process across six session types, with the four registers (Therapist, Coach, Mentor, Companion).
- **The Mirror** · in the first conversation, Mara reflects one specific, non-obvious pattern back. The product earns trust or it does not.
- **Journal** · reflection intelligence with generative prompts written from the Life Model.
- **The Glass Box** · full visibility, editing and deletion of the Life Model from day one.
- **The Growth Mirror** · a periodic synthesis surfacing concrete evidence of change, in the user's own words.

---

## Running it locally

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# then fill in CLAUDE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

# 3. Set up the database
# Open the Supabase SQL editor and run migrations/001_mara-personal.sql once.

# 4. Start
npm start
# open http://localhost:3000
```

---

## Database

The schema lives in `migrations/001_mara-personal.sql`. It is idempotent and safe to run more than once. It expects an existing `profiles` table with a `uuid` primary key (the standard Supabase auth profile pattern). If you do not have one yet, create a minimal `public.profiles (id uuid primary key references auth.users)` first.

Six tables are created: `personal_life_model`, `personal_sessions`, `personal_messages`, `personal_journal`, `personal_theme_threads`, `personal_pattern_candidates`.

---

## Roadmap

This MVP is the foundation. Built on the same spine, no room is ever rebuilt, only added:

- Pattern Radar active detection and the Insights room
- The Personal Growth Twin (present, emerging, possible self)
- The Future Self engine
- Life GPS, Confidence Lab, Relationships, the Habit Engine
- Voice-first live state reading (gated on the EU AI Act Article 5 answer)

---

(c) 2026 Session · Property of Jade Matthew. All rights reserved.
