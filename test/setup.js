process.env.NODE_ENV = "test";

require("mocha-cakes-2");

require("mocha-cakes-2");

const chai = require("chai");

chai.config.truncateThreshold = 0;
chai.config.includeStack = true;

Object.assign(global, {
  should: chai.should(),
});
