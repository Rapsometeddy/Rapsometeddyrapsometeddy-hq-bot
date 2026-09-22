const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const CHANNEL_ID = process.env.CHANNEL_ID || "";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\\/$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_KEY = SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY;

const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";

async function tg(method, body = {}) {
  if (!BOT_TOKEN) return { ok: false, description: "BOT_TOKEN missing" };

  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  return r.json();
}

function isAdmin(member) {
  return member && (member.status === "creator" || member.status === "administrator");
}

async function requireAdmin(chatId, userId) {
  const r = await tg("getChatMember", { chat_id: chatId, user_id: userId });
  return r.ok && isAdmin(r.result);
}

function args(text = "") {
  return text.trim().split(/\s+/).slice(1).join(" ").trim();
}

async function send(chatId, text, extra = {}) {
  return tg("sendMessage", { chat_id: chatId, text, ...extra });
}

async function dbRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    console.error("Supabase error:", r.status, body);
    return null;
  }
  return r.status === 204 ? [] : r.json();
}

function dbEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

async function saveDraft(chatId, userId, format, idea, content) {
  if (!dbEnabled()) return null;
  const rows = await dbRequest("content_drafts", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ chat_id: chatId, user_id: userId || null, format, idea, content, status: "Draft" })
  });
  return rows?.[0] || null;
}

async function listDrafts(chatId, limit = 10) {
  if (!dbEnabled()) return [];
  return (await dbRequest(`content_drafts?chat_id=eq.${encodeURIComponent(chatId)}&order=id.desc&limit=${limit}&select=*`)) || [];
}

async function getDraft(chatId, number) {
  if (!dbEnabled()) return null;
  const rows = await dbRequest(`content_drafts?chat_id=eq.${encodeURIComponent(chatId)}&order=id.asc&limit=100&select=*`);
  return rows?.[number - 1] || null;
}

async function setDraftStatus(id, status) {
  if (!dbEnabled()) return false;
  const rows = await dbRequest(`content_drafts?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status,
      updated_at: new Date().toISOString(),
      ...(status === "Published" ? { published_at: new Date().toISOString() } : {})
    })
  });
  return Boolean(rows?.length);
}

async function publishDraft(chatId, draft) {
  const destination = CHANNEL_ID || chatId;
  const r = await send(destination, `🧸 Rapsometeddy HQ\n\n${draft.content}`);
  if (r.ok && dbEnabled()) {
    await setDraftStatus(draft.id, "Published");
    if (draft.id) {
      await dbRequest(`content_drafts?id=eq.${encodeURIComponent(draft.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ telegram_message_id: r.result?.message_id || null })
      });
    }
  }
  return r;
}

const defaultRules = `🧸 Rapsometeddy HQ Community Rules

1. Be respectful.
2. No spam or harassment.
3. No scams, fraud or misleading promotions.
4. Keep links relevant and safe.
5. Respect other creators and their work.
6. Follow Telegram's rules and applicable laws.

Build • Learn • Create • Invest 🚀`;

let currentRules = defaultRules;
let welcomeEnabled = true;

