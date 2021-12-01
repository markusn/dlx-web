const dummyLogger = require("./dummy-logger");
const { trello } = require("exp-config");
const axios = require("axios");

const { apiKey, token, boardId, createOnListId, labelIds } = trello || {};
const msgIdCardIdMap = {};

async function getCards(messages, logger = dummyLogger) {
  const withTrello = [];
  await Promise.all(
    messages.map(async (msg) => {
      const trelloCard = await getCard(msg.id, msg.correlationId, logger);
      withTrello.push({ ...msg, trello: { ...trelloCard, msg } });
    }),
  );
  return withTrello.sort((a, b) => new Date(a.ts) - new Date(b.ts));
}

async function addCard(msgId, body, logger = dummyLogger) {
  const { routingKey, correlationId, message } = body;
  try {
    const { data: result } = await axios.request({
      url: "https://api.trello.com/1/cards",
      method: "post",
      params: {
        key: apiKey,
        token,
        idList: createOnListId,
        name: `DLX ${routingKey} (#${correlationId.substr(correlationId.length - 5)})`,
        desc: `**correlationId** \n ${correlationId} \n\n---\n\n **Meddelande** \n \`\`\`${JSON.stringify(
          message,
        )}\`\`\``,
        idLabels: labelIds,
      },
    });

    logger.info(`Response from trello create card: ${JSON.stringify(body)}`);
    msgIdCardIdMap[msgId] = result.id;
    const { shortUrl } = result;
    return { shortUrl };
  } catch (err) {
    logger.error(`Unexpected response for create trello card  ${err.response.status}, ${JSON.stringify(err.response.data)}`);
    return;
  }
}

async function getCard(msgId, correlationId, logger = dummyLogger) {
  let card;
  if (msgIdCardIdMap[msgId]) {
    card = await cardById(msgIdCardIdMap[msgId], logger);
  } else {
    const searchRes = await searchCard(correlationId, logger);
    if (searchRes && searchRes.id) {
      msgIdCardIdMap[msgId] = searchRes.id;
      card = searchRes;
    }
  }
  if (card) {
    const { shortUrl, list, members } = card;
    card = { ...card, shortUrl, listName: list && list.name, members: (members || []).map((m) => m.initials).join(", ") };
  }
  return { ...card };
}

async function cardById(id, logger = dummyLogger) {
  try {
    const { data: body } = await axios.request({
      url: `https://api.trello.com/1/cards/${id}`,
      method: "get",
      params: {
        key: apiKey,
        token,
        fields: "shortUrl",
        list: true,
        members: true,
        // eslint-disable-next-line camelcase
        member_fields: "initials",
      },
    });
    logger.info(`Response from trello card by id ${id}: ${JSON.stringify(body)}`);
    return body;
  } catch (err) {
    logger.error(`Unexpected response for get card by id ${err.response.status}, ${JSON.stringify(err.response.data)}`);
    return;
  }
}

async function searchCard(correlationId, logger = dummyLogger) {
  try {
    const { data: body } = await axios.request({
      url: "https://api.trello.com/1/search", method: "get", params: {
        key: apiKey,
        token,
        idBoard: boardId,
        list: true,
        query: correlationId,
        // eslint-disable-next-line camelcase
        card_fields: "desc,shortUrl",
        // eslint-disable-next-line camelcase
        card_list: true,
        // eslint-disable-next-line camelcase
        card_members: true,
      },
    });
    if (body.cards) {
      logger.info(`Response from trello search with query ${correlationId} ${JSON.stringify(body)}`);
      return body.cards[0];
    }
  } catch (err) {
    logger.error(`Unexpected response for trello search ${err.response.status}, ${JSON.stringify(err.response.data)}`);
  }
  return;
}

module.exports = { addCard, getCards };
