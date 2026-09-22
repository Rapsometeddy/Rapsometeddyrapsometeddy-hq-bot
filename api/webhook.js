const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const CHANNEL_ID = process.env.CHANNEL_ID || "";

async function getConfiguredChannelId() {
  if (CHANNEL_ID) return CHANNEL_ID;
  if (!dbEnabled()) return "";
  const rows = await dbRequest("bot_settings?key=eq.telegram_hq_channel_id&limit=1&select=value");
  return rows?.[0]?.value || "";
}

async function setConfiguredChannelId(channelId) {
  if (!dbEnabled()) return false;
  const rows = await dbRequest("bot_settings?key=eq.telegram_hq_channel_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      key: "telegram_hq_channel_id",
      value: String(channelId),
      updated_at: new Date().toISOString()
    })
  });
  return Boolean(rows?.length);
}
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
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
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
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

async function integrationStatus() {
  const configuredChannelId = await getConfiguredChannelId();
  return {
    telegram: Boolean(BOT_TOKEN),
    supabase: dbEnabled(),
    telegramChannel: Boolean(configuredChannelId),
    x: Boolean(process.env.X_BEARER_TOKEN || process.env.X_API_KEY || process.env.X_ACCESS_TOKEN),
    meta: Boolean(process.env.META_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN),
    instagram: Boolean(process.env.INSTAGRAM_ACCESS_TOKEN)
  };
}

