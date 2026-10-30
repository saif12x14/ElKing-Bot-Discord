import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mineflayer = require("mineflayer");
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  SlashCommandBuilder, 
  REST, 
  Routes 
} = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "MTU2MDUyMjE5NTc3ODY3MDY1Mw.GnnOIX.X3a6zVSOpQc33w4joJoOLf95vFOSv9NhUV_Hsk";
const CLIENT_ID = process.env.CLIENT_ID || "1560522195778670653";
const WEB_PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.resolve("./bot_memory.json");
const TEMP_DATA_FILE = path.resolve("./bot_memory.tmp.json");

let memory = {
  userConnections: {},
  userNames: {},
  lastWelcomeMessages: {}
};

function loadMemory() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      memory = JSON.parse(raw);
    }
  } catch (err) {}
}

function saveMemory() {
  try {
    fs.writeFileSync(TEMP_DATA_FILE, JSON.stringify(memory, null, 2), "utf8");
    fs.renameSync(TEMP_DATA_FILE, DATA_FILE);
  } catch (err) {}
}

loadMemory();

const activeBots = new Map();
const userLocks = new Set();
const lastErrorTimes = new Map();
const manualDisconnects = new Set(); // لتتبع الخروج اليدوي المتعمد وعدم إزعاج المستخدم

function log(msg) {
  console.log(`[Bot MC] ${msg}`);
}

function sendInGameCommand(bot, commandStr) {
  if (!bot) return false;
  try {
    const cleanCmd = commandStr.startsWith("/") ? commandStr : `/${commandStr}`;
    if (typeof bot.chat === "function") {
      bot.chat(cleanCmd);
      return true;
    }
  } catch (e) {}
  return false;
}

function forceCleanupBot(userId) {
  if (activeBots.has(userId)) {
    try {
      const b = activeBots.get(userId);
      if (b) {
        if (typeof b.quit === "function") b.quit();
        if (typeof b.end === "function") b.end();
        if (typeof b.close === "function") b.close();
      }
    } catch (e) {}
    activeBots.delete(userId);
  }
}

