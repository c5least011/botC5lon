require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');
const mongoose = require('mongoose');

// ===== CONNECT DB =====
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Mongo OK"))
    .catch(e => console.log("❌ Mongo lỗi", e));

// ===== SCHEMA =====
const Data = mongoose.model('NekoData', new mongoose.Schema({
    guildId: String,
    type: String,                 // tx | bc
    val: mongoose.Schema.Types.Mixed,
    side: String,                 // kết quả thật (TX)
    predict: String,              // bot đoán
    createdAt: { type: Date, default: Date.now }
}));

const Setup = mongoose.model('NekoSetup', new mongoose.Schema({
    userId: String,
    guildId: String,
    alias: String
}));

// ===== BOT CONFIG =====
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const NEKO_ID = "1248205177589334026";

// ===== SLASH COMMANDS =====
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('định dạng server')
        .setIntegrationTypes(1)
        .setContexts(0)
        .addStringOption(o => o.setName('ten').setDescription('sv1, sv2...').setRequired(true)),

    new SlashCommandBuilder()
        .setName('xoasetup')
        .setDescription('Xóa tên server đã lưu')
        .setIntegrationTypes(1)
        .setContexts(0, 1, 2)
        .addStringOption(o => o.setName('ten_sv').setDescription('Tên muốn xóa').setRequired(true).setAutocomplete(true)),

    new SlashCommandBuilder()
        .setName('dudoancobac')
        .setDescription('Soi cầu dự đoán')
        .setIntegrationTypes(1)
        .setContexts(0, 1, 2)
        .addStringOption(o => o.setName('ten_sv').setDescription('Server').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('loai').setDescription('TX hoặc BC').setRequired(true)
            .addChoices({ name: 'TX', value: 'tx' }, { name: 'BC', value: 'bc' })),

    new SlashCommandBuilder()
        .setName('luucau')
        .setDescription('Dán KQ Neko để lưu')
        .setIntegrationTypes(1)
        .setContexts(0, 1, 2)
        .addStringOption(o => o.setName('ten_sv').setDescription('Server').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('noidung').setDescription('Tin nhắn Neko').setRequired(true))
].map(c => c.toJSON());

// ===== REGISTER COMMANDS =====
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log("🚀 Slash OK");
    } catch (e) { console.log(e); }
})();

// ===== AUTO HÚP DATA =====
client.on('messageCreate', async (msg) => {
    if (msg.author.id !== NEKO_ID) return;
    const gId = msg.guildId;
    if (!gId) return;

    const content = msg.content;
    const txM = content.match(/=\s*\**(\d+)\**/);
    const sdM = content.match(/Tài\/Xỉu:\s*\**([^\*\n\s]+)\**/i);
    if (txM && sdM) {
        await Data.create({ guildId: gId, type: 'tx', val: parseInt(txM[1]), side: sdM[1].trim() });
        console.log(`[AUTO TX] ${gId}`);
    }

    const bcM = [...content.matchAll(/<(?:a)?:([a-zA-Z0-9]+)(?:_nk)?:\d+>/g)];
    if (bcM.length === 3) {
        await Data.create({ guildId: gId, type: 'bc', val: bcM.map(m => m[1].toLowerCase()) });
        console.log(`[AUTO BC] ${gId}`);
    }
});

