const Botkit = require('botkit');
const mongoProvider = require('./db/mongo-provider')({
    mongoUri: process.env.MONGO_CONNECTION_STRING
});

const eventListeners = require('./listeners/events');
const basicListener = require('./listeners/basic-ears');
const interactiveListener = require('./listeners/interactive');
const { getFilterMiddleware } = require('./listeners/middleware/migration-filter');

let botCfg = {
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    //update to granular scopes 
    scopes: ['channels:join',
        'channels:manage',
        'channels:read',
        'incoming-webhook',
        'team:read',
        'users:read',
        'users:read.email',
        'users:write', 
        'channels:write',
        'channels:history',
        'im:read',
        'im:write',
        'users.profile:read',
        'im:history',
        'mpim:read', 
        'mpim:write', 
        'groups:read', 
        'groups:write', 
        'groups:history',
        'app_mentions:read',
        'commands'

    ],
    storage: mongoProvider,
    clientSigningSecret: process.env.SLACK_SIGNING_SECRET,
    oauthVersion : 'v2'
};

let controller = Botkit.slackbot(botCfg);
controller.startTicking();
controller.middleware.receive.use(getFilterMiddleware(controller));

eventListeners(controller);
basicListener(controller);
interactiveListener(controller);

module.exports = controller;