async function draftCounts(chatId) {
  if (!dbEnabled()) return {};
  const rows = await listDrafts(chatId, 100);
  return rows.reduce((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1;
    return acc;
  }, {});
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

async function getDraft(chatId, id) {
  if (!dbEnabled()) return null;
  const rows = await dbRequest(`content_drafts?chat_id=eq.${encodeURIComponent(chatId)}&id=eq.${encodeURIComponent(id)}&limit=1&select=*`);
  return rows?.[0] || null;
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
  const configuredChannelId = await getConfiguredChannelId();
  const destination = configuredChannelId || chatId;
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
/bindchannel — connect the current channel as HQ

Content Machine:
/content — Content Machine help
/idea [topic] — generate 5 fresh ideas
/ideas [topic] — same as /idea
/create <idea> — create a post draft
/thread <idea> — create a thread draft
/short <idea> — create a short-video script
/adapt <id> <x|instagram|telegram> — make a platform version
/drafts — list saved drafts
/approve <id> — approve a draft
/queue <id> — queue a draft
/publish <id> — publish a draft now
/published <id> — same as /publish

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

  if (/^\/bindchannel(?:@\w+)?\b/i.test(text)) {
    if (chat.type === "channel") {
      const ok = await setConfiguredChannelId(chat.id);
      return ok
        ? send(chat.id, "✅ This channel is now connected as Rapsometeddy HQ.\\n\\nContent Machine publishing will use this channel.")
        : send(chat.id, "❌ I couldn't save this channel connection.");
    }

    // Private-channel friendly binding: reply to a forwarded post from the private HQ channel.
    // This avoids requiring a /bindchannel command to be sent inside the channel.
    const forwarded = msg.reply_to_message?.forward_origin?.chat || msg.reply_to_message?.forward_from_chat;
    if (chat.type === "private" && forwarded?.id && forwarded.type === "channel") {
      const me = await tg("getMe");
      if (!me.ok) return send(chat.id, "❌ I couldn't verify the bot account.");
      const member = await tg("getChatMember", { chat_id: forwarded.id, user_id: me.result.id });
      if (!member.ok || !isAdmin(member.result)) {
        return send(chat.id, "❌ I found the channel, but I am not an administrator there. Add @RapsometeddyHQBot as a channel admin, then try /bindchannel again.");
      }
      const ok = await setConfiguredChannelId(forwarded.id);
      return ok
        ? send(chat.id, "✅ Private HQ channel connected!\\n\\nPublishing will now go to that channel.")
        : send(chat.id, "❌ I found the channel but couldn't save the connection.");
    }

    if (chat.type === "private") {
      return send(chat.id, "📡 To connect your private HQ channel:\\n1. Forward any post from the HQ channel to me.\\n2. Reply to that forwarded post with /bindchannel.\\n\\nMake sure @RapsometeddyHQBot is an administrator in the channel.");
    }

    if (!user || !(await requireAdmin(chat.id, user.id))) return send(chat.id, "⛔ Admins only.");
    return send(chat.id, "📡 Post /bindchannel inside the HQ channel itself. The bot must be an admin there.");
  }

  const adminCmd = /^(\/announce|\/pin|\/warn|\/unwarn|\/mute|\/unmute|\/ban|\/unban|\/welcome|\/setrules)(?:@\w+)?\b/i.exec(text);

  if (adminCmd) {
    if (!user || !(await requireAdmin(chat.id, user.id))) return send(chat.id, "⛔ Admins only.");

    const cmd = adminCmd[1].toLowerCase();
    const rest = args(text);

    if (cmd === "/announce") {
      if (!rest) return send(chat.id, "Usage: /announce Your message");
      const configuredChannelId = await getConfiguredChannelId();
      const destination = configuredChannelId || chat.id;
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

  if (/^\/status(?:@\w+)?\b/i.test(text)) {
    const s = await integrationStatus();
    const counts = await draftCounts(chat.id);
    return send(chat.id, `📊 Rapsometeddy HQ Status

Telegram bot: ${s.telegram ? "✅" : "❌"}
Supabase: ${s.supabase ? "✅" : "❌"}
HQ channel: ${s.telegramChannel ? "✅ configured" : "⚠️ not configured"}
X: ${s.x ? "✅ credentials found" : "⚪ not configured"}
Meta/Facebook: ${s.meta ? "✅ credentials found" : "⚪ not configured"}
Instagram: ${s.instagram ? "✅ credentials found" : "⚪ not configured"}

Drafts: ${counts.Draft || 0}
Approved: ${counts.Approved || 0}
Queued: ${counts.Queued || 0}
Published: ${counts.Published || 0}`);
  }

  if (/^\/content(?:@\w+)?\b/i.test(text)) {
    return send(chat.id, `🧸 Content Machine

/idea [topic] — generate 5 fresh ideas
/create <idea> — create a post draft
/thread <idea> — create a thread draft
/short <idea> — create a short-video script
/drafts — show saved drafts
/approve <id> — approve a draft
/queue <id> — queue a draft
/publish <id> — publish a draft now\n/status — connection & draft status
/bindchannel — connect the current channel as HQ`);
  }

  function contentDraft(idea, format) {
    const templates = {
      post: (value) => `HOOK: ${value}

Here is the simple version:
• What it is
• Why it matters
• One practical way to start

CTA: Save this and follow Rapsometeddy for more.`,
      thread: (value) => `THREAD: ${value}

1/ Start with the problem.
2/ Explain the key idea in plain language.
3/ Give one practical example.
4/ Share one beginner-friendly next step.
5/ End with a simple takeaway.`,
      short: (value) => `SHORT VIDEO: ${value}

0–3s: Strong hook
3–10s: Explain the idea
10–20s: Give one useful example
20–25s: Call to action`
    };
    const template = templates[format];
    return typeof template === "function" ? template(idea) : templates.post(idea);
  }

  const contentCmd = /^(\/create|\/thread|\/short|\/idea|\/ideas|\/drafts|\/adapt|\/approve|\/queue|\/publish|\/published)(?:@\w+)?\b/i.exec(text);
  if (contentCmd) {
    const cmd = contentCmd[1].toLowerCase();
    const rest = args(text);

    if (cmd === "/idea" || cmd === "/ideas") {
      const topic = rest || "Rapsometeddy";
      const pool = [
        `A beginner's guide to ${topic}`,
        `3 mistakes beginners make with ${topic}`,
        `How I would start ${topic} with R0 and a phone`,
        `What nobody tells you about ${topic}`,
        `Free tools that make ${topic} easier`,
        `A 7-day challenge to learn ${topic}`,
        `Myth vs reality: ${topic}`,
        `Can you build a real project around ${topic} using only a phone?`,
        `What I learned building around ${topic}`,
        `The next step after learning ${topic}`
      ];
      const offset = Math.floor(Date.now() / 3600000) % pool.length;
      const ideas = Array.from({length: 5}, (_, i) => pool[(offset + i) % pool.length]);
      return send(chat.id, `💡 5 fresh Rapsometeddy ideas about “${topic}”

${ideas.map((idea, i) => `${i + 1}. ${idea}`).join("\n")}

Pick one:
 /create <idea>
 /thread <idea>
 /short <idea>`);
    }
    if (cmd === "/create" || cmd === "/thread" || cmd === "/short") {
      if (!rest) return send(chat.id, `Usage: ${cmd} Your content idea`);
      const format = cmd === "/create" ? "post" : cmd.slice(1);
      const draftContent = contentDraft(rest, format);

      if (dbEnabled()) {
        const saved = await saveDraft(chat.id, user?.id, format, rest, draftContent);
        if (!saved) return send(chat.id, "⚠️ I couldn't save that draft. Check the Content Machine database setup.");
        return send(chat.id, `📝 Draft #${saved.id} created and saved.

${draftContent}

Status: Draft
/approve ${saved.id} → approve
/queue ${saved.id} → queue
/publish ${saved.id} → publish`);
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

    if (cmd === "/adapt") {
      const match = rest.match(/^(\\d+)\\s+(x|instagram|telegram)\\s*$/i);
      if (!match) return send(chat.id, "Usage: /adapt <draft id> <x|instagram|telegram>");
      if (!dbEnabled()) return send(chat.id, "⚠️ Persistent storage isn't connected yet.");
      const draft = await getDraft(chat.id, Number(match[1]));
      if (!draft) return send(chat.id, "❌ Draft not found.");
      const platform = match[2].toLowerCase();
      const adapted = platform === "x"
        ? `X POST

${draft.idea}

One useful takeaway: start small, test quickly, and document what you learn.

— Rapsometeddy`
        : platform === "instagram"
        ? `INSTAGRAM CAPTION

${draft.idea}

Build it. Learn from it. Share the process.

#Rapsometeddy #BuildInPublic #Tech #AI`
        : `TELEGRAM POST

🧸 ${draft.idea}

Quick takeaway: start with one small action today, then improve from there.

Build • Learn • Create • Invest`;
      const saved = await saveDraft(chat.id, user?.id, platform, `${draft.idea} [${platform}]`, adapted);
      if (!saved) return send(chat.id, "❌ Could not save the adapted draft.");
      return send(chat.id, `🔄 Adapted draft #${saved.id} for ${platform}.

${adapted}

/approve ${saved.id} → approve
/publish ${saved.id} → publish`);
    }

    if (["/approve", "/queue", "/publish", "/published"].includes(cmd)) {
      if (!dbEnabled()) return send(chat.id, "⚠️ Persistent storage isn't connected yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.");
      const match = rest.match(/^(\d+)/);
      if (!match) return send(chat.id, `Usage: ${cmd} <draft id>`);
      const id = Number(match[1]);
      const draft = await getDraft(chat.id, id);
      if (!draft) return send(chat.id, "❌ Draft not found.");

      if (cmd === "/publish" || cmd === "/published") {
        if (draft.status !== "Approved" && draft.status !== "Queued") {
          return send(chat.id, `⚠️ Draft #${id} is currently ${draft.status}. Approve it first with /approve ${id}.`);
        }
        const r = await publishDraft(chat.id, draft);
        return send(chat.id, r.ok ? `🚀 Draft #${id} published.` : `❌ Could not publish: ${r.description || "unknown Telegram error"}`);
      }

      const status = cmd === "/approve" ? "Approved" : "Queued";
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
