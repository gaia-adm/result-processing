/**
 * Responsible for result processing service startup. It coordinates work between different modules.
 *
 * @module service/manager
 */
'use strict';

var log4js = require('log4js');
var processors = require('./processors');
var notification = require('./notification');
var when = require('when');
var Promise = when.promise;

var logger = log4js.getLogger('manager.js');

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

function msgConsumer(msg, ackControl) {
    logger.info(" [x] Received '%s'", msg.content.toString());
    ackControl.ack();
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
