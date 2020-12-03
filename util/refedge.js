
const connFactory = require('../util/connection-factory');
const logger = require('../common/logger');

module.exports = {
    saveTeamId: (conn, teamData) => {
        conn.apex.post('/refedge/rebot', teamData, (err, res) => {

            if (err) {
                logger.log(err);
            }
        });
    }
};