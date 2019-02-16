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

"use strict";
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

let dlxBroker;
let db = {};
let app;

function init(cb) {
  dlxBroker = initConnection(dlxBehavior);
  dlxBroker.on("error", err => {
    console.error("error", err);
  });

  dlxBroker.on("callback_error", err => {
    console.error(
      `AMQP Error: Error in callback sent to AMQP lib: ${err.message}`
    );
  });

  dlxBroker.on("connected", () => {
    console.log(`Connected to AMQP server: ${JSON.stringify(config.dlxRabbit)}`);
  });

  dlxBroker.on("subscribed", subscription => {
    console.log(`Subscription started: ${JSON.stringify(subscription)}`);
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
  console.log("get messages", Object.values(db).length);
  res.send({
    messages: Object.values(db).map(x => x.data)
  });
});

router.post("/api/messages/:id/resend", bodyParser.json(), (req, res) => {
  console.log("resend", req.params.id, req.body);
  const message = db[req.params.id];
  if (!message) return res.sendStatus(404);
  return async.each(
    message.data.queues,
    (queue, cb) => {
      dlxBroker.sendToQueue(queue, req.body, message.properties, err => {
        if (err) return cb(err);
        return cb();
      });
    },
    err => {
      if (err) {
        console.log("err", err);
        return res.sendStatus(500);
      }
      message.notify.ack();
      delete db[req.params.id];
      return res.sendStatus(204);
    }
  );
});

router.post("/api/messages/:id/ignore", (req, res) => {
  console.log("ignore", req.params.id);
  const message = db[req.params.id];
  if (!message) return res.sendStatus(404);
  message.notify.ack();
  delete db[req.params.id];
  return res.sendStatus(204);
});

function handleMessage(message, meta, notify) {
  const queues = Array.from(
    new Set(meta.properties.headers["x-death"].map(e => e.queue))
  );
  const id = getUuid(`${meta.fields.consumerTag}-${meta.fields.deliveryTag}`);
  const routingKey = config.routingKeyHeader
    ? meta.properties.headers[config.routingKeyHeader]
    : meta.fields.routingKey;
  const properties = meta.properties;
  const payload = message;
  const correlationId = meta.properties.correlationId;
  console.log(`got message with id ${id} and body ${JSON.stringify(payload)}`);
  const ts = moment(
    Math.min(
      ...meta.properties.headers["x-death"].map(x => x.time.value * 1000)
    )
  ).toISOString();
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
