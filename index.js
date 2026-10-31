import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mineflayer = require("mineflayer");
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require("discord.js");

const T = process.env.DISCORD_TOKEN || "MTU2NjAyMjM5MzczMjkyNzUzMg.GXjOXI.yYerRL_XbN7qxydFSrbLGZgLIDkWN8xjMMj3mA";
const C = process.env.CLIENT_ID || "1566022393732927532";
const P = Number(process.env.PORT || 3000);

const bots = new Map();
const locks = new Map();
const manualDis = new Map();

function getDir(id) {
  const d = path.resolve(`./user_data_${id}`);
  if (!fs.existsSync(d)) try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  return { f: path.join(d, "m.json"), t: path.join(d, "m.tmp.json") };
}

function loadMem(id) {
  const { f } = getDir(id);
  try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {}
  return { c: null, n: "ElKing" };
}

function saveMem(id, data) {
  const { f, t } = getDir(id);
  try {
    fs.writeFileSync(t, JSON.stringify(data), "utf8");
    fs.renameSync(t, f);
  } catch (e) {}
}

function cleanBot(id) {
  if (bots.has(id)) {
    try {
      const b = bots.get(id);
      if (b) { if (b.quit) b.quit(); if (b.end) b.end(); if (b.close) b.close(); }
    } catch (e) {}
    bots.delete(id);
  }
}

async function runBot(id, h, p, v, i, isStart = false) {
  if (locks.get(id)) {
    if (i) i.editReply({ content: "⚠️ هناك عملية تشغيل جارية لحسابك." }).catch(() => {});
    return;
  }
  locks.set(id, true);

  try {
    cleanBot(id);
    let mem = loadMem(id);
    mem.c = { h, p, v };
    saveMem(id, mem);

    const name = mem.n || "ElKing";
    let res = false;

    const timer = setTimeout(() => {
      if (!res) {
        res = true;
        cleanBot(id);
        locks.set(id, false);
        if (i) i.editReply({ content: "❌ **عدم دخول البوت إلى السيرفر.**\n> *تأكد من تفعيل أمر الكراك في السيرفر.*" }).catch(() => {});
      }
    }, 45000);

    const bot = mineflayer.createBot({ host: h, port: p, username: name, auth: "offline", version: v, skipValidation: true });
    bots.set(id, bot);

    bot.once("spawn", () => {
      locks.set(id, false);
      if (res) return;
      res = true;
      clearTimeout(timer);

      if (bot.rec) {
        bot.rec.edit({ content: "🟢 **تم حل المشكلة ودخول البوت إلى السيرفر بأمان!**" }).catch(() => {});
        bot.rec = null;
      }

      if (i) {
        i.editReply({ content: `🟢 **تم دخول البوت إلى السيرفر بنجاح!**\n🌐 **الآي بي:** \`${h}\` | **البورت:** \`${p}\` | **الإصدار:** \`${v}\`\n\n> *تأكد من تفعيل الأوبي في السيرفر.*` }).catch(() => {});
      }

      setTimeout(() => {
        try { bot.chat(`/gamemode creative ${bot.username}`); bot.chat(`/skin set Esoteric_Artist`); } catch (e) {}
      }, 1000);

      const cs = setInterval(() => {
        if (bots.get(id) !== bot || !bot.game) return clearInterval(cs);
        if (bot.game.gameMode !== 'creative') {
          try { bot.chat(`/gamemode creative ${bot.username}`); } catch (e) {}
        }
      }, 100);

      const afk = setInterval(() => {
        if (bots.get(id) === bot && bot.entity && bot.entity.position) {
          bot.setControlState("jump", true);
          bot.setControlState("forward", true);
          setTimeout(() => {
            if (bot) {
              bot.setControlState("jump", false);
              bot.setControlState("forward", false);
              bot.setControlState("back", true);
              setTimeout(() => { if (bot) bot.setControlState("back", false); }, 200);
            }
          }, 300);
        } else {
          clearInterval(afk);
        }
      }, 30000);
    });

    bot.on("error", () => {
      locks.set(id, false);
      if (res) return;
      res = true;
      clearTimeout(timer);
      cleanBot(id);
      if (i) i.editReply({ content: "❌ **عدم دخول البوت إلى السيرفر.**\n> *تأكد من تفعيل أمر الكراك في السيرفر.*" }).catch(() => {});
    });

    bot.on("end", async () => {
      locks.set(id, false);
      cleanBot(id);
      if (manualDis.get(id)) { manualDis.set(id, false); return; }

      try {
        const u = await client.users.fetch(id);
        if (u) {
          const m = await u.send({ content: "⚠️ تم خروج البوت بسبب مشكلة ما." }).catch(() => {});
          if (m) bot.rec = m;
        }
      } catch (e) {}

      setTimeout(() => { runBot(id, h, p, v, null, false); }, 3000);
    });
  } catch (e) {
    locks.set(id, false);
    cleanBot(id);
  } finally {
    setTimeout(() => { locks.set(id, false); }, 1500);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });

