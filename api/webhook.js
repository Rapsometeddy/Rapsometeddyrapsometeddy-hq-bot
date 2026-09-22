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

async function sendMediaPhoto(chatId, url, caption = "") {
  return tg("sendPhoto", { chat_id: chatId, photo: url, ...(caption ? { caption } : {}) });
}

async function sendMediaVideo(chatId, url, caption = "") {
  return tg("sendVideo", {
    chat_id: chatId,
    video: url,
    supports_streaming: true,
    ...(caption ? { caption } : {})
  });
}

async function sendMediaAudio(chatId, url, caption = "") {
  return tg("sendAudio", {
    chat_id: chatId,
    audio: url,
    title: "Rapsometeddy Voiceover",
    performer: "Rapsometeddy",
    ...(caption ? { caption } : {})
  });
}

async function fetchMediaBuffer(url, label) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(label + " download failed (" + r.status + ")");
  const contentType = r.headers.get("content-type") || "";
  const buffer = Buffer.from(await r.arrayBuffer());
  if (!buffer.length) throw new Error(label + " download returned an empty file");
  return { buffer, contentType };
}

async function renderSlideshow(imageAssets, audioAsset, outputPath) {
  const fs = require("fs"), os = require("os"), path = require("path");
  const { spawn } = require("child_process");
  const ffmpegPath = require("ffmpeg-static");
  if (!ffmpegPath) throw new Error("FFmpeg binary unavailable");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rapsometeddy-media-"));
  const imagePaths = [];
  try {
    for (let i = 0; i < imageAssets.length; i++) {
      const ext = String(imageAssets[i].contentType || "").includes("png") ? ".png" : ".jpg";
      const p = path.join(dir, "scene-" + String(i).padStart(2, "0") + ext);
      fs.writeFileSync(p, imageAssets[i].buffer);
      imagePaths.push(p);
    }

    const audioExt = String(audioAsset.contentType || "").includes("wav") ? ".wav" : ".mp3";
    const audioPath = path.join(dir, "voiceover" + audioExt);
    fs.writeFileSync(audioPath, audioAsset.buffer);

    const listPath = path.join(dir, "images.txt");
    const concat = imagePaths.map(p =>
      "file '" + p.replace(/'/g, "'\\''") + "'\\nduration 4"
    ).join("\\n") + "\\nfile '" +
      imagePaths[imagePaths.length - 1].replace(/'/g, "'\\''") + "'";
    fs.writeFileSync(listPath, concat);

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        "-y",
        "-f", "concat", "-safe", "0", "-i", listPath,
        "-i", audioPath,
        "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,format=yuv420p",
        "-r", "30",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest", "-movflags", "+faststart",
        outputPath
      ]);

      let stderr = "";
      proc.stderr.on("data", d => { stderr += d.toString(); });
      proc.on("error", reject);
      proc.on("close", code => {
        if (code === 0) return resolve();
        reject(new Error("FFmpeg failed (exit " + code + "): " + stderr.slice(-1600)));
      });
    });

    return outputPath;
  } finally {
    for (const p of imagePaths) {
      try { fs.unlinkSync(p); } catch {}
    }
    try { fs.unlinkSync(path.join(dir, "voiceover.mp3")); } catch {}
    try { fs.unlinkSync(path.join(dir, "voiceover.wav")); } catch {}
    try { fs.unlinkSync(path.join(dir, "images.txt")); } catch {}
    try { fs.rmdirSync(dir); } catch {}
  }
}

async function sendLocalVideo(chatId, filePath, caption = "") {
  const fs = require("fs"), FormData = require("form-data");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("video", fs.createReadStream(filePath), { filename:"rapsometeddy.mp4", contentType:"video/mp4" });
  if (caption) form.append("caption", caption);
  const r = await fetch(API + "/sendVideo", { method:"POST", headers:form.getHeaders(), body:form });
  return r.json();
}

function pollinationsUrl(kind, prompt, params = {}) {
  const base = "https://gen.pollinations.ai/" + kind + "/" + encodeURIComponent(prompt);
  const q = new URLSearchParams(params);
  if (process.env.POLLINATIONS_API_KEY) q.set("key", process.env.POLLINATIONS_API_KEY);
  return base + (q.toString() ? "?" + q.toString() : "");
}

function extractImagePrompts(content) {
  const section = String(content || "").split("━━━━━━━━━━━━━━━━━━\n🎬 VIDEO SHOT LIST")[0];
  const match = section.match(/🖼️ IMAGE PROMPTS\n\n([\s\S]*?)(?:\n\n━━━━━━━━━━━━━━━━━━|$)/);
  if (!match) return [];
  return [...match[1].matchAll(/(?:^|\n)\s*(\d+)\.\s+(.+)/g)]
    .map(m => m[2].trim())
    .filter(Boolean)
    .slice(0, 7);
}

