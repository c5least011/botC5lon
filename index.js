require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');
const mongoose = require('mongoose');
const http = require('http');

// ==========================================
//              CONNECT DATABASE
// ==========================================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ CONNECT MONGO OK"))
    .catch(e => console.log("❌ MONGO LỖI:", e));

// ==========================================
//               DATABASE SCHEMA
// ==========================================
const Data = mongoose.model('NekoData', new mongoose.Schema({
    guildId: String,
    type: String,               // tx | bc
    val: mongoose.Schema.Types.Mixed,
    side: String,               // Tài / Xỉu
    predict: String,            // tài / xỉu
    createdAt: { type: Date, default: Date.now }
}));

const Setup = mongoose.model('NekoSetup', new mongoose.Schema({
    userId: String,
    guildId: String,
    alias: String
}));

// ==========================================
//               BOT CONFIG
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const NEKO_ID = "1248205177589334026";

// ==========================================
//              SLASH COMMANDS
// ==========================================
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('định dạng server')
        .addStringOption(o =>
            o.setName('ten').setDescription('sv1, sv2...').setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('xoasetup')
        .setDescription('Xóa tên server đã lưu')
        .addStringOption(o =>
            o.setName('ten_sv')
                .setDescription('Tên muốn xóa')
                .setRequired(true)
                .setAutocomplete(true)
        ),

    new SlashCommandBuilder()
        .setName('dudoancobac')
        .setDescription('Soi cầu dự đoán')
        .addStringOption(o =>
            o.setName('ten_sv')
                .setDescription('Server')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(o =>
            o.setName('loai')
                .setDescription('TX hoặc BC')
                .setRequired(true)
                .addChoices(
                    { name: 'TX', value: 'tx' },
                    { name: 'BC', value: 'bc' }
                )
        ),

    new SlashCommandBuilder()
        .setName('luucau')
        .setDescription('Dán KQ Neko để lưu')
        .addStringOption(o =>
            o.setName('ten_sv')
                .setDescription('Server')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(o =>
            o.setName('noidung')
                .setDescription('Tin nhắn Neko')
                .setRequired(true)
        )
].map(c => c.toJSON());

// ==========================================
//           REGISTER COMMAND
// ==========================================
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
    await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
    );
    console.log("🚀 SLASH READY");
})();

// ==========================================
//              AUTO HÚP DATA
// ==========================================
client.on('messageCreate', async (msg) => {
    if (msg.author.id !== NEKO_ID) return;
    if (!msg.guildId) return;

    const c = msg.content;

    // TX
    const txM = c.match(/=\s*\**(\d+)\**/);
    const sdM = c.match(/Tài\/Xỉu:\s*\**([^\*\n\s]+)\**/i);
    if (txM && sdM) {
        await Data.create({
            guildId: msg.guildId,
            type: 'tx',
            val: parseInt(txM[1]),
            side: sdM[1]
        });
    }

    // BC – CHỈ LƯU DATA, KHÔNG TÍNH
    const bcM = [...c.matchAll(/<(?:a)?:([a-zA-Z0-9]+)(?:_nk)?:\d+>/g)];
    if (bcM.length === 3) {
        await Data.create({
            guildId: msg.guildId,
            type: 'bc',
            val: bcM.map(m => m[1].toLowerCase())
        });
    }
});

// ==========================================
//           INTERACTION HANDLER
// ==========================================
client.on('interactionCreate', async (interaction) => {

    // AUTOCOMPLETE
    if (interaction.isAutocomplete()) {
        const focused = interaction.options.getFocused();
        const setups = await Setup.find({
            userId: interaction.user.id,
            guildId: interaction.guildId
        });

        return interaction.respond(
            setups
                .filter(s => s.alias.startsWith(focused))
                .slice(0, 25)
                .map(s => ({ name: s.alias, value: s.alias }))
        );
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, user, guildId } = interaction;

    // SETUP
    if (commandName === 'setup') {
        const alias = options.getString('ten');

        await Setup.findOneAndUpdate(
            { userId: user.id, guildId, alias },
            { guildId },
            { upsert: true }
        );

        return interaction.reply({
            content: `✅ Đã setup server: **${alias}**`,
            ephemeral: true
        });
    }

    // XOASETUP
    if (commandName === 'xoasetup') {
        const alias = options.getString('ten_sv');
        const del = await Setup.findOneAndDelete({
            userId: user.id,
            guildId,
            alias
        });

        return interaction.reply({
            content: del ? `🗑️ Đã xóa **${alias}**` : "❌ Không thấy server này",
            ephemeral: true
        });
    }

    // DUDOAN
    if (commandName === 'dudoancobac') {
        const alias = options.getString('ten_sv');
        const loai = options.getString('loai');
        const sInfo = await Setup.findOne({
            userId: user.id,
            guildId,
            alias
        });

        if (!sInfo) return interaction.reply("❌ Chưa setup server này");

        await interaction.deferReply();

        if (loai === 'bc') {
            return interaction.editReply("🎲 **BAUCUA: COMING SOON**");
        }

        const rs = await soiCauTX(sInfo.guildId);
        return interaction.editReply(`📊 **SOI [${alias}]** → ${rs}`);
    }

    // LUUCAU
    if (commandName === 'luucau') {
        const alias = options.getString('ten_sv');
        const raw = options.getString('noidung');
        const sInfo = await Setup.findOne({
            userId: user.id,
            guildId,
            alias
        });

        if (!sInfo) return interaction.reply("❌ Không thấy server");

        const txM = raw.match(/=\s*\**(\d+)\**/);
        const sdM = raw.match(/Tài\/Xỉu:\s*\**([^\*\n\s]+)\**/i);

        if (txM && sdM) {
            await Data.create({
                guildId: sInfo.guildId,
                type: 'tx',
                val: parseInt(txM[1]),
                side: sdM[1]
            });
            return interaction.reply("✅ Đã lưu TX");
        }

        return interaction.reply("❌ Sai format");
    }
});

// ==========================================
//             SOI CẦU TX
// ==========================================
async function soiCauTX(gId) {
    const history = await Data.find({
        guildId: gId,
        type: 'tx',
        side: { $exists: true }
    }).sort({ createdAt: -1 }).limit(20);

    if (history.length < 5) return "Ít data, soi cc.";

    const norm = s => s.toLowerCase().includes('t') ? 'tài' : 'xỉu';

    const lastVan = history[0];
    const prevVan = history[1];

    let tai = 0, xiu = 0;
    history.forEach(v => norm(v.side) === 'tài' ? tai++ : xiu++);

    const soDong = tai >= xiu ? 'tài' : 'xỉu';
    let pick = soDong;

    if (prevVan?.predict) {
        const prevPredict = norm(prevVan.predict);
        const lastSide = norm(lastVan.side);

        if (prevPredict !== lastSide) {
            pick = prevPredict === 'tài' ? 'xỉu' : 'tài';
        } else {
            pick = soDong;
        }
    }

    await Data.findByIdAndUpdate(lastVan._id, { predict: pick });

    return `${pick.toUpperCase()} | SỐ ĐÔNG: ${soDong.toUpperCase()} (${tai}-${xiu})`;
}

// ==========================================
//              KEEP ALIVE
// ==========================================
http.createServer((req, res) => {
    res.end("bot còn sống");
}).listen(process.env.PORT || 10000);

client.login(process.env.DISCORD_TOKEN);
