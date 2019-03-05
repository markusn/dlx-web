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
const moment = require("moment");
const config = require("exp-config");
const bodyParser = require("body-parser");
const getUuid = require("uuid-by-string");
const initConnection = require("exp-amqp-connection");
const dlxBehavior = Object.assign(
  {
    confirm: true,
    ack: true,
    prefetch: 200,
    resubscribeOnError: true
  },
  config.dlxRabbit
);
const payloadCorrelationId = config.payloadCorrelationId ? config.payloadCorrelationId.split(".") : undefined;

let dlxBroker;
let db = {};
let app;

const dummyLogger = {
  info: (...args) => console.log("info:", ...args),
  error: (...args) => console.log("error:", ...args)
};

let logger = dummyLogger;

function init(customLogger, cb) {
  if (!cb) {
    cb = customLogger;
    customLogger = dummyLogger;
  }
  logger = customLogger;
  dlxBroker = initConnection(dlxBehavior);
  dlxBroker.on("error", (err) => {
    logger.error(`AMQP Error: ${err.toString}`);
  });

  dlxBroker.on("callback_error", (err) => {
    logger.error(`AMQP Error: Error in callback sent to AMQP lib: ${err.message}`);
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
    app.use(router);
    cb(app);
  });
}

function shutdown(cb) {
  dlxBroker.unsubscribeAll(() => {
    db = {};
    app = null;
    dlxBroker = null;
    cb();
  });
}

router.use(express.static("dist"));
router.get("/api/messages", (req, res) => {
  logger.info("get messages", Object.values(db).length);
  res.send({
    messages: Object.values(db).map((x) => x.data)
  });
});

router.post("/api/messages/:id/resend", bodyParser.json(), (req, res) => {
  logger.info("resend", req.params.id, req.body);
  const message = db[req.params.id];
  if (!message) return res.sendStatus(404);
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
      message.notify.ack();
      delete db[req.params.id];
      return res.sendStatus(204);
    }
  );
});

router.post("/api/messages/:id/ignore", (req, res) => {
  logger.info("ignore", req.params.id);
  const message = db[req.params.id];
  if (!message) return res.sendStatus(404);
  message.notify.ack();
  delete db[req.params.id];
  return res.sendStatus(204);
});

function handleMessage(message, meta, notify) {
  const queues = [meta.properties.headers["x-first-death-queue"]];
  const id = getUuid(`${meta.fields.consumerTag}-${meta.fields.deliveryTag}`);
  const routingKey = config.routingKeyHeader
    ? meta.properties.headers[config.routingKeyHeader]
    : meta.fields.routingKey;
  const properties = meta.properties;
  const payload = message;
  let correlationId = meta.properties.correlationId;
  if (payloadCorrelationId && typeof payload === "object") {
    let cand = payload;
    for (const key of payloadCorrelationId) {
      if (!cand) break;
      cand = cand[key];
    }

    if (typeof cand === "string") correlationId = cand;
  }
  logger.info(`got message with id ${id} and body ${JSON.stringify(payload)}`);
  const ts = moment(Math.min(...meta.properties.headers["x-death"].map((x) => x.time.value * 1000))).format(
    "YYYY-MM-DD HH:MM:SS"
  );
  db[id] = {
    notify,
    data: {
      queues,
      id,
      ts,
      routingKey,
      correlationId,
      properties,
      message: payload
    }
  };
}

module.exports = {init, shutdown};