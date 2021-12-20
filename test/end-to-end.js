const nock = require("nock");
const puppeteer = require("puppeteer");
const config = require("exp-config");
const axios = require("axios");
const initConnection = require("exp-amqp-connection");
const uuid = require("uuid");

const puppeteerOpts = {
  args: [ "--disable-features=site-per-process" ],
  ignoreHTTPSErrors: true,
  headless: true,
  // slowMo: 50
};

const { init, shutdown } = require("../lib/server");

const behavior = Object.assign(
  {
    confirm: true,
    ack: true,
    prefetch: 200,
  },
  config.testRabbit,
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
    const correlationId = uuid.v4();

    before(async () => {
      page = await browser.newPage();
      await page._client.send("Network.clearBrowserCookies");
    });

    Given("no messages are on the DLX", async () => {
      await clearMessages(url);
    });

    And("that there is a message handler", (done) => {
      broker.subscribeTmp(
        "#",
        (message, meta, notify) => {
          if (message.do === "nack") {
            nacked.push({ message, meta });
            return notify.nack(false);
          }
          if (message.do === "ack") {
            acked.push({ message, meta });
            return notify.ack();
          }
          return keep.push({ message, meta });
        },
        done,
      );
    });

    And("that there is a published message which is nacked", (done) => {
      broker.publish("foo", { do: "nack" }, { correlationId }, done);
    });

    And("no trello card found for correlationId", () => {
      nock("https://api.trello.com")
        .filteringPath(() => {
          return "/1/search";
        })
        .get("/1/search")
        .times(100)
        .query(true)
        .reply(200, { cards: [] });
    });

    And("the message is handled by dlx-web", async () => {
      await sleep(500);
      const { data: { messages } } = await axios.get(`${url}/api/messages`);
      messages.length.should.eql(1);
    });

    And("that a user navigates to dlx-web", async () => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    });

    When("the user edits the message and sends it back to the queue", async () => {
      // bring out the editor
      await page.waitForSelector(".table > tbody > tr > td:nth-child(2)");
      await page.click(".table > tbody > tr > td:nth-child(2)");
      await page.waitForSelector(".object-content > .variable-row > .click-to-edit > .click-to-edit-icon > svg");
      await page.click(".string-value");
      await page.click(".object-content > .variable-row > .click-to-edit > .click-to-edit-icon > svg");

      // erase nack and write ack
      await page.waitForSelector("textarea");
      await page.click("textarea");
      await page.keyboard.press("End");
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
      acked[0].message.do.should.eql("ack");
      acked[0].meta.properties.headers["x-routing-key"].should.eql("foo");
    });

    And("there should be no messages left", async () => {
      const { data: { messages } } = await axios.get(`${url}/api/messages`);
      messages.length.should.eql(0);
    });

    after((done) => broker.unsubscribeAll(done));
  });

  Scenario("sending a message back to the queue failure, no queue", () => {
    let page;
    const correlationId = uuid.v4();

    before(async () => {
      page = await browser.newPage();
      await page._client.send("Network.clearBrowserCookies");
    });

    Given("no messages are on the DLX", async () => {
      await clearMessages(url);
    });

    And("that there is a published message directly to the dlx queue", (done) => {
      broker.sendToQueue(config.dlxQueue, { do: "nack" }, { correlationId }, done);
    });

    And("no trello card found for correlationId", () => {
      nock("https://api.trello.com")
        .filteringPath(() => {
          return "/1/search";
        })
        .get("/1/search")
        .times(100)
        .query(true)
        .reply(200, { cards: [] });
    });

    And("the message is handled by dlx-web", async () => {
      await sleep(1000);
      const { data: { messages } } = await axios.get(`${url}/api/messages`);
      messages.length.should.eql(1);
    });

    And("that a user navigates to dlx-web", async () => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    });

    When("the user edits the message and tries to send it back to the queue", async () => {
      // bring out the editor
      await page.waitForSelector(".table > tbody > tr > td:nth-child(2)");
      await page.click(".table > tbody > tr > td:nth-child(2)");
      await page.waitForSelector(".object-content > .variable-row > .click-to-edit > .click-to-edit-icon > svg");
      await page.click(".string-value");
      await page.click(".object-content > .variable-row > .click-to-edit > .click-to-edit-icon > svg");

      // erase nack and write ack
      await page.waitForSelector("textarea");
      await page.click("textarea");
      await page.keyboard.press("End");
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

    Then("the message should not have been ack:ed as there is no queue to send back to", async () => {
      await sleep(1000);
      const { data: { messages } } = await axios.get(`${url}/api/messages`);
      messages.length.should.eql(1);
    });

    after((done) => broker.unsubscribeAll(done));
  });

  Scenario("sending a message back to the queue with a different routing key", () => {
    const nacked = [];
    const acked = [];
    const keep = [];
    let page;
    const correlationId = uuid.v4();

    before(async () => {
      page = await browser.newPage();
      await page._client.send("Network.clearBrowserCookies");
    });

    Given("no messages are on the DLX", async () => {
      await clearMessages(url);
    });

    And("that there is a message handler", (done) => {
      broker.subscribeTmp(
        "#",
        (message, meta, notify) => {
          const routingKey = meta.properties.headers[config.routingKeyHeader] || meta.fields.routingKey;
          if (routingKey === "ack") {
            acked.push({ message, meta });
            return notify.ack();
          }
          if (routingKey === "nack") {
            nacked.push({ message, meta });
            return notify.nack(false);
          }
          return keep.push({ message, meta });
        },
        done,
      );
    });

    And("that there is a published message which is nacked", (done) => {
      broker.publish("nack", { foo: "bar" }, { correlationId }, done);
    });

    And("no trello card found for correlationId", () => {
      nock("https://api.trello.com")
        .filteringPath(() => {
          return "/1/search";
        })
        .get("/1/search")
        .times(100)
        .query(true)
        .reply(200, { cards: [] });
    });

    And("the message is handled by dlx-web", async () => {
      await sleep(500);
      const { data: { messages } } = await axios.get(`${url}/api/messages`);
      messages.length.should.eql(1);
    });

    And("that a user navigates to dlx-web", async () => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    });

    When("the user edits the message routing key sends it back to the queue", async () => {
      // bring out the editor
      const selector = await page.waitForSelector(".table > tbody > tr > td:nth-child(4)");
      await selector.click({ clickCount: 2 });

      // erase nack and write ack
      await page.keyboard.press("End");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
      await page.keyboard.type("ack");
      await page.keyboard.press("Enter");

      // click the checkbox
      await page.waitForSelector(".table > tbody > tr > td > .selection-input-4");
      await page.click(".table > tbody > tr > td > .selection-input-4");

      // click send back to queue
      await page.waitForSelector("#root > div > .btn-toolbar > .btn-group > .btn-primary");
      await page.click("#root > div > .btn-toolbar > .btn-group > .btn-primary");
    });

    Then("the message should have been ack:ed (as it is sent back with its' routing key set to ack)", async () => {
      await sleep(1000);
      acked.length.should.eql(1);
      acked[0].message.foo.should.eql("bar");
      acked[0].meta.properties.headers["x-routing-key"].should.eql("ack");
    });

    And("the nacked message should have the expected routing key", () => {
      nacked.length.should.eql(1);
      nacked[0].message.foo.should.eql("bar");
      nacked[0].meta.fields.routingKey.should.eql("nack");
    });

    And("there should be no messages left", async () => {
      const { data: { messages } } = await axios.get(`${url}/api/messages`);
      messages.length.should.eql(0);
    });

    after((done) => broker.unsubscribeAll(done));
  });

  Scenario("deleting a message", () => {
    const nacked = [];
    const acked = [];
    const keep = [];
    let page;
    const correlationId = uuid.v4();

    before(async () => {
      page = await browser.newPage();
      await page._client.send("Network.clearBrowserCookies");
    });

    Given("no messages are on the DLX", async () => {
      await clearMessages(url);
    });

    And("that there is a message handler", (done) => {
      broker.subscribeTmp(
        "#",
        (message, meta, notify) => {
          if (message.do === "nack") {
            nacked.push({ message, meta });
            return notify.nack(false);
          }
          if (message.do === "ack") {
            acked.push({ message, meta });
            return notify.ack();
          }
          return keep.push({ message, meta });
        },
        done,
      );
    });

    And("that there is a published message which is nacked", (done) => {
      broker.publish("foo", { do: "nack" }, { correlationId }, done);
    });

    And("no trello card found for correlationId", () => {
      nock("https://api.trello.com")
        .filteringPath(() => {
          return "/1/search";
        })
        .get("/1/search")
        .times(100)
        .query(true)
        .reply(200, { cards: [] });
    });

    And("that a user navigates to dlx-web", async () => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    });

    When("the user marks and deleted the message", async () => {
      // click the checkbox
      await page.waitForSelector(".table > tbody > tr > td > .selection-input-4");
      await page.click(".table > tbody > tr > td > .selection-input-4");
      // click delete
      await page.waitForSelector("#root > div > .btn-toolbar > .btn-group > .btn-danger");
      await page.click("#root > div > .btn-toolbar > .btn-group > .btn-danger");
    });

    Then("the message should be gone", async () => {
      await sleep(500);
      const { data: { messages } } = await axios.get(`${url}/api/messages`);
      messages.length.should.eql(0);
    });

    after((done) => broker.unsubscribeAll(done));
  });

  Scenario("filtering and deleting message", () => {
    const nacked = [];
    const acked = [];
    const keep = [];
    let page;
    const correlationId = uuid.v4();
    const correlationId2 = uuid.v4();

    before(async () => {
      page = await browser.newPage();
      await page._client.send("Network.clearBrowserCookies");
    });

    Given("no messages are on the DLX", async () => {
      await clearMessages(url);
    });

    And("that there is a message handler", (done) => {
      broker.subscribeTmp(
        "#",
        (message, meta, notify) => {
          if (message.do === "nack") {
            nacked.push({ message, meta });
            return notify.nack(false);
          }
          if (message.do === "ack") {
            acked.push({ message, meta });
            return notify.ack();
          }
          return keep.push({ message, meta });
        },
        done,
      );
    });

    And("that there two messages published message which are nacked", (done) => {
      broker.publish("foo", { do: "nack", correlationId }, { correlationId }, () => {
        broker.publish("bar", { do: "nack", correlationId: correlationId2 }, { correlationId2 }, done);
      });
    });

    And("no trello card found for correlationId", () => {
      nock("https://api.trello.com")
        .filteringPath(() => {
          return "/1/search";
        })
        .get("/1/search")
        .times(100)
        .query(true)
        .reply(200, { cards: [] });
    });

    And("that a user navigates to dlx-web", async () => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    });

    When("the user filters messages on routing key foo, marks all and deletes", async () => {
      await page.waitForSelector(".text-filter");
      await page.click(".text-filter");
      await page.keyboard.type("foo");
      await page.keyboard.press("Enter");
      await sleep(500);
      // select all
      await page.click("#root > div > div:nth-child(2) > table > thead > tr > th:nth-child(1) > input");
      // click delete
      await page.waitForSelector("#root > div > .btn-toolbar > .btn-group > .btn-danger");
      await page.click("#root > div > .btn-toolbar > .btn-group > .btn-danger");
    });

    Then("the foo message should be gone", async () => {
      await sleep(500);
      const { data: { messages } } = await axios.get(`${url}/api/messages`);
      messages.length.should.eql(1);
      const msg = messages[0];
      msg.routingKey.should.eql("bar");
      msg.message.correlationId.should.eql(correlationId2);
    });

    after((done) => broker.unsubscribeAll(done));
  });

  Scenario("message correlationId should be a clickable link", () => {
    const nacked = [];
    const acked = [];
    const keep = [];
    let page;
    const correlationId = uuid.v4();

    before(async () => {
      page = await browser.newPage();
      await page._client.send("Network.clearBrowserCookies");
    });

    Given("no messages are on the DLX", async () => {
      await clearMessages(url);
    });

    And("that there is a message handler", (done) => {
      broker.subscribeTmp(
        "#",
        (message, meta, notify) => {
          if (message.do === "nack") {
            nacked.push({ message, meta });
            return notify.nack(false);
          }
          if (message.do === "ack") {
            acked.push({ message, meta });
            return notify.ack();
          }
          return keep.push({ message, meta });
        },
        done,
      );
    });

    And("that there is a published message which is nacked", (done) => {
      broker.publish("foo", { do: "nack" }, { correlationId }, done);
    });

    And("no trello card found for correlationId", () => {
      nock("https://api.trello.com")
        .filteringPath(() => {
          return "/1/search";
        })
        .get("/1/search")
        .times(100)
        .query(true)
        .reply(200, { cards: [] });
    });

    And("the message is handled by dlx-web", async () => {
      await sleep(500);
      const { data: { messages } } = await axios.get(`${url}/api/messages`);
      messages.length.should.eql(1);
    });

    When("that a user navigates to dlx-web", async () => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    });

    Then("the correlation id should be a clickable link", async () => {
      await page.waitForSelector(".table a");
      const hrefs = await page.$$eval(".table a", (as) =>
        as.map((a) => {
          return { href: a.href, target: a.target };
        }),
      );
      hrefs.length.should.eql(1, await page.evaluate(() => document.body.innerHTML));
      hrefs[0].href.should.eql(
        `${config.clientConfig.correlationIdUrlPrefix}${correlationId}${config.clientConfig.correlationIdUrlSuffix}`,
      );
      hrefs[0].target.should.eql("_blank");
    });

    after(async () => {
      // click the checkbox
      await page.waitForSelector(".table > tbody > tr > td > .selection-input-4");
      await page.click(".table > tbody > tr > td > .selection-input-4");
      // click delete
      await page.waitForSelector("#root > div > .btn-toolbar > .btn-group > .btn-danger");
      await page.click("#root > div > .btn-toolbar > .btn-group > .btn-danger");
    });

    after((done) => {
      broker.unsubscribeAll(done);
    });
  });

  Scenario("extra configured column should display text from message", () => {
    const nacked = [];
    const acked = [];
    const keep = [];
    let page;
    const correlationId = uuid.v4();

    before(async () => {
      page = await browser.newPage();
      await page._client.send("Network.clearBrowserCookies");
    });

    Given("no messages are on the DLX", async () => {
      await clearMessages(url);
    });

    And("that there is a message handler", (done) => {
      broker.subscribeTmp(
        "#",
        (message, meta, notify) => {
          if (message.do === "nack") {
            nacked.push({ message, meta });
            return notify.nack(false);
          }
          if (message.do === "ack") {
            acked.push({ message, meta });
            return notify.ack();
          }
          return keep.push({ message, meta });
        },
        done,
      );
    });

    And("that there is a published message which is nacked", (done) => {
      broker.publish("foo", { do: "nack", errors: "some error" }, { correlationId }, done);
    });

    And("no trello card found for correlationId", () => {
      nock("https://api.trello.com")
        .filteringPath(() => {
          return "/1/search";
        })
        .get("/1/search")
        .times(100)
        .query(true)
        .reply(200, { cards: [] });
    });

    And("the message is handled by dlx-web", async () => {
      await sleep(500);
      const { data: { messages } } = await axios.get(`${url}/api/messages`);
      messages.length.should.eql(1);
    });

    When("that a user navigates to dlx-web", async () => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    });

    Then("the configured column should be present", async () => {
      await page.waitForSelector("th");
      const headings = await page.$$eval("th", (ths) =>
        ths.map((th) => {
          return { text: th.textContent };
        }),
      );

      headings.pop().text.should.eql("Error");

      await page.waitForSelector("tr td");
      const rowTexts = await page.$$eval("tr td", (trs) =>
        trs.map((tr) => {
          return { text: tr.textContent };
        }),
      );
      rowTexts.pop().text.should.eql('"some error"');
    });

    after(async () => {
      // click the checkbox
      await page.waitForSelector(".table > tbody > tr > td > .selection-input-4");
      await page.click(".table > tbody > tr > td > .selection-input-4");
      // click delete
      await page.waitForSelector("#root > div > .btn-toolbar > .btn-group > .btn-danger");
      await page.click("#root > div > .btn-toolbar > .btn-group > .btn-danger");
    });

    after((done) => {
      broker.unsubscribeAll(done);
    });
  });

  Scenario("configured header links should be displayed", () => {
    let page;

    before(async () => {
      page = await browser.newPage();
      await page._client.send("Network.clearBrowserCookies");
    });

    When("a user navigates to dlx-web", async () => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    });

    Then("the configured header links should be present", async () => {
      await page.waitForSelector(".d-flex a");
      const links = await page.$$eval(".d-flex a", (link) =>
        link.map((l) => {
          return { text: l.textContent, href: l.href, target: l.target };
        }),
      );

      links.length.should.eql(2, await page.evaluate(() => document.body.innerHTML));

      links.should.eql(
        [
          { text: "Some cool wiki", href: "https://google.com/", target: "blank" },
          { text: "Some other link", href: "https://stackoverflow.com/", target: "blank" },
        ],
        JSON.stringify(links),
      );
    });

    after((done) => {
      broker.unsubscribeAll(done);
    });
  });
});

async function clearMessages(url) {
  const { data: { messages } } = await axios.get(`${url}/api/messages`);
  await Promise.all(
    messages.map(async (msg) => {
      await axios.post(`${url}/api/messages/${msg.id}/delete`);
    }),
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
