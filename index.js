require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');
const mongoose = require('mongoose');

// ==========================================
//              CONNECT DATABASE
// ==========================================
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("================================");
        console.log("✅ KẾT NỐI MONGODB THÀNH CÔNG");
        console.log("================================");
    })
    .catch(e => {
        console.log("❌ LỖI KẾT NỐI DATABASE:", e);
    });

// ==========================================
//               DATABASE SCHEMA
// ==========================================
const Data = mongoose.model('NekoData', new mongoose.Schema({
    guildId: String,
    type: String,                 // tx | bc
    val: mongoose.Schema.Types.Mixed,
    side: String,                 // kết quả thật (TX)
    predict: String,              // bot đoán
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
}));

const Setup = mongoose.model('NekoSetup', new mongoose.Schema({
    userId: String,
    guildId: String,
    alias: String
}));

// ==========================================
//               BOT CONFIGURATION
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
        .setIntegrationTypes(1)
        .setContexts(0)
        .addStringOption(o =>
            o.setName('ten').setDescription('sv1, sv2...').setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('xoasetup')
        .setDescription('Xóa tên server đã lưu')
        .setIntegrationTypes(1)
        .setContexts(0, 1, 2)
        .addStringOption(o =>
            o.setName('ten_sv').setDescription('Tên muốn xóa').setRequired(true).setAutocomplete(true)
        ),

    new SlashCommandBuilder()
        .setName('dudoancobac')
        .setDescription('Soi cầu dự đoán')
        .setIntegrationTypes(1)
        .setContexts(0, 1, 2)
        .addStringOption(o =>
            o.setName('ten_sv').setDescription('Server').setRequired(true).setAutocomplete(true)
        )
        .addStringOption(o =>
            o.setName('loai').setDescription('TX hoặc BC').setRequired(true)
                .addChoices(
                    { name: 'TX', value: 'tx' },
                    { name: 'BC', value: 'bc' }
                )
        ),

    new SlashCommandBuilder()
        .setName('luucau')
        .setDescription('Dán KQ Neko để lưu')
        .setIntegrationTypes(1)
        .setContexts(0, 1, 2)
        .addStringOption(o =>
            o.setName('ten_sv').setDescription('Server').setRequired(true).setAutocomplete(true)
        )
        .addStringOption(o =>
            o.setName('noidung').setDescription('Tin nhắn Neko').setRequired(true)
        )
].map(c => c.toJSON());

// REGISTER
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
    try {
        console.log("🔄 Đang nạp lệnh Slash...");
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log("🚀 Lệnh Slash đã sẵn sàng!");
    } catch (e) {
        console.error("❌ Lỗi nạp lệnh:", e);
    }
})();

// ==========================================
//               AUTO HÚP DATA
// ==========================================
client.on('messageCreate', async (msg) => {
    if (msg.author.id !== NEKO_ID) return;
    const gId = msg.guildId;
    if (!gId) return;

    const content = msg.content;

    // --- LOGIC HÚP TX ---
    const txM = content.match(/=\s*\**(\d+)\**/);
    const sdM = content.match(/Tài\/Xỉu:\s*\**([^\*\n\s]+)\**/i);
    if (txM && sdM) {
        await Data.create({
            guildId: gId,
            type: 'tx',
            val: parseInt(txM[1]),
            side: sdM[1].trim()
        });
        console.log(`✅ [HÚP TX] Server: ${gId} - Kết quả: ${sdM[1]}`);
    }

    // --- LOGIC HÚP BC ---
    const bcM = [...content.matchAll(/<(?:a)?:([a-zA-Z0-9]+)(?:_nk)?:\d+>/g)];
    if (bcM.length === 3) {
        await Data.create({
            guildId: gId,
            type: 'bc',
            val: bcM.map(m => m[1].toLowerCase())
        });
        console.log(`✅ [HÚP BC] Server: ${gId}`);
    }
});

