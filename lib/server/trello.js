const config = require("exp-config");
const request = require("request-promise-native");
const correlationIdTrelloIdMap = {};

async function addCard(req, res) {
  const correlationId = req.params.correlationId;
  const response = await request.post("https://api.trello.com/1/cards", {
    qs: {
      key: config.trello.apiKey,
      token: config.trello.token,
      idList: config.trello.createOnListId,
      name: `DLX ${correlationId}`,
      idLabels: config.trello.labelIds
    },
    resolveWithFullResponse: true,
    simple: false,
    json: true
  });
  console.log(response.statusCode, JSON.stringify(response.body));
  if (response.statusCode === 200) {
    correlationIdTrelloIdMap[correlationId] = response.body.id;
  }
  const {shortUrl} = response.body;
  return res.send({shortUrl});
}

async function getCard(correlationId) {
  let id;
  if (correlationIdTrelloIdMap[correlationId]) {
    id = correlationIdTrelloIdMap[correlationId];
  } else {
    const searchRes = await searchCard(correlationId);
    if (searchRes && searchRes.id) {
      id = searchRes.id;
    }
  }
  if (!id) return {correlationId};
  let card = await cardById(id);
  if (card) {
    const {shortUrl, list} = card;
    card = {...card, shortUrl, listName: list && list.name};
  }
  return {...card, correlationId};
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
  console.log(response.statusCode, JSON.stringify(response.body));
  if (response.statusCode === 200) {
    return response.body;
  }
  return;
}

async function searchCard(correlationId) {
  const response = await request.get(`https://api.trello.com/1/search`, {
    qs: {
      key: config.trello.apiKey,
      token: config.trello.token,
      list: true,
      query: correlationId
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
