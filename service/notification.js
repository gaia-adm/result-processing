/**
 * Responsible for receiving notifications for processing uploaded files. There is queue per result processor. We cannot
 * have just single queue as each result processing service may have different result processors.
 *
 * @module service/notification
 */
'use strict';

var log4js = require('log4js');
var amqp = require('amqplib');
var VError = require('verror');
var when = require('when');

var logger = log4js.getLogger('notification.js');

var RESULT_EXCHANGE = 'result-upload';
var connection = null;
var channel = null;

/**
 * Collects credentials for connection to AMQ (RabbitMQ).
 *
 * @returns {{username: *, password: *}}
 */
function getAmqCredentials() {
    if (!process.env.AMQ_USER) {
        throw new Error('AMQ_USER environment variable is not specified');
    }
    if (!process.env.AMQ_PASSWORD) {
        throw new Error('AMQ_PASSWORD environment variable is not specified');
    }
    return {
        username: process.env.AMQ_USER, password: process.env.AMQ_PASSWORD
    };
}

/**
 * Returns controller that can be used to ack/nack given message.
 *
 * @param channel
 * @param msg message that should be acked
 * @returns {Function} function
 */
function getAckController(channel, msg) {
    function ack() {
        channel.ack(msg);
    }
    function nack() {
        channel.nack(msg);
    }
    return {ack: ack, nack: nack};
}

/**
 * Creates queue and sets up listening on routing keys determined by processor descriptor. Queue will have name after
 * result processor name.
 *
 * @param channel AMQ channel
 * @param processorDesc one result processor descriptor
 * @param msgConsumer message consumer
 * @returns promise
 */
function initQueue(channel, processorDesc, msgConsumer) {
    var queue = processorDesc.name;
    var ok = channel.assertQueue(queue, {durable: true});

    ok = ok.then(function() {
        logger.debug('Asserted queue \'' + queue + '\' into existence');
        // bind 'result-upload' exchange to our queue using defined routing keys
        var consumesArr = processorDesc.consumes;
        var promises = [];
        consumesArr.forEach(function(consumesItem) {
            var routingKey = getRoutingKey(consumesItem);
            promises.push(channel.bindQueue(queue, RESULT_EXCHANGE, routingKey).then(function() {
                logger.debug('Bound queue \'' + queue + '\' to exchange \'' + RESULT_EXCHANGE + '\' with routing key ' + routingKey);
            }));
        });
        return when.all(promises);
    });

    return ok.then(function() {
        return channel.consume(queue, function(msg) {
            // call msgConsumer with message and contoller to ack it
            msgConsumer(msg, getAckController(channel, msg));
        });
    });
}

/**
 * Creates queues and sets up listening on routing keys determined by processor descriptors. Queues will have names after
 * result processor name.
 *
 * @param channel AMQ channel
 * @param processorDescs result processor descriptors
 * @param msgConsumer message consumer
 * @returns promise
 */
function initQueues(channel, processorDescs, msgConsumer) {
    var promises = [];
    processorDescs.forEach(function(processorDesc) {
        promises.push(initQueue(channel, processorDesc, msgConsumer));
    });
    return when.all(promises);
}

/**
 * Creates AMQ channel on which messages can be received.
 *
 * @param conn AMQ connection
 * @param processorDescs result processor descriptors
 * @param msgConsumer message consumer
 * @returns promise
 */
function initChannel(conn, processorDescs, msgConsumer) {
    // TODO: consider channel per processor, but since Node.js is 1 thread maybe its not needed
    return conn.createChannel().then(function(ch) {
        // TODO: handle channel recreation in case of close caused by error
        function onClose() {
            channel = null;
        }

        function onError(err) {
            logger.error(err.stack);
        }

        function cleanup() {
            ch.removeListener('close', onClose);
            ch.removeListener('error', onError);

            ch.removeListener('close', cleanup);
        }

        ch.on('close', onClose);
        ch.on('error', onError);

        ch.on('close', cleanup);

        channel = ch;
        return initQueues(ch, processorDescs, msgConsumer);
    });
}

/**
 * Initializes connection to RabbitMQ and returns promise to allow waiting for initialization completion.
 * @param processorDescs result processor descriptors
 * @param msgConsumer message consumer
 * @returns promise
 */
function initAmq(processorDescs, msgConsumer) {
    var credentials = getAmqCredentials();
    var url = 'amqp://' + credentials.username + ':' + credentials.password +
                '@amqserver:5672?frameMax=0x1000&heartbeat=30';

    return amqp.connect(url).then(function(conn) {
        // TODO: handle reconnect in case close caused by certain errors (not invalid credentials)
        function onClose() {
        }

        function onError(err) {
            logger.error(err.stack);
        }

        function cleanup() {
            conn.removeListener('close', onClose);
            conn.removeListener('error', onError);

            conn.removeListener('close', cleanup);
        }

        conn.on('close', onClose);
        conn.on('error', onError);

        conn.on('close', cleanup);

        logger.info('Connected to AMQ');

        connection = conn;
        return initChannel(conn, processorDescs, msgConsumer);
    }, function (err) {
        logger.error(err.stack);
        throw new VError(err, 'Failed to connect to AMQ');
    });
}

function getRoutingKey(consumesItem) {
    return consumesItem.metric + '/' + consumesItem.category;
}

/**
 * Closes the channel.
 *
 * @returns promise
 */
function closeChannel() {
    if (channel !== null) {
        var ok = channel.close();
        return ok.finally(function() {
            logger.debug('Closed AMQ channel');
            channel = null;
        });
    } else {
        return when.resolve();
    }
}

/**
 * Closes the AMQP connection.
 *
 * @return promise
 */
function closeConnection() {
    if (connection !== null) {
        var ok = connection.close();
        return ok.finally(function() {
            logger.debug('Closed AMQ connection');
            connection = null;
        });
    } else {
        return when.resolve();
    }
}

/**
 * Closes all channels and connection.
 *
 * @returns promise
 */
function shutdown() {
    var ok = closeChannel();
    return ok.then(closeConnection);
}

/** To be called to initialize the notification module. This involves opening connection to RabbitMQ. Returns promise. */
exports.initAmq = initAmq;
exports.shutdown = shutdown;
