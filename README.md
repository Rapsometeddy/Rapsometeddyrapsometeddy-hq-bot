# Rapsometeddy HQ Bot

A lightweight Telegram community bot for Rapsometeddy HQ.

## Features
- `/start`, `/help`, `/rules`, `/about`
- `/id` to show the current chat ID
- `/announce <message>` for admins
- `/pin` to pin the replied-to message (admins)
- `/warn` and `/unwarn` (admins)
- `/mute` and `/unmute` (admins)
- `/ban` and `/unban` (admins)
- `/welcome on|off`
- `/setrules <text>`
- Basic link/spam filtering
- Webhook endpoint for Vercel

## Deploy
1. Create a bot with Telegram's @BotFather and keep the token secret.
2. Push this repository to GitHub.
3. Import the repository into Vercel.
4. Add environment variable `BOT_TOKEN`.
5. Deploy.
6. Set Telegram webhook to:
   `https://YOUR-VERCEL-DOMAIN/api/webhook?token=YOUR_WEBHOOK_SECRET`
   using the Telegram Bot API `setWebhook`.
7. Add the bot to your Rapsometeddy HQ discussion group as an administrator.
8. If you also want the bot to publish announcements to your channel, add it as an administrator in the channel with permission to post.

## Security
Never commit `BOT_TOKEN` or your webhook secret to GitHub.
