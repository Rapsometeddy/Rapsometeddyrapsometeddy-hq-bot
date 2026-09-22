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
    if (v.includes("3 mistakes") || v.includes("mistakes beginners")) return "mistakes";
    if (v.includes("7-day challenge") || v.includes("challenge")) return "challenge";
    if (v.includes("myth vs reality") || v.includes("myth")) return "myth";
    if (v.includes("using only a phone") || v.includes("from a phone") || v.includes("phone-only")) return "phone";
    if (v.includes("r0") || v.includes("no money") || v.includes("without money")) return "r0";
    if (v.includes("how i would start") || v.includes("build") || v.includes("building")) return "build";
    if (v.includes("what i learned") || v.includes("what nobody tells you")) return "lessons";
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

  function contentPackage(idea) {
    const type = detectContentType(idea);
    const facts = contentFacts(idea);
    const cta = ["Save this for your next project.","What would you build with this?","Try one step today.","Follow the build — more experiments coming.","What should Rapsometeddy build next?"][Math.floor(Date.now() / 86400000) % 5];

    if (type === "mistakes") {
      return makePackage(
        "🔥 " + idea + "\n\n3 mistakes beginners make:\n\n1️⃣ " + facts[0] + "\n2️⃣ " + facts[1] + "\n3️⃣ " + facts[2] + "\n\n💡 Fix: start small, test early, then improve what works.",
        idea + "\n\n1. " + facts[0] + "\n2. " + facts[1] + "\n3. " + facts[2] + "\n\nBetter approach: build the smallest useful version, test it, then improve.\n\n" + cta + "\n\n— Rapsometeddy",
        "❌ " + facts[0] + "\n❌ " + facts[1] + "\n❌ " + facts[2] + "\n\n✅ Start small. Test early. Learn. Improve.\n\n" + cta + "\n\n#Rapsometeddy #BuildInPublic #Tech #AI",
        "🧸 " + idea + "\n\n1️⃣ " + facts[0] + "\n2️⃣ " + facts[1] + "\n3️⃣ " + facts[2] + "\n\n💡 Start with one useful version and improve it.\n\nBuild • Learn • Create • Invest 🚀",
        "0–3s HOOK: “Here are 3 mistakes beginners keep making.”\n\n3–8s #1: “" + facts[0] + "”\n8–13s #2: “" + facts[1] + "”\n13–18s #3: “" + facts[2] + "”\n18–25s FIX: “Start small, test, then improve.”\n25–30s CTA: “" + cta + "”"
      );
    }

    if (type === "phone") {
      return makePackage(
        "📱 " + idea + "\n\nThe goal isn't a massive app. It's proving a useful first version can be built with the device you already have.\n\n1️⃣ Pick one problem.\n2️⃣ Build one feature.\n3️⃣ Connect only what you need.\n4️⃣ Test it on your phone.\n5️⃣ Document what breaks.\n\n🎯 Ship a tiny working version before adding more features.",
        "Can you build an AI project using only a phone?\n\nOne problem. One feature. One workflow.\n\nBuild → test → fix → repeat.\n\nThe constraint can become the experiment.\n\n— Rapsometeddy",
        "📱 PHONE-ONLY BUILD EXPERIMENT\n\nPick one problem. Build one feature. Test it. Document failures. Improve the next version.\n\n" + cta + "\n\n#Rapsometeddy #PhoneOnly #AI #Tech",
        "🧸 PHONE-ONLY EXPERIMENT\n\n📱 Pick one problem\n🛠️ Build one feature\n🧪 Test it\n📝 Document what breaks\n🔁 Improve it\n\nBuild • Learn • Create • Invest 🚀",
        "0–3s HOOK: “Can I actually build this using only my phone?”\n3–8s GOAL: “One problem. One useful feature.”\n8–18s BUILD: “Build it. Test it. Find what breaks.”\n18–24s LESSON: “The first version needs to work, not be perfect.”\n24–30s CTA: “Follow Rapsometeddy for the experiment.”"
      );
    }

    if (type === "r0") {
      return makePackage(
        "💸 " + idea + "\n\nIf I had R0, I'd prove an idea before spending money.\n\n1️⃣ Use tools I already have.\n2️⃣ Pick one real problem.\n3️⃣ Build the smallest useful version.\n4️⃣ Test it.\n5️⃣ Spend only when the next expense has a clear purpose.\n\n🎯 R0 means using time and attention as the first resources.",
        "Starting with R0?\n\nDon't start by buying tools.\nStart with a real problem, simple solution, free workflow and real test.\n\nThen spend only when the result justifies it.\n\n— Rapsometeddy",
        "💸 THE R0 BUILD\n\nUse what you already have. Solve one problem. Build the smallest version. Test it. Then decide what deserves money.\n\n" + cta + "\n\n#Rapsometeddy #R0 #BuildInPublic #Entrepreneurship",
        "🧸 R0 BUILD PLAN\n\n💡 One real problem\n🛠️ One simple solution\n📱 Tools you already have\n🧪 One real test\n\nLet the result decide the next step.\n\nBuild • Learn • Create • Invest 🚀",
        "0–3s HOOK: “If I had R0, this is where I'd start.”\n3–10s: “Find one real problem.”\n10–16s: “Build the smallest solution with what you have.”\n16–22s: “Test it before spending money.”\n22–30s CTA: “Follow Rapsometeddy for the R0 build.”"
      );
    }

    if (type === "challenge") {
      return makePackage(
        "🔥 " + idea + "\n\nDAY 1 — Pick one problem.\nDAY 2 — Plan the simplest solution.\nDAY 3 — Build.\nDAY 4 — Test.\nDAY 5 — Fix the biggest problem.\nDAY 6 — Share what you learned.\nDAY 7 — Decide what to build next.\n\n🎯 The goal is a finished experiment, not perfection.",
        "7-day challenge:\n\nDay 1 problem → Day 2 plan → Day 3 build → Day 4 test → Day 5 fix → Day 6 share → Day 7 reflect.\n\nSeven days of building beats seven days of waiting.\n\n— Rapsometeddy",
        "🔥 7-DAY BUILD CHALLENGE\n\nProblem → Plan → Build → Test → Fix → Share → Reflect.\n\nFinish the experiment.\n\n" + cta + "\n\n#Rapsometeddy #7DayChallenge #BuildInPublic",
        "🧸 7-DAY BUILD CHALLENGE\n\n1️⃣ Problem\n2️⃣ Plan\n3️⃣ Build\n4️⃣ Test\n5️⃣ Fix\n6️⃣ Share\n7️⃣ Reflect\n\nBuild • Learn • Create • Invest 🚀",
        "0–3s: “Give me 7 days and one idea.”\n3–18s: “Problem. Plan. Build. Test. Fix. Share.”\n18–24s: “Day 7: decide what the results taught you.”\n24–30s: “Join the challenge and follow Rapsometeddy.”"
      );
    }

    const master = "💡 " + idea + "\n\nStart with one small problem.\nUse the simplest useful workflow.\nTest the first version.\nLearn from what happens.\nImprove the next version.\n\n🎯 Build something real before trying to make it perfect.";
    return makePackage(master, idea + "\n\nStart small. Test early. Learn from real results. Improve the next version.\n\nBuild → test → learn → repeat.\n\n— Rapsometeddy", "Keep the first version simple.\n\n1. Start small.\n2. Test early.\n3. Learn from feedback.\n4. Improve the next version.\n\n" + cta + "\n\n#Rapsometeddy #BuildInPublic #Tech #AI", "🧸 " + idea + "\n\n💡 Start small\n🧪 Test early\n📚 Learn\n🔁 Improve\n\nBuild • Learn • Create • Invest 🚀", "0–3s: “Here's the simple way I'd approach this.”\n3–10s: “Start with one small problem.”\n10–18s: “Build and test the first useful version.”\n18–24s: “Let real results guide the next version.”\n24–30s: “Follow Rapsometeddy for the build.”");
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

  const contentCmd = /^(\/auto|\/create|\/thread|\/short|\/idea|\/ideas|\/drafts|\/adapt|\/approve|\/queue|\/publish|\/published)(?:@\w+)?\b/i.exec(text);
  if (contentCmd) {
    const cmd = contentCmd[1].toLowerCase();
    const rest = args(text);

    if (cmd === "/auto") {
      const topic = rest || "Rapsometeddy";
      const pool = [
        `A beginner's guide to ${topic}`,
        `3 mistakes beginners make with ${topic}`,
        `How I would start ${topic} with R0 and a phone`,
        `What nobody tells you about ${topic}`,
        `Free tools that make ${topic} easier`,
        `Can you build a real project around ${topic} using only a phone?`
      ];
      const idea = pool[Math.floor(Date.now() / 3600000) % pool.length];
      const draftContent = contentPackage(idea);

      if (!dbEnabled()) {
        return send(chat.id, `⚠️ Persistent storage isn't connected yet.\n\nIdea: ${idea}\n\n${draftContent}`);
      }

      const saved = await saveDraft(chat.id, user?.id, "post", idea, draftContent);
      if (!saved) return send(chat.id, "⚠️ I couldn't save the auto-generated draft.");

      return send(chat.id, `🤖 Auto draft #${saved.id} created.\n\n💡 Idea: ${idea}\n\n${draftContent}\n\nStatus: Draft\n\nReview it, then use:\n/approve ${saved.id}\n/queue ${saved.id}\n/publish ${saved.id}`);
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