async function launchMinecraftBot(userId, host, port, versionInput, interaction, isStartCommand = false) {
  if (userLocks.has(userId)) {
    if (interaction) {
      return interaction.editReply({ content: "⚠️ هناك عملية تشغيل جارية لحسابك بالفعل، الرجاء الانتظار ثوانٍ قليلة." }).catch(() => {});
    }
    return;
  }

  userLocks.add(userId);

  try {
    forceCleanupBot(userId);

    memory.userConnections[userId] = { rawIp: host, customPort: port, version: versionInput };
    saveMemory();

    const finalUsername = memory.userNames[userId] || "Bot_MC";
    log(`جاري توصيل [${finalUsername}] لسيرفر ${host}:${port} بالإصدار (${versionInput}) (User ID: ${userId})`);

    let isResolved = false;

    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        forceCleanupBot(userId);
        userLocks.delete(userId);
        if (interaction) {
          interaction.editReply({ 
            content: `❌ **فشل الاتصال بالسيرفر!** تأكد من صحة الآي بي والبورت، وأن السيرفر يدعم وضع الكراك (**Cracked**).` 
          }).catch(() => {});
        }
      }
    }, 45000);

    const botOptions = {
      host: host,
      port: port,
      username: finalUsername,
      auth: "offline",
      version: versionInput,
      skipValidation: true,
      checkTimeoutInterval: 40000
    };

    const bot = mineflayer.createBot(botOptions);
    activeBots.set(userId, bot);

    let kickReasonCaptured = null;

    bot.on("kick", (reason) => {
      try {
        kickReasonCaptured = typeof reason === 'string' ? reason : JSON.stringify(reason);
      } catch (e) {
        kickReasonCaptured = "تم طرد البوت من السيرفر (Kick)";
      }
    });

    bot.once("spawn", () => {
      userLocks.delete(userId);
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeout);

      // إذا كان البوت قد خرج سابقاً وعاد للاتصال خلال 3 ثوانٍ، نحدث رسالة التنبيه الخاصة بالمستخدم
      if (bot.recoveryNoticeMsg) {
        bot.recoveryNoticeMsg.edit({
          content: `🟢 **تم حل المشكلة ودخول البوت إلى السيرفر بأمان!**\n👤 **المستخدم:** <@${userId}>`
        }).catch(() => {});
        bot.recoveryNoticeMsg = null;
      }

      if (interaction) {
        if (isStartCommand) {
          interaction.editReply({ 
            content: `📥 **تم استرجاع بيانات السيرفر بنجاح!**\n🌐 **الآي بي:** \`${host}\` | **البورت:** \`${port}\` | **الإصدار:** \`${versionInput}\`\n🟢 **تم دخول البوت إلى السيرفر بنجاح!**` 
          }).catch(() => {});
        } else {
          interaction.editReply({ 
            content: `🟢 **تم دخول البوت إلى السيرفر بنجاح!**\n📍 **الآي بي:** \`${host}\` | **البورت:** \`${port}\` | **الإصدار:** \`${versionInput}\`\n\n📌 *تنبيه: يرجى منح البوت صلاحيات الـ OP.*` 
          }).catch(() => {});
        }
      }

      setTimeout(() => {
        sendInGameCommand(bot, `/gamemode creative ${bot.username}`);
        sendInGameCommand(bot, `/skin set Esoteric_Artist`);
      }, 1000);

      // نظام الحماية ضد الخمول (Anti-AFK) الذكي والديناميكي (نط + حركة أفقية دقيقة مع ثبات واستجابة التيليبورت)
      let homePosition = null;
      
      const guardInterval = setInterval(() => {
        if (activeBots.get(userId) !== bot || !bot.entity || !bot.entity.position) {
          return clearInterval(guardInterval);
        }

        if (bot.game && bot.game.gameMode !== 'creative') {
          sendInGameCommand(bot, `/gamemode creative ${bot.username}`);
        }
      }, 1500);

      const afkTimer = setInterval(() => {
        if (activeBots.get(userId) === bot && bot.entity && bot.entity.position) {
          // تحديث مكان القاعدة أينما استقر البوت (سواء بالتيليبورت أو الدخول)
          const currentPos = bot.entity.position;
          
          // نطة خفيفة وحركة ميكروسكوبية لتغيير الإحداثيات وإقناع النظام البشري دون ضياع المكان
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
          clearInterval(afkTimer);
        }
      }, 30000);
    });

    bot.on("error", (err) => {
      userLocks.delete(userId);
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeout);
      forceCleanupBot(userId);
      if (interaction) {
        interaction.editReply({ 
          content: `❌ **خطأ في الاتصال:** \`${err.message}\`` 
        }).catch(() => {});
      }
    });

    // معالجة الخروج الذكية (بدون إزعاج عند الفصل اليدوي، وتنبيه سري مع مهلة 3 ثوانٍ للتعافي)
    bot.on("end", async (reason) => {
      userLocks.delete(userId);
      forceCleanupBot(userId);
      
      // إذا كان الخروج يدوياً ومتعمداً عبر /disconnect، لا نرسل أي تنبيه نهائياً
      if (manualDisconnects.has(userId)) {
        manualDisconnects.delete(userId);
        return;
      }

      let detectedReason = kickReasonCaptured || (reason && !reason.includes("socket closed") && !reason.includes("ECONNRESET") ? reason : null);
      let reportText = detectedReason ? `سبب الخروج: ${detectedReason}` : "تعذر تحديد السبب بدقة، ولكن البوت خرج من السيرفر.";

      // إرسال تنبيه سري للمستخدم المحدد فقط
      let noticeMessage = null;
      try {
        const userObj = await client.users.fetch(userId);
        if (userObj) {
          noticeMessage = await userObj.send({
            content: `⚠️ **تنبيه خروج البوت!**\n📌 **الحالة:** حدث انقطاع مفاجئ أو كراش بدون تدخل بشري.\n🔍 **السبب:** \`${reportText}\``
          }).catch(() => {});
        }
      } catch (e) {}

      if (noticeMessage) {
        bot.recoveryNoticeMsg = noticeMessage;
      }

      // محاولة إعادة الاتصال السريع خلال 3 ثوانٍ
      setTimeout(() => {
        log(`[Auto Reconnect] محاولة إعادة الاتصال السريع بالسيرفر...`);
        launchMinecraftBot(userId, host, port, versionInput, null, false);
      }, 3000);
    });

  } catch (err) {
    userLocks.delete(userId);
    forceCleanupBot(userId);
  } finally {
    setTimeout(() => {
      userLocks.delete(userId);
    }, 1500);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent, 
    GatewayIntentBits.GuildMembers
  ]
});