async function sendLong(chatId, text, extra = {}) {
  const limit = 3800;
  const value = String(text || "");
  if (value.length <= limit) return send(chatId, value, extra);

  const chunks = [];
  let remaining = value;

  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n\n", limit);
    if (cut < 1000) cut = remaining.lastIndexOf("\n", limit);
    if (cut < 1000) cut = limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);

  let last = { ok: true };
  for (const chunk of chunks) {
    last = await send(chatId, chunk, extra);
    if (!last.ok) return last;
  }
  return last;
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
  const r = await sendLong(destination, `🧸 Rapsometeddy HQ\n\n${draft.content}`);
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

  if (text.trim().match(/^\/render(?:@\w+)?\b/i)) {
    const topic = args(text) || "Create a cinematic Rapsometeddy AI, tech and entrepreneurship short.";
    await send(chat.id, "🎬 Render request received.\\n\\nTelegram → Vercel → 7 scenes → background renderer → FFmpeg.\\n\\nI’ll report the exact stage if rendering/audio fails.");
    const rendererUrl = process.env.CONTENT_MACHINE_URL || "https://rapsometeddy-content-machine.vercel.app/api/render";
    try {
      const r = await fetch(rendererUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: topic, telegramChatId: chat.id })
      });
      const raw = await r.text();
      let result = null;
      try { result = JSON.parse(raw); } catch {}

      console.log("[CONTENT_MACHINE_RENDER]", r.status, raw.slice(0, 5000));

      if (!r.ok) {
        const detail = typeof result?.error === "string"
          ? result.error
          : result?.error?.message
            ? ((result.error.stage ? result.error.stage + ": " : "") + result.error.message)
            : result?.message || raw.slice(0, 1200) || "Unknown error.";
        return send(chat.id, "❌ Render failed at Vercel.\\n\\nHTTP " + r.status + "\\n" + detail);
      }

      if (result?.ok === false) {
        return send(chat.id, "⚠️ Render finished with an error.\\n\\n" + (result.error || result.message || "Unknown render error."));
      }

      return sendLong(chat.id, "✅ Render request completed.\\n\\n" + (result?.message || result?.status || "Vercel returned successfully.") + (result?.error ? "\\n\\n⚠️ " + result.error : ""));
    } catch (e) {
      console.error("[CONTENT_MACHINE_RENDER_REQUEST_FAILED]", e);
      return send(chat.id, "❌ Could not reach the Content Machine.\\n\\n" + String(e?.message || e));
    }
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
/sports — football analytics dashboard

