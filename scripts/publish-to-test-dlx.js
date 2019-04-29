const uuid = require("uuid");
const initConnection = require("exp-amqp-connection");
const config = require("exp-config");

const behavior = Object.assign(
  {
    confirm: true,
    ack: true,
    prefetch: 200
  },
  config.testRabbit
);

const broker = initConnection(behavior);

broker.subscribeTmp(
  "#",
  (message, meta, notify) => {
    console.log(message);
    if (message.do === "nack") {
      console.log("nacking");
      notify.nack(false);
      setTimeout(() => {
        // eslint-disable-next-line no-process-exit
        process.exit(0);
      }, 500);
    }
  },
  () => {
    setTimeout(() => {
      console.log("listener up");
      broker.publish("foo", {do: "nack"}, {correlationId: uuid.v4()}, (err, res) => {
        setTimeout(() => {
          console.log(err, res);
        }, 1000);
      });
    }, 1000);
  }
);
