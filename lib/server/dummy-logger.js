const dummyLogger = {
  // eslint-disable-next-line no-console
  info: (...args) => console.log("info:", ...args),
  // eslint-disable-next-line no-console
  error: (...args) => console.log("error:", ...args),
};

module.exports = dummyLogger;