async function handleMessage(msg) {
  const chat = msg.chat;
  if (!chat) return;

  const text = msg.text || "";
  const user = msg.from;

  if (msg.new_chat_members?.length && welcomeEnabled) {
    const names = msg.new_chat_members.map(m => m.first_name).join(", ");
    return send(chat.id, `🧸 Welcome to Rapsometeddy HQ, ${names}!

💻 Tech & AI
🚀 Business & entrepreneurship
👨‍💻 Open source
🎵 Music
🤝 Networking

Use /help to see what the bot can do.`);
  }

  if (!text) return;

  if (/^\/start(?:@\w+)?\b/i.test(text)) {
    return send(chat.id, `🧸 Welcome to Rapsometeddy HQ!

A community for:
💻 AI & tech
🚀 Building & entrepreneurship
👨‍💻 Open source
🎵 Music
🤝 Networking

Use /help to see what I can do.`);
  }

  if (/^\/help(?:@\w+)?\b/i.test(text)) {
    return send(chat.id, `🧸 Rapsometeddy HQ Bot

Member:
/rules — community rules
/about — about HQ
/id — show chat ID

Content Machine:
/content — Content Machine help
/create <idea> — create a post draft
/thread <idea> — create a thread draft
/short <idea> — create a short-video script
/ideas — content ideas
/drafts — list drafts
/approve <number> — approve
/queue <number> — queue
/published <number> — publish now

Admin:
/announce <text> — publish to the HQ channel
/pin — pin the replied-to message
/warn — warn a replied-to user
/unwarn — remove a warning
/mute — mute a replied-to user for 1 hour
/unmute — unmute a replied-to user
/ban — ban a replied-to user
/unban — unban a replied-to user
/welcome on|off — toggle welcomes
/setrules <text> — replace the current rules`);
  }

  if (/^\/rules(?:@\w+)?\b/i.test(text)) return send(chat.id, currentRules);

  if (/^\/about(?:@\w+)?\b/i.test(text)) {
    return send(chat.id, `🚀 Rapsometeddy HQ

Building with AI, code & open source.
Exploring business.
Creating music.
Documenting the journey.

Build • Learn • Create • Invest`);
  }

  if (/^\/id(?:@\w+)?\b/i.test(text)) return send(chat.id, `📡 Chat ID: ${chat.id}`);

  const adminCmd = /^(\/announce|\/pin|\/warn|\/unwarn|\/mute|\/unmute|\/ban|\/unban|\/welcome|\/setrules)(?:@\w+)?\b/i.exec(text);

  if (adminCmd) {
    if (!user || !(await requireAdmin(chat.id, user.id))) return send(chat.id, "⛔ Admins only.");

    const cmd = adminCmd[1].toLowerCase();
    const rest = args(text);

    if (cmd === "/announce") {
      if (!rest) return send(chat.id, "Usage: /announce Your message");
      const destination = CHANNEL_ID || chat.id;
      const r = await send(destination, `📢 ${rest}`);
      return send(chat.id, r.ok ? "✅ Announcement published." : `Could not publish: ${r.description || "unknown error"}`);
    }

    if (cmd === "/pin") {
      if (!msg.reply_to_message) return send(chat.id, "Reply to the message you want to pin, then use /pin.");
      const r = await tg("pinChatMessage", { chat_id: chat.id, message_id: msg.reply_to_message.message_id, disable_notification: true });
      return send(chat.id, r.ok ? "📌 Pinned." : `Could not pin: ${r.description || "unknown error"}`);
    }

    const target = msg.reply_to_message?.from;
    if (["/warn", "/unwarn", "/mute", "/unmute", "/ban", "/unban"].includes(cmd)) {
      if (!target) return send(chat.id, `Reply to a user's message, then use ${cmd}.`);
      if (target.is_bot) return send(chat.id, "🤖 I won't moderate another bot.");
      if (target.id === user.id) return send(chat.id, "You can't use this command on yourself.");
    }

    if (cmd === "/warn") return send(chat.id, `⚠️ Warning issued to ${target.first_name}. (Warnings are not persisted yet.)`);
    if (cmd === "/unwarn") return send(chat.id, `✅ Warning removed for ${target.first_name}. (Warnings are not persisted yet.)`);

    if (cmd === "/mute") {
      const r = await tg("restrictChatMember", { chat_id: chat.id, user_id: target.id, permissions: { can_send_messages: false }, until_date: Math.floor(Date.now() / 1000) + 3600 });
      return send(chat.id, r.ok ? `🔇 ${target.first_name} muted for 1 hour.` : `Could not mute: ${r.description || "unknown error"}`);
    }

    if (cmd === "/unmute") {
      const permissions = {
        can_send_messages: true, can_send_audios: true, can_send_documents: true,
        can_send_photos: true, can_send_videos: true, can_send_video_notes: true,
        can_send_voice_notes: true, can_send_polls: true, can_send_other_messages: true,
        can_add_web_page_previews: true
      };
      const r = await tg("restrictChatMember", { chat_id: chat.id, user_id: target.id, permissions });
      return send(chat.id, r.ok ? `🔊 ${target.first_name} can speak again.` : `Could not unmute: ${r.description || "unknown error"}`);
    }

    if (cmd === "/ban") {
      const r = await tg("banChatMember", { chat_id: chat.id, user_id: target.id });
      return send(chat.id, r.ok ? `🚫 ${target.first_name} was banned.` : `Could not ban: ${r.description || "unknown error"}`);
    }

    if (cmd === "/unban") {
      const r = await tg("unbanChatMember", { chat_id: chat.id, user_id: target.id, only_if_banned: true });
      return send(chat.id, r.ok ? `✅ ${target.first_name} was unbanned.` : `Could not unban: ${r.description || "unknown error"}`);
    }

    if (cmd === "/welcome") {
      const mode = rest.toLowerCase();
      if (!["on", "off"].includes(mode)) return send(chat.id, "Usage: /welcome on or /welcome off");
      welcomeEnabled = mode === "on";
      return send(chat.id, welcomeEnabled ? "👋 Welcome messages are ON." : "🔕 Welcome messages are OFF.");
    }

    if (cmd === "/setrules") {
      if (!rest) return send(chat.id, "Usage: /setrules Your rules...");
      currentRules = `📜 Rapsometeddy HQ Rules

${rest}`;
      return send(chat.id, "✅ Rules updated for this bot instance.");
    }
  }

  if (/^\/content(?:@\w+)?\b/i.test(text)) {
    return send(chat.id, `🧸 Content Machine

/create <idea> — create a post draft
/thread <idea> — create a thread draft
/short <idea> — create a short-video script
/ideas — get content ideas
/drafts — show drafts for this bot session
/approve <number> — approve a draft
/queue <number> — queue a draft
/published <number> — mark it published`);
  }

  function contentDraft(idea, format) {
    const templates = {
      post: `HOOK: ${idea}

Here is the simple version:
• What it is
• Why it matters
• One practical way to start

CTA: Save this and follow Rapsometeddy for more.`,
      thread: `THREAD: ${idea}

1/ Start with the problem.
2/ Explain the key idea in plain language.
3/ Give one practical example.
4/ Share one beginner-friendly next step.
5/ End with a simple takeaway.`,
      short: `SHORT VIDEO: ${idea}

0–3s: Strong hook
3–10s: Explain the idea
10–20s: Give one useful example
20–25s: Call to action`
    };
    return templates[format](idea);
  }

  const contentCmd = /^(\/create|\/thread|\/short|\/ideas|\/drafts|\/approve|\/queue|\/publish|\/published)(?:@\w+)?\b/i.exec(text);
  if (contentCmd) {
    const cmd = contentCmd[1].toLowerCase();
    const rest = args(text);

    if (cmd === "/ideas") {
      return send(chat.id, `💡 Content ideas

1. 5 useful AI tools for students
2. How to build an app using only a phone
3. GitHub basics for beginners
4. Realistic online business ideas
5. AI + music for independent creators
6. What I learned building Rapsometeddy HQ
7. How to automate a Telegram community
8. Free tools every new creator should know`);
    }

    if (cmd === "/create" || cmd === "/thread" || cmd === "/short") {
      if (!rest) return send(chat.id, `Usage: ${cmd} Your content idea`);
      const format = cmd === "/create" ? "post" : cmd.slice(1);
      const draftContent = contentDraft(rest, format);

      if (dbEnabled()) {
        const saved = await saveDraft(chat.id, user?.id, format, rest, draftContent);
        if (!saved) return send(chat.id, "⚠️ I couldn't save that draft. Check the Content Machine database setup.");
        return send(chat.id, `📝 Draft #${saved.id} created and saved permanently.

${draftContent}

Status: Draft
Use /approve ${saved.id}, /queue ${saved.id}, or /publish ${saved.id}.`);
      }

      return send(chat.id, `📝 Draft created, but persistent storage is not connected yet.

${draftContent}

⚠️ Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel to make drafts permanent.`);
    }

    if (cmd === "/drafts") {
      if (!dbEnabled()) return send(chat.id, "📭 Persistent storage isn't connected yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.");
      const list = await listDrafts(chat.id, 10);
      if (!list.length) return send(chat.id, "📭 No saved drafts yet. Try /create Your idea");
      return send(chat.id, list.map(d => `#${d.id} [${d.status}] ${d.idea}`).join("\n"));
    }

    if (["/approve", "/queue", "/publish", "/published"].includes(cmd)) {
      if (!dbEnabled()) return send(chat.id, "⚠️ Persistent storage isn't connected yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.");
      const match = rest.match(/^(\d+)/);
      if (!match) return send(chat.id, `Usage: ${cmd} <draft number>`);
      const id = Number(match[1]);
      const status = cmd === "/approve" ? "Approved" : cmd === "/queue" ? "Queued" : "Published";
      const draft = await getDraft(chat.id, id);
      if (!draft) return send(chat.id, "❌ Draft not found.");
      
      if (status === "Published") {
        const r = await publishDraft(chat.id, draft);
        return send(chat.id, r.ok ? `🚀 Draft #${id} published.` : `❌ Could not publish: ${r.description || "unknown Telegram error"}`);
      }

      const ok = await setDraftStatus(draft.id, status);
      return send(chat.id, ok ? `✅ Draft #${id} marked ${status}.` : "❌ Could not update that draft.");
    }
  }

  if (chat.type !== "private" && /(https?:\/\/|t\.me\/|www\.)/i.test(text)) {
    if (user && !(await requireAdmin(chat.id, user.id))) {
      await tg("deleteMessage", { chat_id: chat.id, message_id: msg.message_id });
      return send(chat.id, "🔗 Links are restricted here. Ask an admin before posting one.");
    }
  }
}

module.exports = async (req, res) => {
  try {
    if (!BOT_TOKEN) return res.status(500).json({ ok: false, error: "BOT_TOKEN missing" });
    if (!WEBHOOK_SECRET) return res.status(500).json({ ok: false, error: "WEBHOOK_SECRET missing" });

    if (req.method === "GET") {
      const host = req.headers.host;
      if (!host) return res.status(500).json({ ok: false, error: "Host header missing" });

      const webhookUrl = `https://${host}/api/webhook?token=${encodeURIComponent(WEBHOOK_SECRET)}`;
      const r = await tg("setWebhook", {
        url: webhookUrl,
        allowed_updates: ["message", "channel_post"]
      });

      return res.status(r.ok ? 200 : 502).json({
        ok: r.ok,
        message: r.ok ? "Telegram webhook connected." : (r.description || "Telegram rejected the webhook.")
      });
    }

    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    if (req.query?.token !== WEBHOOK_SECRET) return res.status(401).json({ ok: false, error: "unauthorized" });

    await handleMessage(req.body?.message || req.body?.channel_post || {});
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Webhook error:", e);
    return res.status(500).json({
      ok: false,
      error: "Webhook function failed",
      detail: String(e?.message || e)
    });
  }
};
