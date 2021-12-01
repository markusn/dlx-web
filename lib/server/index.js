/**
 * @author Markus Ekholm
 * @copyright 2019 (c) Markus Ekholm <markus at botten dot org >
 * @license Copyright (c) 2019, Markus Ekholm
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *    * Redistributions of source code must retain the above copyright
 *      notice, this list of conditions and the following disclaimer.
 *    * Redistributions in binary form must reproduce the above copyright
 *      notice, this list of conditions and the following disclaimer in the
 *      documentation and/or other materials provided with the distribution.
 *    * Neither the name of the author nor the
 *      names of its contributors may be used to endorse or promote products
 *      derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL MARKUS EKHOLM BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

const async = require("async");
const express = require("express");
const router = express.Router(); // eslint-disable-line new-cap
const { DateTime } = require("luxon");
const config = require("exp-config");
const bodyParser = require("body-parser");
const getUuid = require("uuid-by-string");
const basicAuth = require("basic-auth-connect");
const initConnection = require("exp-amqp-connection");
const trello = require("./trello");
const stringify = require("json-stable-stringify");
const dummyLogger = require("./dummy-logger");
const dlxBehavior = Object.assign(
  {
    confirm: true,
    ack: true,
    prefetch: 500,
    resubscribeOnError: false,
  },
  config.dlxRabbit,
);
const envName = process.env.NODE_ENV || "development";
const html = `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <title>DLX Web (${envName.toUpperCase()})</title>
</head>

<body>
<div id="root"></div>
<script type="application/javascript">
window.config = ${JSON.stringify(
    Object.assign(config.clientConfig || {}, {
      trello: config.trello ? true : false,
      editRoutingKey: config.routingKeyHeader ? true : false,
    }),
    null,
    2,
  )};
window.envName = "${envName}";
</script>
<script type="text/javascript" src="bundle.js">
</script>
</body>

</html>`;

const payloadCorrelationId = config.payloadCorrelationId ? config.payloadCorrelationId.split(".") : undefined;

let dlxBroker;
let db = {};
let app;

let logger = dummyLogger;

function init(customLogger, cb) {
  if (!cb) {
    cb = customLogger;
    customLogger = dummyLogger;
  }
  logger = customLogger;
  dlxBroker = initConnection(dlxBehavior);
  dlxBroker.on("error", (err) => {
    logger.error(`AMQP Error: ${err.message}`);
    logger.info("Exiting due to AMQP error, to recover state");
    process.exit(1); // eslint-disable-line no-process-exit
  });

  dlxBroker.on("callback_error", (err) => {
    logger.error(`AMQP Error: Error in callback sent to AMQP lib: ${err.message}`);
    logger.info("Exiting due to AMQP error, to recover state");
    process.exit(1); // eslint-disable-line no-process-exit
  });

  dlxBroker.on("blocked", (reason) => {
    logger.error(`AMQP BLOCKED: Cannot publish messages because ${reason}`);
  });

  dlxBroker.on("connected", () => {
    logger.info(`Connected to AMQP server: ${JSON.stringify(config.dlxRabbit)}`);
  });

  dlxBroker.on("subscribed", (subscription) => {
    db = {}; // clear db on subscription started (i.e. make it work when reconnecting)
    logger.info(`Subscription started: ${JSON.stringify(subscription)}`);
  });

  dlxBroker.subscribe("#", config.dlxQueue, handleMessage, () => {
    app = express();
    app.disable("x-powered-by");
    app.use(router);
    cb(app);
  });
}

function shutdown(cb) {
  if (!dlxBroker) {
    db = {};
    app = null;
    return cb();
  }
  return dlxBroker.unsubscribeAll(() => {
    db = {};
    app = null;
    dlxBroker = null;
    cb();
  });
}

if (config.basicAuth) router.use(basicAuth(config.basicAuth.username, config.basicAuth.password));

router.use(express.static("dist"));

router.get("/api/messages", async (req, res) => {
  const messages = Object.values(db).map((x) => x.data);
  logger.info("get messages", messages.length);

  if (!config.trello) {
    return res.send({
      messages,
    });
  }

  const messagesWithTrello = await trello.getCards(messages, logger);

  return res.send({ messages: messagesWithTrello });
});

router.post("/api/messages/:id/resend", bodyParser.json(), (req, res) => {
  logger.info("resend", req.params.id, req.body);
  const message = db[req.params.id];
  if (!message) return res.sendStatus(404);
  if (message.state !== "new") {
    logger.error(`Tried to resend message ${req.params.id} that is already being resent`);
    return res.sendStatus(400);
  }
  message.state = "resending";

  if (config.routingKeyHeader && req.query.routingKey) {
    const routingKey = req.query.routingKey;
    logger.info(`setting routing key header to ${routingKey}`);
    message.data.properties.headers[config.routingKeyHeader] = routingKey;
  }

  return async.each(
    message.data.queues,
    (queue, cb) => {
      dlxBroker.sendToQueue(queue, req.body, message.data.properties, (err) => {
        if (err) return cb(err);
        return cb();
      });
    },
    (err) => {
      if (err) {
        logger.err("err", err);
        return res.sendStatus(500);
      }
      logger.info(`Resent ${JSON.stringify(db[req.params.id].data)} to ${message.data.queues.join(",")}`);
      message.notify.ack();
      delete db[req.params.id];
      logger.info(`Deleted ${req.params.id} from internal db as it has been removed`);
      return res.sendStatus(204);
    },
  );
});

router.post("/api/messages/:id/delete", (req, res) => {
  logger.info("delete", req.params.id);
  const message = db[req.params.id];
  if (!message) return res.sendStatus(404);
  if (message.state !== "new") {
    logger.error(`Tried to delete message ${req.params.id} that is already being resent`);
    res.sendStatus(400);
  }
  message.notify.ack();
  delete db[req.params.id];
  logger.info(`Deleted message ${JSON.stringify(message.data)}`);
  return res.sendStatus(204);
});

if (config.trello) {
  router.post("/api/trello/:msgId", bodyParser.json(), async (req, res) => {
    const { msgId } = req.params;
    const card = await trello.addCard(msgId, req.body, logger);
    return res.send(card);
  });
}

router.use("/", (req, res) => {
  res.send(html);
});

function handleMessage(message, meta, notify) {
  const queues = [ meta.properties.headers["x-first-death-queue"] ];

  const id = getUuid(`${meta.fields.consumerTag}-${meta.fields.deliveryTag}`);
  const routingKey =
    (config.routingKeyHeader && meta.properties.headers[config.routingKeyHeader]) || meta.fields.routingKey;
  const properties = meta.properties;
  const payload = message;
  const hash = getUuid(stringify({ payload, message, routingKey }));
  const existingMessage = Object.values(db).find((x) => x.hash === hash);
  if (existingMessage) {
    logger.error(`Found existing message (id: ${existingMessage.id}) with the same hash ${hash}`);
    if (config.terminateOnDuplicateMessage) {
      logger.info("Exiting due to duplicate message to recover state");
      process.exit(1); // eslint-disable-line no-process-exit
    }
  }
  let correlationId = meta.properties.correlationId;
  if (payloadCorrelationId && typeof payload === "object") {
    let cand = payload;
    for (const key of payloadCorrelationId) {
      if (!cand) break;
      cand = cand[key];
    }

    if (typeof cand === "string") correlationId = cand;
  }
  logger.info(`got message with id ${id} and body ${JSON.stringify(payload)}, correlationId: ${correlationId}`);
  const ts = DateTime.fromMillis(Math.min(...(meta.properties.headers["x-death"] || []).map((x) => x.time.value * 1000))).toFormat(
    "yyyy-MM-dd HH:mm:ss",
  );
  db[id] = {
    id,
    notify,
    state: "new",
    hash,
    data: {
      queues,
      id,
      ts,
      routingKey,
      correlationId,
      properties,
      message: payload,
    },
  };
}

module.exports = { init, shutdown };
