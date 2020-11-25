
/* module.exports = (app, controller) => {

    let authHandler = {
        login: (req, res) => {
            res.redirect(controller.getAuthorizeURL());
        },
        authorize: (req, res) => {
            let code = req.query.code;

            if (!req.query.state) {
                return res.redirect('/auth-failed.html?error=missing_state_param');
            }

            if (process.env.STATE != req.query.state) {
                return res.redirect('/auth-failed.html?error=invalid_state_param');
            }
            let botInstance = controller.spawn({});

            let options = {
                client_id: controller.config.clientId,
                client_secret: controller.config.clientSecret,
                code: code
            };

            botInstance.api.oauth.access(options, (err, auth) => {

                if (err) {
                    res.status(401);
                    return res.redirect('/auth-failed.html');
                }

                botInstance.api.auth.test({ token: auth.access_token }, (err, identity) => {

                    if (err) {
                        res.status(401);
                        return res.redirect('/auth-failed.html');
                    }
                    auth.identity = identity;
                    controller.trigger('oauth_success', [auth]);
                    res.redirect(`https://slack.com/app_redirect?app=${process.env.SLACK_APP_ID}`);
                });
            });
        }
    };
    app.get('/login', authHandler.login);
    app.get('/oauth', authHandler.authorize);
    return authHandler;
} */

module.exports = controller => {

    controller.webserver.get('/login', (req, res) => {
        res.redirect(controller.adapter.getInstallLink());
    });

    controller.webserver.get('/oauth', async (req, res) => {

        try {
            console.log('-----/oauth/req-----');
            console.dir(req);
            if (!req.query.state) {
                return res.redirect('/auth-failed.html?error=missing_state_param');
            }

            if (process.env.STATE != req.query.state) {
                return res.redirect('/auth-failed.html?error=invalid_state_param');
            }
            const authData = await controller.adapter.validateOauthCode(req.query.code);
            console.log('-----/authData/-----')
            console.dir(req.query)
            controller.trigger('oauth_success', authData);
            res.redirect(`https://slack.com/app_redirect?app=${process.env.SLACK_APP_ID}`);
        } catch (err) {
            console.error('OAUTH ERROR: ', err);
            res.status(401);
            return res.redirect('/auth-failed.html');
        }
    });
}