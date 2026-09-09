const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method, body = {}) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify(body)
  });
  return r.json();
}

function isAdmin(member) {
  return member && (member.status === "creator" || member.status === "administrator");
}

async function requireAdmin(chatId, userId) {
  const r = await tg("getChatMember", {chat_id: chatId, user_id: userId});
  return r.ok && isAdmin(r.result);
}

function args(text) {
  return text.trim().split(/\\s+/).slice(1).join(" ").trim();
}

async function send(chatId, text, extra={}) {
  return tg("sendMessage", {chat_id:chatId, text, ...extra});
}

async function handleMessage(msg) {
  const chat = msg.chat;
  const text = msg.text || "";
  const user = msg.from;

  if (!text) return;

  // Public commands
  if (/^\\/start(?:@\\w+)?\\b/i.test(text)) {
    return send(chat.id,
`🧸 Welcome to Rapsometeddy HQ!

A community for:
💻 AI & tech
🚀 Building & entrepreneurship
👨‍💻 Open source
🎵 Music
🤝 Networking

Use /help to see what I can do.`);
  }

  if (/^\\/help(?:@\\w+)?\\b/i.test(text)) {
    return send(chat.id,
`🧸 Rapsometeddy HQ Bot

Member:
/rules — community rules
/about — about HQ
/id — show chat ID

Admin:
/announce <text> — publish an announcement
/pin — pin the replied-to message
/warn — warn a replied-to user
/unwarn — remove a warning
/mute — mute a replied-to user
/unmute — unmute a replied-to user
/ban — ban a replied-to user
/unban — unban a replied-to user
/welcome on|off — toggle welcome messages
/setrules <text> — replace rules`);
  }

  if (/^\\/about(?:@\\w+)?\\b/i.test(text)) {
    return send(chat.id,
`🚀 Rapsometeddy HQ

Building with AI, code & open source.
Exploring business.
Creating music.
Documenting the journey.

Build • Learn • Create • Invest`);
  }

  if (/^\\/id(?:@\\w+)?\\b/i.test(text)) {
    return send(chat.id, `Chat ID: ${chat.id}`);
  }

  // Admin commands
  const adminCmd = /^(\\/announce|\\/pin|\\/warn|\\/unwarn|\\/mute|\\/unmute|\\/ban|\\/unban|\\/welcome|\\/setrules)(?:@\\w+)?\\b/i.exec(text);
  if (adminCmd) {
    if (!user || !(await requireAdmin(chat.id, user.id))) {
      return send(chat.id, "⛔ Admins only.");
    }

    const cmd = adminCmd[1].toLowerCase();
    const rest = args(text);

    if (cmd === "/announce") {
      if (!rest) return send(chat.id, "Usage: /announce Your message");
      return send(chat.id, `📢 ${rest}`);
    }

    if (cmd === "/pin") {
      if (!msg.reply_to_message) return send(chat.id, "Reply to the message you want to pin, then use /pin.");
      const r = await tg("pinChatMessage", {chat_id:chat.id, message_id:msg.reply_to_message.message_id, disable_notification:true});
      return send(chat.id, r.ok ? "📌 Pinned." : `Could not pin: ${r.description || "unknown error"}`);
    }

    const target = msg.reply_to_message?.from;
    if (["/warn","/unwarn","/mute","/unmute","/ban","/unban"].includes(cmd)) {
      if (!target) return send(chat.id, `Reply to a user's message, then use ${cmd}.`);
      if (target.is_bot) return send(chat.id, "🤖 I won't moderate another bot.");
    }

    if (cmd === "/warn") {
      return send(chat.id, `⚠️ Warning issued to ${target.first_name}.`);
    }
    if (cmd === "/unwarn") {
      return send(chat.id, `✅ Warning removed for ${target.first_name}.`);
    }
    if (cmd === "/mute") {
      const until = Math.floor(Date.now()/1000) + 3600;
      const r = await tg("restrictChatMember", {chat_id:chat.id,user_id:target.id,permissions:{can_send_messages:false},until_date:until});
      return send(chat.id, r.ok ? `🔇 ${target.first_name} muted for 1 hour.` : `Could not mute: ${r.description || "unknown error"}`);
    }
    if (cmd === "/unmute") {
      const r = await tg("restrictChatMember", {chat_id:chat.id,user_id:target.id,permissions:{can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true}});
      return send(chat.id, r.ok ? `🔊 ${target.first_name} can speak again.` : `Could not unmute: ${r.description || "unknown error"}`);
    }
    if (cmd === "/ban") {
      const r = await tg("banChatMember", {chat_id:chat.id,user_id:target.id});
      return send(chat.id, r.ok ? `🚫 ${target.first_name} was banned.` : `Could not ban: ${r.description || "unknown error"}`);
    }
    if (cmd === "/unban") {
      const r = await tg("unbanChatMember", {chat_id:chat.id,user_id:target.id,only_if_banned:true});
      return send(chat.id, r.ok ? `✅ ${target.first_name} was unbanned.` : `Could not unban: ${r.description || "unknown error"}`);
    }
    if (cmd === "/welcome") {
      return send(chat.id, "Welcome settings are prepared for the next version. For now, welcomes are always on.");
    }
    if (cmd === "/setrules") {
      if (!rest) return send(chat.id, "Usage: /setrules Your rules...");
      return send(chat.id, `📜 New rules saved for this session:\\n\\n${rest}`);
    }
  }

  // Basic anti-link filter for group chats (admins are exempt).
  if (chat.type !== "private" && /(https?:\\/\\/|t\\.me\\/|www\\.)/i.test(text)) {
    if (user && !(await requireAdmin(chat.id, user.id))) {
      await tg("deleteMessage", {chat_id:chat.id,message_id:msg.message_id});
      return send(chat.id, "🔗 Links are restricted here. Ask an admin before posting one.");
    }
  }

  // Reply to channel posts with /id so the owner can discover the channel ID.
  if (msg.chat && msg.chat.type === "channel" && /^\\/id\\b/i.test(text)) {
    return send(chat.id, `📡 Channel ID: ${chat.id}`);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(200).send("Rapsometeddy HQ Bot is online.");
  if (!BOT_TOKEN) return res.status(500).json({ok:false,error:"BOT_TOKEN missing"});
  if (WEBHOOK_SECRET && req.query.token !== WEBHOOK_SECRET) return res.status(401).json({ok:false,error:"unauthorized"});
  try {
    await handleMessage(req.body?.message || req.body?.channel_post || {});
    return res.status(200).json({ok:true});
  } catch (e) {
    console.error(e);
    return res.status(200).json({ok:false});
  }
};
