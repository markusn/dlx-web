# dlx-web
[![Build Status](https://github.com/markusn/dlx-web/actions/workflows/test.yml/badge.svg)](https://github.com/markusn/dlx-web/actions/workflows/test.yml)

Web UI and backend to manually handle dead letters. Works by checking out all messages from
the dead letter queue and keeping them until shutdown or an action is
taken from the GUI. The supported actions is a delete (acks the
message on the queue) and resend. Resend sends the message back
directly to the first dead-lettering queue unchanged or with the
modifications made in the GUI.

# Configuration
Configuration is done in the implementing project. Use `config/ENVIRONMENT.(js|json)`.

Useful keys:
`dlxRabbit` (mandatory) specify the RabbitMQ URL and Exchange.
`routingKeyHeader` (optional) if the displayed routing key should be fetched from
a header instead of using the actual routing key.
`dlxQueue` (mandatory) the queue to fetch dead lettered messages from.
`payloadCorrelationId` (optional) instead of using the AMQP standard
correlation id header use the JSON path from `payloadCorrelationId` to
grab the correlation id from the payload.
`basicAuth` (optional) if set and contains a key `username` and
`password` DLX-web will be protected by basic auth.

## Trello
dlx-web has a simple Trello integration that can display info about and add
cards in trello for messages that are on the dead letter queue.

Messages that have an associated card will display a link to the card, which list
the card is in and assigned members (if any).

Cards created by dlx-web will will have:
* Name: DLX `<routingKey>`
* Description `<correlationId>` `<message>`

To avoid managing state a search is made with the trello api to find cards associated
with a message by their correlationId. This also means you can associate a message
with a trello card by adding the messages correlationId to the cards description.

### Configuration
Trello integration is activated by adding a trello object to the config file.
```
"trello": {
  "apiKey": "<trello-api-key>",
  "token": "<trello-token>",
  "boardId": "<trello-board-id>",
  "createOnListId": "<trello-list-id>",
  "labelIds": "<trello-label-ids>"
}
```

* `apiKey` (required) see https://trello.com/app-key
* `token` (required) see https://trello.com/app-key
* `boardId` (required) Board id to associate dlx-web with (find with GET `https://api.trello.com/1/members/me/boards`)
* `createOnListId` (required) List id to create new card on (find with GET `https://api.trello.com/1/boards/<boardId>/lists`)
* `labelIds` (optional) comma separated list with labelIds to add on created card (find with GET `https://api.trello.com/1/boards/<boardId>/labels`)