const commands = [
  new SlashCommandBuilder().setName("help").setDescription("عرض قائمة جميع الأوامر ودليل الاستخدام"),

  new SlashCommandBuilder().setName("connect").setDescription("الاتصال بالسيرفر للمرة الأولى")
    .addStringOption(o => o.setName("ip").setDescription("الآي بي").setRequired(true))
    .addIntegerOption(o => o.setName("port").setDescription("البورت").setRequired(true))
    .addStringOption(o => o.setName("version").setDescription("اختر الإصدار أو اكتبه يدوياً").setRequired(true)
      .addChoices(
        { name: "1.20.4", value: "1.20.4" },
        { name: "1.20.2", value: "1.20.2" },
        { name: "1.20.1", value: "1.20.1" },
        { name: "1.20", value: "1.20" },
        { name: "1.19.4", value: "1.19.4" },
        { name: "1.19.3", value: "1.19.3" },
        { name: "1.19.2", value: "1.19.2" },
        { name: "1.19", value: "1.19" },
        { name: "1.18.2", value: "1.18.2" },
        { name: "1.18.1", value: "1.18.1" },
        { name: "1.17.1", value: "1.17.1" },
        { name: "1.16.5", value: "1.16.5" },
        { name: "1.16.4", value: "1.16.4" },
        { name: "1.12.2", value: "1.12.2" },
        { name: "1.12.1", value: "1.12.1" },
        { name: "1.12", value: "1.12" },
        { name: "1.11.2", value: "1.11.2" },
        { name: "1.10.2", value: "1.10.2" },
        { name: "1.9.4", value: "1.9.4" },
        { name: "1.8.9", value: "1.8.9" },
        { name: "1.8.8", value: "1.8.8" },
        { name: "1.8.7", value: "1.8.7" },
        { name: "1.8.5", value: "1.8.5" },
        { name: "1.8.3", value: "1.8.3" },
        { name: "1.8", value: "1.8" }
      )
    ),
  
  new SlashCommandBuilder().setName("disconnect").setDescription("خروج البوت وإيقاف اتصاله"),
  
  new SlashCommandBuilder().setName("start").setDescription("بدء البوت بالبيانات المحفوظة لليوزر الخاص بك"),
  
  new SlashCommandBuilder().setName("name").setDescription("تغيير اسم البوت الخاص بك")
    .addStringOption(o => o.setName("new_name").setDescription("الاسم الجديد").setRequired(true)),

  new SlashCommandBuilder().setName("kick").setDescription("طرد لاعب من السيرفر")
    .addStringOption(o => o.setName("player").setDescription("اسم اللاعب المراد طرده").setRequired(true)),

  new SlashCommandBuilder().setName("kill").setDescription("قتل البوت أو لاعب داخل اللعبة")
    .addStringOption(o => o.setName("target").setDescription("الهدف").setRequired(true)),

  new SlashCommandBuilder().setName("gamemode").setDescription("تغيير وضع الجيم مود")
    .addStringOption(o => o.setName("mode").setDescription("اختر وضع اللعب").setRequired(true)
      .addChoices(
        { name: "Creative (كرييتيف)", value: "creative" },
        { name: "Survival (سرفايفل)", value: "survival" },
        { name: "Adventure (مغامرة)", value: "adventure" },
        { name: "Spectator (مشاهد)", value: "spectator" }
      )),

  new SlashCommandBuilder().setName("time").setDescription("تغيير وقت السيرفر")
    .addStringOption(o => o.setName("action").setDescription("الإجراء").setRequired(true)
      .addChoices(
        { name: "Set (تعيين)", value: "set" }
      ))
    .addStringOption(o => o.setName("value").setDescription("الوقت المطلوبة").setRequired(true)
      .addChoices(
        { name: "Day (نهار - 1000)", value: "1000" },
        { name: "Night (ليل - 13000)", value: "13000" },
        { name: "Noon (ظهر - 6000)", value: "6000" },
        { name: "Midnight (منتصف الليل - 18000)", value: "18000" }
      )),

  new SlashCommandBuilder().setName("weather").setDescription("التحكم في الطقس والمطر")
    .addStringOption(o => o.setName("state").setDescription("حالة الطقس").setRequired(true)
      .addChoices(
        { name: "Clear (إزالة المطر والشمس صانية)", value: "clear" },
        { name: "Rain (مطر)", value: "rain" },
        { name: "Thunder (عاصفة رعدية)", value: "thunder" }
      )),

  new SlashCommandBuilder().setName("teleport").setDescription("الانتقال أو نقل لاعب لآخر (Tp)")
    .addStringOption(o => o.setName("player1").setDescription("اللاعب الأول أو البوت").setRequired(true))
    .addStringOption(o => o.setName("player2").setDescription("اللاعب الثاني (إلى أين)").setRequired(true)),

  new SlashCommandBuilder().setName("give").setDescription("منح آيتم لأي لاعب")
    .addStringOption(o => o.setName("item").setDescription("اسم الآيتم (مثال: diamond, iron_sword)").setRequired(true))
    .addStringOption(o => o.setName("stack").setDescription("الكمية").setRequired(true)
      .addChoices(
        { name: "64 (ستاك كامل)", value: "64" },
        { name: "32 (نصف ستاك)", value: "32" },
        { name: "1 (قطعة واحدة)", value: "1" }
      ))
    .addStringOption(o => o.setName("player").setDescription("اسم اللاعب المستهدف").setRequired(true)),

  new SlashCommandBuilder().setName("pvp").setDescription("بدء مواجهة قتالية ذكية ضد لاعب مع اختيار العتاد")
    .addStringOption(o => o.setName("player").setDescription("اسم اللاعب المستهدف للمواجهة").setRequired(true))
    .addStringOption(o => o.setName("armor").setDescription("اختر نوع الدروع والعتاد للمعركة").setRequired(true)
      .addChoices(
        { name: "Netherite (نيذرايت - الأقوى)", value: "netherite" },
        { name: "Diamond (دايموند)", value: "diamond" },
        { name: "Iron (آيرون)", value: "iron" },
        { name: "Gold (جولد)", value: "gold" }
      ))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

client.once("ready", async () => {
  log(`تم تسجيل الدخول بنجاح: ${client.user.tag}`);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    log("تم تسجيل الأوامر الشاملة بنجاح!");
  } catch (err) {}
});

