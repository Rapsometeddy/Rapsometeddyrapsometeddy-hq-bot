# Rapsometeddy HQ Bot

Telegram community bot for Rapsometeddy HQ.

## Features
- /start, /help, /rules, /about, /id
- Admin announcements
- Pin messages
- Warn/unwarn
- Mute/unmute
- Ban/unban
- Welcome messages
- Custom rules
- Basic link filtering
- Vercel serverless webhook

## Environment variables

Add these in Vercel **Production**:

- BOT_TOKEN — Telegram bot token from BotFather
- WEBHOOK_SECRET — private random string used to protect the webhook
- CHANNEL_ID — optional numeric Telegram channel ID. If set, /announce publishes there.

Never put BOT_TOKEN or WEBHOOK_SECRET in GitHub.

## Telegram setup

1. Add the bot to your group as an administrator.
2. Give it permission to delete messages, restrict members, ban users and pin messages.
3. Add the bot to the channel as an administrator with permission to post.
4. Open your Vercel production domain followed by `/api/webhook` to register the webhook.
5. Test /start, /help and /id.

## Important

The current V1 keeps welcome/rules settings in memory. Vercel serverless instances can restart, so these settings are not permanent yet. A later V2 can add a database for persistent settings and warning counts.

Deployment trigger: September 22, 2026.