Content Machine:
/content — Content Machine help
/auto [topic] — generate a full content package\n/idea [topic] — generate 5 fresh ideas
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

  function topicFacts(idea) {
    const value = idea.toLowerCase();

    if (value.includes("ai app") && (value.includes("phone") || value.includes("mobile"))) {
      return [
        "Trying to build the whole app at once instead of starting with one useful feature.",
        "Choosing tools that are difficult to use on a phone instead of designing a mobile-friendly workflow.",
        "Paying for APIs, hosting or subscriptions before proving the first version actually works."
      ];
    }

    if (value.includes("app") && (value.includes("phone") || value.includes("mobile"))) {
      return [
        "Starting with a huge feature list instead of one small problem to solve.",
        "Using a complicated development workflow that is hard to manage from a phone.",
        "Spending money before testing whether the first version is useful."
      ];
    }

    if (value.includes("ai")) {
      return [
        "Trying every AI tool instead of choosing one problem to solve.",
        "Paying for tools before proving the idea works.",
        "Trusting generated output without checking whether it is actually useful."
      ];
    }

    if (value.includes("business") || value.includes("money") || value.includes("entrepreneur")) {
      return [
        "Starting with a product instead of a real problem.",
        "Spending money before testing whether anyone wants the solution.",
        "Trying to scale before finding a repeatable way to deliver value."
      ];
    }

    if (value.includes("music") || value.includes("song") || value.includes("rap")) {
      return [
        "Focusing on tools before developing a clear creative direction.",
        "Trying to make every track perfect instead of finishing songs.",
        "Posting music without giving people a reason to remember the artist."
      ];
    }

    if (value.includes("github") || value.includes("open source") || value.includes("coding")) {
      return [
        "Trying to understand the entire codebase before fixing one small problem.",
        "Copying code without understanding what the important parts do.",
        "Building without testing each small change before moving on."
      ];
    }

    return [
      "Trying to learn everything before starting.",
      "Using complicated tools when a simple solution would work.",
      "Building without testing the idea with real people."
    ];
  }

  function detectContentType(idea) {
    const v = idea.toLowerCase();

    // Topic-specific experiments take priority over generic title wording.
    // This prevents “3 mistakes” from forcing every topic into the same format.
    if (v.includes("r0") || v.includes("no money") || v.includes("without money")) return "r0";
    if (v.includes("using only a phone") || v.includes("from a phone") || v.includes("phone-only")) return "phone";
    if (v.includes("7-day challenge") || v.includes("challenge")) return "challenge";
    if (v.includes("myth vs reality") || v.includes("myth")) return "myth";
    if (v.includes("what i learned") || v.includes("what nobody tells you")) return "lessons";
    if (v.includes("how i would start") || v.includes("build") || v.includes("building")) return "build";
    if (v.includes("3 mistakes") || v.includes("mistakes beginners")) return "mistakes";
    return "guide";
  }

  function contentFacts(idea) {
    const v = idea.toLowerCase();
    if (v.includes("ai app") && (v.includes("phone") || v.includes("mobile"))) return [
      "Build one useful feature before attempting the whole app.",
      "Choose a workflow you can realistically manage from a phone.",
      "Prove the first version works before paying for APIs, hosting or subscriptions."
    ];
    if (v.includes("app") && (v.includes("phone") || v.includes("mobile"))) return [
      "Start with one small problem instead of a huge feature list.",
      "Keep the development workflow simple enough to manage from a phone.",
      "Test the first version before spending money."
    ];
    if (v.includes("ai")) return [
      "Choose one problem instead of trying every AI tool.",
      "Test the idea before paying for more tools.",
      "Check AI output instead of assuming it is useful."
    ];
    if (v.includes("music") || v.includes("song") || v.includes("rap")) return [
      "Choose a clear creative direction before collecting more tools.",
      "Finish songs instead of endlessly perfecting one track.",
      "Give each release a memorable idea or identity."
    ];
    if (v.includes("business") || v.includes("money") || v.includes("entrepreneur")) return [
      "Start with a real problem instead of a product idea.",
      "Test demand before spending heavily.",
      "Find a repeatable way to create value before scaling."
    ];
    return [
      "Start with one small problem instead of trying to solve everything.",
      "Use the simplest workflow that can prove the idea.",
      "Test early and let real results guide the next version."
    ];
  }

  function contentPackage(idea, forcedType = null, rawTopic = null) {
    const type = forcedType || detectContentType(idea);
    const topic = rawTopic || idea;
    const v = topic.toLowerCase();
    const cta = ["Save this for your next project.","What would you build with this?","Try one step today.","Follow the build — more experiments coming.","What should Rapsometeddy build next?"][Math.floor(Date.now() / 86400000) % 5];

    if (type === "phone") {
      const isAiApp = v.includes("ai") && v.includes("app");
      const title = isAiApp ? "📱 7-Day AI App Build From a Phone" : "📱 7-Day Build From a Phone";
      const goal = isAiApp ? "Can I build a useful AI app using only a phone?" : "Can I build a useful project using only a phone?";
      const days = isAiApp
        ? "DAY 1 — Choose one real problem.\nDAY 2 — Design the smallest useful feature.\nDAY 3 — Build the first version.\nDAY 4 — Connect the AI.\nDAY 5 — Test it on the phone.\nDAY 6 — Fix what breaks.\nDAY 7 — Share the result and lessons."
        : "DAY 1 — Choose one problem.\nDAY 2 — Plan the smallest solution.\nDAY 3 — Build the first version.\nDAY 4 — Connect what you need.\nDAY 5 — Test it.\nDAY 6 — Fix what breaks.\nDAY 7 — Share the result.";

      return makePackage(
        title + "\n\n" + goal + "\n\n" + days + "\n\n🎯 The goal is a working experiment, not a perfect app.",
        title + "\n\n" + days + "\n\nBuild → test → fix → share.\n\n— Rapsometeddy",
        "📱 " + title.toUpperCase() + "\n\n" + days.replace(/DAY /g, "Day ") + "\n\n" + cta + "\n\n#Rapsometeddy #PhoneOnly #AI #BuildInPublic",
        "🧸 " + title + "\n\n" + days + "\n\nBuild • Learn • Create • Invest 🚀",
        "0–3s HOOK: “" + goal + "”\n3–8s DAY 1–2: “Pick the problem and smallest feature.”\n8–16s DAY 3–4: “Build it and connect the AI.”\n16–23s DAY 5–6: “Test it and fix what breaks.”\n23–30s DAY 7: “Share the result. Follow Rapsometeddy for the build.”"
      );
    }

    if (type === "r0") {
      const title = "💸 R0 Experiment: Test " + topic;
      return makePackage(
        title + "\n\n1️⃣ Find one real problem.\n2️⃣ Create the smallest useful offer.\n3️⃣ Use free tools and what you already have.\n4️⃣ Test it with real people.\n5️⃣ Only spend money when the next expense has a clear purpose.\n\n🎯 Goal: prove demand before investing.",
        title + "\n\nProblem → offer → test → learn.\n\nDon't spend first. Prove first.\n\n— Rapsometeddy",
        "💸 R0 EXPERIMENT\n\nProblem → simple offer → free workflow → real test → learn.\n\n" + cta + "\n\n#Rapsometeddy #R0 #Entrepreneurship #BuildInPublic",
        "🧸 R0 TEST\n\n💡 Problem\n🛠️ Offer\n🆓 Free tools\n🧪 Real test\n📚 Learn\n\nBuild • Learn • Create • Invest 🚀",
        "0–3s HOOK: “Can I test this with R0?”\n3–10s: “Find a real problem and make a simple offer.”\n10–18s: “Use what you already have and test it.”\n18–24s: “Let real results decide what deserves money.”\n24–30s CTA: “Follow Rapsometeddy for the experiment.”"
      );
    }

    if (type === "challenge") {
      return makePackage(
        "🔥 7-Day Challenge: " + topic + "\n\nDAY 1 — Pick one goal.\nDAY 2 — Make a simple plan.\nDAY 3 — Build or practice.\nDAY 4 — Test.\nDAY 5 — Fix the biggest problem.\nDAY 6 — Share what you learned.\nDAY 7 — Review the result and choose the next step.\n\n🎯 Finish the experiment, not perfection.",
        "7 days. One goal. One experiment.\n\nPlan → build → test → fix → share → reflect.\n\n— Rapsometeddy",
        "🔥 7-DAY CHALLENGE\n\n" + topic + "\n\nGoal → plan → build → test → fix → share → reflect.\n\n" + cta + "\n\n#Rapsometeddy #7DayChallenge #BuildInPublic",
        "🧸 7-DAY CHALLENGE\n\n1️⃣ Goal\n2️⃣ Plan\n3️⃣ Build\n4️⃣ Test\n5️⃣ Fix\n6️⃣ Share\n7️⃣ Reflect\n\nBuild • Learn • Create • Invest 🚀",
        "0–3s: “Give me 7 days and one goal.”\n3–18s: “Plan. Build. Test. Fix. Share.”\n18–24s: “Day 7: review what actually happened.”\n24–30s: “Follow Rapsometeddy for the next experiment.”"
      );
    }

    if (type === "mistakes") {
      const facts = contentFacts(topic);
      return makePackage(
        "❌ 3 Real Mistakes With " + topic + "\n\n1️⃣ " + facts[0] + "\n2️⃣ " + facts[1] + "\n3️⃣ " + facts[2] + "\n\n💡 Better approach: start small, test early and improve from evidence.",
        "3 real mistakes with " + topic + ":\n\n1. " + facts[0] + "\n2. " + facts[1] + "\n3. " + facts[2] + "\n\nBetter approach: test before scaling.\n\n— Rapsometeddy",
        "❌ 3 REAL MISTAKES\n\n" + facts.map((x,i) => (i+1) + "️⃣ " + x).join("\n") + "\n\n" + cta + "\n\n#Rapsometeddy #BuildInPublic #Tech #AI",
        "🧸 3 MISTAKES\n\n❌ " + facts[0] + "\n❌ " + facts[1] + "\n❌ " + facts[2] + "\n\n✅ Test. Learn. Improve.",
        "0–3s: “3 mistakes to avoid with " + topic + ".”\n3–8s: “Mistake #1: " + facts[0] + "”\n8–13s: “Mistake #2: " + facts[1] + "”\n13–18s: “Mistake #3: " + facts[2] + "”\n18–30s: “Test first. Scale later. Follow Rapsometeddy.”"
      );
    }

    if (type === "myth") {
      return makePackage(
        "🧠 Myth vs Reality: " + topic + "\n\nMYTH: You need a huge budget, perfect skills or a massive setup before starting.\n\nREALITY: A small, useful first experiment can reveal what actually needs improving.\n\n🎯 Start with the smallest test that can teach you something.",
        "Myth: you need everything figured out before starting " + topic + ".\n\nReality: start with a small test and let evidence guide the next version.\n\n— Rapsometeddy",
        "🧠 MYTH vs REALITY\n\nMYTH: You need a perfect setup.\nREALITY: You need a useful experiment.\n\n" + cta + "\n\n#Rapsometeddy #Tech #AI",
        "🧸 MYTH vs REALITY\n\n❌ Perfect setup first\n✅ Small experiment first\n\nBuild • Learn • Create • Invest 🚀",
        "0–3s: “Think you need a perfect setup?”\n3–12s MYTH: “Everything must be ready first.”\n12–22s REALITY: “Start small and learn from the test.”\n22–30s CTA: “Follow Rapsometeddy.”"
      );
    }

    const facts = contentFacts(topic);
    const title = type === "build" ? "🛠️ Step-by-Step Build: " + topic
      : type === "lessons" ? "📝 What I Learned From " + topic
      : "💡 Beginner Guide: " + topic;

    return makePackage(
      title + "\n\n1️⃣ Start with one small problem.\n2️⃣ Use the simplest useful workflow.\n3️⃣ Build the first version.\n4️⃣ Test it with real use.\n5️⃣ Learn and improve.\n\n🎯 Build something real before trying to make it perfect.",
      title + "\n\nStart small → build → test → learn → improve.\n\n— Rapsometeddy",
      "💡 " + title.toUpperCase() + "\n\nStart small. Build. Test. Learn. Improve.\n\n" + cta + "\n\n#Rapsometeddy #BuildInPublic #Tech #AI",
      "🧸 " + title + "\n\n1️⃣ Start small\n2️⃣ Build\n3️⃣ Test\n4️⃣ Learn\n5️⃣ Improve\n\nBuild • Learn • Create • Invest 🚀",
      "0–3s: “Here's how I'd start " + topic + ".”\n3–10s: “Pick one small problem.”\n10–18s: “Build and test the first version.”\n18–24s: “Learn from what happens.”\n24–30s: “Follow Rapsometeddy for the build.”"
    );
  }

  function visualPackage(topic, type) {
    const v = topic.toLowerCase();
    const style = "cinematic futuristic Rapsometeddy aesthetic, dark tech workspace, subtle glowing accents, realistic smartphone, clean composition, vertical 9:16, no logos, no readable text";

    let prompts;
    if (type === "phone") {
      prompts = [
        "creator planning the app problem and writing a simple idea map on a smartphone",
        "close-up of a smartphone displaying a clean app wireframe with one core feature highlighted",
        "phone-only coding workflow with a compact editor and app preview visible on the screen",
        "AI connection visual: smartphone linked to a glowing neural network through flowing data",
        "creator testing the app on a smartphone with a few subtle bug markers",
        "late-night phone workspace showing debugging and a small fix being made",
        "finished mobile app demo on a smartphone with the creator presenting the result"
      ];
    } else if (type === "r0") {
      prompts = [
        "creator starting a zero-budget business experiment with only a smartphone and notebook",
        "simple problem research and customer idea validation on a smartphone",
        "free digital tools arranged around a smartphone with a zero-budget experiment theme",
        "creator testing a simple offer with no paid advertising",
        "first small result from a zero-budget business experiment",
        "creator reviewing what worked and what failed using a smartphone",
        "small zero-budget project reaching its first meaningful result"
      ];
    } else if (type === "challenge") {
      prompts = [
        "creator announcing a seven-day build challenge with a smartphone and notebook",
        "day-one planning board with one clear goal",
        "mid-challenge creator building and testing a small digital project",
        "progress montage showing several stages of a phone-based build",
        "creator solving a problem during the challenge",
        "final testing session before the challenge deadline",
        "finished challenge result presented confidently on a smartphone"
      ];
    } else {
      prompts = [
        "creator exploring the main problem behind the topic on a smartphone",
        "simple visual breakdown of the core idea with clean digital cards",
        "small first version of the project being built on a smartphone",
        "creator testing the project and studying the result",
        "finished project being presented by the creator"
      ];
    }

    const fullPrompts = prompts.map(p => p + ", " + style);
    const shots = fullPrompts.map((p,i) => {
      const motions = [
        "slow push-in with subtle parallax",
        "gentle left-to-right camera drift",
        "slow tilt toward the phone screen",
        "subtle forward zoom with animated light movement",
        "gentle handheld-style micro movement",
        "slow push-in with subtle screen glow",
        "smooth reveal from phone to creator"
      ];
      return (i+1) + ". SHOT " + (i+1) + "\nIMAGE PROMPT: " + p + "\nMOTION: " + motions[i % motions.length] + "\nDURATION: " + (type === "phone" ? "4s" : "5s");
    });

    const music = type === "phone"
      ? "🎵 MUSIC DIRECTION\nFuturistic melodic trap / chill hip-hop. 90–100 BPM. Dark synths, warm bass, light percussion, gradual build from Day 1 to Day 7. No vocals needed."
      : "🎵 MUSIC DIRECTION\nModern cinematic hip-hop / electronic beat. 90–105 BPM. Clean bass, subtle synths, steady build, energetic final section. No vocals needed.";

    const voice = "🎙️ VOICEOVER\nUse a confident, conversational Rapsometeddy delivery. Keep sentences short, energetic and easy to subtitle. Hook first, then explain the experiment, then finish with a clear follow/next-step CTA.";

    return "🖼️ IMAGE PROMPTS\n\n" + fullPrompts.map((p,i) => (i+1) + ". " + p).join("\n\n") +
      "\n\n━━━━━━━━━━━━━━━━━━\n🎬 VIDEO SHOT LIST\n━━━━━━━━━━━━━━━━━━\n\n" +
      shots.join("\n\n") +
      "\n\n━━━━━━━━━━━━━━━━━━\n" + music +
      "\n\n━━━━━━━━━━━━━━━━━━\n" + voice +
      "\n\n🎨 VISUAL STYLE\n" + style +
      "\n\n📐 FORMAT\n9:16 vertical • short-form video • phone-friendly";
  }

  function makePackage(master, xVersion, instagram, telegram, short) {
    return "🧸 RAPSOMETTEDY CONTENT PACKAGE\n\n━━━━━━━━━━━━━━━━━━\n📝 MASTER POST\n━━━━━━━━━━━━━━━━━━\n\n" + master + "\n\n#Rapsometeddy #BuildInPublic #Tech #AI #Entrepreneurship\n\n━━━━━━━━━━━━━━━━━━\n🐦 X VERSION\n━━━━━━━━━━━━━━━━━━\n\n" + xVersion + "\n\n━━━━━━━━━━━━━━━━━━\n📸 INSTAGRAM VERSION\n━━━━━━━━━━━━━━━━━━\n\n" + instagram + "\n\n━━━━━━━━━━━━━━━━━━\n💬 TELEGRAM VERSION\n━━━━━━━━━━━━━━━━━━\n\n" + telegram + "\n\n━━━━━━━━━━━━━━━━━━\n🎬 SHORT VIDEO\n━━━━━━━━━━━━━━━━━━\n\n" + short;
  }

  function contentDraft(idea, format) {
    const packageText = contentPackage(idea);
    if (format === "post") return packageText;
    if (format === "short") return "🎬 SHORT VIDEO: " + idea + "\n\nBuild a small version. Test it. Learn from what breaks. Improve the next version.\n\nCTA: Follow Rapsometeddy for the build.";
    return packageText;
  }

  if (/^\/sports(?:@\w+)?\b/i.test(text)) {
    const sportsUrl = process.env.SPORTS_ANALYTICS_URL || "https://rapsometeddy-sports-predictor.vercel.app/api/football/analytics";
    try {
      const r = await fetch(sportsUrl, { headers: { accept: "application/json" } });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) return send(chat.id, "⚽ Sports analytics is temporarily unavailable.\\n\\n" + (data?.error || ("HTTP " + r.status)));
      const a = data.analytics || {};
      const pct = n => Math.round((Number(n) || 0) * 100);
      const top = (a.topTeams || []).slice(0, 5).map((t, i) => `${i + 1}. ${t.name} — ${t.points} pts • ${t.ppg} PPG • GD ${t.goalDiff > 0 ? "+" : ""}${t.goalDiff}`).join("\\n");
      return sendLong(chat.id, "⚽ RAPSOMETTEDY FOOTBALL ANALYTICS\\n\\n" +
        "Finished: " + (a.finished ?? 0) + "\\n" +
        "Upcoming: " + (a.upcoming ?? 0) + "\\n" +
        "Goals: " + (a.goals ?? 0) + "\\n" +
        "Average goals: " + (a.avgGoals ?? 0) + "\\n\\n" +
        "Home wins: " + pct(a.homeWinRate) + "%\\n" +
        "Draws: " + pct(a.drawRate) + "%\\n" +
        "Away wins: " + pct(a.awayWinRate) + "%\\n\\n" +
        (top ? "🏆 Table snapshot\\n" + top : "No standings snapshot available.") +
        "\\n\\n📊 Statistical analysis only.");
    } catch (e) {
      console.error("[SPORTS_ANALYTICS]", e);
      return send(chat.id, "❌ Could not reach the football analytics service.\\n\\n" + String(e?.message || e));
    }
  }

  const contentCmd = /^(\/auto|\/media|\/create|\/thread|\/short|\/idea|\/ideas|\/drafts|\/adapt|\/approve|\/queue|\/publish|\/published)(?:@\w+)?\b/i.exec(text);
  if (contentCmd) {
    const cmd = contentCmd[1].toLowerCase();
    const rest = args(text);

    if (cmd === "/media") {
      const id = Number(rest);
      if (!Number.isInteger(id) || id <= 0) return send(chat.id, "Usage: /media <draft_id>\\nExample: /media 13");
      if (!dbEnabled()) return send(chat.id, "⚠️ Persistent storage isn't connected yet.");

      const draft = await getDraft(chat.id, id);
      if (!draft) return send(chat.id, "❌ Draft #" + id + " was not found.");

      const prompts = extractImagePrompts(draft.content);
      if (!prompts.length) return send(chat.id, "❌ Draft #" + id + " has no image prompts.");

      await send(chat.id, "🎬 Starting Media Engine for draft #" + id + "...\\n\\n🖼️ Generating " + prompts.length + " vertical scenes.\\nThis uses Pollinations and may take a little while.");

      for (let i = 0; i < prompts.length; i++) {
        const url = pollinationsUrl("image", prompts[i], {
          model: "flux",
          width: "720",
          height: "1280",
          nologo: "true",
          private: "true",
          safe: "true"
        });
        const sent = await sendMediaPhoto(chat.id, url, "🎨 Rapsometeddy scene " + (i + 1) + "/" + prompts.length);
        if (!sent.ok) {
          await send(chat.id, "⚠️ Scene " + (i + 1) + " could not be delivered. Check the Pollinations API key/configuration.");
        }
      }

      const videoPrompt = "cinematic vertical 9:16 short-form video for Rapsometeddy, " +
        "AI app built using only a smartphone, planning, wireframe, coding, connecting AI, testing, debugging, finished app reveal, futuristic dark tech aesthetic, smooth camera movement, no readable text";
      const videoUrl = pollinationsUrl("video", videoPrompt, {
        duration: "5",
        aspectRatio: "9:16"
      });

      const voiceText = "Can I build a useful AI app using only a phone? Day one: choose one real problem. Day two: design the smallest useful feature. Day three: build the first version. Day four: connect the AI. Day five: test it. Day six: fix what breaks. Day seven: share the result. Build, test, fix, share.";
      const audioUrl = pollinationsUrl("audio", voiceText, { voice: "nova" });

      const imageUrls = prompts.map(prompt => pollinationsUrl("image", prompt, {
        model: "flux", width: "720", height: "1280",
        nologo: "true", private: "true", safe: "true"
      }));

      // Download the exact generated assets once. The renderer uses these same bytes,
      // instead of requesting the Pollinations URLs a second time.
      const imageAssets = [];
      let assetError = "";
      for (let i = 0; i < imageUrls.length; i++) {
        try {
          imageAssets.push(await fetchMediaBuffer(imageUrls[i], "Scene " + (i + 1)));
        } catch (e) {
          assetError = String(e?.message || e);
          break;
        }
      }

      const audioAssetResult = await fetchMediaBuffer(audioUrl, "Voiceover").catch(e => ({
        error: String(e?.message || e)
      }));

      const audioSent = await sendMediaAudio(chat.id, audioUrl, "🎙️ Rapsometeddy voiceover");

      for (let i = 0; i < imageUrls.length; i++) {
        const sent = await sendMediaPhoto(chat.id, imageUrls[i], "🎨 Rapsometeddy scene " + (i + 1) + "/" + prompts.length);
        if (!sent.ok) {
          await send(chat.id, "⚠️ Scene " + (i + 1) + " could not be delivered.");
        }
      }

      await send(chat.id, "🎬 Assembling the exact generated scenes into one 9:16 MP4...");
      const fs = require("fs"), path = require("path");
      const outputPath = path.join("/tmp", "rapsometeddy-draft-" + id + "-" + Date.now() + ".mp4");
      let finalSent = { ok:false }, renderError = "";

      try {
        if (assetError) throw new Error(assetError);
        if (audioAssetResult.error) throw new Error(audioAssetResult.error);
        await renderSlideshow(imageAssets, audioAssetResult, outputPath);
        finalSent = await sendLocalVideo(chat.id, outputPath, "🎬 Rapsometeddy final short — draft #" + id);
      } catch (e) {
        renderError = String(e?.message || e);
        console.error("Media render error:", renderError);
      } finally {
        try { fs.unlinkSync(outputPath); } catch {}
      }

      if (!finalSent.ok) {
        const fallback = await sendMediaVideo(chat.id, videoUrl, "🎥 Rapsometeddy fallback video — draft #" + id);
        if (!fallback.ok) await send(chat.id, "⚠️ Final MP4 failed. " + (renderError || fallback.description || "Unknown media error."));
      }

      return sendLong(chat.id,
        "✅ Media Engine finished for draft #" + id + ".\n\n" +
        "🖼️ " + prompts.length + " generated scenes: ✅\n" +
        "🎬 Final 9:16 MP4: " + (finalSent.ok ? "✅ sent to Telegram" : "⚠️ fallback used") + "\n" +
        "🎙️ Voiceover: " + (audioSent.ok ? "✅ sent" : "⚠️ failed") + "\n\n" +
        "🔐 API credentials are kept out of the Telegram response."
      );
    }

    if (cmd === "/auto") {
      const topic = rest || "Rapsometeddy";
      const v = topic.toLowerCase();

      // Choose the content archetype from the topic itself so the headline,
      // structure and platform versions always describe the same thing.
      let archetype = "guide";
      if (v.includes("r0") || v.includes("no money") || v.includes("without money")) archetype = "r0";
      else if (v.includes("phone") || v.includes("mobile") || v.includes("from a phone")) archetype = "phone";
      else if (v.includes("challenge")) archetype = "challenge";
      else if (v.includes("mistake")) archetype = "mistakes";
      else if (v.includes("myth")) archetype = "myth";
      else if (v.includes("learned") || v.includes("nobody tells")) archetype = "lessons";
      else if (v.includes("build") || v.includes("app") || v.includes("project")) archetype = "build";

      const builders = {
        phone: [
          `📱 7-Day AI App Build From a Phone`,
          `📱 Phone-only build experiment: ${topic}`,
          `🛠️ Can I build ${topic} using only a phone?`
        ],
        r0: [
          `💸 R0 experiment: test ${topic} without spending money`,
          `💸 How I'd test ${topic} with R0`,
          `🧪 Can ${topic} work with R0?`
        ],
        challenge: [
          `🔥 7-day challenge: ${topic}`,
          `🗓️ 7 days to test ${topic}`,
          `🚀 The ${topic} build challenge`
        ],
        mistakes: [
          `❌ 3 real mistakes beginners make with ${topic}`,
          `⚠️ 3 ways beginners go wrong with ${topic}`,
          `🧠 3 mistakes I'd avoid with ${topic}`
        ],
        myth: [
          `🧠 Myth vs reality: ${topic}`,
          `🔍 What people get wrong about ${topic}`,
          `💡 ${topic}: myth vs reality`
        ],
        lessons: [
          `📝 What I learned from ${topic}`,
          `🧠 What nobody tells you about ${topic}`,
          `🚀 Lessons from building around ${topic}`
        ],
        build: [
          `🛠️ Step-by-step: building ${topic}`,
          `🚀 How I'd build ${topic} from scratch`,
          `🧪 Build experiment: ${topic}`
        ],
        guide: [
          `💡 Beginner guide to ${topic}`,
          `🚀 The simple way to start ${topic}`,
          `🧠 ${topic}: what I'd learn first`
        ]
      };

      const options = builders[archetype] || builders.guide;
      const idea = options[Math.floor(Date.now() / 86400000) % options.length];
      const draftContent = contentPackage(idea, archetype, topic) + "\n\n━━━━━━━━━━━━━━━━━━\n🎨 VISUAL PRODUCTION KIT\n━━━━━━━━━━━━━━━━━━\n\n" + visualPackage(topic, archetype);

      if (!dbEnabled()) {
        return sendLong(chat.id, `⚠️ Persistent storage isn't connected yet.\n\nIdea: ${idea}\n\n${draftContent}`);
      }

      const saved = await saveDraft(chat.id, user?.id, "post", idea, draftContent);
      if (!saved) return send(chat.id, "⚠️ I couldn't save the auto-generated draft.");

      return sendLong(chat.id, `🤖 Auto draft #${saved.id} created.\n\n💡 Idea: ${idea}\n\n${draftContent}\n\nStatus: Draft\n\nReview it, then use:\n/approve ${saved.id}\n/queue ${saved.id}\n/publish ${saved.id}`);
    }
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
