const puppeteer = require("puppeteer");
const config = require("exp-config");
const request = require("request-promise-native");
const initConnection = require("exp-amqp-connection");

const puppeteerOpts = {
  args: ["--disable-features=site-per-process"],
  ignoreHTTPSErrors: true,
  headless: true
  //slowMo: 50
};

const {init, shutdown} = require("../lib/server");

const behavior = Object.assign(
  {
    confirm: true,
    ack: true,
    prefetch: 200
  },
  config.testRabbit
);

Feature("dlx-web", () => {
  let browser;
  let server;
  let url;
  let broker;

  before(async () => {
    browser = await puppeteer.launch(puppeteerOpts);
  });

  before((done) => {
    init((app) => {
      broker = initConnection(behavior);
      server = app.listen((err) => {
        if (err) return done(err);
        url = `http://localhost:${server.address().port}`;
        console.log({url});
        return done();
      });
    });
  });

  after((done) => {
    shutdown(() => {
      broker.deleteQueue(config.dlxQueue);
      done();
    });
  });

  Scenario("sending a message back to the queue", () => {
    const nacked = [];
    const acked = [];
    const keep = [];
    let page;

    before(async () => {
      page = await browser.newPage();
      await page._client.send("Network.clearBrowserCookies");
    });

    Given("that there is a message handler", (done) => {
      broker.subscribeTmp(
        "#",
        (message, meta, notify) => {
          if (message.do === "nack") {
            nacked.push(message);
            return notify.nack(false);
          }
          if (message.do === "ack") {
            acked.push(message);
            return notify.ack();
          }
          return keep.push(message);
        },
        done
      );
    });

    And("that there is a published message which is nacked", (done) => {
      broker.publish("foo", {do: "nack"}, done);
    });

    And("the message is handled by dlx-web", async () => {
      await sleep(500);
      const {messages} = await request.get(`${url}/api/messages`, {json: true});
      messages.length.should.eql(1);
    });

    And("that a user navigates to dlx-web", async () => {
      await page.goto(url, {waitUntil: "domcontentloaded"});
    });

    When("the user edits the message and sends it back to the queue", async () => {
      // bring out the editor
      await page.waitForSelector(".react-bootstrap-table > .table > tbody > tr > td:nth-child(2)");
      await page.click(".react-bootstrap-table > .table > tbody > tr > td:nth-child(2)");
      await page.waitForSelector(".object-content > .variable-row > .click-to-edit > .click-to-edit-icon > svg");
      await page.click(".string-value");
      await page.click(".object-content > .variable-row > .click-to-edit > .click-to-edit-icon > svg");

      // erase nack and write ack
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
      await page.type(".object-content > .variable-row > .variable-value", "ack");
      await page.waitForSelector("div > .edit-check > svg > g > path");
      await page.click("div > .edit-check > svg > g > path");

      // click the checkbox
      await page.waitForSelector(".table > tbody > tr > td > .selection-input-4");
      await page.click(".table > tbody > tr > td > .selection-input-4");

      // click send back to queue
      await page.waitForSelector("#root > div > .btn-toolbar > .btn-group > .btn-primary");
      await page.click("#root > div > .btn-toolbar > .btn-group > .btn-primary");
    });

    Then("the message should have been ack:ed (as it is sent back with do set to ack)", async () => {
      await sleep(1000);
      acked.length.should.eql(1);
      acked[0].do.should.eql("ack");
    });

    And("there should be no messages left", async () => {
      const {messages} = await request.get(`${url}/api/messages`, {json: true});
      messages.length.should.eql(0);
    });

    after((done) => broker.unsubscribeAll(done));
  });

  Scenario("deleting a message", () => {
    const nacked = [];
    const acked = [];
    const keep = [];
    let page;

    before(async () => {
      page = await browser.newPage();
      await page._client.send("Network.clearBrowserCookies");
    });

    Given("that there is a message handler", (done) => {
      broker.subscribeTmp(
        "#",
        (message, meta, notify) => {
          if (message.do === "nack") {
            nacked.push(message);
            return notify.nack(false);
          }
          if (message.do === "ack") {
            acked.push(message);
            return notify.ack();
          }
          return keep.push(message);
        },
        done
      );
    });

    And("that there is a published message which is nacked", (done) => {
      broker.publish("foo", {do: "nack"}, done);
    });

    And("that a user navigates to dlx-web", async () => {
      await page.goto(url, {waitUntil: "domcontentloaded"});
    });

    When("the user marks and deleted the message", async () => {
      // click the checkbox
      await page.waitForSelector(".table > tbody > tr > td > .selection-input-4");
      await page.click(".table > tbody > tr > td > .selection-input-4");

      // click delete
      await page.waitForSelector("#root > div > .btn-toolbar > .btn-group > .btn-secondary");
      await page.click("#root > div > .btn-toolbar > .btn-group > .btn-secondary");
    });

    Then("the message should be gone", async () => {
      await sleep(500);
      const {messages} = await request.get(`${url}/api/messages`, {json: true});
      messages.length.should.eql(0);
    });

    after((done) => broker.unsubscribeAll(done));
  });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
