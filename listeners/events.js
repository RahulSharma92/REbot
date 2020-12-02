
const logger = require('../common/logger');
const connFactory = require('../util/connection-factory');
const { saveTeamId } = require('../util/refedge');
const { checkTeamMigration } = require('./middleware/migration-filter');

module.exports = controller => {

    controller.on('grid_migration_started', async (ctrl, event) => {

        try {
            let team = await controller.storage.teams.get(event.team_id);

            if (team) {
                team.is_migrating = true;
                controller.storage.teams.save(team);
            }
        } catch (err) {
            logger.log(err);
        }
    });

    controller.on('grid_migration_finished', async (ctrl, event) => {

        try {
            let team = await controller.storage.teams.get(event.team_id);

            if (team) {
                team.is_migrating = false;
                controller.storage.teams.save(team);
            }
        } catch (err) {
            logger.log(err);
        }
    });

    controller.on('app_uninstalled', async (ctrl, event) => {

        try {
            const existingConn = await connFactory.getConnection(event.team_id, controller);
            const channels = await controller.storage.channels.find({ team_id: event.team_id });

            if (channels && channels.length > 0) {
                const delChannelResult = await controller.storage.channels.delete(channels[0].id);
                logger.log('delete channel result:', delChannelResult);
            }

            if (existingConn) {
                let teamData = { removeTeam: event.team_id };
                saveTeamId(existingConn, teamData);
                const revokeResult = await connFactory.revoke({
                    revokeUrl: existingConn.oauth2.revokeServiceUrl,
                    refreshToken: existingConn.refreshToken,
                    teamId: event.team_id
                }, controller);
                logger.log('delete org result:', revokeResult);
            }
            const delTeamResult = await controller.storage.teams.delete(event.team_id);
            logger.log('delete team result:', delTeamResult);
        } catch (err) {
            logger.log(err);
        }
    });

    controller.on('onboard', bot => {

        bot.startPrivateConversation({ user: bot.config.createdBy }, (err, convo) => {

            if (err) {
                logger.log(err);
            } else {
                convo.say('Hello, I\'m REbot. I have joined your workspace.\n'
                + 'I\'m here to help deliver messages from ReferenceEdge to your Customer Reference Program (CRP) team and individual users.\n'
                + 'I have created a public channel for the CRP Team. All updates concerning the Customer Reference Team '
                + 'will be posted in this channel. You should add the members of the Customer Reference Team and me, REbot, '
                + 'to this channel to ensure they receive updates. You can do this by @mentioning them / me, like this: @REbot.'
                + 'To connect your workspace to ReferenceEdge you can type \'connect to a salesforce instance\'.'
                + 'Just message me if you have any other queries.');
            }
        });
    });

    controller.on('create_channel', (auth, bot) => {
        
        bot.api.conversations.create({
            token: auth.access_token,
            name: 'crp_team'
        }, (err, result) => {

            if (err) {
                return logger.log('channel create error:', err);
            }
            const crpTeamChannel = {
                id: result.channel.id,
                name: result.channel.name,
                team_id: auth.identity.team_id
            };
            controller.storage.channels.save(crpTeamChannel, (err, id) => {

                if (err) {
                    logger.log('channel save error:', err);
                }
            });
        });
    });

    controller.on('oauth_success', auth => {
        controller.storage.teams.get(auth.identity.team_id, (err, team) => {
            let isNew = false;

            if (!team) {
                team = {
                    id: auth.identity.team_id,
                    createdBy: auth.identity.user_id,
                    url: auth.identity.url,
                    name: auth.identity.team,
                    is_migrating: false
                };
                isNew = true;
            }

            team.bot = {
                //##old way of getting token
                //token: auth.bot.bot_access_token,
                //user_id: auth.bot.bot_user_id,
                //Add support of oauth v2 
                token: auth.access_token,
                user_id: auth.bot_user_id,
                createdBy: auth.identity.user_id,
                app_token: auth.access_token,
            };
            let botInstance = controller.spawn(team.bot);

            botInstance.api.auth.test({}, (err, botAuth) => {

                if (err) {
                    logger.log('auth error:', err);
                } else {
                    team.bot.name = botAuth.user;
                    botInstance.identity = botAuth;
                    botInstance.team_info = team;

                    controller.storage.teams.save(team, (saveErr, id) => {

                        if (saveErr) {
                            logger.log('team save error:', saveErr);
                        } else {

                            if (isNew) {
                                controller.trigger('create_channel', [auth, botInstance]);
                                controller.trigger('onboard', [botInstance, team]);
                            }
                        }
                    });
                }
            });
        });
    });

    controller.on('post-message', reqBody => {
        console.log('in event js');;
        reqBody.messages.forEach(async msg => {

            try {
                let teamIdsArray = reqBody.teamId.split(',');
                const teams = await controller.storage.teams.find({ id: { $in: teamIdsArray } });

                if (!teams) {
                    return logger.log('team not found for id:', reqBody.teamId);
                }

                for (let index = 0, len = teams.length; index < len; index++) {
                    const isTeamMigrating = await checkTeamMigration(teams[index].id, controller);

                    if (!isTeamMigrating) {
                        const bot = controller.spawn(teams[index].bot);

                        if (msg.userEmail) {

                            bot.api.users.lookupByEmail({
                                token: teams[index].bot.token,
                                email: msg.userEmail
                            }, (err, result) => {

                                if (err) {
                                    return logger.log(err, `team id - ${teams[index].id}`, `user email - ${msg.userEmail}`);
                                }

                                if (!result) {
                                    return logger.log('user not found in team ' + teams[index].id + ' for email:', msg.userEmail);
                                }

                                bot.startPrivateConversation({ user: result.user.id }, (err, convo) => {

                                    if (err) {
                                        logger.log(err);
                                    } else {
                                        convo.say(msg.text);
                                    }
                                });
                            });
                        } else {
                            const channels = await controller.storage.channels.find({ team_id: teams[index].id });

                            if (channels && channels.length > 0) {
                                bot.say({ text: msg.text, channel: channels[0].id });
                            }
                        }
                    } else {
                        logger.log(`cannot post message for team id ${teams[index].id}, this team is in migration `);
                    }
                }
            } catch (err) {
                logger.log(err);
            }
        });
    });
}