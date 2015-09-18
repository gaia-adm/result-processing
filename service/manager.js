/**
 * Responsible for result processing service startup. It coordinates work between different modules.
 *
 * @module service/manager
 */
'use strict';

var log4js = require('log4js');
var processors = require('./processors');
var notification = require('./notification');
var metricsGateway = require('./metrics-gateway');
var when = require('when');
var VError = require('verror');
var WError = VError.WError;
var errorUtils = require('../util/error-utils.js');
var getFullError = errorUtils.getFullError;
var fs = require('fs');

var logger = log4js.getLogger('manager.js');

var DEFAULT_BATCH_SIZE = 50;

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
    if (logger.isLevelEnabled(log4js.levels.TRACE)) {
        logger.trace(" [x] Received '%s'", contentStr);
    } else if (logger.isLevelEnabled(log4js.levels.DEBUG)) {
        // with debug level log less
        logger.debug(" [x] Received '%s...'", contentStr.substr(0, 50));
    }
    // process file
    var processingMetadata = msg.properties.headers; // path, accessToken, tenantId
    var contentMetadata = JSON.parse(contentStr);
    var notifier = processors.processFile(processingMetadata, contentMetadata);
    var ackResponse = false;
    // handle new processed data
    var dataArr = [];
    function sendData(dataToSend, end) {
        metricsGateway.send(processingMetadata, dataToSend, function(err) {
            if (err) {
                logger.error(getFullError(new WError(err, 'Failed to send metrics to metrics-gateway-service')));
                // stop further processing
                notifier.stop();
                // ack immediately, no need to wait
                if (!ackResponse) {
                    // TODO: in case of send failure the message should be saved in DB to allow later processing
                    // we cannot nack since it will result in immediate redelivery and another failure for some time (or forever)
                    // in case of error we also don't delete the file
                    ackControl.ack();
                    ackResponse = true;
                }
            } else if (end && !ackResponse) {
                ackControl.ack();
                ackResponse = true;
                unlinkFile(processingMetadata.path);
            }
        });
    }
    function onData(data) {
        dataArr.push(data);
        if (dataArr.length >= getBatchSize()) {
            // reached batch size, send data
            var localArr = dataArr;
            dataArr = [];
            sendData(localArr);
        }
    }
    notifier.on('data', onData);
    // handle on data end
    function onEnd(err) {
        logger.debug('End of data');
        if (dataArr.length > 0) {
            // there are still data to send
            var localArr = dataArr;
            dataArr = [];
            sendData(localArr, true);
        } else {
            // no data to send, we are at end
            if (!ackResponse) {
                if (err) {
                    // TODO: in case of processing failure the message should be saved in DB to allow later processing/investigation
                    // we cannot nack since it will result in immediate redelivery and another failure forever
                    // in case of error we also don't delete the file
                    var errMsg;
                    if (err.code) {
                        errMsg = 'Result processing failed with code ' + err.code;
                    } else {
                        errMsg = 'Result processing failed';
                    }
                    logger.error(getFullError(new WError(err, errMsg)));
                }
                ackControl.ack();
                ackResponse = true;
                if (!err) {
                    unlinkFile(processingMetadata.path);
                }
            }
        }
    }
    notifier.on('end', onEnd);
    // handle processing errors
    function onError(err) {
        logger.error(getFullError(new WError(err, 'Data processing error')));
        // further processing will stop automatically
        // ack immediately, no need to wait
        // TODO: in case of processing failure the message should be saved in DB to allow later processing/investigation
        // we cannot nack since it will result in immediate redelivery and another failure forever
        if (!ackResponse) {
            ackControl.ack();
            ackResponse = true;
        }
    }
    notifier.on('error', onError);
}

/**
 * Unlinks file in file system identified by given file path. File will be deleted once the link count reaches 0.
 *
 * @param path file path
 */
function unlinkFile(path) {
    fs.unlink(path, function(err) {
        if (err) {
            logger.error(getFullError(new WError(err, 'Failed to unlink ' + path)));
        }
    });
}

/**
 * Performs initialization of the result-processing service.
 *
 * @param processorsPath directory where result processors are located
 * @returns promise
 */
function startServer(processorsPath) {
    // discover result processors
    var ok = when.try(processors.init, processorsPath);
    return ok.then(function(processorDescs) {
        // we got array of discovered processors
        if (processorDescs.length > 0) {
            logger.info('Found the following result processors: ' + getProcessorNames(processorDescs));
            return notification.initAmq(processorDescs, msgConsumer);
        } else {
            throw new Error('Found no result processors in "' + processorsPath + '"');
        }
    });
}

/**
 * Shuts down everything cleanly.
 */
function shutdown() {
    return notification.shutdown();
}

exports.startServer = startServer;
exports.shutdown = shutdown;
