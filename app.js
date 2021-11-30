const { init, shutdown } = require("./lib/server/index");
const logger = require("./lib/server/dummy-logger");

if (require.main === module) {
  init(logger, (app) => {
    app.listen(process.env.PORT || 3000, () => {
      logger.info(`Listening on port ${process.env.PORT || 3000}!`);
    });
  });
}

module.exports = { init, shutdown };
