import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js'

export const commands = [
  new SlashCommandBuilder()
    .setName('watch')
    .setDescription('Get pinged when a specific Ascend coin trades')
    .addStringOption(o =>
      o.setName('token')
        .setDescription('Token contract address (0x…)')
        .setRequired(true)
        .setMinLength(42)
        .setMaxLength(42)),

  new SlashCommandBuilder()
    .setName('unwatch')
    .setDescription('Stop watching a coin')
    .addStringOption(o =>
      o.setName('token')
        .setDescription('Token contract address (0x…)')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Show the coins you are watching'),

  new SlashCommandBuilder()
    .setName('pool')
    .setDescription('Show stats for an Ascend coin')
    .addStringOption(o =>
      o.setName('token')
        .setDescription('Token contract address (0x…)')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('recent')
    .setDescription('Show the most recent Ascend launches'),

  new SlashCommandBuilder()
    .setName('top')
    .setDescription('Show the busiest Ascend pools by volume'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Bot and chain status'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('What this bot does and how to use it'),

  new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('Point live alerts at a channel (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel to post alerts in')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('unsubscribe')
    .setDescription('Stop live alerts (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
]
