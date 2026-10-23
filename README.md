# SahayakAI

SahayakAI is a demo-first-contact support platform designed for vulnerable and distressed users. The app supports a modern AI-assisted flow with login, category selection, multilingual interface, adaptive chatbot, safety checks, the fixed 10-item K10 psychological distress assessment, a separate experimental screening engine, legal guidance, recommendations, helpline information, and history tracking.

## Features

- Landing page with polished UI
- Login and registration flow
- Category selection for SC / ST / OBC / BC
- Dashboard with support modules
- Multilingual support toggle
- AI chat demo with adaptive safety flow
- Voice assessment interface with transcript and safety notes
- The fixed K10 items and response options, with a 30-day reference period and a 10-50 total; AI-chat concern context does not change K10 wording or scoring
- K10 score history comparisons and suggestions based on change over time; scores are screening information, not a diagnosis or proof of cause
- A separate experimental condition-specific screening engine, clearly marked as unvalidated and not the K10 or a diagnosis
- A prototype support-priority heuristic, tailored recommendations, and relevant legal/support resources; it is not a validated risk measure
- Incident-matched recommendations and official resource links; caste-related legal information distinguishes general protections from the conditional SC/ST (Prevention of Atrocities) Act, and does not infer eligibility from profile selection alone
- Risk and support classification
- Legal guidance and recommendation engine
- NHAA emergency and helpline page
- Assessment history and summaries
- Demo mode with fallback logic when no API key is configured
- Local English NLP for chat-intent classification, sentiment, and key-term extraction; user text is not sent to an NLP provider
- Messages containing caste-related terms are categorized as **Discrimination due to caste**, with tailored follow-up questions and official legal-aid/commission links; this keyword classification does not establish that discrimination occurred or determine legal eligibility
- Optional Supabase Auth and PostgreSQL persistence with per-user Row Level Security
- Explicit opt-in conversation memory, assessment and mood history, conversation search/resume, memory editing, export, and deletion controls
- Progress comparisons only across matching assessment types/scales; K10 comparisons use only fixed K10 reports, and mood ratings are user-reported and non-clinical

Language selection translates page text, labels, placeholders, accessibility text, assessment questions, and generated answers. Translations are cached in the browser, repeated strings are batched once, and configured providers are tried in this order: Groq, Gemini, then OpenAI. Set at least one of `GEMINI_API_KEY`, `GROQ_API_KEY`, or `OPENAI_API_KEY` in the git-ignored `.env` file for non-English languages. Model overrides are available through `GEMINI_TRANSLATION_MODEL`, `GROQ_TRANSLATION_MODEL`, and `OPENAI_TRANSLATION_MODEL`. Official legal titles, product names, URLs, and helpline numbers are preserved.

## Setup

1. Install dependencies:
   `npm install`
2. Copy the sample environment file:
   `copy .env.example .env`
3. Add the rotated provider key(s) in `.env`:
   - GEMINI_API_KEY for Gemini
   - GROQ_API_KEY for Groq
   - OPENAI_API_KEY for OpenAI
4. Start the app:
   `npm start`

The app is available at http://localhost:3000

On Windows, you can also double-click `run-app.bat`. It starts the server if needed, waits for it to respond, and opens the app in your browser. Keep the server window open while using the app; closing it stops the local server. Run the launcher again whenever you want to use the app.

## Demo Mode

The app works without Supabase configuration. In this mode, account data and assessments use the existing in-memory demo behavior and are not durable; chat/assessment history is not a private persistent database. The `demo` / `demo` account is available for local exploration. Translation requires a configured translation-provider key for non-English text.

## Supabase persistence setup

Supabase is optional for local demo use. To enable persistent, email-based accounts and private history:

1. Create a Supabase project at [supabase.com](https://supabase.com/).
2. In **Project Settings → API**, copy the Project URL and the publishable/anon key. Add them to the local `.env`:
   ```text
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_ANON_KEY=your-publishable-or-anon-key
   SUPABASE_AUTH_REDIRECT_URL=http://localhost:3000/login.html
   ```
   Use only a publishable/anon key here. Do not put a `service_role` secret in `.env` or expose it to a browser.
3. In the Supabase **SQL Editor**, open and run [`supabase/migrations/001_initial_persistence.sql`](./supabase/migrations/001_initial_persistence.sql). It creates the user-scoped tables, indexes, profile trigger, and RLS policies.
4. In **Authentication → URL Configuration**, set the local Site URL to `http://localhost:3000` and allow `http://localhost:3000/login.html` as a redirect URL. For a deployed site, add its HTTPS URL too.
5. Keep email confirmation enabled for production. After signup, users confirm through email and then log in. Supabase email delivery may need an SMTP provider configured for production.
6. Restart the server with `npm start`, then create an account using an email address and a password of at least 8 characters.
7. On the dashboard, turn on **Enable saved conversation memory and progress history** to consent to storing conversations and assessment data. Turning it off deletes saved conversations, assessments, recommendations, progress, and optional profile background/goals. You can also export or delete saved data there.

The server verifies Supabase sessions from HttpOnly, SameSite cookies and accesses PostgreSQL using the user’s token, so table RLS remains active. No conversation history is sent to a third-party AI model by this implementation; the existing chat logic uses local NLP. Without the Supabase variables and migration, the app stays in demo mode.

For deployments behind a trusted reverse proxy, set `TRUST_PROXY=true`; leave it `false` for local development. The included rate limiter uses an in-process store, so a multi-instance production deployment should configure a shared rate-limit store.

## Security note

Do not commit your real `.env` file or expose API keys. Keep them local only or add them as private environment variables in your hosting provider. Never use a Supabase service-role key in this application.

## Project info

The sample environment file includes the project reference values:
- Project ID: projects/689193393430
- Project number: 689193393430

## API routes

- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/me
- GET /api/user/profile
- PATCH /api/user/profile
- GET /api/user/memory
- PUT /api/user/memory
- POST /api/chat
- POST /api/conversations
- GET /api/conversations
- GET /api/conversations/:id/messages
- DELETE /api/conversations/:id
- GET /api/user/progress
- GET /api/user/assessments
- POST /api/user/assessments
- POST /api/user/progress/feedback
- GET /api/user/recommendations
- POST /api/user/recommendations/feedback
- DELETE /api/user/history
- GET /api/user/export
- POST /api/assessment/screening
- GET /api/assessment/k10/questions
- POST /api/assessment/k10
- POST /api/assessment/final
- GET /api/history
- DELETE /api/history/:id
- GET /api/legal
- GET /api/helplines

## Notes

This prototype is not a substitute for professional medical or legal advice. It is designed for first-contact support and triage guidance.
