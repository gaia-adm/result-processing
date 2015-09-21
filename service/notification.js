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
var WError = VError.WError;
var errorUtils = require('../util/error-utils.js');
var getFullError = errorUtils.getFullError;
var when = require('when');
var os = require('os');

var logger = log4js.getLogger('notification.js');

var RESULT_EXCHANGE = 'result-upload';
var processorDescs = null;
var msgConsumer = null;
var connection = null;
var channel = null;

var RECONNECT_TIMEOUT = 10000;
var MAX_RECONNECT_COUNTER = 3;
var reconnectCounter = 0;
var recreateChannelTimerId = null;
var reconnectTimerId = null;

/**
 * Collects credentials for connection to AMQ (RabbitMQ).
 *
 * @returns {{username: *, password: *}}
 */
function getAmqCredentials() {
    if (!process.env.AMQ_USER) {
        throw new Error('AMQ_USER environment variable is not specified');
    }
    var pwd = process.env.AMQ_PASSWORD ? process.env.AMQ_PASSWORD : '';
    return {
        username: process.env.AMQ_USER, password: pwd
    };
}

/**
 * Returns hostname:port of RabbitMQ server.
 */
function getAmqServer() {
    if (!process.env.AMQ_SERVER) {
        throw new Error('AMQ_SERVER environment variable is not specified');
    }
    return process.env.AMQ_SERVER;
}

/**
 * Returns number of processors that may execute in parallel.
 */
function getParallelism() {
    return Number(process.env.PROCESSORS_PARALLELISM) || os.cpus().length;
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
 * consumesItem dataType.
 *
 * @param channel AMQ channel
 * @param processorDesc one result processor descriptor
 * @param consumesItem one item of consumes array
 * @param msgConsumer message consumer
 * @returns promise
 */
function initQueue(channel, processorDesc, consumesItem, msgConsumer) {
    var queue = consumesItem.dataType;
    var ok = channel.assertQueue(queue, {durable: true});

    ok = ok.then(function() {
        logger.debug('Asserted queue \'' + queue + '\' into existence');
        // bind 'result-upload' exchange to our queue using routing key
        var routingKey = consumesItem.dataType;
        return channel.bindQueue(queue, RESULT_EXCHANGE, routingKey).then(function() {
            logger.debug('Bound queue \'' + queue + '\' to exchange \'' + RESULT_EXCHANGE + '\' with routing key ' + routingKey);
        });
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
        var consumesArr = processorDesc.consumes;
        consumesArr.forEach(function(consumesItem) {
            promises.push(initQueue(channel, processorDesc, consumesItem, msgConsumer));
        });
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
    var ok = conn.createChannel().then(function(ch) {
        var parallelism = getParallelism();
        logger.info('Allowing up to ' + parallelism + ' parallel data processor executions');
        ch.prefetch(parallelism, true);

        function onClose() {
            logger.debug('Closed MQ channel');
            channel = null;
        }

        function onError(err) {
            logger.error(getFullError(new WError(err, 'Channel reached error state')));
            scheduleRecreateChannel();
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
        return ch.assertExchange('result-upload', 'direct', {durable: true}).then(function() {
        //return ch.checkExchange('wrongEx').then(function() {
            logger.debug('Exchange \'result-upload\' has been asserted into existence');
        });
    });
    ok = ok.then(function() {
        return initQueues(channel, processorDescs, msgConsumer);
    });
    ok = ok.then(function() {
        reconnectCounter = 0;
    });
    return ok;
}

/**
 * Initializes connection to RabbitMQ and returns promise to allow waiting for initialization completion.
 * @returns promise
 */
function initAmqConnection(handleReconnect) {
    var credentials = getAmqCredentials();
    var url = 'amqp://' + credentials.username + ':' + credentials.password +
                '@' + getAmqServer() + '?frameMax=0x1000&heartbeat=30';

    return amqp.connect(url).then(function(conn) {
        function onClose() {
            logger.debug('Closed MQ connection');
            connection = null;
        }

        function onError(err) {
            logger.error(getFullError(new WError(err, 'Connection reached error state')));
            if (handleReconnect) {
                scheduleReconnect();
            }
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
        // amqp.connect failed, could be wrong password, host unreachable etc
        throw new WError(err, 'Failed to connect to RabbitMQ');
    });
}

function initAmq(pProcessorDescs, pMsgConsumer, handleReconnect) {
    processorDescs = pProcessorDescs;
    msgConsumer = pMsgConsumer;
    var ok = initAmqConnection(handleReconnect);
    ok = ok.then(function onFulfilled() {
        logger.info(' [*] Waiting for messages. To exit press CTRL+C');
    }).catch(function onRejected(err) {
        if (handleReconnect) {
            logger.error(getFullError(new WError(err, 'Failed to initialize RabbitMQ connection or channel')));
            scheduleReconnect();
        } else {
            throw err;
        }
    });
    return ok;
}

function scheduleRecreateChannel() {
    if (recreateChannelTimerId) {
        return;
    }
    function doRecreateChannel() {
        recreateChannelTimerId = null;
        closeChannel().finally(function() {
            if (connection !== null) {
                logger.debug('Recreating channel..');
                initChannel(connection, processorDescs, msgConsumer);
            }
        });
    }
    reconnectCounter++;
    reconnectCounter = Math.min(reconnectCounter, MAX_RECONNECT_COUNTER);
    var delay = reconnectCounter * RECONNECT_TIMEOUT;
    logger.debug('Trying next channel recreation in ' + delay / 1000 + 's');
    recreateChannelTimerId = setTimeout(doRecreateChannel, delay);
}

function scheduleReconnect() {
    if (recreateChannelTimerId) {
        reconnectCounter--;
        reconnectCounter = Math.max(reconnectCounter, 0);
        clearTimeout(recreateChannelTimerId);
        recreateChannelTimerId = null;
    }
    if (reconnectTimerId) {
        return;
    }
    function doReconnect() {
        reconnectTimerId = null;
        shutdown().finally(function() {
            logger.debug('Reconnecting to RabbitMQ..');
            initAmq(processorDescs, msgConsumer, true);
        });
    }
    reconnectCounter++;
    reconnectCounter = Math.min(reconnectCounter, MAX_RECONNECT_COUNTER);
    var delay = reconnectCounter * RECONNECT_TIMEOUT;
    logger.debug('Trying next reconnect in ' + delay / 1000 + 's');
    reconnectTimerId = setTimeout(doReconnect, delay);
}

/**
 * Closes the channel.
 *
 * @returns promise
 */
function closeChannel() {
    if (channel !== null) {
        return channel.close();
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
        return connection.close();
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
