/**
 * Responsible for result processing service startup. It coordinates work between different modules.
 *
 * @module service/manager
 */
'use strict';

var log4js = require('log4js');
var processors = require('./processors');
var notification = require('./notification');
var metricsGateway = require('./metrics_gateway');
var when = require('when');
var Promise = when.promise;
var VError = require('verror');

var logger = log4js.getLogger('manager.js');

var DEFAULT_BATCH_SIZE = 20;

/**
 * Returns batch size when pushing metrics to metrics-gateway-service.
 * @returns {number}
 */
function getBatchSize() {
    return process.env.METRICS_BATCH_SIZE || DEFAULT_BATCH_SIZE;
}

/**
 * Returns comma separated names of processors
 * @param processorDescs array of processor descriptors
 * @returns {string}
 */
function getProcessorNames(processorDescs) {
    var names = [];
    processorDescs.forEach(function(processor) {
        names.push(processor.name);
    });
    return names.toString();
}

/**
 * Listens for message notifications in AMQ that request file processing. The message contains file descriptor. Message
 * consumer lets result processor to process the file and pushes any metrics to metrics-gateway-service.
 *
 * @param msg message received from AMQ
 * @param ackControl object that can be used to ack/nack the message
 */
function msgConsumer(msg, ackControl) {
    var contentStr = msg.content.toString();
    logger.debug(" [x] Received '%s'", contentStr);
    // process file
    var fileDescriptor = JSON.parse(contentStr);
    var notifier = processors.processFile(fileDescriptor);
    var ackResponse = false;
    // handle new processed data
    function onData(data) {
        logger.debug('Parsed data:' + data);
        metricsGateway.send(fileDescriptor.authorization, data, function(err) {
            if (err) {
                logger.error(err.stack);
                logger.error(new VError(err, 'Failed to send metrics to metrics-gateway-service'));
                // stop further processing
                notifier.stop();
                // nack immediately, no need to wait
                if (!ackResponse) {
                    ackControl.nack();
                    ackResponse = true;
                }
            }
        });
    }
    notifier.on('data', onData);
    // handle on data end
    function onEnd(err) {
        logger.debug('End of data');
        if (!ackResponse) {
            if (err) {
                logger.error(err.stack);
                logger.error(new VError(err, 'Result processing failed with code %s', err.code));
                ackControl.nack();
            } else {
                ackControl.ack();
            }
            ackResponse = true;
        }
    }
    notifier.on('end', onEnd);
    // handle processing errors
    function onError(err) {
        logger.error(err.stack);
        logger.error(new VError(err, 'Data processing error'));
        // further processing will stop automatically
        // nack immediately, no need to wait
        if (!ackResponse) {
            ackControl.nack();
            ackResponse = true;
        }
    }
    notifier.on('error', onError);
}

function startServer(processorsPath) {
    // discover result processors
    return new Promise(function(fulfill, reject) {
        // TODO: convert processors.init to Promises
        processors.init(processorsPath, function(err, processorDescs) {
            if (err) {
                reject(err);
            } else {
                // we got array of discovered processors
                if (processorDescs.length > 0) {
                    logger.info('Found the following result processors: ' + getProcessorNames(processorDescs));
                    notification.initAmq(processorDescs, msgConsumer).done(function onOk() {
                        fulfill();
                    }, function onError(err) {
                        reject(err);
                    });
                } else {
                    reject(new Error('Found no result processors'));
                }
            }
        });
    });
}

exports.startServer = startServer;