// ==========================================
//              INTERACTION HANDLER
// ==========================================
client.on('interactionCreate', async (interaction) => {

    // --- XỬ LÝ AUTOCOMPLETE (CHỐNG SẬP) ---
    if (interaction.isAutocomplete()) {
        try {
            const focused = interaction.options.getFocused();
            const setups = await Setup.find({ userId: interaction.user.id });
            const filtered = setups.filter(s => s.alias.startsWith(focused)).slice(0, 25);
            
            return await interaction.respond(
                filtered.map(s => ({ name: s.alias, value: s.alias }))
            );
        } catch (error) {
            return console.log("Lỗi Autocomplete nhưng k sập bot.");
        }
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, user, guildId } = interaction;

    // --- LỆNH SETUP ---
    if (commandName === 'setup') {
        if (!guildId) return interaction.reply("ở trong sv mới setup dc");
        const alias = options.getString('ten');
        
        await Setup.findOneAndUpdate(
            { userId: user.id, alias },
            { guildId },
            { upsert: true }
        );
        return interaction.reply(`✅ Đã setup server với tên: **${alias}**`);
    }

    // --- LỆNH XÓA SETUP ---
    if (commandName === 'xoasetup') {
        const alias = options.getString('ten_sv');
        const deleted = await Setup.findOneAndDelete({ userId: user.id, alias });
        
        if (deleted) return interaction.reply(`🗑️ Đã xóa tên lưu: **${alias}** (Data gốc k đổi).`);
        return interaction.reply("❌ K tìm thấy server này trong list của m.");
    }

    // --- LỆNH DỰ ĐOÁN ---
    if (commandName === 'dudoancobac') {
        const alias = options.getString('ten_sv');
        const loai = options.getString('loai');
        const sInfo = await Setup.findOne({ userId: user.id, alias });
        
        if (!sInfo) return interaction.reply("chưa setup server này");

        await interaction.deferReply();
        
        let result = "";
        if (loai === 'tx') {
            result = await soiCauTX(sInfo.guildId);
        } else {
            result = await soiCauBC(sInfo.guildId);
        }

        return interaction.editReply(`📊 **KẾT QUẢ SOI [${alias}]:** ${result}`);
    }

    // --- LỆNH LƯU CẦU THỦ CÔNG ---
    if (commandName === 'luucau') {
        const alias = options.getString('ten_sv');
        const raw = options.getString('noidung');
        const sInfo = await Setup.findOne({ userId: user.id, alias });
        
        if (!sInfo) return interaction.reply("K thấy sv.");

        const txM = raw.match(/=\s*\**(\d+)\**/);
        const sdM = raw.match(/Tài\/Xỉu:\s*\**([^\*\n\s]+)\**/i);
        
        if (txM && sdM) {
            await Data.create({
                guildId: sInfo.guildId,
                type: 'tx',
                val: parseInt(txM[1]),
                side: sdM[1].trim()
            });
            return interaction.reply(`✅ Đã lưu TX [${alias}]`);
        }
        
        const bcM = [...raw.matchAll(/<(?:a)?:([a-zA-Z0-9]+)(?:_nk)?:\d+>/g)];
        if (bcM.length === 3) {
            await Data.create({
                guildId: sInfo.guildId,
                type: 'bc',
                val: bcM.map(m => m[1].toLowerCase())
            });
            return interaction.reply(`✅ Đã lưu BC [${alias}]`);
        }

        return interaction.reply("❌ Format tin nhắn m dán k đúng.");
    }
});

// ==========================================
//             THUẬT TOÁN SOI CẦU
// ==========================================

async function soiCauTX(gId) {
    const history = await Data.find({ 
        guildId: gId, 
        type: 'tx', 
        side: { $exists: true } 
    }).sort({ createdAt: -1 }).limit(20);

    if (history.length < 5) return "Dữ liệu server này ít quá (dưới 5 ván), k soi đc.";

    const lastVan = history[0];

    // Check "Lì" (Gấp thếp logic)
    if (lastVan.predict && lastVan.side !== lastVan.predict) {
        return `${lastVan.predict.toUpperCase()} (Lì tiếp ván trước)`;
    }

    // Tính tỉ lệ Tài/Xỉu
    let taiCount = 0;
    let xiuCount = 0;
    history.forEach(v => {
        if (v.side === 'Tài') taiCount++;
        else xiuCount++;
    });

    const pick = taiCount >= xiuCount ? 'Tài' : 'Xỉu';

    // Update dự đoán vào ván vừa xong để ván sau check Lì
    await Data.findByIdAndUpdate(lastVan._id, { predict: pick });

    return `${pick.toUpperCase()} (Tỉ lệ ${Math.round((taiCount/history.length)*100)}% đang thiên về con này)`;
}

async function soiCauBC(gId) {
    const history = await Data.find({ 
        guildId: gId, 
        type: 'bc', 
        val: { $exists: true } 
    }).sort({ createdAt: -1 }).limit(15);

    if (history.length < 5) return "Ít data BC quá.";

    const lastVan = history[0];

    if (lastVan.predict && !lastVan.val.includes(lastVan.predict)) {
        return `${lastVan.predict.toUpperCase()} (Lì BC)`;
    }

    const count = {};
    history.flatMap(i => i.val).forEach(v => {
        count[v] = (count[v] || 0) + 1;
    });

    const pick = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    
    // BC giữ nguyên pattern cũ của m
    await Data.create({
        guildId: gId,
        type: 'bc',
        predict: pick
    });

    return `${pick.toUpperCase()} (Con này ra nhiều nhất gần đây)`;
}

// ==========================================
//               RENDER ALIVE
// ==========================================
const http = require('http');
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot Neko Bip is Online 24/7!');
}).listen(process.env.PORT || 10000);

client.login(process.env.DISCORD_TOKEN);