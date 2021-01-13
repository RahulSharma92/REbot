const connFactory = require('../util/connection-factory');
const logger = require('../common/logger');

const { getRefTypes, getOpp, getOppfromName, getOppfromAcc, saveTeamId} = require('../util/refedge');

const { checkTeamMigration } = require('../listeners/middleware/migration-filter');

module.exports = controller => {

    controller.on('direct_message,direct_mention', 
    async (bot, message) => {

        try {
            console.log('------direct mention---');
            const supportUrl = `https://www.point-of-reference.com/contact/`;

            if (message.text.includes('hello')) {
                bot.replyEphemeral(message, `Hi, you can invite me to the channel for Customer Reference Team to receive updates!`);
            } else if (message.text == 'connect to a salesforce instance' || message.intent === 'connect_to_sf') {
                let existingConn = await connFactory.getConnection(message.team, controller);

                if (!existingConn) {
                    const authUrl = connFactory.getAuthUrl(message.team);
                    bot.replyEphemeral(message, `click this link to connect\n<${authUrl}|Connect to Salesforce>`);
                }else {
                        /* await controller.plugins.database.orgs.delete(message.team);
                        const authUrl = connFactory.getAuthUrl(message.team);
                        await bot.reply(message, `click this link to connect\n<${authUrl}|Connect to Salesforce>`); */
                        await bot.beginDialog('sf_auth');
                 }
            } else if (message.text.includes('help')) {
                bot.replyEphemeral(message, 
                `Hello, Referencebot here. I can help you find customer references, and deliver messages related to your customer reference requests. \n`
                +`Use the /references command to start a search for reference accounts or reference content. \n`
                + `Are you an administrator? I can connect you to a Salesforce instance.
                    Just type "connect to a Salesforce instance" to get started.\n
                    Please visit the <${supportUrl}|support page> if you have any further questions.`);
            } else {
                bot.replyEphemeral(message, `Sorry, I didn't understand that.`);
            }
        } catch (err) {
            logger.log(err);
        }
    });

    controller.on('post-message', reqBody => {

        reqBody.messages.forEach(async msg => {

            try {
                let teamIdsArray = reqBody.teamId.split(',');
                const teams = await controller.plugins.database.teams.find({ id: { $in: teamIdsArray } });

                if (!teams) {
                    return logger.log('team not found for id:', reqBody.teamId);
                }

                for (let index = 0, len = teams.length; index < len; index++) {
                    const isTeamMigrating = await checkTeamMigration(teams[index].id, controller);

                    if (!isTeamMigrating) {
                        const bot = await controller.spawn(teams[index].id);

                        if (msg.userEmail) {
                            const userData = await bot.api.users.lookupByEmail({
                                token: teams[index].bot.token,
                                email: msg.userEmail
                            });

                            if (!userData || !userData.user) {
                                    return logger.log('user not found in team ' + teams[index].id + ' for email:', msg.userEmail);
                                }
                            await bot.startPrivateConversation(userData.user.id);
                            await bot.say(msg.text);
                                    } else {
                            const channels = await controller.plugins.database.channels.find({ team_id: teams[index].id });

                            if (channels && channels.length > 0) {
                                await bot.startConversationInChannel(channels[0].id);
                                await bot.say(msg.text);
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

    controller.on('app_home_opened', async (bot, event) =>{
        console.log('----------App-home-opened---------');
        console.log('event channel', event.channel);
        console.log('bot information');
        console.dir(bot);
        try {
            // Call the conversations.history method.
            const result = await bot.api.conversations.history({
                channel: event.channel
            });
            
            let conversationHistory = result.messages;
            console.log('----------messages----------------');
            
            if (conversationHistory.length <= 0) {
                const support_page = 'https://www.point-of-reference.com/contact/';
                await bot.say(`Hello, I'm Referencebot. I'm here to assist you with finding customer references, and to help deliver messages related to your reference requests from ReferenceEdge to you. \n`
                + `Use the /references command to request reference accounts or reference content. \n` 
                + `Are you an administrator? I can connect you to a Salesforce instance. Just type 'connect to a Salesforce instance' to get started.\n`
                +`Please visit the <${support_page}|support page> if you have any further questions.`
                );
            }
        }catch (error) {
            console.log('--error in app home opened event--');
            console.error(error);
        }
        
    });

    controller.on('app_uninstalled', async (ctrl, event) => {

        try {
        	const channels = await controller.plugins.database.channels.find({ team_id: event.team });

            if (channels && channels.length > 0) {
                await controller.plugins.database.channels.delete(channels[0].id);
            }
            //controller.plugins.database.teams.delete(event.team_id); uncomment it if any issue.
            const existingConn = await connFactory.getConnection(event.team, controller);
            if (existingConn) {
                let teamData = { removeTeam: event.team };
                saveTeamId(existingConn, teamData);
                const revokeResult = await connFactory.revoke({
                    revokeUrl: existingConn.oauth2.revokeServiceUrl,
                    refreshToken: existingConn.refreshToken,
                    teamId: event.team
                }, controller);
                logger.log('delete org result:', revokeResult);
            }
            const deletion_result = await controller.plugins.database.teams.delete(event.team);
            console.log('deletion result------');
            console.dir(deletion_result);
        } catch (err) {
            console.log('error occured during uninstall...');
        	logger.log(err);
        }
    });

    controller.on('oauth_success', async authData => {
        console.log('******************-----/oauth_success/-----******************');
        console.log('-----/authData/-----')
        console.dir(authData)
        
        try {
            let existingTeam = await controller.plugins.database.teams.get(authData.team.id);

            let isNew = false;

            if (!existingTeam) {
                isNew = true;
                existingTeam = {
                    id: authData.team.id,
                    name: authData.team.name,
                    is_migrating: false
                };
            }else{
                console.log('found existing team...');
            }
            existingTeam.bot = {
                token : authData.access_token,
                user_id : authData.bot_user_id,
                created_by: authData.authed_user.id
            };
            const savedTeam = await controller.plugins.database.teams.save(existingTeam);
            const teamData = await controller.plugins.database.teams.get(existingTeam.id);
            console.log('@@@@@team data after saving team data', teamData);
            console.log('saved team');
            console.dir(savedTeam);
			if (isNew) {
                let bot = await controller.spawn(authData.team.id);
                controller.trigger('create_channel', bot, authData);
            }
        } catch (err) {
            console.log('-------error-----------');
            console.log(err);
        }
    });

    controller.on('onboard', async (bot, params) => {
        const internal_url = 'slack://channel?team='+ params.teamId +'&id='+ params.channelId;
        const support_page = 'https://www.point-of-reference.com/contact/';
        console.log('internal_url', internal_url);

        await bot.startPrivateConversation(params.userId);
        await bot.say(`Hello, Referencebot here. I have joined your workspace. I deliver messages from ReferenceEdge to your Customer Reference Program (CRP) team and individual users, and assist users with finding customer references.\n`
                + `I have created a public channel with the name <${internal_url}|crp_team> for the CRP Team. All updates for the CRP Team will be posted in this channel. `
                + `You should add the members of the Customer Reference Team to this channel to ensure they receive these updates. `
                + `You can do this by selecting the crp_team channel then clicking the add people icon. `
                + `To connect your workspace to ReferenceEdge you can type "connect to a salesforce instance". `
                + `Please visit the <${support_page}|support page> if you have any further questions.`);
    });

    controller.on('create_channel', async (bot, authData) => {
        console.log('******************-----/create_channel/-----******************');
        try {
            let result = await bot.api.conversations.create({
                token: authData.access_token,
                name: 'crp_team'
            });

            const crpTeamChannel = {
                id: result.channel.id,
                name: result.channel.name,
                team_id: authData.team.id
            };
            console.log('-----/crpTeamChannel/-----');
            const savedData = await controller.plugins.database.channels.save(crpTeamChannel);
            console.log('savedData', savedData);
            
            const params = {
                userId : authData.authed_user.id,
                channelId : crpTeamChannel.id,
                teamId : crpTeamChannel.team_id
            };
            controller.trigger('onboard', bot, params);

        } catch (err) {
            console.log('error setting up crp_team channel:', err);
        }
    });

    controller.on(
        'slash_command',
        async (bot, message) => {
            try {
                console.log('slash_command');
                console.dir(message);
                if(message.text && message.text.toLowerCase()  == 'help'){
                    await bot.replyEphemeral(message,
                        `This command allows you to start a search for customer reference resources, without being in Salesforce.\n`
                        + `You’ll be taken to the Reference Search page where you can refine your search, request the use of an account, and, if enabled, share content.`
                    );
                }else{
                    let existingConn = await connFactory.getConnection(message.team, controller);
                    
                    if (existingConn) {
                        const userProfile = await bot.api.users.info({
                            token : bot.api.token,
                            user : message.user
                        });
                        console.log('.......userprofile ....', userProfile);
                        console.log(userProfile.user.profile.email);
                        
                        const result = await bot.api.views.open({
                            trigger_id: message.trigger_id,
                            view: {
                                "type": "modal",
                                "notify_on_close" : true,
                                "callback_id" : "actionSelectionView",
                                "private_metadata" : userProfile.user.profile.email,
                                "title": {
                                    "type": "plain_text",
                                    "text": "Reference Assistant",
                                    "emoji": true
                                },
                                "submit": {
                                    "type": "plain_text",
                                    "text": "Next",
                                    "emoji": true
                                },
                                "close": {
                                    "type": "plain_text",
                                    "text": "Cancel",
                                    "emoji": true
                                },
                                
                                "blocks": [
                                    {
                                        "type": "input",
                                        "block_id": "accblock",
                                        "element": {
                                            "type": "radio_buttons",
                                            "action_id": "searchid",
                                            "options": [
                                                {
                                                    "value": "account_search",
                                                    "text": {
                                                        "type": "plain_text",
                                                        "text": "Reference Account(s)"
                                                    }
                                                },
                                                {
                                                    "value": "content_search",
                                                    "text": {
                                                        "type": "plain_text",
                                                        "text": "Reference Content"
                                                    }
                                                },
                                                {
                                                    "value": "both",
                                                    "text": {
                                                        "type": "plain_text",
                                                        "text": "Both"
                                                    }
                                                }
                                            ]
                                        },
                                        "label": {
                                            "type": "plain_text",
                                            "text": "What do you need?",
                                            "emoji": true
                                        }
                                    }
                                ]
                            }
                            
                        });
                        console.log('open view');
                        
                    } else if (!existingConn) {
                        const authUrl = connFactory.getAuthUrl(message.team);
                        await bot.replyEphemeral(message, `click this link to connect\n<${authUrl}|Connect to Salesforce>`);
                    }
                }
            } catch (err) {
                logger.log(err);
            }
        }
    );
    
    controller.on(
        'view_closed',
        async (bot, message) => {
            console.log('-----------view_closed message -----------');
            bot.httpBody({
                "response_action": "clear"
            });
            
            console.dir(message);
    });

    controller.on(
        'view_submission',
        async (bot, message) => {
            console.log('view_submission');
            console.dir(message);
            try {
                let existingConn = await connFactory.getConnection(message.team.id, controller);
                
                if (!existingConn) {
                    const authUrl = connFactory.getAuthUrl(message.team);
                    await bot.replyEphemeral(message, `click this link to connect\n<${authUrl}|Connect to Salesforce>`);
                } else {
                    
                    // When Account Name entered
                    if (message.view.callback_id == 'actionSelectionView') {
                        let actionName = 'account_search';
                        actionName = message.view.state.values.accblock.searchid.selected_option.value;
                        let email = message.view.private_metadata + '::' + actionName;
                        let mapval = await getRefTypes(existingConn,actionName);
                        if (actionName == 'content_search') {
                            bot.httpBody({
                                response_action: 'update',
                                view: {
                                    "type": "modal",
                                    "notify_on_close" : true,
                                    "callback_id": "oppselect",
                                    "private_metadata" : email,
                                    "submit": {
                                        "type": "plain_text",
                                        "text": "Next",
                                        "emoji": true
                                    },
                                    "title": {
                                        "type": "plain_text",
                                        "text": "Content Type",
                                        "emoji": true
                                    },
                                    "blocks": [
                                        {
                                            "type": "input",
                                            "optional" : true,
                                            "block_id": "blkref",
                                            "element": {
                                                "type": "static_select",
                                                "action_id": "reftype_select",
                                                "placeholder": {
                                                    "type": "plain_text",
                                                    "text": "Select a type",
                                                    "emoji": true
                                                },
                                                "options": mapval
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": "What type of content do you need?",
                                                "emoji": true
                                            }
                                        }
                                    ]
                                }
                            });
                        } else {
                            bot.httpBody({
                                response_action: 'update',
                                view: {
                                    "type": "modal",
                                    "notify_on_close" : true,
                                    "callback_id": "oppselect",
                                    "private_metadata" : email,
                                    "submit": {
                                        "type": "plain_text",
                                        "text": "Next",
                                        "emoji": true
                                    },
                                    "title": {
                                        "type": "plain_text",
                                        "text": "Referenceability Type",
                                        "emoji": true
                                    },
                                    "blocks": [
                                        {
                                            "type": "input",
                                            "block_id": "blkref",
                                            "element": {
                                                "type": "static_select",
                                                "action_id": "reftype_select",
                                                "placeholder": {
                                                    "type": "plain_text",
                                                    "text": "Select a type",
                                                    "emoji": true
                                                },
                                                "options": mapval
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": "What type of reference do you need?",
                                                "emoji": true
                                            }
                                        }
                                    ]
                                }
                            });
                        }
                    } else if (message.view.callback_id == 'oppselect') {
                        let metdata = message.view.private_metadata;
                        const email = metdata.split('::')[0];
                        let refselected = message.view.state.values.blkref.reftype_select.selected_option != null ? message.view.state.values.blkref.reftype_select.selected_option : 'NONE';
                        refselected = refselected && refselected != 'NONE' && refselected != '' && refselected != null ? (refselected.value.indexOf('::') > -1 ? refselected.value.split('::')[1] : refselected.value) : '';
                        const actionName = metdata.split('::')[1];
                        let mapval = await getOpp(existingConn,email,actionName);
                        let searchURL = mapval['searchURL'];
                        let opps = mapval['opp'];
                        if (opps != null && opps.length > 0 && opps.length < 11) {
                            bot.httpBody({
                                response_action: 'update',
                                view: {
                                    "type": "modal",
                                    "notify_on_close" : true,
                                    "callback_id": "searchselect",
                                    "private_metadata" : searchURL + '::' + refselected,
                                    "submit": {
                                        "type": "plain_text",
                                        "text": "Next",
                                        "emoji": true
                                    },
                                    "title": {
                                        "type": "plain_text",
                                        "text": "Select an Opportunity",
                                        "emoji": true
                                    },
                                    "blocks": [
                                        {
                                            "type": "input",
                                            "block_id": "blkselectopp",
                                            "element": {
                                                "type": "static_select",
                                                "action_id": "opp_select",
                                                "placeholder": {
                                                    "type": "plain_text",
                                                    "text": "Select an Opp",
                                                    "emoji": true
                                                },
                                                "options": opps
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": "Recent Opportunities",
                                                "emoji": true
                                            }
                                        }
                                    ]
                                }
                            });
                        } else if (opps != null && opps.length >= 11) {
                            bot.httpBody({
                                response_action: 'update',
                                view: {
                                    "type": "modal",
                                    "notify_on_close" : true,
                                    "callback_id": "searchselectopplarge",
                                    "private_metadata" : searchURL + '::' + refselected + '::' + email,
                                    "submit": {
                                        "type": "plain_text",
                                        "text": "Next",
                                        "emoji": true
                                    },
                                    "title": {
                                        "type": "plain_text",
                                        "text": "Select an Opportunity",
                                        "emoji": true
                                    },
                                    "blocks": [
                                        {
                                            "type": "section",
                                            "text": {
                                                "type": "plain_text",
                                                "text": "•Select from the 10 most recently accessed opportunities.\n•Or lookup an opportunity by name or account.",
                                            }
                                        },
                                        {
                                            "type": "input",
                                            "optional": true,
                                            "block_id": "blkselectopp",
                                            "element": {
                                                "type": "static_select",
                                                "action_id": "opp_select",
                                                "placeholder": {
                                                    "type": "plain_text",
                                                    "text": "Select",
                                                    "emoji": true
                                                },
                                                "options": opps
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": "Recent Opportunities",
                                                "emoji": true
                                            }
                                        },
                                        {
                                            "type": "section",
                                            "text": {
                                                "type": "mrkdwn",
                                                "text": "*OR*"
                                            }
                                        },
                                        {
                                            "type": "input",
                                            "optional": true,
                                            "block_id" : "accblock",
                                            "element": {
                                                "type": "plain_text_input",
                                                "action_id": "account_name",
                                                "placeholder": {
                                                    "type": "plain_text",
                                                    "text": "Type account"
                                                },
                                                "multiline": false
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": "Account Lookup",
                                                "emoji": true
                                            }
                                        },
                                        {
                                            "type": "section",
                                            "text": {
                                                "type": "mrkdwn",
                                                "text": "*OR*"
                                            }
                                        },
                                        {
                                            "type": "input",
                                            "optional": true,
                                            "block_id" : "oppblock",
                                            "element": {
                                                "type": "plain_text_input",
                                                "action_id": "opp_name",
                                                "placeholder": {
                                                    "type": "plain_text",
                                                    "text": "Type opportunity"
                                                },
                                                "multiline": false
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": "Opportunity Lookup",
                                                "emoji": true
                                            }
                                        }
                                    ]
                                }
                            });
                        } else {
                            if (refselected && refselected != 'NONE' && refselected != '' && refselected != null) {
                                searchURL += '&type=' + refselected;
                            }
                            searchURL = 'Thanks! Please <' + searchURL + '|click to complete your request in Salesforce.>';
                            bot.httpBody({
                                response_action: 'update',
                                view: {
                                    "type": "modal",
                                    "notify_on_close" : true,
                                    "close": {
                                        "type": "plain_text",
                                        "text": "Close",
                                        "emoji": true
                                    },
                                    "title": {
                                        "type": "plain_text",
                                        "text": "Continue Search",
                                        "emoji": true
                                    },
                                    "blocks": [
                                        {
                                            "type": "section",
                                            "text": {
                                                "type": "mrkdwn",
                                                "text": searchURL
                                            }
                                        }
                                    ]
                                }
                            });
                        }
                    } else if (message.view.callback_id == 'searchselectopplarge') {
                        let metadata = message.view.private_metadata;
                        let searchURL = metadata.split('::')[0];
                        const refselected = metadata.split('::')[1];
                        const email = metadata.split('::')[2];
                        let oppSelected = message.view.state.values.blkselectopp != null && message.view.state.values.blkselectopp.opp_select.selected_option != null ? message.view.state.values.blkselectopp.opp_select.selected_option.value : '';
                        let acctext = message.view.state.values.accblock != null && message.view.state.values.accblock.account_name.value != null ? message.view.state.values.accblock.account_name.value : '';
                        let opptext = message.view.state.values.oppblock != null && message.view.state.values.oppblock.opp_name.value != null ? message.view.state.values.oppblock.opp_name.value : '';
                        let opps = [];
                        if (oppSelected != '') {
                            searchURL = searchURL.replace('@@',oppSelected);
                            if (refselected && refselected != 'NONE' && refselected != '' && refselected != null) {
                                searchURL += '&type=';
                                searchURL += refselected;
                            }
                            searchURL = 'Thanks! Please <' + searchURL + '|click to complete your request in Salesforce.>';
                            bot.httpBody({
                            response_action: 'update',
                            view: {
                                "type": "modal",
                                "notify_on_close" : true,
                                "close": {
                                    "type": "plain_text",
                                    "text": "Close",
                                    "emoji": true
                                },
                                "title": {
                                    "type": "plain_text",
                                    "text": "Continue Search",
                                    "emoji": true
                                },
                                "blocks": [
                                    {
                                        "type": "section",
                                        "text": {
                                            "type": "mrkdwn",
                                            "text": searchURL
                                        }
                                    }
                                ]
                            }
                        });
                        } else if (oppSelected == '' && acctext == '' && opptext == '') {
                            bot.httpBody({
                                response_action: 'errors',
                                errors: {
                                    "oppblock": 'Please provide Opportunity information.'
                                }
                            });
                        } else if (acctext != '' && opptext != '') {
                            bot.httpBody({
                                response_action: 'errors',
                                errors: {
                                    "oppblock": 'Please enter Account Name OR Opportunity name;'
                                }
                            });
                        } else if (acctext != '' && opptext == '') {
                            opps = await getOppfromAcc(existingConn,email,acctext);
                            if (opps == null || opps.length == 0) {
                                bot.httpBody({
                                    response_action: 'errors',
                                    errors: {
                                        "accblock": 'No Opportunity matching the Opportunity Account Name found.Please retry.'
                                    }
                                });
                            } 
                        } else if (acctext == '' && opptext != '') {
                            opps = await getOppfromName(existingConn,email,opptext);
                            if (opps == null || opps.length == 0) {
                                bot.httpBody({
                                    response_action: 'errors',
                                    errors: {
                                        "oppblock": 'No Opportunity matching the Opportunity Name found.Please retry.'
                                    }
                                });
                            }
                        } 
                        if (opps != null && opps.length > 0) {
                            bot.httpBody({
                                response_action: 'update',
                                view: {
                                    "type": "modal",
                                    "notify_on_close" : true,
                                    "callback_id": "searchselect",
                                    "private_metadata" : searchURL + '::' + refselected,
                                    "submit": {
                                        "type": "plain_text",
                                        "text": "Next",
                                        "emoji": true
                                    },
                                    "title": {
                                        "type": "plain_text",
                                        "text": "Select an Opportunity",
                                        "emoji": true
                                    },
                                    "blocks": [
                                        {
                                            "type": "input",
                                            "block_id": "blkselectoppFinal",
                                            "element": {
                                                "type": "static_select",
                                                "action_id": "opp_select",
                                                "placeholder": {
                                                    "type": "plain_text",
                                                    "text": "Select",
                                                    "emoji": true
                                                },
                                                "options": opps
                                            },
                                            "label": {
                                                "type": "plain_text",
                                                "text": "Recent Opportunities",
                                                "emoji": true
                                            }
                                        }
                                    ]
                                }
                            });
                        } 
                    } else if (message.view.callback_id == 'searchselect') {
                        let metadata = message.view.private_metadata;
                        const refselected = metadata.split('::')[1];
                        let oppSelected = message.view.state.values.blkselectopp != null ? message.view.state.values.blkselectopp.opp_select.selected_option.value :
                                            (message.view.state.values.blkselectoppFinal != null ? message.view.state.values.blkselectoppFinal.opp_select.selected_option.value : '');
                        let searchURL = metadata.split('::')[0];
                        searchURL = searchURL.replace('@@',oppSelected);
                        if (refselected && refselected != 'NONE' && refselected != '' && refselected != null) {
                            searchURL += '&type=';
                            searchURL += refselected;
                        }
                        searchURL = 'Thanks! Please <' + searchURL + '|click to complete your request in Salesforce.>';
                        bot.httpBody({
                            response_action: 'update',
                            view: {
                                "type": "modal",
                                "notify_on_close" : true,
                                "close": {
                                    "type": "plain_text",
                                    "text": "Close",
                                    "emoji": true
                                },
                                "title": {
                                    "type": "plain_text",
                                    "text": "Continue Search",
                                    "emoji": true
                                },
                                "blocks": [
                                    {
                                        "type": "section",
                                        "text": {
                                            "type": "mrkdwn",
                                            "text": searchURL
                                        }
                                    }
                                ]
                            }
                        });
                    }
                }
            } catch (err) {
                logger.log(err);
            }
        }
    );

}