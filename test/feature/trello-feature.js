const nock = require("nock");
const config = require("exp-config");
const trello = require("../../lib/server/trello");

Feature("Trello", () => {
  beforeEachScenario(() => {
    nock.disableNetConnect();
    nock.cleanAll();
  });
  Scenario("Get cards for messages", () => {
    const message = {id: "some-id", correlationId: "some-correlation-id"};
    Given("we can find card by correlationId in trello", () => {
      nock("https://api.trello.com")
        .get("/1/search")
        .times(2)
        .query({
          key: config.trello.apiKey,
          token: config.trello.token,
          idBoard: config.trello.boardId,
          list: true,
          query: message.correlationId,
          // eslint-disable-next-line camelcase
          card_fields: "desc,shortUrl",
          // eslint-disable-next-line camelcase
          card_list: true,
          // eslint-disable-next-line camelcase
          card_members: true
        })
        .reply(200, {
          cards: [
            {
              id: "some-trello-id",
              shortUrl: "http://some-short-url",
              list: {name: "some-list-name"}
            }
          ]
        });
    });

    And("we can get card by id from trello", () => {
      nock("https://api.trello.com")
        .get("/1/cards/some-trello-id")
        .times(1)
        .query({
          key: config.trello.apiKey,
          token: config.trello.token,
          fields: "shortUrl",
          list: true,
          members: true,
          // eslint-disable-next-line camelcase
          member_fields: "initials"
        })
        .reply(200, {
          id: "some-trello-id",
          shortUrl: "http://some-short-url",
          list: {name: "some-list-name"}
        });
    });

    let withTrello;
    When("getting cards for messages", async () => {
      withTrello = await trello.getCards([message]);
    });

    Then("the message should have a trello card", () => {
      withTrello[0].should.have.property("trello");
    });

    And("the trello card should have listName and shortUrl", () => {
      withTrello[0].trello.should.have.property("shortUrl", "http://some-short-url");
      withTrello[0].trello.should.have.property("listName", "some-list-name");
    });

    Given("getting cards for message again", async () => {
      withTrello = await trello.getCards([message]);
    });

    Then("no search should have been made", () => {
      const pendingMocks = nock.pendingMocks();
      pendingMocks.length.should.eql(1);
      pendingMocks[0].should.contain("search");
    });
  });

  Scenario("Add card", () => {
    const message = {
      id: "some-id",
      correlationId: "some-correlation-id-2",
      routingKey: "some-routing-key",
      message: {foo: "bar"}
    };

    Given("we can create new card in trello", () => {
      nock("https://api.trello.com")
        .post("/1/cards")
        .times(1)
        .query({
          key: config.trello.apiKey,
          token: config.trello.token,
          idList: config.trello.createOnListId,
          name: `DLX ${message.routingKey} (${message.correlationId.substr(message.correlationId.length - 5)})`,
          desc: `**correlationId** \n ${message.correlationId} \n\n---\n\n **Meddelande** \n \`\`\`${JSON.stringify(
            message.message
          )}\`\`\``,
          idLabels: config.trello.labelIds
        })
        .reply(200, {id: "some-trello-id-2", shortUrl: "http://some-short-url"});
    });

    let card;
    When("adding card", async () => {
      card = await trello.addCard(message.id, message);
    });

    Then("the card should have been posted to trello", () => {
      nock.pendingMocks().length.should.eql(0);
    });

    And("the card should have a shortUrl property", () => {
      card.should.have.property("shortUrl", "http://some-short-url");
    });

    And("some persons are assigned to the created trello card", () => {});

    Given("we can get the created card by id from trello", () => {
      nock("https://api.trello.com")
        .get("/1/cards/some-trello-id-2")
        .times(2)
        .query({
          key: config.trello.apiKey,
          token: config.trello.token,
          fields: "shortUrl",
          list: true,
          members: true,
          // eslint-disable-next-line camelcase
          member_fields: "initials"
        })
        .reply(200, {
          id: "some-trello-id-2",
          shortUrl: "http://some-short-url",
          list: {name: "some-list-name"},
          members: [{id: "some-member-id", initials: "AA"}, {id: "some-member-id-2", initials: "BB"}]
        });
    });

    let withTrello;
    When("getting cards for messages", async () => {
      withTrello = await trello.getCards([message]);
    });

    Then("the message should have a trello card", () => {
      withTrello[0].should.have.property("trello");
    });

    And("the trello card should have members", () => {
      withTrello[0].trello.should.have.property("members", "AA, BB");
    });
  });
});
