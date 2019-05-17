const config = require("exp-config");
const request = require("request-promise-native");
const msgIdCardIdMap = {};

//todo: use batch for gets

async function addCard(req, res) {
  const {msgId} = req.params;
  const {routingKey, correlationId, message} = req.body;
  console.log(msgId, req.body);
  const response = await request.post("https://api.trello.com/1/cards", {
    qs: {
      key: config.trello.apiKey,
      token: config.trello.token,
      idList: config.trello.createOnListId,
      name: `DLX ${routingKey}`,
      desc: `**correlationId** \n ${correlationId} \n\n---\n\n **Meddelande** \n \`\`\`${JSON.stringify(
        message
      )}\`\`\``,
      idLabels: config.trello.labelIds
    },
    resolveWithFullResponse: true,
    simple: false,
    json: true
  });
  //console.log(response.statusCode, JSON.stringify(response.body));
  if (response.statusCode === 200) {
    msgIdCardIdMap[msgId] = response.body.id;
  }
  const {shortUrl} = response.body;
  return res.send({shortUrl});
}

async function getCard(msgId, correlationId) {
  console.log(msgIdCardIdMap);
  let id;
  if (msgIdCardIdMap[msgId]) {
    id = msgIdCardIdMap[msgId];
  } else {
    const searchRes = await searchCard(correlationId);
    console.log({searchRes});
    if (searchRes && searchRes.id) {
      id = searchRes.id;
      msgIdCardIdMap[msgId] = id;
    }
  }
  if (!id) return;
  let card = await cardById(id);
  if (card) {
    const {shortUrl, list} = card;
    card = {...card, shortUrl, listName: list && list.name};
  }
  return {...card};
}

async function cardById(id) {
  const response = await request.get(`https://api.trello.com/1/cards/${id}`, {
    qs: {
      key: config.trello.apiKey,
      token: config.trello.token,
      list: true
    },
    resolveWithFullResponse: true,
    simple: false,
    json: true
  });
  //console.log(response.statusCode, JSON.stringify(response.body));
  if (response.statusCode === 200) {
    return response.body;
  }
  return;
}

async function searchCard(correlationId) {
  console.log(correlationId);
  const response = await request.get(`https://api.trello.com/1/search`, {
    qs: {
      key: config.trello.apiKey,
      token: config.trello.token,
      idBoard: config.trello.boardId,
      list: true,
      query: correlationId,
      // eslint-disable-next-line camelcase
      card_fields: "desc"
    },
    resolveWithFullResponse: true,
    simple: false,
    json: true
  });
  console.log(response.statusCode, JSON.stringify(response.body));

  if (response.statusCode === 200 && response.body.cards) {
    return response.body.cards[0];
  }

  return;
}

module.exports = {addCard, getCard};