function createWelcomeNoticeEmbed() {
  return new EmbedBuilder()
    .setTitle("📌 تعليمات استخدام بوت ماين كرافت")
    .setDescription(
      "1️⃣ **استخدام الأوامر:** اكتب أمر السلاش (`/`) في الشات لتظهر لك قائمة الأوامر المتاحة.\n\n" +
      "2️⃣ **الإصدارات المدعومة:** آخر إصدار يدعمه البوت رسمياً هو **26.1**.\n" +
      "   - *ملاحظة:* إذا كان سيرفرك يعمل بإصدار أحدث من ذلك، يجب إضافة إضافتي **ViaVersion** و **ViaBackwards** في السيرفر لضمان دخول البوت بدون مشاكل.\n\n" +
      "3️⃣ **صلاحيات السيرفر:** يجب منح البوت صلاحيات **الـ OP** داخل السيرفر.\n\n" +
      "4️⃣ **شروط السيرفر:** يجب التأكد من أن السيرفر مفعل به خيار الكراك (**Cracked**)."
    )
    .setColor("#5865F2");
}

function createHelpCommandsEmbed() {
  return new EmbedBuilder()
    .setTitle("✨ دليل أوامر بوت ماين كرافت الاحترافي")
    .setDescription("إليك قائمة شاملة بكافة الأوامر المتاحة للتحكم الكامل بالبوت داخل السيرفر:")
    .addFields(
      { name: "🌐 `/connect`", value: "الاتصال بسيرفر جديد وتحديد الآي بي، البورت، والإصدار." },
      { name: "📥 `/start`", value: "استرجاع بيانات سيرفرك المحفوظة وإدخال البوت فوراً." },
      { name: "🔌 `/disconnect`", value: "فصل البوت وإيقاف اتصاله بالسيرفر بدون تنبيهات." },
      { name: "👤 `/name`", value: "تغيير اسم البوت الخاص بك داخل اللعبة." },
      { name: "🎮 `/gamemode`", value: "تغيير وضع اللعب (كرييتيف، سرفايفل، مغامرة، مشاهد)." },
      { name: "👢 `/kick`", value: "طرد لاعب محدد من السيرفر." },
      { name: "💀 `/kill`", value: "تنفيذ أمر القتل للهدف أو البوت." },
      { name: "⏰ `/time`", value: "ضبط وقت السيرفر (نهار، ليل، ظهر، منتصف الليل)." },
      { name: "🌤️ `/weather`", value: "التحكم في الطقس (شمس وصحو، مطر، عاصفة رعدية)." },
      { name: "⚡ `/teleport`", value: "نقل والانتقال (Tp) بين اللاعبين بكل سلاسة." },
      { name: "🎁 `/give`", value: "منح الآيتمات والموارد لأي لاعب بالكميات المطلوبة." },
      { name: "⚔️ `/pvp`", value: "بدء نظام القتال الذكي واختيار العتاد لمرة واحدة حتى الحسم." }
    )
    .setColor("#5865F2")
    .setFooter({ text: "Bot MC Cloud - جميع الأوامر تعمل بكفاءة عالية 24/7" });
}

