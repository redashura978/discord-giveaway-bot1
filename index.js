const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, Partials } = require('discord.js');
require('dotenv').config();
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User]
});

const GIVEAWAYS_FILE = 'giveaways.json';
const BONUS_ENTRIES_FILE = 'bonus_entries.json';
let giveaways = {};
let bonusEntries = {};

function loadData() {
  try {
    if (fs.existsSync(GIVEAWAYS_FILE)) {
      const raw = fs.readFileSync(GIVEAWAYS_FILE, 'utf8').trim();
      giveaways = raw ? JSON.parse(raw) : {};
    }
  } catch (err) {
    console.error('Error reading giveaways file, starting with empty state:', err);
    giveaways = {};
  }

  try {
    if (fs.existsSync(BONUS_ENTRIES_FILE)) {
      const raw = fs.readFileSync(BONUS_ENTRIES_FILE, 'utf8').trim();
      bonusEntries = raw ? JSON.parse(raw) : {};
    }
  } catch (err) {
    console.error('Error reading bonus entries file, starting with empty state:', err);
    bonusEntries = {};
  }
}

function saveGiveaways() {
  try {
    fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify(giveaways, null, 2));
  } catch (err) {
    console.error('Error saving giveaways file:', err);
  }
}

function saveBonusEntries() {
  try {
    fs.writeFileSync(BONUS_ENTRIES_FILE, JSON.stringify(bonusEntries, null, 2));
  } catch (err) {
    console.error('Error saving bonus entries file:', err);
  }
}

client.once('ready', () => {
  console.log(`✅ Bot is ready! Logged in as ${client.user.tag}`);
  loadData();
  checkGiveaways();
  setInterval(checkGiveaways, 10_000);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;
  if (!message.guild) return; // ignore DMs

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'gstart') {
    await handleGiveawayStart(message, args);
  } else if (command === 'setbonus' || command === 'setextra') {
    await handleSetBonus(message, args);
  } else if (command === 'listbonus' || command === 'bonuslist') {
    await handleListBonus(message);
  } else if (command === 'removebonus') {
    await handleRemoveBonus(message, args);
  } else if (command === 'ghelp') {
    await handleHelp(message);
  }
});

