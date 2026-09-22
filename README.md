# Rapsometeddy HQ Bot

Telegram community bot + Content Machine for Rapsometeddy HQ.

## Features
- /start, /help, /rules, /about, /id
- Admin announcements and moderation
- Welcome messages and custom rules
- Content ideas
- Post, thread and short-video drafts
- Persistent draft storage
- Draft workflow: Draft → Approved → Queued → Published
- Direct Telegram publishing with /publish
- Vercel serverless webhook

## Vercel environment variables

Add these in Vercel **Production**:

- BOT_TOKEN — Telegram bot token from BotFather
- WEBHOOK_SECRET — private random string used to protect the webhook
- CHANNEL_ID — optional numeric Telegram channel ID. If set, publishing and /announce go there.
- SUPABASE_URL — Supabase project URL
- SUPABASE_SERVICE_ROLE_KEY — Supabase service-role key

Never put BOT_TOKEN, WEBHOOK_SECRET or SUPABASE_SERVICE_ROLE_KEY in GitHub.

## Persistent Content Machine setup

The file `supabase.sql` contains the database schema.

1. Create a Supabase project.
2. Open its SQL Editor.
3. Paste the contents of `supabase.sql`.
4. Run the SQL.
5. Copy the Supabase project URL into Vercel as `SUPABASE_URL`.
6. Copy the Supabase **service_role** key into Vercel as `SUPABASE_SERVICE_ROLE_KEY`.
7. Redeploy after adding the variables.

The service-role key must stay private and must only be stored in Vercel environment variables.

## Content Machine commands

- /content — show Content Machine help
- /ideas — get ideas
- /create <idea> — create and save a post draft
- /thread <idea> — create and save a thread draft
- /short <idea> — create and save a short-video script
- /drafts — list saved drafts
- /approve <number> — mark a draft Approved
- /queue <number> — mark a draft Queued
- /publish <number> — publish a draft to CHANNEL_ID or the current chat
- /published <number> — alias for /publish

## Telegram setup

1. Add the bot to your group as an administrator.
2. Give it permission to delete messages, restrict members, ban users and pin messages.
3. Add the bot to the channel as an administrator with permission to post.
4. Open your Vercel production domain followed by `/api/webhook` to register the webhook.
5. Test /start, /help and /id.

## Important

Without Supabase variables, the bot still runs, but drafts cannot be persisted. With Supabase connected, drafts survive normal Vercel function restarts.