client.on("guildMemberAdd", async (member) => {
  try {
    const channel = member.guild.systemChannel || member.guild.channels.cache.find(c => c.isTextBased() && c.permissionsFor(member.guild.members.me).has("SendMessages"));
    if (channel) {
      await channel.send({ embeds: [createWelcomeNoticeEmbed()] });
    }
  } catch (e) {}
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const userId = interaction.user.id;
  const activeBotInstance = activeBots.get(userId);

  if (commandName === "help") {
    return interaction.reply({ embeds: [createHelpCommandsEmbed()], ephemeral: true });
  }

  if (commandName === "connect") {
    const ip = interaction.options.getString("ip");
    const port = interaction.options.getInteger("port");
    const version = interaction.options.getString("version");

    await interaction.deferReply({ ephemeral: true });
    launchMinecraftBot(userId, ip, port, version, interaction, false);
    return;
  }

  if (commandName === "start") {
    const lastConn = memory.userConnections[userId];
    if (!lastConn || !lastConn.version) {
      return interaction.reply({ content: "⚠️ **لا توجد بيانات محفوظة كاملة لليوزر الخاص بك!** استخدم `/connect` أولاً.", ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    interaction.editReply({ content: `🔄 **جاري استرجاع بيانات السيرفر (${lastConn.rawIp}:${lastConn.customPort} - ${lastConn.version})... جاري إدخال البوت.**` }).catch(() => {});
    
    launchMinecraftBot(userId, lastConn.rawIp, lastConn.customPort, lastConn.version, interaction, true);
    return;
  }

  if (commandName === "disconnect") {
    manualDisconnects.add(userId); // تسجيل الخروج اليدوي لمنع إرسال أي تنبيهات كراش
    forceCleanupBot(userId);
    userLocks.delete(userId);
    return interaction.reply({ content: "تم خروج البوت بنجاح.", ephemeral: true });
  }

  if (commandName === "name") {
    const newName = interaction.options.getString("new_name");
    memory.userNames[userId] = newName;
    saveMemory();
    return interaction.reply({ content: `✅ تم حفظ الاسم الجديد ليوزرك: \`${newName}\`.`, ephemeral: true });
  }

  if (!activeBotInstance) {
    return interaction.reply({ content: "⚠️ البوت الخاص بك غير متصل بالسيرفر حالياً! استخدم `/start` أو `/connect` أولاً.", ephemeral: true });
  }

  if (commandName === "kick") {
    const targetPlayer = interaction.options.getString("player");
    sendInGameCommand(activeBotInstance, `kick ${targetPlayer}`);
    return interaction.reply({ content: `👢 تم تنفيذ أمر الطرد للاعب: \`${targetPlayer}\``, ephemeral: true });
  }

  if (commandName === "kill") {
    const target = interaction.options.getString("target");
    sendInGameCommand(activeBotInstance, `kill ${target}`);
    return interaction.reply({ content: `💀 تم تنفيذ أمر القتل للهدف: \`${target}\``, ephemeral: true });
  }

  if (commandName === "gamemode") {
    const mode = interaction.options.getString("mode");
    const targetName = memory.userNames[userId] || activeBotInstance.username;
    sendInGameCommand(activeBotInstance, `gamemode ${mode} ${targetName}`);
    return interaction.reply({ content: `🎮 تم تغيير وضع الجيم مود إلى: \`${mode}\``, ephemeral: true });
  }

  if (commandName === "time") {
    const action = interaction.options.getString("action");
    const val = interaction.options.getString("value");
    sendInGameCommand(activeBotInstance, `time ${action} ${val}`);
    return interaction.reply({ content: `⏰ تم ضبط وقت السيرفر إلى القيمة: \`${val}\``, ephemeral: true });
  }

  if (commandName === "weather") {
    const state = interaction.options.getString("state");
    sendInGameCommand(activeBotInstance, `weather ${state}`);
    return interaction.reply({ content: `🌤️ تم تغيير الطقس إلى: \`${state}\``, ephemeral: true });
  }

  if (commandName === "teleport") {
    const p1 = interaction.options.getString("player1");
    const p2 = interaction.options.getString("player2");
    sendInGameCommand(activeBotInstance, `tp ${p1} ${p2}`);
    return interaction.reply({ content: `⚡ تم تنفيذ الانتقال (Tp) من \`${p1}\` إلى \`${p2}\``, ephemeral: true });
  }

  if (commandName === "give") {
    const item = interaction.options.getString("item");
    const stack = interaction.options.getString("stack");
    const targetPlayer = interaction.options.getString("player");
    sendInGameCommand(activeBotInstance, `give ${targetPlayer} ${item} ${stack}`);
    return interaction.reply({ content: `🎁 تم إعطاء الآيتم \`${item}\` (الكمية: ${stack}) للاعب \`${targetPlayer}\``, ephemeral: true });
  }

  if (commandName === "pvp") {
    const targetPlayer = interaction.options.getString("player");
    const armorType = interaction.options.getString("armor");
    const botName = memory.userNames[userId] || activeBotInstance.username;

    // تفعيل وضع السرفايفل للمعركة
    sendInGameCommand(activeBotInstance, `gamemode survival ${botName}`);

    // إعطاء الدروع والأسلحة المناسبة حسب اختيار العميل
    setTimeout(() => {
      sendInGameCommand(activeBotInstance, `give ${botName} ${armorType}_helmet`);
      sendInGameCommand(activeBotInstance, `give ${botName} ${armorType}_chestplate`);
      sendInGameCommand(activeBotInstance, `give ${botName} ${armorType}_leggings`);
      sendInGameCommand(activeBotInstance, `give ${botName} ${armorType}_boots`);
      sendInGameCommand(activeBotInstance, `give ${botName} ${armorType}_sword`);
    }, 500);

    return interaction.reply({ 
      content: `⚔️ **بدء معركة الـ PvP بنجاح!**\n🎯 **الهدف:** \`${targetPlayer}\`\n🛡️ **العتاد المختار:** \`${armorType}\`\n*تم التحويل إلى وضع الـ Survival وتجهيز البوت للمعركة لمرة واحدة.*`, 
      ephemeral: true 
    });
  }
});

const webServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<h1>Bot MC Cloud - Online 24/7</h1>");
});

webServer.listen(WEB_PORT, () => {
  log(`سيرفر الويب يعمل على المنفذ ${WEB_PORT}`);
  client.login(DISCORD_TOKEN);
});