const cmds = [
  new SlashCommandBuilder().setName("connect").setDescription("الاتصال بالسيرفر للمرة الأولى")
    .addStringOption(o => o.setName("ip").setDescription("الآي بي").setRequired(true))
    .addIntegerOption(o => o.setName("port").setDescription("البورت").setRequired(true))
    .addStringOption(o => o.setName("version").setDescription("الإصدار").setRequired(true)),
  new SlashCommandBuilder().setName("disconnect").setDescription("خروج البوت وإيقاف اتصاله"),
  new SlashCommandBuilder().setName("start").setDescription("بدء البوت بالبيانات المحفوظة"),
  new SlashCommandBuilder().setName("name").setDescription("تغيير اسم البوت")
    .addStringOption(o => o.setName("bot_name").setDescription("الاسم الجديد").setRequired(true)),
  new SlashCommandBuilder().setName("kick").setDescription("طرد لاعب")
    .addStringOption(o => o.setName("player").setDescription("اسم اللاعب").setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName("kill").setDescription("قتل لاعب أو البوت")
    .addStringOption(o => o.setName("player").setDescription("اسم اللاعب").setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName("time").setDescription("تغيير وقت السيرفر")
    .addStringOption(o => o.setName("set").setDescription("الوقت").setRequired(true)
      .addChoices(
        { name: "نهار (Day - 1000)", value: "1000" },
        { name: "ليل (Night - 13000)", value: "13000" },
        { name: "ظهر (Noon - 6000)", value: "6000" },
        { name: "منتصف الليل (Midnight - 18000)", value: "18000" }
      )),
  new SlashCommandBuilder().setName("weather").setDescription("التحكم في الطقس")
    .addStringOption(o => o.setName("state").setDescription("الحالة").setRequired(true)
      .addChoices(
        { name: "إزالة المطر، سما صافية (Clear)", value: "clear" },
        { name: "مطر (Rain)", value: "rain" },
        { name: "عاصفة رعدية (Thunder)", value: "thunder" }
      )),
  new SlashCommandBuilder().setName("pvp").setDescription("بدء القتال الذكي")
    .addStringOption(o => o.setName("player").setDescription("اسم اللاعب المستهدف").setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName("armor").setDescription("اختر نوع العتاد").setRequired(true)
      .addChoices(
        { name: "Netherite", value: "netherite" },
        { name: "Diamond", value: "diamond" },
        { name: "Iron", value: "iron" },
        { name: "Gold", value: "gold" }
      )),
  new SlashCommandBuilder().setName("help").setDescription("عرض دليل واستخدام الأوامر")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(T);

client.once("ready", async () => {
  try { await rest.put(Routes.applicationCommands(C), { body: cmds }); } catch (e) {}
});

client.on("guildMemberAdd", async (m) => {
  try {
    const ch = m.guild.systemChannel || m.guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(m.guild.members.me).has("SendMessages"));
    if (ch) {
      await ch.send({ embeds: [new EmbedBuilder()
        .setTitle("🌸 مرحبا بكم في سيرفر بوت ماينكرافت 🌸")
        .setDescription(
          "• للتعامل مع الشات واستخدام البوت، يجب كتابة أمر السلاش (`/`) لتظهر لك قائمة الأوامر التفاعلية.\n" +
          "• البوت يدعم آخر إصدار رسمي وهو **26.1** بكفاءة تامة.\n" +
          "• إذا كنت تريد تشغيل إصدارات أحدث، لزم إضافة إضافتي `ViaVersion` و `ViaBackwards` في السيرفر.\n" +
          "• تأكد تماماً من تفعيل خيار الكراك (`Cracked`) في إعدادات السيرفر.\n" +
          "• يجب منح البوت صلاحيات الـ `OP` الكاملة داخل اللعبة للتحكم السلس."
        )
        .setColor("#5865F2")] });
    }
  } catch (e) {}
});

client.on("interactionCreate", async (i) => {
  if (i.isAutocomplete()) {
    const id = i.user.id;
    const bot = bots.get(id);
    const focusedValue = i.options.getFocused();

    let choices = [];
    if (bot && bot.players) {
      choices = Object.keys(bot.players).filter(p => p !== bot.username);
    }

    if (choices.length === 0) {
      return i.respond([{ name: "لا يوجد أحد في السيرفر", value: "no_players" }]);
    }

    const filtered = choices.filter(choice => choice.toLowerCase().startsWith(focusedValue.toLowerCase()));
    return i.respond(
      filtered.length > 0 
        ? filtered.slice(0, 25).map(choice => ({ name: choice, value: choice }))
        : [{ name: "لا يوجد أحد في السيرفر", value: "no_players" }]
    );
  }

  if (!i.isChatInputCommand()) return;
  const id = i.user.id;
  const bot = bots.get(id);

  if (i.commandName === "help") {
    return i.reply({ embeds: [new EmbedBuilder()
      .setTitle("✨ دليل أوامر البوت الاحترافي")
      .setDescription(
        "• 🌐 `/connect` : الاتصال بالسيرفر للمرة الأولى عبر تحديد الآي بي، البورت، والإصدار.\n" +
        "• 🔌 `/disconnect` : خروج البوت وإيقاف اتصاله بالسيرفر.\n" +
        "• 📥 `/start` : استرجاع بيانات السيرفر المحفوظة وإدخال البوت فوراً.\n" +
        "• 👤 `/name` : تغيير اسم البوت الخاص بك داخل اللعبة.\n" +
        "• 👢 `/kick` : طرد لاعب محدد من السيرفر.\n" +
        "• 💀 `/kill` : تنفيذ أمر القتل للهدف أو البوت داخل اللعبة.\n" +
        "• ⏰ `/time` : تغيير وضبط وقت السيرفر (نهار، ليل، ظهر، منتصف الليل).\n" +
        "• 🌤️ `/weather` : التحكم في الطقس (إزالة المطر وسما صافية، مطر، عاصفة رعدية).\n" +
        "• ⚔️ `/pvp` : بدء المواجهة القتالية الذكية وتحديد اللاعب والعتاد.\n" +
        "• ❓ `/help` : عرض دليل واستخدام الأوامر."
      )
      .setColor("#5865F2")
      .setFooter({ text: "Bot MC Cloud - 24/7" })], ephemeral: true });
  }

  if (i.commandName === "connect") {
    await i.deferReply({ ephemeral: true });
    runBot(id, i.options.getString("ip"), i.options.getInteger("port"), i.options.getString("version"), i, false);
    return;
  }
  if (i.commandName === "start") {
    const mem = loadMem(id);
    if (!mem.c || !mem.c.v) return i.reply({ content: "⚠️ لا توجد بيانات محفوظة. استخدم `/connect` أولاً.", ephemeral: true });
    await i.deferReply({ ephemeral: true });
    await i.editReply({ content: `🔄 **تم استرجاع البيانات:** \`${mem.c.h}:${mem.c.p}\`` }).catch(() => {});
    runBot(id, mem.c.h, mem.c.p, mem.c.v, i, true);
    return;
  }
  if (i.commandName === "disconnect") {
    if (!bot) {
      return i.reply({ content: "⚠️ البوت غير متصل بالسيرفر حالياً! استخدم `/connect` أو `/start` للاتصال أولاً.", ephemeral: true });
    }
    manualDis.set(id, true);
    cleanBot(id);
    locks.set(id, false);
    return i.reply({ content: "📉 تم خروج البوت من السيرفر. 😢", ephemeral: true });
  }
  if (i.commandName === "name") {
    const nn = i.options.getString("bot_name");
    let mem = loadMem(id);
    mem.n = nn;
    saveMem(id, mem);
    return i.reply({ content: "✅ تم تغيير اسم البوت بنجاح.\n> *تنبيه: يجب أن يكون البوت خارج السيرفر لتغيير الاسم.*", ephemeral: true });
  }

  if (!bot) {
    return i.reply({ content: "⚠️ البوت غير متصل بالسيرفر حالياً! استخدم `/connect` أو `/start` للاتصال أولاً.", ephemeral: true });
  }

  if (i.commandName === "kick") {
    const pl = i.options.getString("player");
    try { bot.chat(`/kick ${pl}`); } catch (e) {}
    return i.reply({ content: `👢 تم تنفيذ أمر الطرد للاعب: \`${pl}\``, ephemeral: true });
  }
  if (i.commandName === "kill") {
    const pl = i.options.getString("player");
    try { bot.chat(`/kill ${pl}`); } catch (e) {}
    return i.reply({ content: `💀 تم تنفيذ أمر القتل للهدف: \`${pl}\``, ephemeral: true });
  }
  if (i.commandName === "time") {
    try { bot.chat(`/time set ${i.options.getString("set")}`); } catch (e) {}
    return i.reply({ content: "⏰ تم ضبط الوقت.", ephemeral: true });
  }
  if (i.commandName === "weather") {
    try { bot.chat(`/weather ${i.options.getString("state")}`); } catch (e) {}
    return i.reply({ content: "🌤️ تم تغيير الطقس.", ephemeral: true });
  }
  if (i.commandName === "pvp") {
    const pl = i.options.getString("player");
    const ar = i.options.getString("armor");

    const playersList = bot.players ? Object.keys(bot.players) : [];
    const targetExists = playersList.some(pName => pName.toLowerCase() === pl.toLowerCase());

    if (!targetExists) {
      return i.reply({ 
        content: `❌ **عدم تنفيذ أمر الـ pvp.**\n> *لا يوجد شخص يُدعى بهذا الاسم:* \`${pl}\``, 
        ephemeral: true 
      });
    }

    const mem = loadMem(id);
    const bn = mem.n || bot.username;
    try {
      bot.chat(`/gamemode survival ${bn}`);
      setTimeout(() => {
        ["helmet", "chestplate", "leggings", "boots", "sword"].forEach(it => {
          try { bot.chat(`/give ${bn} ${ar}_${it}`); } catch (e) {}
        });
      }, 500);
    } catch (e) {}

    return i.reply({ 
      content: `⚔️ **تم تنفيذ أمر الـ PvP:**\n🎯 **تحديد اللاعب:** \`${pl}\`\n🛡️ **نوع الدروع:** \`${ar}\`\n🔄 **تم التحويل إلى وضع السرفايفل وتجهيز العتاد بنجاح.**`, 
      ephemeral: true 
    });
  }
});

http.createServer((req, res) => { res.writeHead(200); res.end("OK"); }).listen(P, () => {
  client.login(T);
});
