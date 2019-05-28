const dummyLogger = {
  info: (...args) => console.log("info:", ...args),
  error: (...args) => console.log("error:", ...args)
};

module.exports = dummyLogger;
