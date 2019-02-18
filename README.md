# dlx-web
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