// ===== INTERACTION =====
client.on('interactionCreate', async (interaction) => {
    // 1. AUTOCOMPLETE (Thêm try-catch để k sập bot)
    if (interaction.isAutocomplete()) {
        try {
            const focused = interaction.options.getFocused();
            const setups = await Setup.find({ userId: interaction.user.id });
            const filtered = setups.filter(s => s.alias.startsWith(focused)).slice(0, 25);
            
            // Phải return ở đây để nó thoát hàm, k chạy xuống dưới nữa
            return await interaction.respond(filtered.map(s => ({ name: s.alias, value: s.alias })));
        } catch (e) {
            return console.error("Lỗi Autocomplete:", e);
        }
    }

    // 2. CHẶN NẾU K PHẢI SLASH COMMAND
    if (!interaction.isChatInputCommand()) return;

});
    // SETUP
    if (commandName === 'setup') {
        if (!guildId) return interaction.reply("Vào server đi m.");
        const alias = options.getString('ten');
        await Setup.findOneAndUpdate({ userId: user.id, alias }, { guildId }, { upsert: true });
        return interaction.reply(`✅ Setup xong: **${alias}**`);
    }

    // XÓA SETUP (MỚI THÊM)
    if (commandName === 'xoasetup') {
        const alias = options.getString('ten_sv');
        const deleted = await Setup.findOneAndDelete({ userId: user.id, alias });
        if (deleted) return interaction.reply(`🗑️ Đã xóa tên lưu: **${alias}** (Data ván đấu vẫn còn).`);
        return interaction.reply("❌ K thấy tên này để xóa.");
    }

    // DUDOAN
    if (commandName === 'dudoancobac') {
        const alias = options.getString('ten_sv');
        const loai = options.getString('loai');
        const sInfo = await Setup.findOne({ userId: user.id, alias });
        if (!sInfo) return interaction.reply("K thấy server.");

        await interaction.deferReply();
        const res = loai === 'tx' ? await soiCauTX(sInfo.guildId) : await soiCauBC(sInfo.guildId);
        return interaction.editReply(`📊 **[${alias}]** ${res}`);
    }

    // LUUCAU
    if (commandName === 'luucau') {
        const alias = options.getString('ten_sv');
        const raw = options.getString('noidung');
        const sInfo = await Setup.findOne({ userId: user.id, alias });
        if (!sInfo) return interaction.reply("K thấy sv.");

        const txM = raw.match(/=\s*\**(\d+)\**/);
        const sdM = raw.match(/Tài\/Xỉu:\s*\**([^\*\n\s]+)\**/i);
        if (txM && sdM) {
            await Data.create({ guildId: sInfo.guildId, type: 'tx', val: parseInt(txM[1]), side: sdM[1].trim() });
            return interaction.reply(`✅ Lưu TX ${alias}`);
        }
        const bcM = [...raw.matchAll(/<(?:a)?:([a-zA-Z0-9]+)(?:_nk)?:\d+>/g)];
        if (bcM.length === 3) {
            await Data.create({ guildId: sInfo.guildId, type: 'bc', val: bcM.map(m => m[1].toLowerCase()) });
            return interaction.reply(`✅ Lưu BC ${alias}`);
        }
        return interaction.reply("❌ Sai format.");
    }

// ===== SOI TX (GHI ĐÈ PREDICT) =====
async function soiCauTX(gId) {
    const h = await Data.find({ guildId: gId, type: 'tx', side: { $exists: true } }).sort({ createdAt: -1 }).limit(20);
    if (h.length < 5) return "Ít data, né.";
    const last = h[0];
    if (last.predict && last.side !== last.predict) return `${last.predict.toUpperCase()} (Lì)`;
    let t = 0, x = 0;
    h.forEach(i => i.side === 'Tài' ? t++ : x++);
    const pick = t >= x ? 'Tài' : 'Xỉu';
    await Data.findByIdAndUpdate(last._id, { predict: pick }); 
    return `${pick.toUpperCase()} (Tỉ lệ)`;
}

// ===== SOI BC (PATTERN CŨ) =====
async function soiCauBC(gId) {
    const h = await Data.find({ guildId: gId, type: 'bc', val: { $exists: true } }).sort({ createdAt: -1 }).limit(15);
    if (h.length < 5) return "Ít data, né.";
    const last = h[0];
    if (last.predict && !last.val.includes(last.predict)) return `${last.predict.toUpperCase()} (Lì BC)`;
    const count = {};
    h.flatMap(i => i.val).forEach(v => count[v] = (count[v] || 0) + 1);
    const pick = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    await Data.create({ guildId: gId, type: 'bc', predict: pick });
    return `${pick.toUpperCase()} (Tỉ lệ BC)`;
}

// ===== RENDER ALIVE =====
const http = require('http');
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot Neko Bip Online!');
}).listen(process.env.PORT || 10000);

client.login(process.env.DISCORD_TOKEN);