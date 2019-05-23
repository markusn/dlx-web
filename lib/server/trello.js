const {trello} = require("exp-config");
const {apiKey, token, boardId, createOnListId, labelIds} = trello || {};
const request = require("request-promise-native").defaults({
  resolveWithFullResponse: true,
  simple: false,
  json: true,
  qs: {
    key: apiKey,
    token: token
  }
});

const msgIdCardIdMap = {};

async function getCards(messages) {
  const withTrello = [];
  await Promise.all(
    messages.map(async (msg) => {
      const trelloCard = await getCard(msg.id, msg.correlationId);
      withTrello.push({...msg, trello: {...trelloCard, msg}});
    })
  );
  return withTrello.sort((a, b) => new Date(a.ts) - new Date(b.ts));
}

async function addCard(msgId, body) {
  const {routingKey, correlationId, message} = body;
  const response = await request.post("https://api.trello.com/1/cards", {
    qs: {
      idList: createOnListId,
      name: `DLX ${routingKey}`,
      desc: `**correlationId** \n ${correlationId} \n\n---\n\n **Meddelande** \n \`\`\`${JSON.stringify(
        message
      )}\`\`\``,
      idLabels: labelIds
    }
  });
  if (response.statusCode === 200) {
    msgIdCardIdMap[msgId] = response.body.id;
  }
  const {shortUrl} = response.body;
  return {shortUrl};
}

async function getCard(msgId, correlationId) {
  let card;
  if (msgIdCardIdMap[msgId]) {
    card = await cardById(msgIdCardIdMap[msgId]);
  } else {
    const searchRes = await searchCard(correlationId);
    if (searchRes && searchRes.id) {
      msgIdCardIdMap[msgId] = searchRes.id;
      card = searchRes;
    }
  }
  if (card) {
    const {shortUrl, list, members} = card;
    card = {...card, shortUrl, listName: list && list.name, members: (members || []).map((m) => m.initials).join(", ")};
  }
  return {...card};
}

async function cardById(id) {
  const response = await request.get(`https://api.trello.com/1/cards/${id}`, {
    qs: {
      fields: "shortUrl",
      list: true,
      members: true,
      // eslint-disable-next-line camelcase
      member_fields: "initials"
    }
  });
  if (response.statusCode === 200) {
    return response.body;
  }
  return;
}

async function searchCard(correlationId) {
  const response = await request.get(`https://api.trello.com/1/search`, {
    qs: {
      idBoard: boardId,
      list: true,
      query: correlationId,
      // eslint-disable-next-line camelcase
      card_fields: "desc,shortUrl",
      // eslint-disable-next-line camelcase
      card_list: true,
      // eslint-disable-next-line camelcase
      card_members: true
    }
  });
  if (response.statusCode === 200 && response.body.cards) {
    return response.body.cards[0];
  }

  return;
}

module.exports = {addCard, getCards};
