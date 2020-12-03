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
    scopes: ['channels:join',//To be able to join public channel specially created by ReferenceEdge itself.
        'channels:manage',//To create a public channel for Customer Reference Team when the app is installed.
        'channels:read',//To get the basic information of the channel in which ReferenceEdge is added.
        'incoming-webhook',//To Post Message in CRP team channel
        'team:read',//To read the Id and domain name information for the Workspace
        'users:read',//To read the email address of the users in the Workspace.
        'users:read.email',// To find users based on email address and send messages to them
        'channels:history',// To view messages of the channels in which ReferencEedge is added.
        'im:write', //This is required for having conversation with bot user. Specially when bot starts conversation after app installation.
        'im:history',//This is automatically selected and can not be removed.
        'chat:write'//Bot User does not reply to message with this scope.

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