async function handleGiveawayStart(message, args) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return message.reply('❌ You need the "Manage Server" permission to start giveaways!');
  }
  if (args.length < 3) {
    return message.reply('❌ Usage: `!gstart <duration> <winners> <prize>`\nExample: `!gstart 1h 1 Nitro`');
  }

  const duration = parseDuration(args[0]);
  if (!duration) {
    return message.reply('❌ Invalid duration! Use formats like: 1m, 30m, 1h, 2d');
  }

  const winnerCount = parseInt(args[1], 10);
  if (isNaN(winnerCount) || winnerCount < 1) {
    return message.reply('❌ Winner count must be a positive number!');
  }

  const prize = args.slice(2).join(' ');
  const endTime = Date.now() + duration;
  const guildId = message.guild.id;
  const guildBonusEntries = bonusEntries[guildId] || {};

  let bonusEntriesText = '';
  if (Object.keys(guildBonusEntries).length > 0) {
    bonusEntriesText = '\n**Extra Entries:**\n';
    for (const [roleId, count] of Object.entries(guildBonusEntries)) {
      const role = message.guild.roles.cache.get(roleId);
      if (role) {
        bonusEntriesText += `<@&${roleId}>: **+${count}** ${count === 1 ? 'entry' : 'entries'}\n`;
      }
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎁 ${prize} giveaway 🎁`)
    .setDescription(`→**Ends : ** <t:${Math.floor(endTime / 1000)}:R>\n→**Winners : ** ${winnerCount}\n→**Hosted by : ** ${message.author.tag}\n${bonusEntriesText}\nReact with 🎉 to enter the giveaway!`)
    .setColor('#00FF00')
    .setTimestamp(endTime);

  const giveawayMessage = await message.channel.send({ content: '🎉 **New Giveaway** 🎉', embeds: [embed] });
  await giveawayMessage.react('🎉');

  giveaways[giveawayMessage.id] = {
    messageId: giveawayMessage.id,
    channelId: message.channel.id,
    guildId,
    prize,
    winnerCount,
    endTime,
    hostId: message.author.id,
    ended: false
  };

  saveGiveaways();

  // Attempt to delete the command message for cleanliness (optional)
  message.delete().catch(() => {});
}

async function handleSetBonus(message, args) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return message.reply('❌ You need the "Manage Server" permission to set bonus entries!');
  }
  if (args.length < 2) {
    return message.reply('❌ Usage: `!setbonus <@role> <entries>`\nExample: `!setbonus @VIP 5`');
  }

  const roleId = args[0].replace(/[<@&>]/g, '');
  const role = message.guild.roles.cache.get(roleId);
  if (!role) {
    return message.reply('❌ Invalid role! Please mention a valid role.');
  }

  const entries = parseInt(args[1], 10);
  if (isNaN(entries) || entries < 1) {
    return message.reply('❌ Entries must be a positive number!');
  }

  const guildId = message.guild.id;
  if (!bonusEntries[guildId]) {
    bonusEntries[guildId] = {};
  }
  bonusEntries[guildId][roleId] = entries;
  saveBonusEntries();

  const embed = new EmbedBuilder()
    .setTitle('✅ Bonus Entries Set')
    .setDescription(`<@&${roleId}> will now receive **+${entries}** bonus ${entries === 1 ? 'entry' : 'entries'} in giveaways!`)
    .setColor('#00FF00')
    .setTimestamp();

  message.reply({ embeds: [embed] });
}

async function handleListBonus(message) {
  const guildId = message.guild.id;
  const guildBonusEntries = bonusEntries[guildId] || {};
  if (Object.keys(guildBonusEntries).length === 0) {
    return message.reply('📋 No bonus entries configured for this server.');
  }

  let description = '';
  for (const [roleId, count] of Object.entries(guildBonusEntries)) {
    const role = message.guild.roles.cache.get(roleId);
    if (role) {
      description += `<@&${roleId}>: **+${count}** ${count === 1 ? 'entry' : 'entries'}\n`;
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('📋 Bonus Entries List')
    .setDescription(description || 'No valid roles found.')
    .setColor('#0099FF')
    .setTimestamp();

  message.reply({ embeds: [embed] });
}

async function handleRemoveBonus(message, args) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return message.reply('❌ You need the "Manage Server" permission to remove bonus entries!');
  }
  if (args.length < 1) {
    return message.reply('❌ Usage: `!removebonus <@role>`\nExample: `!removebonus @VIP`');
  }

  const roleId = args[0].replace(/[<@&>]/g, '');
  const guildId = message.guild.id;
  if (!bonusEntries[guildId] || !bonusEntries[guildId][roleId]) {
    return message.reply('❌ This role does not have any bonus entries set!');
  }
  delete bonusEntries[guildId][roleId];
  saveBonusEntries();
  message.reply('✅ Bonus entries removed for that role!');
}

async function handleHelp(message) {
  const embed = new EmbedBuilder()
    .setTitle('📖 Giveaway Bot Commands')
    .setDescription('Here are all available commands:')
    .addFields(
      { name: '!gstart <duration> <winners> <prize>', value: 'Start a giveaway\nExample: `!gstart 1h 1 Discord Nitro`', inline: false },
      { name: '!setbonus <@role> <entries>', value: 'Set bonus entries for a role\nExample: `!setbonus @VIP 5`', inline: false },
      { name: '!listbonus', value: 'List all bonus entries for this server', inline: false },
      { name: '!removebonus <@role>', value: 'Remove bonus entries for a role\nExample: `!removebonus @VIP`', inline: false },
      { name: '!ghelp', value: 'Show this help message', inline: false }
    )
    .setColor('#9B59B6')
    .setFooter({ text: 'Manage Server permission required for most commands' })
    .setTimestamp();

  message.reply({ embeds: [embed] });
}

async function checkGiveaways() {
  const now = Date.now();
  for (const [messageId, giveaway] of Object.entries(giveaways)) {
    if (giveaway.ended || giveaway.endTime > now) continue;
    // endGiveaway handles marking ended and saving
    await endGiveaway(messageId, giveaway);
  }
}

async function endGiveaway(messageId, giveaway) {
  try {
    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
    if (!channel || !channel.isText()) {
      console.warn(`Channel ${giveaway.channelId} not available; marking giveaway ended.`);
      giveaway.ended = true;
      saveGiveaways();
      return;
    }

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) {
      console.warn(`Message ${messageId} not found in channel ${giveaway.channelId}; marking giveaway ended.`);
      giveaway.ended = true;
      saveGiveaways();
      return;
    }

    // Fetch reaction (handle partials)
    const reaction = message.reactions.cache.get('🎉') || (await message.reactions.fetch()).get('🎉');
    if (!reaction) {
      const embed = new EmbedBuilder()
        .setTitle(`🎁 ${giveaway.prize} giveaway 🎁`)
        .setDescription(`→**Ended:** <t:${Math.floor(giveaway.endTime / 1000)}:R>\n→**Winner:** No valid participants\n→**Participants:** 0\n\nThis giveaway has ended!`)
        .setColor('#00FF00')
        .setTimestamp();
      await message.edit({ content: '🎉 **Giveaway Ended** 🎉', embeds: [embed] }).catch(() => {});
      giveaway.ended = true;
      saveGiveaways();
      return;
    }

    const users = await reaction.users.fetch();
    const participants = users.filter(u => !u.bot);

    if (participants.size === 0) {
      const embed = new EmbedBuilder()
        .setTitle(`🎁 ${giveaway.prize} giveaway 🎁`)
        .setDescription(`→**Ended:** <t:${Math.floor(giveaway.endTime / 1000)}:R>\n→**Winner:** No valid participants\n→**Participants:** 0\n\nThis giveaway has ended!`)
        .setColor('#00FF00')
        .setTimestamp();
      await message.edit({ content: '🎉 **Giveaway Ended** 🎉', embeds: [embed] }).catch(() => {});
      giveaway.ended = true;
      saveGiveaways();
      return;
    }

    const guildBonusEntries = bonusEntries[giveaway.guildId] || {};
    const entriesMap = new Map();

    // participants is a Collection (id -> User). Use .entries() to get [id, user]
    for (const [userId, user] of participants.entries()) {
      let entries = 1;
      try {
        const member = await message.guild.members.fetch(userId).catch(() => null);
        if (member) {
          for (const [roleId, bonusCount] of Object.entries(guildBonusEntries)) {
            if (member.roles.cache.has(roleId)) {
              entries += bonusCount;
            }
          }
        }
      } catch (err) {
        console.log(`Could not fetch member ${userId}`, err);
      }
      entriesMap.set(userId, entries);
    }

    // Build weighted pool
    const entryPool = [];
    for (const [userId, entries] of entriesMap.entries()) {
      for (let i = 0; i < entries; i++) entryPool.push(userId);
    }

    // Choose winners without duplication
    const winners = [];
    const winnerIds = new Set();
    for (let i = 0; i < giveaway.winnerCount && entryPool.length > 0; i++) {
      let attempts = 0;
      let winnerId;
      do {
        const randomIndex = Math.floor(Math.random() * entryPool.length);
        winnerId = entryPool[randomIndex];
        attempts++;
      } while (winnerIds.has(winnerId) && attempts < 200);

      if (!winnerIds.has(winnerId)) {
        winnerIds.add(winnerId);
        winners.push(winnerId);
      } else {
        // If we couldn't find a unique winner after many attempts, break
        break;
      }
    }

    const winnersText = winners.length ? winners.map(id => `<@${id}>`).join(', ') : 'No valid winners';
    const embed = new EmbedBuilder()
      .setTitle(`🎁 ${giveaway.prize} giveaway 🎁`)
      .setDescription(`→**Ended:** <t:${Math.floor(giveaway.endTime / 1000)}:R>\n→**${winners.length > 1 ? 'Winners' : 'Winner'}:** ${winnersText}\n→**Participants:** ${participants.size}\n\nThis giveaway has ended!`)
      .setColor('#00FF00')
      .setTimestamp();

    await message.edit({ content: '🎉 **Giveaway Ended** 🎉', embeds: [embed] }).catch(() => {});
    if (winners.length) await channel.send(`🎊 Congratulations ${winnersText}! You won ${giveaway.prize}`).catch(() => {});

    giveaway.ended = true;
    saveGiveaways();
  } catch (error) {
    console.error('Error ending giveaway:', error);
    // Mark as ended to avoid retry loops if something unexpected happened
    giveaway.ended = true;
    saveGiveaways();
  }
}

function parseDuration(str) {
  const regex = /^(\d+)([smhd])$/;
  const match = str.match(regex);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };
  return value * multipliers[unit];
}

// Use DISCORD_TOKEN (matches many examples). Set this in your .env file.
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN not found in environment variables!');
  process.exit(1);
}

client.login(token).catch(err => {
  console.error('Failed to login:', err);
  process.exit(1);
});
